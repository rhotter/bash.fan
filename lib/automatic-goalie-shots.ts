import type { GoalieChangeEvent, LiveGameState } from "./scorekeeper-types"
import { parseClockString, shotPeriodIndex } from "./scorekeeper-types"
import { validateShotArray } from "./goalie-shot-validation"

const sum = (shots: number[]) => shots.reduce((total, count) => total + count, 0)
const order = (a: { period: number; clock: string }, b: { period: number; clock: string }) =>
  a.period - b.period || parseClockString(b.clock) - parseClockString(a.clock)

/** Shot totals recorded at every substitution establish the split; time played doesn't. */
export function inferGoalieShots(state: LiveGameState, team: string, opponent: string, home: boolean): Record<string, number> | null {
  const shots = home ? state.awayShots : state.homeShots
  const currentGoalie = home ? state.homeGoalieId : state.awayGoalieId
  if (currentGoalie == null || validateShotArray(shots, "Shots")) return null
  const emptyNetGoals = state.goals.filter(g => g.team === opponent && g.period <= 4 && g.flags.includes("ENG"))
  const changes = (state.goalieChanges ?? []).filter(c => c.team === team).sort(order)
  if (!changes.length) {
    const total = sum(shots) - emptyNetGoals.length
    return total >= 0 ? { [currentGoalie]: total } : null
  }
  if (changes.at(-1)!.inGoalieId !== currentGoalie) return null

  let previousShots = [0, 0, 0, 0]
  let previousEmptyNetGoals = 0
  const allocation: Record<string, number> = {}
  for (const [index, change] of changes.entries()) {
    const snapshot = change.shotSnapshot
    // Moving a substitution, changing already completed periods, or missing a
    // boundary makes the recorded split ambiguous. Leave it for admin review.
    if (!snapshot || snapshot.period !== change.period || snapshot.clock !== change.clock ||
      validateShotArray(snapshot.opponentShots, "Shots at substitution") ||
      change.outGoalieId === change.inGoalieId ||
      (index > 0 && changes[index - 1].inGoalieId !== change.outGoalieId)) return null
    const periodIndex = shotPeriodIndex(change.period)
    if (periodIndex < 0 || snapshot.opponentShots.some((count, i) =>
      count < (previousShots[i] ?? 0) || count > (shots[i] ?? 0) ||
      (i < periodIndex && count !== (shots[i] ?? 0)) || (i > periodIndex && count !== 0))) return null
    // A same-second ENG and substitution have no recorded ordering.
    if (emptyNetGoals.some(goal => order(goal, change) === 0)) return null
    const emptyBefore = emptyNetGoals.filter(goal => order(goal, change) < 0).length
    const faced = sum(snapshot.opponentShots) - sum(previousShots) - (emptyBefore - previousEmptyNetGoals)
    if (faced < 0) return null
    allocation[change.outGoalieId] = (allocation[change.outGoalieId] ?? 0) + faced
    previousShots = snapshot.opponentShots
    previousEmptyNetGoals = emptyBefore
  }
  const faced = sum(shots) - sum(previousShots) - (emptyNetGoals.length - previousEmptyNetGoals)
  if (faced < 0) return null
  allocation[currentGoalie] = (allocation[currentGoalie] ?? 0) + faced
  return allocation
}

export function captureGoalieShotSnapshot(state: LiveGameState, change: GoalieChangeEvent, homeSlug: string): GoalieChangeEvent {
  return { ...change, shotSnapshot: {
    period: change.period, clock: change.clock,
    opponentShots: [...(change.team === homeSlug ? state.awayShots : state.homeShots)],
  } }
}

/** Scorekeeper finalization derives known totals instead of exposing manual fields.
 * Existing allocations remain available for legacy games whose history is incomplete. */
export function prepareScorekeeperFinalization(state: LiveGameState, homeSlug: string, awaySlug: string): LiveGameState {
  const allocation = { ...state.goalieShotsAgainst }
  for (const [team, opponent, home] of [[homeSlug, awaySlug, true], [awaySlug, homeSlug, false]] as const) {
    const inferred = inferGoalieShots(state, team, opponent, home)
    if (!(state.goalieChanges ?? []).some(change => change.team === team)) {
      const goalie = home ? state.homeGoalieId : state.awayGoalieId
      // The existing single-goalie server path already derives this total.
      // Drop stale overrides after an ENG correction instead of requiring input.
      if (goalie != null) delete allocation[String(goalie)]
    } else if (inferred) Object.assign(allocation, inferred)
  }
  return { ...state, goalieShotsAgainst: allocation }
}

/** Preserve explicit admin allocations and validate them as usual. Fill only a
 * wholly unallocated team, using evidence captured by the live scorekeeper. */
export function fillMissingGoalieShots(state: LiveGameState, homeSlug: string, awaySlug: string): void {
  if (state.goalieShotsAgainst !== undefined && (!state.goalieShotsAgainst ||
    typeof state.goalieShotsAgainst !== "object" || Array.isArray(state.goalieShotsAgainst))) return
  for (const [team, opponent, home] of [[homeSlug, awaySlug, true], [awaySlug, homeSlug, false]] as const) {
    if (!(state.goalieChanges ?? []).some(change => change.team === team)) continue
    const inferred = inferGoalieShots(state, team, opponent, home)
    if (inferred && !Object.keys(inferred).some(id => state.goalieShotsAgainst?.[id] !== undefined)) {
      state.goalieShotsAgainst = { ...state.goalieShotsAgainst, ...inferred }
    }
  }
}
