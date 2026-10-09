import { describe, expect, it } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { createInitialState } from "@/lib/scorekeeper-types"
import { finalShotUpdateSql, planFinalShotCorrection, type FinalShotContext } from "@/lib/final-game-shots"
import { gameEditMode } from "@/lib/game-edit-mode"

function context(): FinalShotContext {
  return {
    status: "final", seasonId: "2026-summer", gameLength: 45, isOvertime: true, isForfeit: false, homeTeam: "home", awayTeam: "away", homeScore: 4, awayScore: 5,
    state: createInitialState(),
    goalies: [
      { playerId: 1, goalsAgainst: 5, shotsAgainst: 0, saves: -5, seconds: 2749, sides: ["home"] },
      { playerId: 2, goalsAgainst: 4, shotsAgainst: 0, saves: -4, seconds: 2749, sides: ["away"] },
    ],
  }
}
const correction = { homeShots: [9, 10, 10], awayShots: [14, 14, 15] }

describe("final-game shot corrections", () => {
  it("reconciles shots and saves from saved goalie rows without replaying an empty legacy event history", () => {
    const before = context()
    const preserved = structuredClone(before)
    expect(planFinalShotCorrection(before, correction)).toEqual([
      { playerId: 1, shotsAgainst: 43, saves: 38 },
      { playerId: 2, shotsAgainst: 29, saves: 25 },
    ])
    expect(before).toEqual(preserved)
  })

  it.each([[0, 0, 0], [-1, 10, 10], [1.5, 10, 10], [NaN, 10, 10], [Infinity, 1, 1]])("rejects invalid/insufficient shots %s without clamping", (...shots) => {
    const ctx = context()
    ctx.state.homeShots = [2, 2, 2]
    expect(() => planFinalShotCorrection(ctx, { ...correction, homeShots: shots })).toThrow()
  })

  it("does not assign a team total to each of multiple goalies", () => {
    const ctx = context()
    ctx.goalies[0].goalsAgainst = 3
    ctx.goalies[0].seconds = 1549
    ctx.goalies.push({ playerId: 3, goalsAgainst: 2, shotsAgainst: 0, saves: -2, seconds: 1200, sides: ["home"] })
    expect(() => planFinalShotCorrection(ctx, correction)).toThrow(/explicit/)
    expect(planFinalShotCorrection(ctx, { ...correction, goalieShotsAgainst: { 1: 20, 3: 23 } })).toEqual([
      { playerId: 1, shotsAgainst: 20, saves: 17 },
      { playerId: 3, shotsAgainst: 23, saves: 21 },
      { playerId: 2, shotsAgainst: 29, saves: 25 },
    ])
    expect(() => planFinalShotCorrection(ctx, { ...correction, goalieShotsAgainst: { 1: 41, 3: 2.5 } })).toThrow()
    expect(() => planFinalShotCorrection(ctx, { ...correction, goalieShotsAgainst: { 1: 42, 3: 1 } })).toThrow()
    expect(() => planFinalShotCorrection(ctx, { ...correction, goalieShotsAgainst: { 1: 20 } })).toThrow()
  })

  it.each(["changes", "pulls", "time", "assignment", "membership"])("requires review when a single row has ambiguous %s", (kind) => {
    const ctx = context()
    if (kind === "changes") ctx.state.goalieChanges = [{ id: "c", team: "home", period: 2, clock: "10:00", outGoalieId: 1, inGoalieId: 3 }]
    if (kind === "pulls") ctx.state.goaliePulls = [{ id: "p", team: "home", period: 3, pulledAt: "1:00", returnedAt: null }]
    if (kind === "time") ctx.goalies[0].seconds = 0
    if (kind === "assignment") ctx.state.homeGoalieId = 3
    if (kind === "membership") ctx.goalies[0].sides = ["home", "away"]
    expect(() => planFinalShotCorrection(ctx, correction)).toThrow()
  })

  it("requires scoring review rather than inferring missing empty-net or shootout goals", () => {
    const ctx = context()
    ctx.awayScore = 6
    expect(() => planFinalShotCorrection(ctx, correction)).toThrow(/official score/)
  })

  it("subtracts documented empty-net goals instead of manufacturing a goalie save", () => {
    const ctx = context()
    ctx.awayScore = 6
    ctx.state.goals = [{ id: "eng", team: "away", period: 3, clock: "0:02", scorerId: 20, assist1Id: null, assist2Id: null, flags: ["ENG"] }]
    expect(planFinalShotCorrection(ctx, correction)[0]).toEqual({ playerId: 1, shotsAgainst: 42, saves: 37 })
  })

  it("preserves an unchanged team's raw stats", () => {
    const ctx = context()
    const result = planFinalShotCorrection(ctx, { ...correction, awayShots: ctx.state.awayShots })
    expect(result).toEqual([{ playerId: 2, shotsAgainst: 29, saves: 25 }])
  })

  it.each(["partial", "mismatched", "non-overtime", "missing-duration"])("requires recorded allocations when full-game time is not supported: %s", (kind) => {
    const ctx = context()
    if (kind === "partial") ctx.goalies[0].seconds = 60
    if (kind === "mismatched") ctx.goalies[1].seconds = 2700
    if (kind === "non-overtime") ctx.isOvertime = false
    if (kind === "missing-duration") ctx.gameLength = null
    expect(() => planFinalShotCorrection(ctx, correction)).toThrow(/explicit/)
    expect(planFinalShotCorrection(ctx, { ...correction, goalieShotsAgainst: { 1: 43, 2: 29 } })).toHaveLength(2)
  })

  it("accepts exact regulation time without overtime and rejects equal partial times", () => {
    const ctx = context()
    ctx.isOvertime = false
    for (const goalie of ctx.goalies) goalie.seconds = 2700
    expect(planFinalShotCorrection(ctx, correction)).toHaveLength(2)
    for (const goalie of ctx.goalies) goalie.seconds = 60
    expect(() => planFinalShotCorrection(ctx, correction)).toThrow(/explicit/)
  })

  it("rejects any unmapped saved goalie rather than assigning its shots to another goalie", () => {
    const ctx = context()
    ctx.goalies.push({ playerId: 3, goalsAgainst: 0, shotsAgainst: 10, saves: 10, seconds: 500, sides: [] })
    expect(() => planFinalShotCorrection(ctx, correction)).toThrow(/every saved goalie/)
  })

  it.each([null, [], 12, "invalid"])("validates malformed allocations even when shots are unchanged: %s", (allocation) => {
    const ctx = context()
    expect(() => planFinalShotCorrection(ctx, { homeShots: ctx.state.homeShots, awayShots: ctx.state.awayShots,
      goalieShotsAgainst: allocation as any })).toThrow(/allocations/)
  })

  it("does not clear a required multi-goalie allocation when team totals are unchanged", () => {
    const ctx = context()
    ctx.state.awayShots = correction.awayShots
    ctx.state.goalieShotsAgainst = { 1: 20, 3: 23 }
    ctx.goalies[0].goalsAgainst = 3
    ctx.goalies.push({ playerId: 3, goalsAgainst: 2, shotsAgainst: 23, saves: 21, seconds: 500, sides: ["home"] })
    expect(() => planFinalShotCorrection(ctx, { homeShots: ctx.state.homeShots, awayShots: ctx.state.awayShots,
      goalieShotsAgainst: {} })).toThrow(/explicit/)
  })

  it("updates an existing single-goalie override alongside corrected saved stats", () => {
    const ctx = context()
    ctx.state.goalieShotsAgainst = { 1: 0 }
    const updates = planFinalShotCorrection(ctx, correction)
    const query = new PgDialect().sqlToQuery(finalShotUpdateSql("g65", ctx, correction, updates, 1000))
    expect(query.params).toContain(JSON.stringify({ ...correction, goalieShotsAgainst: { 1: 43 }, updatedAt: 1000 }))
    expect(query.sql).toContain("g.season_id =")
    expect(query.sql).toContain("'sides', sides")
  })

  it.each(["running", "failed"] as const)("blocks shot corrections during a %s full rebuild", (phase) => {
    const ctx = context()
    ctx.state.finalizationPending = { attemptId: "pending", phase }
    expect(() => planFinalShotCorrection(ctx, correction)).toThrow(/finalization is pending/)
  })

  it("rejects forfeits and non-final games", () => {
    expect(() => planFinalShotCorrection({ ...context(), isForfeit: true }, correction)).toThrow(/non-forfeited/)
    expect(() => planFinalShotCorrection({ ...context(), status: "live" }, correction)).toThrow(/completed/)
  })

  it("writes both tables in one guarded SQL statement and retains previous raw values in its audit", () => {
    const ctx = context()
    const updates = planFinalShotCorrection(ctx, correction)
    const query = new PgDialect().sqlToQuery(finalShotUpdateSql("g65", ctx, correction, updates, 1000))
    expect(query.sql).toContain("FOR UPDATE")
    expect(query.sql).toContain("l.state =")
    expect(query.sql).toContain("g.status = 'final' AND NOT g.is_forfeit")
    expect(query.sql).toContain("updated_goalies AS")
    expect(query.sql).toContain("shotCorrections")
    expect(query.sql).not.toMatch(/UPDATE games|DELETE|player_game_stats/)
    expect(query.params).toContain(JSON.stringify(ctx.state))
    expect(query.params).toContain(JSON.stringify(ctx.goalies))
  })
})

describe("admin edit dispatch", () => {
  it("uses the atomic shot path for legacy games and treats array defaults as unchanged", () => {
    const before = createInitialState()
    delete (before as any).goaliePulls
    delete (before as any).goalieChanges
    const after = { ...before, ...correction, goaliePulls: [], goalieChanges: [] }
    expect(gameEditMode(before, after)).toBe("shots")
    expect(gameEditMode(before, { ...before, updatedAt: 10 })).toBe("unchanged")
    expect(gameEditMode(before, { ...before, notes: "Corrected" })).toBe("full")
    expect(gameEditMode(before, { ...after, notes: "Corrected" })).toBe("mixed")
  })
  it("treats explicit goalie allocations as a shot-only correction", () => {
    const before = createInitialState()
    expect(gameEditMode(before, { ...before, goalieShotsAgainst: { 1: 12 } })).toBe("shots")
  })
})
