import { describe, expect, it } from "vitest"
import { captureGoalieShotSnapshot, fillMissingGoalieShots, inferGoalieShots, prepareScorekeeperFinalization } from "@/lib/automatic-goalie-shots"
import { createInitialState, type GoalieChangeEvent, type LiveGameState } from "@/lib/scorekeeper-types"

function state(): LiveGameState {
  return { ...createInitialState(), period: 3, homeGoalieId: 3, awayGoalieId: 2,
    homeShots: [5, 5, 5], awayShots: [4, 4, 4],
    goalieChanges: [{ id: "swap", team: "home", period: 2, clock: "8:00", outGoalieId: 1, inGoalieId: 3,
      shotSnapshot: { period: 2, clock: "8:00", opponentShots: [4, 2, 0] } }] }
}
const infer = (s: LiveGameState) => inferGoalieShots(s, "home", "away", true)
function eng(s: LiveGameState, period: number, clock: string) {
  s.goals.push({ id: `eng-${s.goals.length}`, team: "away", period, clock, scorerId: 20, assist1Id: null, assist2Id: null, flags: ["ENG"] })
}

describe("automatic goalie shot allocations", () => {
  it("uses opposing shots minus ENG for a single goalie, including recorded pulls", () => {
    const s = state(); s.goalieChanges = []
    s.goaliePulls = [{ id: "pull", team: "home", period: 3, pulledAt: "1:00", returnedAt: "0:10" }]
    eng(s, 3, "0:30")
    expect(infer(s)).toEqual({ "3": 11 })
  })
  it("splits shots using recorded substitution counters, not time played", () => {
    expect(infer(state())).toEqual({ "1": 6, "3": 6 })
  })
  it("merges returning goalie stints and excludes ENG during a relief-goalie pull", () => {
    const s = state()
    s.goalieChanges.push({ id: "return", team: "home", period: 3, clock: "1:00", outGoalieId: 3, inGoalieId: 1,
      shotSnapshot: { period: 3, clock: "1:00", opponentShots: [4, 4, 3] } })
    s.homeGoalieId = 1
    s.goaliePulls = [{ id: "pull", team: "home", period: 3, pulledAt: "2:00", returnedAt: "1:20" }]
    eng(s, 3, "1:30")
    expect(infer(s)).toEqual({ "1": 7, "3": 4 })
  })
  it("recalculates allocations when a recorded goal is corrected to empty-net", () => {
    const s = state(); eng(s, 1, "1:00")
    s.goalieShotsAgainst = { "1": 6, "3": 6 }
    expect(prepareScorekeeperFinalization(s, "home", "away").goalieShotsAgainst).toEqual({ "1": 5, "3": 6 })
  })
  it.each(["missing", "moved", "past-period-edit", "counter-regression", "same-second-eng", "broken-chain"])("does not invent allocations when evidence is %s", (reason) => {
    const s = state()
    if (reason === "missing") delete s.goalieChanges[0].shotSnapshot
    if (reason === "moved") s.goalieChanges[0].clock = "7:00"
    if (reason === "past-period-edit") s.awayShots[0] = 5
    if (reason === "counter-regression") s.awayShots[1] = 1
    if (reason === "same-second-eng") eng(s, 2, "8:00")
    if (reason === "broken-chain") s.homeGoalieId = 1
    expect(infer(s)).toBeNull()
  })
  it("keeps an existing admin allocation for a legacy game without shot snapshots", () => {
    const s = state(); delete s.goalieChanges[0].shotSnapshot
    s.goalieShotsAgainst = { "1": 5, "3": 7 }
    expect(prepareScorekeeperFinalization(s, "home", "away").goalieShotsAgainst).toEqual({ "1": 5, "3": 7 })
  })
  it("does not overwrite explicit admin entries, including invalid entries that must be rejected", () => {
    const s = state(); s.goalieShotsAgainst = { "1": 0, "3": 0 }
    fillMissingGoalieShots(s, "home", "away")
    expect(s.goalieShotsAgainst).toEqual({ "1": 0, "3": 0 })
  })
  it("captures an immutable copy of the opposing counters at a live swap", () => {
    const s = state()
    const change: GoalieChangeEvent = { id: "new", team: "home", period: 2, clock: "8:00", outGoalieId: 1, inGoalieId: 3 }
    const captured = captureGoalieShotSnapshot(s, change, "home")
    s.awayShots[0]++
    expect(captured.shotSnapshot).toEqual({ period: 2, clock: "8:00", opponentShots: [4, 4, 4] })
    expect(change.shotSnapshot).toBeUndefined()
  })
})
