import { parseClockString, type LiveGameState } from "./scorekeeper-types"

/** Remove a mistaken substitution while preserving later, real substitutions. */
export function removeGoalieChange(state: LiveGameState, id: string, homeSlug: string): LiveGameState {
  const changes = state.goalieChanges ?? []
  const removed = changes.find(change => change.id === id)
  if (!removed) return state
  const teamChanges = changes.filter(change => change.team === removed.team)
    .sort((a, b) => a.period - b.period || parseClockString(b.clock) - parseClockString(a.clock))
  const next = teamChanges[teamChanges.findIndex(change => change.id === id) + 1]
  const key = removed.team === homeSlug ? "homeGoalieId" : "awayGoalieId"
  return {
    ...state,
    // Don't overwrite a later substitution or a separate goalie correction.
    [key]: !next && state[key] === removed.inGoalieId ? removed.outGoalieId : state[key],
    goalieChanges: changes.filter(change => change.id !== id).flatMap(change => {
      if (change.id !== next?.id || change.outGoalieId !== removed.inGoalieId) return [change]
      // A -> B (mistake), B -> A becomes no substitution at all.
      if (change.inGoalieId === removed.outGoalieId) return []
      return [{ ...change, outGoalieId: removed.outGoalieId }]
    }),
  }
}
