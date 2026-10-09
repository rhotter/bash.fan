import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { createInitialState } from "@/lib/scorekeeper-types"
import type { FinalShotContext } from "@/lib/final-game-shots"

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), select: vi.fn(), rawSql: vi.fn(), update: vi.fn() }))
vi.mock("@/lib/db", async () => ({ db: mocks, rawSql: mocks.rawSql, schema: await import("@/lib/db/schema") }))
vi.mock("@/lib/admin-session", () => ({ getSession: mocks.getSession }))
import { PATCH, PUT, POST } from "@/app/api/bash/scorekeeper/[id]/state/route"

let context: FinalShotContext
const correction = { homeShots: [9, 10, 10], awayShots: [14, 14, 15] }
function request(body: unknown, method = "PATCH") { return new Request("https://bash.fan/api/bash/scorekeeper/g65/state", { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) }
const params = { params: Promise.resolve({ id: "g65" }) }

beforeEach(() => {
  vi.clearAllMocks()
  context = { status: "final", seasonId: "2026-summer", gameLength: 45, isOvertime: true, isForfeit: false, homeTeam: "home", awayTeam: "away", homeScore: 4, awayScore: 5,
    state: createInitialState(), goalies: [
      { playerId: 1, goalsAgainst: 5, shotsAgainst: 0, saves: -5, seconds: 2749, sides: ["home"] },
      { playerId: 2, goalsAgainst: 4, shotsAgainst: 0, saves: -4, seconds: 2749, sides: ["away"] },
    ] }
  mocks.getSession.mockResolvedValue(true)
  mocks.rawSql.mockResolvedValueOnce([context]).mockResolvedValue([{ game_id: "g65", updatedGoalies: 2 }])
  let selectCount = 0
  mocks.select.mockImplementation(() => ({ from: () => ({ where: async () => ++selectCount === 1 ? [context] : [{ state: context.state }] }) }))
  mocks.update.mockImplementation(() => ({ set: () => ({ where: async () => undefined }) }))
})

describe("scorekeeper shot-only API", () => {
  it("authenticates before reading or changing anything", async () => {
    mocks.getSession.mockResolvedValue(false)
    expect((await PATCH(request(correction), params)).status).toBe(401)
    expect(mocks.rawSql).not.toHaveBeenCalled()
  })
  it("atomically corrects a legacy finished game without finalizing or updating its official score", async () => {
    const response = await PATCH(request({ ...correction, expectedState: context.state, goals: [], homeScore: 0 }), params)
    expect(await response.json()).toMatchObject({ ok: true, requiresFinalization: false })
    expect(mocks.rawSql).toHaveBeenCalledTimes(2)
    const query = new PgDialect().sqlToQuery(mocks.rawSql.mock.calls[1][0])
    expect(query.sql).toContain("updated_goalies AS")
    expect(query.sql).not.toContain("UPDATE games")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("rejects a stale editor before any write", async () => {
    expect((await PATCH(request({ ...correction, expectedState: { ...context.state, updatedAt: 12 } }), params)).status).toBe(409)
    expect(mocks.rawSql).toHaveBeenCalledTimes(1)
  })
  it("reports an atomic compare-and-swap conflict instead of succeeding", async () => {
    mocks.rawSql.mockReset().mockResolvedValueOnce([context]).mockResolvedValueOnce([])
    expect((await PATCH(request({ ...correction, expectedState: context.state }), params)).status).toBe(409)
  })
  it("rejects an impossible goalie total before any mutation", async () => {
    expect((await PATCH(request({ ...correction, homeShots: [1, 0, 0], expectedState: context.state }), params)).status).toBe(422)
    expect(mocks.rawSql).toHaveBeenCalledTimes(1)
  })
  it("rejects forfeits before any mutation", async () => {
    context.isForfeit = true
    const response = await PATCH(request({ ...correction, expectedState: context.state }), params)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "GAME_FORFEITED", finalizationCanceled: true })
    expect(mocks.rawSql).toHaveBeenCalledTimes(1)
  })
  it("rejects legacy full-state shot edits instead of silently diverging team and goalie totals", async () => {
    expect((await PUT(request({ expectedState: context.state, state: { ...context.state, ...correction } }, "PUT"), params)).status).toBe(409)
    expect(mocks.rawSql).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("never zeros a final score from a stale period-zero beacon", async () => {
    expect((await POST(request(context.state, "POST"), params)).status).toBe(409)
    expect(mocks.rawSql).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("does not save other changes into an incomplete legacy history", async () => {
    expect((await PUT(request({ expectedState: context.state, state: { ...context.state, notes: "edit" } }, "PUT"), params)).status).toBe(409)
    expect(mocks.rawSql).not.toHaveBeenCalled()
  })
  it("requires validated finalization for full event edits instead of saving unvalidated state first", async () => {
    Object.assign(context.state, { period: 3, homeAttendance: [1], awayAttendance: [2], homeGoalieId: 1, awayGoalieId: 2 })
    expect((await PUT(request({ expectedState: context.state, state: { ...context.state, notes: "edit" } }, "PUT"), params)).status).toBe(409)
    expect(mocks.rawSql).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})


describe("terminal forfeits during state sync", () => {
  it.each([PUT, POST])("reports a terminal forfeit for autosave and beacon before writes", async (handler) => {
    context.isForfeit = true
    const before = structuredClone(context)
    const response = await handler(request(context.state, "POST"), params)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "GAME_FORFEITED", finalizationCanceled: true })
    expect(mocks.rawSql).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(context).toEqual(before)
  })

  it("reports a terminal forfeit when autosave loses to a concurrent forfeit", async () => {
    context.status = "live"
    mocks.select.mockImplementation(() => ({ from: () => ({ where: async () => [context] }) }))
    mocks.rawSql.mockReset().mockImplementationOnce(async () => { context.isForfeit = true; return [] })
    const response = await PUT(request(context.state, "PUT"), params)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "GAME_FORFEITED", finalizationCanceled: true })
    expect(mocks.rawSql).toHaveBeenCalledTimes(1)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("reports a terminal forfeit when a shot correction loses to a concurrent forfeit", async () => {
    mocks.rawSql.mockReset().mockResolvedValueOnce([context]).mockImplementationOnce(async () => { context.isForfeit = true; return [] })
    const response = await PATCH(request({ ...correction, expectedState: context.state }), params)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "GAME_FORFEITED", finalizationCanceled: true })
    expect(mocks.rawSql).toHaveBeenCalledTimes(2)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
