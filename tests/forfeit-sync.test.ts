import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SQL } from "drizzle-orm"

type Query = { sql: string; params: unknown[] }

const mocks = vi.hoisted(() => ({
  rawSql: vi.fn(),
  query: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema")
  const { PgDialect } = await import("drizzle-orm/pg-core")
  const { drizzle } = await import("drizzle-orm/pg-proxy")
  const dialect = new PgDialect()
  return {
    schema,
    db: drizzle(async (sql, params) => mocks.query({ sql, params }), { schema }),
    rawSql: (query: SQL) => mocks.rawSql(dialect.sqlToQuery(query)),
  }
})

vi.mock("@/lib/admin-session", () => ({
  getSession: () => mocks.getSession(),
}))

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}))

import {
  resolveForfeitOutcome,
  applyForfeitPreset,
  inferForfeitingSide,
  syncForfeitRosterStats,
} from "@/lib/forfeit-sync"
import { PATCH as patchScheduleGame } from "@/app/api/bash/admin/seasons/[id]/schedule/[gameId]/route"
import { NextRequest } from "next/server"
import fs from "node:fs"
import path from "node:path"

describe("forfeit-sync helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(true)
  })

  it("resolves single-team, double, and non-forfeit outcomes accurately", () => {
    expect(
      resolveForfeitOutcome({
        isForfeit: false,
        status: "final",
        homeTeam: "red",
        awayTeam: "blue",
        homeScore: 5,
        awayScore: 0,
      })
    ).toEqual({ kind: "not_forfeit" })

    expect(
      resolveForfeitOutcome({
        isForfeit: true,
        status: "final",
        homeTeam: "red",
        awayTeam: "blue",
        homeScore: 5,
        awayScore: 0,
      })
    ).toEqual({
      kind: "single_forfeit",
      winnerTeamSlug: "red",
      loserTeamSlug: "blue",
    })

    expect(
      resolveForfeitOutcome({
        isForfeit: true,
        status: "final",
        homeTeam: "red",
        awayTeam: "blue",
        homeScore: 0,
        awayScore: 5,
      })
    ).toEqual({
      kind: "single_forfeit",
      winnerTeamSlug: "blue",
      loserTeamSlug: "red",
    })

    expect(
      resolveForfeitOutcome({
        isForfeit: true,
        status: "final",
        homeTeam: "red",
        awayTeam: "blue",
        homeScore: 0,
        awayScore: 0,
      })
    ).toEqual({ kind: "double_forfeit" })
  })

  it("builds official forfeit score presets and infers forfeiting side", () => {
    expect(applyForfeitPreset("away")).toEqual({
      isForfeit: true,
      status: "final",
      homeScore: 5,
      awayScore: 0,
      isOvertime: false,
      hasShootout: false,
    })
    expect(applyForfeitPreset("home")).toEqual({
      isForfeit: true,
      status: "final",
      homeScore: 0,
      awayScore: 5,
      isOvertime: false,
      hasShootout: false,
    })
    expect(applyForfeitPreset("both")).toEqual({
      isForfeit: true,
      status: "final",
      homeScore: 0,
      awayScore: 0,
      isOvertime: false,
      hasShootout: false,
    })

    expect(inferForfeitingSide({ homeScore: 5, awayScore: 0, status: "final" })).toBe("away")
    expect(inferForfeitingSide({ homeScore: 0, awayScore: 5, status: "final" })).toBe("home")
    expect(inferForfeitingSide({ homeScore: 0, awayScore: 0, status: "final" })).toBe("both")
    expect(inferForfeitingSide({ homeScore: null, awayScore: null, status: "upcoming" })).toBe("away")
  })

  function mockGameRow(row: Record<string, unknown>) {
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("FROM games WHERE id =")) {
        return [{ season_id: "2026-2027", home_team: "red", away_team: "blue", game_type: "regular", ...row }]
      }
      return []
    })
  }
  const statQueries = () =>
    mocks.rawSql.mock.calls.map(([q]) => q as Query).filter((q) => !q.sql.includes("FROM games WHERE id ="))

  it("stamps 0-stat rows for the winning roster via ON CONFLICT DO NOTHING without ever deleting or updating rows", async () => {
    mockGameRow({ id: "g101", date: "2026-10-10", home_score: 5, away_score: 0, status: "final", is_forfeit: true })

    await syncForfeitRosterStats("g101")

    const queries = statQueries()
    expect(queries).toHaveLength(1)
    const [stamp] = queries
    expect(stamp.sql).toContain("WITH winners AS MATERIALIZED")
    expect(stamp.sql).toContain("GROUP BY ps.player_id")
    expect(stamp.sql).toContain("INSERT INTO player_game_stats")
    expect(stamp.sql).toContain("INSERT INTO goalie_game_stats")
    expect(stamp.sql).toContain("ON CONFLICT (player_id, game_id) DO NOTHING")
    expect(stamp.sql).not.toContain("DELETE")
    expect(stamp.sql).not.toContain("DO UPDATE")
    expect(stamp.params).toEqual(expect.arrayContaining(["g101", "2026-2027", "red", "2026-10-10"]))
  })

  it("does not write or delete stat rows on double forfeits, non-forfeits, or exhibition/tryout games", async () => {
    const cases = [
      { id: "g102", date: "2026-10-10", home_score: 0, away_score: 0, status: "final", is_forfeit: true },
      { id: "g102b", date: "2026-10-10", home_score: null, away_score: null, status: "upcoming", is_forfeit: false },
      { id: "g105", date: "2026-10-10", home_score: 5, away_score: 0, status: "final", is_forfeit: true, game_type: "exhibition" },
      { id: "g106", date: "2026-10-10", home_score: 5, away_score: 0, status: "final", is_forfeit: true, game_type: "tryout" },
    ]
    for (const row of cases) {
      mocks.rawSql.mockClear()
      mockGameRow(row)
      await syncForfeitRosterStats(String(row.id))
      expect(statQueries()).toHaveLength(0)
    }
  })

  it("does not re-stamp an unchanged forfeit game on an unrelated re-save", async () => {
    mocks.query.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes('from "games"')) {
        return {
          rows: [[
            "g300", "2026-2027", "2026-11-01", "10:00", "red", "blue",
            5, 0, "final", false, false, true, "The Lick", false,
            null, null, "regular", false, null, null, null, null, null, null, null, null, null,
          ]],
        }
      }
      return { rows: [] }
    })
    mocks.rawSql.mockResolvedValue([])

    const req = new NextRequest("http://localhost/api/bash/admin/seasons/2026-2027/schedule/g300", {
      method: "PATCH",
      body: JSON.stringify({ status: "final", isForfeit: true, homeScore: 5, awayScore: 0, notes: "typo fix" }),
    })
    const res = await patchScheduleGame(req, { params: Promise.resolve({ id: "2026-2027", gameId: "g300" }) })
    expect(res.status).toBe(200)
    expect(mocks.rawSql).not.toHaveBeenCalled()
  })

  it("keeps the client-safe forfeit helpers free of database imports", () => {
    const helpersSrc = fs.readFileSync(path.resolve(process.cwd(), "lib/forfeit-helpers.ts"), "utf-8")
    expect(helpersSrc).not.toMatch(/from ["']@\/lib\/db/)
    const modalSrc = fs.readFileSync(path.resolve(process.cwd(), "components/admin/edit-game-modal.tsx"), "utf-8")
    expect(modalSrc).toContain('from "@/lib/forfeit-helpers"')
    expect(modalSrc).not.toContain('from "@/lib/forfeit-sync"')
  })

  it("advances a playoff series winner when a game is won via forfeit", async () => {
    const updatedSlots: { sql: string; params: unknown[] }[] = []
    mocks.query.mockImplementation(async ({ sql, params }: Query) => {
      if (sql.startsWith('update "games"')) {
        updatedSlots.push({ sql, params })
        return { rows: [] }
      }
      if (sql.includes('from "games"')) {
        return {
          rows: [
            [
              "g200", "2026-2027", "2026-11-01", "10:00", "red", "blue",
              5, 0, "final", false, true, true, "The Lick", false,
              null, null, "playoff", false, null, null, null, null, "g201", "home", "semifinal", "series-1", 1,
            ],
          ],
        }
      }
      return { rows: [] }
    })
    mocks.rawSql.mockResolvedValue([])

    const req = new NextRequest("http://localhost/api/bash/admin/seasons/2026-2027/schedule/g200", {
      method: "PATCH",
      body: JSON.stringify({ status: "final", isForfeit: true, homeScore: 5, awayScore: 0 }),
    })
    const res = await patchScheduleGame(req, { params: Promise.resolve({ id: "2026-2027", gameId: "g200" }) })
    expect(res.status).toBe(200)
    expect(updatedSlots.some((u) => u.params.includes("g201") && u.params.includes("red"))).toBe(true)
  })
})
