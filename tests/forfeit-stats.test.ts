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
import { fetchTeamStats } from "@/lib/fetch-team-stats"
import { fetchGameDetail } from "@/lib/fetch-game-detail"
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
    if (sql.includes("WITH player_stats AS MATERIALIZED")) {
      return [Object.fromEntries(Array.from({ length: 23 }, (_, index) => [`section_${index}`, []]))]
    }
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

function expectWinningTeamForfeitEligibility(queries: Query[], count: number) {
  expect(queries).toHaveLength(count)
  for (const { sql } of queries) {
    const alias = /goalie_game_stats/.test(sql) ? "ggs" : "pgs"
    expect(sql).toContain("NOT g.is_forfeit")
    // Exhibition/tryout queries remain strictly NOT g.is_forfeit; competitive queries include winning-team forfeit predicate
    if (!sql.includes("exhibition")) {
      expect(sql).toContain("g.home_score > g.away_score")
      expect(sql).toContain("g.away_score > g.home_score")
      expect(sql).toMatch(/FILTER \(WHERE NOT (g|tgs|tgg)\.is_forfeit\)/)
    }
    expect(sql).toContain(`NOT ${alias}.is_sub`)
    expect(sql).toContain("g.game_type")
  }
}

describe("forfeit winning-team GP inclusion and counting-stat zeroing on player leaderboards", () => {
  it.each([
    { label: "regular season", playoff: false },
    { label: "playoffs", playoff: true },
  ])("includes winning-team forfeit GP while zeroing counting stats for $label", async ({ playoff }) => {
    await fetchPlayerStats(seasonId, playoff)
    const queries = statQueries()
    expectWinningTeamForfeitEligibility(queries, 2)
    for (const query of queries) {
      expect(query.params).toContain(seasonId)
      expect(query.sql).toContain(playoff ? "AND g.is_playoff" : "AND NOT g.is_playoff")
      expect(query.sql).toContain(playoff
        ? "g.game_type IN ('playoff', 'championship', 'regular')"
        : "g.game_type = 'regular'")
    }
  })

  it("protects skater PTS/G by dividing by played_gp (non-forfeit GP), including traded players and 0 played_gp edge cases", async () => {
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("FROM players p") && sql.includes("JOIN player_game_stats pgs")) {
        return [
          // Player 1: 2 played games on Red (4 pts) + 1 forfeit game on Red (0 pts) => gp=3, played_gp=2, ptsPg="2.00"
          {
            id: 1, name: "Traded Skater", game_team: "Red", game_team_slug: "red",
            team: "Blue", team_slug: "blue",
            gp: 3, played_gp: 2, goals: 2, assists: 2, points: 4,
            gwg: 0, ppg: 0, shg: 0, eng: 0, hat_tricks: 0, pen: 0, pim: 0,
          },
          // Player 1 after trade: 2 played games on Blue (2 pts) => combined gp=5, played_gp=4, points=6 => ptsPg="1.50"
          {
            id: 1, name: "Traded Skater", game_team: "Blue", game_team_slug: "blue",
            team: "Blue", team_slug: "blue",
            gp: 2, played_gp: 2, goals: 1, assists: 1, points: 2,
            gwg: 0, ppg: 0, shg: 0, eng: 0, hat_tricks: 0, pen: 0, pim: 0,
          },
          // Player 2: Only 1 forfeit GP (0 played_gp) => gp=1, played_gp=0, ptsPg="0.00"
          {
            id: 2, name: "Forfeit Only", game_team: "Red", game_team_slug: "red",
            team: "Red", team_slug: "red",
            gp: 1, played_gp: 0, goals: 0, assists: 0, points: 0,
            gwg: 0, ppg: 0, shg: 0, eng: 0, hat_tricks: 0, pen: 0, pim: 0,
          },
        ]
      }
      return []
    })

    const res = await fetchPlayerStats(seasonId, false)
    const traded = res.skaters.find((s) => s.id === 1)!
    expect(traded.gp).toBe(5)
    expect(traded.points).toBe(6)
    expect(traded.ptsPg).toBe("1.50")

    const forfeitOnly = res.skaters.find((s) => s.id === 2)!
    expect(forfeitOnly.gp).toBe(1)
    expect(forfeitOnly.ptsPg).toBe("0.00")
  })

  it.each(["regular", "playoffs", "all"])("filters all-time %s stats and preserves historical totals", async (gameType) => {
    await fetchPlayerStats("all", false, "all", gameType)
    const queries = statQueries()
    expectWinningTeamForfeitEligibility(queries, 2)
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
    expectWinningTeamForfeitEligibility(statQueries(), 2)
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

describe("forfeit handling in player detail reads and game logs", () => {
  it("covers server season/all-time/per-season totals and regular/playoff/exhibition/tryout logs", async () => {
    expect(await fetchPlayerDetail("alex-player")).not.toBeNull()
    const queries = statQueries()
    expect(queries).toHaveLength(1)
    const query = queries[0].sql
    const gameJoins = [...query.matchAll(/JOIN games g ON (?:pgs|ggs)\.game_id = g\.id[^\n]*/g)]
    expect(gameJoins).toHaveLength(20)
    expect(query).toContain("g.home_score > g.away_score")
    expect(query).toContain("FILTER (WHERE NOT g.is_forfeit)")
    expect(query).toContain("CASE WHEN g.is_forfeit THEN 0 ELSE pgs.goals END")
    expect(query).toContain("CASE WHEN g.is_forfeit THEN NULL ELSE ggs.result END")
    expect(query).toContain("FROM player_game_stats WHERE player_id =")
    expect(query).toContain("FROM goalie_game_stats WHERE player_id =")
    expect(query.match(/AND NOT is_sub/g)).toHaveLength(2)
    expect(query.match(/g.game_type IN \('exhibition', 'tryout'\)/g)).toHaveLength(2)
    expect(query.match(/FROM historical_stats/g)).toHaveLength(6)
  })

  it.each([seasonId, "all"])("covers the public player API with season=%s", async (season) => {
    const response = await getPlayer(
      new Request(`http://localhost/api/bash/player/alex-player?season=${season}`),
      { params: Promise.resolve({ slug: "alex-player" }) },
    )
    expect(response.status).toBe(200)
    const queries = statQueries()
    expect(queries).toHaveLength(16)
    expect(queries.filter(({ sql }) => sql.includes("g.game_type = 'exhibition'"))).toHaveLength(2)
  })
})

describe("forfeit handling in team, team-stats, and draft player totals", () => {
  it("includes winning-team forfeit GP on team rosters while protecting PTS/G and keeping forfeit team results in standings", async () => {
    expect(await fetchTeamDetail("red", seasonId)).not.toBeNull()
    expectWinningTeamForfeitEligibility(statQueries(), 2)
    for (const { sql, params } of statQueries()) {
      expect(sql).toContain("g.game_type IN ('regular', 'playoff', 'championship')")
      expect(params).toContain(seasonId)
      expect(params).toContain("red")
    }
    const teamResultQueries = mocks.rawSql.mock.calls
      .map(([query]) => query as Query)
      .filter(({ sql }) => /FROM games g\b|FROM games g2\b/.test(sql))
    expect(teamResultQueries).toHaveLength(2)
  })

  it("protects team PTS/G and SA/G in fetchTeamStats by dividing by played_gp", async () => {
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("SELECT id, name, game_length, stats_only FROM seasons")) {
        return [{ id: seasonId, name: "Fall 2026", game_length: 45, stats_only: false }]
      }
      if (sql.includes("FROM player_game_stats pgs")) {
        return [
          {
            team_slug: "red", team: "Red",
            gp: 5, played_gp: 4, pgp: 45,
            goals: 20, assists: 20, points: 40,
            gwg: 3, ppg: 2, shg: 0, eng: 1, hat_tricks: 1, pen: 2, pim: 4,
          },
        ]
      }
      if (sql.includes("FROM goalie_game_stats ggs")) {
        return [
          {
            team_slug: "red", team: "Red",
            gp: 5, played_gp: 4, pgp: 5,
            seconds: 10800, goals_against: 8, shots_against: 100, saves: 92,
            shutouts: 1, goalie_assists: 0, game_length: 45, wins: 3, losses: 1,
          },
        ]
      }
      if (sql.includes("FROM season_teams st")) {
        return [{ slug: "red", name: "Red" }]
      }
      return []
    })

    const teamStats = await fetchTeamStats(seasonId, false)
    expect(teamStats.teamSkaters[0].gp).toBe(5)
    expect(teamStats.teamSkaters[0].ptsPg).toBe("10.00") // 40 / 4 played_gp, not 40 / 5
    expect(teamStats.teamGoalies[0].gp).toBe(5)
    expect(teamStats.teamGoalies[0].saPg).toBe("25.00") // 100 / 4 played_gp, not 100 / 5
  })

  it("compiles both draft aggregate queries with winning-team forfeit GP and zeroed counting stats", async () => {
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
      expect(sql).toContain("FILTER (WHERE NOT")
      const subParam = sql.match(/"is_sub" = \$(\d+)/)
      expect(subParam).not.toBeNull()
      expect(params[Number(subParam![1]) - 1]).toBe(false)
      expect(params).toEqual(expect.arrayContaining([7, "regular", "playoff", "championship"]))
      expect(sql).toContain('group by "games"."season_id", "games"."is_playoff"')
    }
    const rosterQuery = mocks.query.mock.calls[0][0] as Query
    expect(rosterQuery.params).toContain("2027-summer")
  })

  it("zeroes counting stats and excludes losing team boxscore on forfeited games in fetchGameDetail", async () => {
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("FROM games g")) {
        return [{
          id: "g-forfeit",
          season_id: seasonId,
          date: "2026-10-10",
          time: "7:00 PM",
          home_team: "red",
          away_team: "blue",
          home_team_name: "Red",
          away_team_name: "Blue",
          home_score: 5,
          away_score: 0,
          status: "final",
          is_overtime: false,
          is_playoff: false,
          is_forfeit: true,
          location: "Rink A",
          game_type: "regular",
        }]
      }
      if (sql.includes("FROM player_game_stats pgs")) {
        return [
          { id: 10, name: "Skater One", goals: 2, assists: 1, points: 3, gwg: 1, ppg: 0, shg: 0, eng: 0, hat_tricks: 0, pen: 1, pim: 2, is_sub: false },
          { id: 11, name: "Sub Skater", goals: 1, assists: 0, points: 1, gwg: 0, ppg: 0, shg: 0, eng: 0, hat_tricks: 0, pen: 0, pim: 0, is_sub: true },
        ]
      }
      if (sql.includes("FROM goalie_game_stats ggs")) {
        return [
          { id: 20, name: "Goalie One", seconds: 2700, goals_against: 1, shots_against: 20, saves: 19, shutouts: 0, goalie_assists: 1, result: "W", is_sub: false },
        ]
      }
      return []
    })

    const detail = await fetchGameDetail("g-forfeit")
    expect(detail).not.toBeNull()
    expect(detail!.isForfeit).toBe(true)
    // Winning team ("red") gets non-sub players with zeroed stats
    expect(detail!.homePlayers).toEqual([
      {
        id: 10, name: "Skater One",
        goals: 0, assists: 0, points: 0,
        gwg: 0, ppg: 0, shg: 0, eng: 0, hatTricks: 0, pen: 0, pim: 0,
        isSub: false,
      },
    ])
    expect(detail!.homeGoalies).toEqual([
      {
        id: 20, name: "Goalie One",
        seconds: 0, goalsAgainst: 0, shotsAgainst: 0, saves: 0,
        savePercentage: "0.000", shutouts: 0, goalieAssists: 0,
        result: null, isSub: false,
      },
    ])
    // Forfeiting team ("blue") gets empty boxscore
    expect(detail!.awayPlayers).toEqual([])
    expect(detail!.awayGoalies).toEqual([])
  })
})
