import { beforeEach, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { createInitialState } from "@/lib/scorekeeper-types"
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), rawSql: vi.fn() }))
vi.mock("@/lib/db", () => ({ rawSql: mocks.rawSql }))
vi.mock("@/lib/admin-session", () => ({ getSession: mocks.getSession }))
import { GET } from "@/app/api/bash/scorekeeper/[id]/native/route"
const context = { params: Promise.resolve({ id: "g1" }) }
beforeEach(() => vi.resetAllMocks())
it("requires an admin session before exposing private scoring state", async () => {
  mocks.getSession.mockResolvedValue(false)
  expect((await GET(new Request("https://bash.fan"), context)).status).toBe(401)
  expect(mocks.rawSql).not.toHaveBeenCalled()
})
it("returns authenticated roster and preserved state without starting or changing the game", async () => {
  mocks.getSession.mockResolvedValue(true)
  const state = { ...createInitialState(), notes: "retained", timing: { version: 1, entries: [] } }
  mocks.rawSql.mockResolvedValueOnce([{ id: "g1", status: "live", home_team: "home", away_team: "away", season_id: "s", game_length: 45 }])
    .mockResolvedValueOnce([{ id: 1, name: "Home" }]).mockResolvedValueOnce([{ id: 2, name: "Away" }])
    .mockResolvedValueOnce([{ player_id: 2 }]).mockResolvedValueOnce([{ state }])
  const response = await GET(new Request("https://bash.fan"), context)
  expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  expect(await response.json()).toMatchObject({ periodLength: 900, homeRoster: [{ id: 1 }], awayRoster: [{ id: 2 }], state })
  for (const [query] of mocks.rawSql.mock.calls) expect(new PgDialect().sqlToQuery(query).sql).not.toMatch(/INSERT|UPDATE|DELETE/)
})
