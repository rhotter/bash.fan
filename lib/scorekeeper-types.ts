export interface GoalEvent {
  id: string
  team: string
  period: number
  clock: string // "MM:SS"
  scorerId: number
  assist1Id: number | null
  assist2Id: number | null
  flags: string[] // "PPG", "SHG", "ENG"
}

export interface PenaltyEvent {
  id: string
  team: string
  period: number
  clock: string
  playerId: number
  infraction: string
  minutes: number // 2, 4, 5, 10
  // Power play tracking
  endedByGoalId?: string // fully ended by a PPG (minor/double-minor second half)
  adjustedEndElapsed?: number // for double minor: adjusted expiration after PPG ends first half
}

export interface TimeoutEvent {
  id: string
  team: string
  period: number
  clock: string // "MM:SS"
}

export interface ShootoutAttempt {
  playerId: number
  scored: boolean
}

export interface ShootoutState {
  homeAttempts: ShootoutAttempt[]
  awayAttempts: ShootoutAttempt[]
}

export interface LiveGameState {
  period: number // 0=pre-game, 1-3=regulation, 4=OT, 5=shootout
  clockSeconds: number // countdown seconds remaining
  clockRunning: boolean
  clockStartedAt: number | null // Date.now() when clock was last started
  homeShots: number[] // [p1, p2, p3, ot]
  awayShots: number[]
  homeTimeoutsUsed: number
  awayTimeoutsUsed: number
  homeAttendance: number[] // player IDs present
  awayAttendance: number[]
  goals: GoalEvent[]
  penalties: PenaltyEvent[]
  timeouts: TimeoutEvent[]
  shootout: ShootoutState | null
  threeStars: number[] | null // [1st, 2nd, 3rd] player IDs
  officials: { ref1: string; ref2: string; scorekeeper: string }
  notes: string
  updatedAt: number // timestamp for merge resolution
}

export interface RosterPlayer {
  id: number
  name: string
  isGoalie: boolean
}

export function createInitialState(): LiveGameState {
  return {
    period: 0,
    clockSeconds: 1200,
    clockRunning: false,
    clockStartedAt: null,
    homeShots: [0, 0, 0],
    awayShots: [0, 0, 0],
    homeTimeoutsUsed: 0,
    awayTimeoutsUsed: 0,
    homeAttendance: [],
    awayAttendance: [],
    goals: [],
    penalties: [],
    timeouts: [],
    shootout: null,
    threeStars: null,
    officials: { ref1: "", ref2: "", scorekeeper: "" },
    notes: "",
    updatedAt: Date.now(),
  }
}

export function periodLabel(period: number): string {
  if (period === 0) return "Pre-Game"
  if (period <= 3) return `P${period}`
  if (period === 4) return "OT"
  if (period === 5) return "SO"
  return `P${period}`
}

export function formatClock(seconds: number): string {
  const m = Math.max(0, Math.floor(seconds / 60))
  const s = Math.max(0, Math.floor(seconds % 60))
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function computeCurrentClock(state: LiveGameState): number {
  if (!state.clockRunning || !state.clockStartedAt) return state.clockSeconds
  const elapsed = (Date.now() - state.clockStartedAt) / 1000
  return Math.max(0, state.clockSeconds - elapsed)
}

export function computeScore(goals: GoalEvent[], homeSlug: string, awaySlug: string) {
  let home = 0
  let away = 0
  for (const g of goals) {
    // Shootout goals don't count in the score display during shootout
    // They're tracked separately. Only count regulation + OT goals.
    if (g.period <= 4) {
      if (g.team === homeSlug) home++
      else if (g.team === awaySlug) away++
    }
  }
  return { home, away }
}

/** Period index for shots array (0-based). OT maps to index 3. */
export function shotPeriodIndex(period: number): number {
  if (period <= 3) return period - 1
  return 3 // OT
}

// ─── Power Play Tracking ──────────────────────────────────────────────────

/** Convert period + clock seconds remaining to total elapsed game seconds. */
export function clockToElapsed(period: number, clockSeconds: number): number {
  const periodLength = period <= 3 ? 1200 : period === 4 ? 300 : 0
  const elapsedInPeriod = periodLength - clockSeconds
  let totalElapsed = 0
  for (let p = 1; p < period; p++) {
    totalElapsed += p <= 3 ? 1200 : 300
  }
  return totalElapsed + elapsedInPeriod
}

/** Parse "M:SS" clock string to seconds remaining. */
export function parseClockString(clock: string): number {
  const parts = clock.split(":")
  return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0)
}

export interface ActivePenalty {
  penalty: PenaltyEvent
  remainingSeconds: number
}

/** Get all currently active (being served) penalties that affect man strength. */
export function getActivePenalties(
  penalties: PenaltyEvent[],
  currentPeriod: number,
  currentClockSeconds: number
): ActivePenalty[] {
  if (currentPeriod === 0 || currentPeriod === 5) return []
  const currentElapsed = clockToElapsed(currentPeriod, currentClockSeconds)

  return penalties
    .filter((p) => !p.endedByGoalId) // not fully ended by a PPG
    .filter((p) => p.minutes <= 5) // 10-min misconducts don't affect strength
    .map((p) => {
      const startElapsed = clockToElapsed(p.period, parseClockString(p.clock))
      const endElapsed = p.adjustedEndElapsed ?? startElapsed + p.minutes * 60
      const remaining = Math.min(endElapsed - currentElapsed, p.minutes * 60)
      return { penalty: p, remainingSeconds: remaining }
    })
    .filter((ap) => ap.remainingSeconds > 0)
}

export interface PowerPlayState {
  ppTeam: string | null // team slug on the power play, or null if even strength
  pkTeam: string | null // team slug on the penalty kill
  homePenalties: number // number of active penalties against home
  awayPenalties: number // number of active penalties against away
}

/** Determine which team (if any) is on the power play. */
export function getPowerPlayState(
  penalties: PenaltyEvent[],
  currentPeriod: number,
  currentClockSeconds: number,
  homeSlug: string,
  awaySlug: string
): PowerPlayState {
  const active = getActivePenalties(penalties, currentPeriod, currentClockSeconds)
  const homePenalties = active.filter((ap) => ap.penalty.team === homeSlug).length
  const awayPenalties = active.filter((ap) => ap.penalty.team === awaySlug).length

  if (homePenalties > awayPenalties) {
    return { ppTeam: awaySlug, pkTeam: homeSlug, homePenalties, awayPenalties }
  }
  if (awayPenalties > homePenalties) {
    return { ppTeam: homeSlug, pkTeam: awaySlug, homePenalties, awayPenalties }
  }
  return { ppTeam: null, pkTeam: null, homePenalties, awayPenalties }
}

/**
 * Find the earliest eligible penalty to end when a PP goal is scored.
 * Returns the penalty to end, or null if none eligible.
 * Rules: 2-min minors end immediately. 4-min double minors: if > 2 min left,
 * adjust to 2 min from now; if <= 2 min left, end immediately. 5-min majors: never end.
 */
export function findPenaltyToEnd(
  penalties: PenaltyEvent[],
  scoringTeam: string,
  currentPeriod: number,
  currentClockSeconds: number
): { penaltyId: string; action: "end" | "halve" } | null {
  const currentElapsed = clockToElapsed(currentPeriod, currentClockSeconds)
  const opposingPenalties = getActivePenalties(penalties, currentPeriod, currentClockSeconds)
    .filter((ap) => ap.penalty.team !== scoringTeam)
    .sort((a, b) => a.remainingSeconds - b.remainingSeconds) // earliest expiring first

  for (const ap of opposingPenalties) {
    const p = ap.penalty
    if (p.minutes === 5) continue // majors don't end on PPG
    if (p.minutes === 2) return { penaltyId: p.id, action: "end" }
    if (p.minutes === 4) {
      const startElapsed = clockToElapsed(p.period, parseClockString(p.clock))
      const halfwayPoint = p.adjustedEndElapsed
        ? p.adjustedEndElapsed // already been halved once, so end it
        : startElapsed + 120
      if (currentElapsed < halfwayPoint) {
        // In first half: adjust to expire 2 min from now
        return { penaltyId: p.id, action: "halve" }
      } else {
        // In second half: end it
        return { penaltyId: p.id, action: "end" }
      }
    }
  }
  return null
}
