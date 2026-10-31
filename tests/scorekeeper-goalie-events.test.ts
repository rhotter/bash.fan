import { describe, expect, it } from "vitest"
import { createInitialState, type GoalieChangeEvent } from "@/lib/scorekeeper-types"
import { removeGoalieChange } from "@/lib/scorekeeper-goalie-events"
import { inferGoalieShots } from "@/lib/automatic-goalie-shots"

const change = (id: string, outGoalieId: number, inGoalieId: number, clock: string, shots: number): GoalieChangeEvent => ({
  id, team: "home", period: 1, clock, outGoalieId, inGoalieId,
  shotSnapshot: { period: 1, clock, opponentShots: [shots, 0, 0] },
})
describe("substitution removal", () => {
  it("repairs the next substitution and shot allocation without changing the current goalie", () => {
    const state = { ...createInitialState(), homeGoalieId: 3, awayShots: [10, 0, 0],
      goalieChanges: [change("a", 1, 2, "15:00", 2), change("b", 2, 3, "10:00", 6)] }
    const result = removeGoalieChange(state, "a", "home")
    expect(result.homeGoalieId).toBe(3)
    expect(result.goalieChanges).toEqual([change("b", 1, 3, "10:00", 6)])
    expect(inferGoalieShots(result, "home", "away", true)).toEqual({ 1: 6, 3: 4 })
    expect(state.goalieChanges).toHaveLength(2)
  })
  it("removes a now-redundant return substitution", () => {
    const state = { ...createInitialState(), homeGoalieId: 1,
      goalieChanges: [change("a", 1, 2, "15:00", 2), change("b", 2, 1, "10:00", 6)] }
    expect(removeGoalieChange(state, "a", "home").goalieChanges).toEqual([])
  })
  it("restores the away goalie without affecting home", () => {
    const state = { ...createInitialState(), homeGoalieId: 8, awayGoalieId: 2,
      goalieChanges: [{ ...change("a", 1, 2, "15:00", 2), team: "away" }] }
    expect(removeGoalieChange(state, "a", "home")).toMatchObject({ homeGoalieId: 8, awayGoalieId: 1, goalieChanges: [] })
  })
  it("preserves a separate manual goalie correction", () => {
    const state = { ...createInitialState(), homeGoalieId: 9, goalieChanges: [change("a", 1, 2, "15:00", 2)] }
    expect(removeGoalieChange(state, "a", "home").homeGoalieId).toBe(9)
    expect(removeGoalieChange(state, "missing", "home")).toBe(state)
  })
})
