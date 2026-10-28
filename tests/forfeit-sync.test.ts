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

  it("stamps 0-stat attendance rows for the winning team's full active roster on a single-team forfeit", async () => {
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("FROM games WHERE id =")) {
        return [
          {
            id: "g101",
            season_id: "2026-2027",
            home_team: "red",
            away_team: "blue",
            home_score: 5,
            away_score: 0,
            status: "final",
            is_forfeit: true,
            has_boxscore: false,
            game_type: "regular",
          },
        ]
      }
      return []
    })

    await syncForfeitRosterStats("g101")

    const queries = mocks.rawSql.mock.calls.map(([q]) => q as Query)
    // Should delete any stale non-winning rows when !has_boxscore, and insert skaters + goalies from player_seasons
    const skaterInsert = queries.find((q) => q.sql.includes("INSERT INTO player_game_stats"))
    const goalieInsert = queries.find((q) => q.sql.includes("INSERT INTO goalie_game_stats"))
    expect(skaterInsert).toBeDefined()
    expect(skaterInsert!.params).toEqual(expect.arrayContaining(["g101", "2026-2027", "red"]))
    expect(goalieInsert).toBeDefined()
    expect(goalieInsert!.params).toEqual(expect.arrayContaining(["g101", "2026-2027", "red"]))
  })

  it("cleans up auto-stamped rows on an unplayed game when forfeit is unchecked or double-forfeited", async () => {
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("FROM games WHERE id =")) {
        return [
          {
            id: "g102",
            season_id: "2026-2027",
            home_team: "red",
            away_team: "blue",
            home_score: 0,
            away_score: 0,
            status: "final",
            is_forfeit: true,
            has_boxscore: false,
            game_type: "regular",
          },
        ]
      }
      return []
    })

    await syncForfeitRosterStats("g102")

    const queries = mocks.rawSql.mock.calls.map(([q]) => q as Query)
    expect(queries.some((q) => q.sql.includes("DELETE FROM player_game_stats WHERE game_id ="))).toBe(true)
    expect(queries.some((q) => q.sql.includes("DELETE FROM goalie_game_stats WHERE game_id ="))).toBe(true)
    expect(queries.some((q) => q.sql.includes("INSERT INTO player_game_stats"))).toBe(false)
  })

  it("preserves existing boxscore audit rows on a retroactive played forfeit while adding absent winning-team roster players", async () => {
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("FROM games WHERE id =")) {
        return [
          {
            id: "g103",
            season_id: "2026-2027",
            home_team: "red",
            away_team: "blue",
            home_score: 5,
            away_score: 0,
            status: "final",
            is_forfeit: true,
            has_boxscore: true,
            game_type: "regular",
          },
        ]
      }
      return []
    })

    await syncForfeitRosterStats("g103")

    const queries = mocks.rawSql.mock.calls.map(([q]) => q as Query)
    expect(queries.some((q) => q.sql.includes("DELETE FROM player_game_stats") && q.sql.includes("hat_tricks = -1"))).toBe(true)
    expect(queries.some((q) => q.sql.includes("DELETE FROM goalie_game_stats") && q.sql.includes("result IS NULL"))).toBe(true)
    expect(queries.some((q) => q.sql.includes("INSERT INTO player_game_stats"))).toBe(true)
    expect(queries.some((q) => q.sql.includes("INSERT INTO goalie_game_stats"))).toBe(true)
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
