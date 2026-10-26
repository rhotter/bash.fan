vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: vi.fn() }))
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { createInitialState } from "@/lib/scorekeeper-types"
import type { FinalShotContext } from "@/lib/final-game-shots"

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), select: vi.fn(), rawSql: vi.fn(), update: vi.fn() }))
vi.mock("@/lib/db", async () => ({ db: mocks, rawSql: mocks.rawSql, schema: await import("@/lib/db/schema") }))
vi.mock("@/lib/admin-session", () => ({ getSession: mocks.getSession, getOperatorRole: async () => null }))
import { PATCH, PUT, POST } from "@/app/api/bash/scorekeeper/[id]/state/route"

let context: FinalShotContext
const correction = { homeShots: [9, 10, 10], awayShots: [14, 14, 15] }
function request(body: unknown, method = "PATCH") { return new Request("https://bash.fan/api/bash/scorekeeper/g65/state", { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json", "x-state-revision": "0", "x-mutation-id": "00000000-0000-4000-8000-000000000001" } }) }
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
    expect((await PATCH(request({ ...correction, expectedState: context.state }), params)).status).toBe(422)
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

describe("private timing persistence", () => {
  it("accepts a public expected snapshot for shot corrections while using full stored state for the atomic write", async () => {
    context.state.timing = { version: 1, firstPlayStartedAt: 123, entries: [] }
    mocks.rawSql.mockReset().mockResolvedValueOnce([context]).mockResolvedValue([{ game_id: "g65", updatedGoalies: 2 }])
    const { timing: _timing, ...publicState } = context.state
    const response = await PATCH(request({ ...correction, expectedState: publicState }), params)
    expect(response.status).toBe(200)
    const query = new PgDialect().sqlToQuery(mocks.rawSql.mock.calls[1][0])
    expect(query.params.some(value => typeof value === "string" && value.includes('"firstPlayStartedAt":123'))).toBe(true)
  })
  it("passes device timing to the database and retains stored history for older clients that omit it", async () => {
    context.status = "live"
    mocks.rawSql.mockReset().mockResolvedValue([{ game_id: "g65", revision: 1 }])
    const state = { ...createInitialState(), period: 1, timing: { version: 1, firstPlayStartedAt: 123, entries: [] } }
    expect((await PUT(request(state, "PUT"), params)).status).toBe(200)
    const query = new PgDialect().sqlToQuery(mocks.rawSql.mock.calls[0][0])
    expect(query.params.some(value => typeof value === "string" && value.includes('"firstPlayStartedAt":123'))).toBe(true)
    expect(query.sql).toContain("INSERT INTO game_timing_events")
    expect(query.sql).toContain("ON CONFLICT (game_id, entry_id) DO NOTHING")
  })
})

it("rejects malformed timing before writing state or journal entries", async () => {
  context.status = "live"
  const state = { ...createInitialState(), timing: { version: 1, entries: [{ id: "bad", capturedAt: "yesterday" }] } }
  expect((await PUT(request(state, "PUT"), params)).status).toBe(422)
  expect(mocks.rawSql).not.toHaveBeenCalled()
  expect(mocks.update).not.toHaveBeenCalled()
})

it("acknowledges a committed timing batch and never acknowledges a rejected snapshot", async () => {
  context.status = "live"
  const entry = { id: "entry-1", kind: "goal", action: "add", capturedAt: 1000, recordedAt: 2000,
    source: "device", period: 1, clockSeconds: 1100, details: { eventId: "goal-1" } }
  const state = { ...createInitialState(), period: 1, timing: { version: 1, entries: [entry] } }
  mocks.rawSql.mockReset().mockResolvedValueOnce([{ game_id: "g65", revision: 1 }]).mockResolvedValueOnce([])
  const committed = await PUT(request(state, "PUT"), params)
  expect(await committed.json()).toEqual({ ok: true, revision: 1, timingAckIds: ["entry-1"] })
  const rejected = await PUT(request(state, "PUT"), params)
  expect(rejected.status).toBe(409)
  expect(await rejected.json()).not.toHaveProperty("timingAckIds")
})
