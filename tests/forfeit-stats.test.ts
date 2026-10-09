import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SQL } from "drizzle-orm"

type Query = { sql: string; params: unknown[] }

const mocks = vi.hoisted(() => ({
  rawSql: vi.fn(),
  query: vi.fn(),
  statsOnly: vi.fn(),
}))

// Compile the real query fragments and ORM builders, without connecting to a DB.
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

vi.mock("@/lib/seasons", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/seasons")>(),
  getCurrentSeason: async () => ({ id: "2026-2027", name: "Fall 2026" }),
  getAllSeasons: async () => [{ id: "2026-2027", name: "Fall 2026" }],
  isStatsOnlySeason: (seasonId: string) => mocks.statsOnly(seasonId),
}))

import { fetchPlayerStats } from "@/lib/fetch-player-stats"
import { fetchPlayerDetail } from "@/lib/fetch-player-detail"
import { fetchTeamDetail } from "@/lib/fetch-team-detail"
import { GET as getPlayer } from "@/app/api/bash/player/[slug]/route"
import { GET as getDraftStats } from "@/app/api/bash/draft/player-stats/[playerId]/route"

const seasonId = "2026-2027"
const player = {
  id: 7, name: "Alex Player", team_slug: "red", team_name: "Red",
  is_goalie: false, season_id: seasonId,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.statsOnly.mockResolvedValue(false)
  mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
    if (/SELECT p\.id, p\.name, ps\.team_slug/.test(sql)) return [player]
    if (/SELECT COUNT\(\*\)::int as count FROM season_teams/.test(sql)) return [{ count: 1 }]
    if (/SELECT EXISTS/.test(sql)) return [{ has_playoffs: true }]
    return []
  })
  mocks.query.mockImplementation(async ({ sql }: Query) => {
    if (/from "players"/.test(sql)) return { rows: [[player.id, player.name]] }
    if (/from "seasons"/.test(sql)) return { rows: [["Fall 2026", null]] }
    if (/from "teams"/.test(sql)) return { rows: [["red", "Red"]] }
    if (/from "player_seasons"/.test(sql)) {
      return { rows: [[seasonId, "red", "Red", false, false, false, "Fall 2026", "fall"]] }
    }
    return { rows: [] }
  })
})

function statQueries(): Query[] {
  return mocks.rawSql.mock.calls
    .map(([query]) => query as Query)
    .filter(({ sql }) => /(?:player|goalie)_game_stats/.test(sql))
}

function expectEligibleGameJoins(queries: Query[], count: number) {
  expect(queries).toHaveLength(count)
  for (const { sql } of queries) {
    const alias = /goalie_game_stats/.test(sql) ? "ggs" : "pgs"
    expect(sql).toMatch(new RegExp(`JOIN games g ON ${alias}\\.game_id = g\\.id AND NOT g\\.is_forfeit`))
    // The forfeit exclusion must not replace the existing substitution filter.
    expect(sql).toContain(`NOT ${alias}.is_sub`)
    expect(sql).toContain("g.game_type")
  }
}

describe("forfeit exclusion from player leaderboards", () => {
  it.each([
    { label: "regular season", playoff: false },
    { label: "playoffs", playoff: true },
  ])("filters both positions for $label without changing the season/game type", async ({ playoff }) => {
    await fetchPlayerStats(seasonId, playoff)
    const queries = statQueries()
    expectEligibleGameJoins(queries, 2)
    for (const query of queries) {
      expect(query.params).toContain(seasonId)
      expect(query.sql).toContain(playoff ? "AND g.is_playoff" : "AND NOT g.is_playoff")
      expect(query.sql).toContain(playoff
        ? "g.game_type IN ('playoff', 'championship', 'regular')"
        : "g.game_type = 'regular'")
    }
  })

  it.each(["regular", "playoffs", "all"])("filters all-time %s stats and preserves historical totals", async (gameType) => {
    await fetchPlayerStats("all", false, "all", gameType)
    const queries = statQueries()
    expectEligibleGameJoins(queries, 2)
    expect(queries[0].sql).toContain("FROM player_season_stats pss")
    for (const query of queries) {
      expect(query.sql).toContain("s.season_type IN ('fall', 'summer')")
      if (gameType === "regular") expect(query.sql).toContain("g.is_playoff = false")
      if (gameType === "playoffs") expect(query.sql).toContain("g.is_playoff = true")
      if (gameType === "all") {
        expect(query.sql).toContain("g.game_type IN ('regular', 'playoff', 'championship')")
        expect(query.sql).not.toContain("g.is_playoff")
      }
    }
  })

  it("preserves the fall-only default and an explicit summer filter", async () => {
    await fetchPlayerStats("all")
    expect(statQueries().every(({ params }) => params.includes("fall"))).toBe(true)
    mocks.rawSql.mockClear()
    await fetchPlayerStats("all", false, "summer")
    expectEligibleGameJoins(statQueries(), 2)
    expect(statQueries().every(({ params }) => params.includes("summer"))).toBe(true)
  })

  it("leaves stats-only historical seasons available without requiring game records", async () => {
    mocks.statsOnly.mockResolvedValue(true)
    await fetchPlayerStats("2000-2001")
    expect(statQueries()).toHaveLength(0)
    const historicalQuery = mocks.rawSql.mock.calls
      .map(([query]) => query as Query)
      .find(({ sql }) => sql.includes("FROM player_season_stats pss"))
    expect(historicalQuery?.params).toContain("2000-2001")
    expect(historicalQuery?.sql).not.toContain("JOIN games")
  })
})

describe("forfeit exclusion from player detail reads", () => {
  it("covers server season/all-time/per-season totals and regular/playoff/exhibition/tryout logs", async () => {
    expect(await fetchPlayerDetail("alex-player")).not.toBeNull()
    const queries = statQueries()
    expectEligibleGameJoins(queries, 20)
    expect(queries.filter(({ sql }) => sql.includes("g.game_type IN ('exhibition', 'tryout')"))).toHaveLength(2)
    expect(queries.filter(({ sql }) => sql.includes("FROM player_season_stats"))).toHaveLength(6)
  })

  it.each([seasonId, "all"])("covers the public player API with season=%s", async (season) => {
    const response = await getPlayer(
      new Request(`http://localhost/api/bash/player/alex-player?season=${season}`),
      { params: Promise.resolve({ slug: "alex-player" }) },
    )
    expect(response.status).toBe(200)
    expectEligibleGameJoins(statQueries(), 16)
    expect(statQueries().filter(({ sql }) => sql.includes("g.game_type = 'exhibition'"))).toHaveLength(2)
  })
})

describe("forfeit exclusion from team and draft player totals", () => {
  it("filters the team roster's individual stats while keeping forfeit team results in standings", async () => {
    expect(await fetchTeamDetail("red", seasonId)).not.toBeNull()
    expectEligibleGameJoins(statQueries(), 2)
    for (const { sql, params } of statQueries()) {
      expect(sql).toContain("g.game_type IN ('regular', 'playoff', 'championship')")
      expect(params).toContain(seasonId)
      expect(params).toContain("red")
    }
    const teamResultQueries = mocks.rawSql.mock.calls
      .map(([query]) => query as Query)
      .filter(({ sql }) => /FROM games g\b|FROM games g2\b/.test(sql))
    expect(teamResultQueries).toHaveLength(2)
    expect(teamResultQueries.every(({ sql }) => !sql.includes("is_forfeit"))).toBe(true)
  })

  it("compiles both draft aggregate queries with forfeit/sub exclusions and all competitive game types", async () => {
    const response = await getDraftStats(
      new Request("http://localhost/api/bash/draft/player-stats/7?currentSeason=2027-summer"),
      { params: Promise.resolve({ playerId: "7" }) },
    )
    expect(response.status).toBe(200)
    const queries = mocks.query.mock.calls
      .map(([query]) => query as Query)
      .filter(({ sql }) => /from "(?:player|goalie)_game_stats"/.test(sql))
    expect(queries).toHaveLength(2)
    for (const { sql, params } of queries) {
      const forfeitParam = sql.match(/"games"\."is_forfeit" = \$(\d+)/)
      expect(forfeitParam).not.toBeNull()
      expect(params[Number(forfeitParam![1]) - 1]).toBe(false)
      const subParam = sql.match(/"is_sub" = \$(\d+)/)
      expect(subParam).not.toBeNull()
      expect(params[Number(subParam![1]) - 1]).toBe(false)
      expect(params).toEqual(expect.arrayContaining([7, "regular", "playoff", "championship"]))
      expect(sql).toContain('group by "games"."season_id", "games"."is_playoff"')
    }
    const rosterQuery = mocks.query.mock.calls[0][0] as Query
    expect(rosterQuery.params).toContain("2027-summer")
  })
})
