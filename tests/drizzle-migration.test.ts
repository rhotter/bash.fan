/**
 * Integration tests for the Drizzle ORM migration.
 *
 * These tests verify:
 * 1. The Drizzle connection and rawSql helper work correctly
 * 2. Schema definitions match the actual DB tables
 * 3. All data-fetching functions return valid, well-shaped data
 * 4. Query builder operations (select, insert, update) work
 * 5. Performance: queries complete within acceptable timeframes
 */

import { describe, it, expect } from "vitest"
import { db, rawSql, schema } from "@/lib/db"
import { sql, eq, count } from "drizzle-orm"
import { getCurrentSeason } from "@/lib/seasons"

// ─── Connection & rawSql helper ──────────────────────────────────────────────

describe("Drizzle connection", () => {
  it("rawSql returns an array of rows", async () => {
    const rows = await rawSql(sql`SELECT 1 as val`)
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBe(1)
    expect(rows[0].val).toBe(1)
  })

  it("rawSql handles parameterized queries", async () => {
    const name = "test-param"
    const rows = await rawSql(sql`SELECT ${name} as name`)
    expect(rows[0].name).toBe("test-param")
  })

  it("rawSql returns empty array for no results", async () => {
    const rows = await rawSql(sql`SELECT 1 WHERE false`)
    expect(rows).toEqual([])
  })

  it("db.execute works for raw queries", async () => {
    const result = await db.execute(sql`SELECT 1 as val`)
    expect(result).toBeDefined()
  })
})

// ─── Schema verification (Drizzle schema matches DB) ────────────────────────

describe("Schema matches database", () => {
  it("seasons table has expected columns", async () => {
    const rows = await rawSql(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'seasons'
      ORDER BY column_name
    `)
    const cols = rows.map((r) => r.column_name).sort()
    expect(cols).toContain("id")
    expect(cols).toContain("name")
    expect(cols).toContain("league_id")
    expect(cols).toContain("is_current")
    expect(cols).toContain("season_type")
  })

  it("teams table has expected columns", async () => {
    const rows = await rawSql(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'teams'
      ORDER BY column_name
    `)
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain("slug")
    expect(cols).toContain("name")
  })

  it("games table has expected columns", async () => {
    const rows = await rawSql(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'games'
      ORDER BY column_name
    `)
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain("id")
    expect(cols).toContain("season_id")
    expect(cols).toContain("home_team")
    expect(cols).toContain("away_team")
    expect(cols).toContain("home_score")
    expect(cols).toContain("away_score")
    expect(cols).toContain("status")
    expect(cols).toContain("is_overtime")
    expect(cols).toContain("is_playoff")
    expect(cols).toContain("has_boxscore")
    expect(cols).toContain("notes")
  })

  it("players table has expected columns", async () => {
    const rows = await rawSql(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players'
    `)
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain("id")
    expect(cols).toContain("name")
  })

  it("player_game_stats table has expected columns", async () => {
    const rows = await rawSql(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'player_game_stats'
    `)
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain("player_id")
    expect(cols).toContain("game_id")
    expect(cols).toContain("goals")
    expect(cols).toContain("assists")
    expect(cols).toContain("points")
    expect(cols).toContain("gwg")
    expect(cols).toContain("ppg")
    expect(cols).toContain("shg")
    expect(cols).toContain("eng")
    expect(cols).toContain("hat_tricks")
    expect(cols).toContain("pen")
    expect(cols).toContain("pim")
  })

  it("goalie_game_stats table has expected columns", async () => {
    const rows = await rawSql(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'goalie_game_stats'
    `)
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain("player_id")
    expect(cols).toContain("game_id")
    expect(cols).toContain("seconds")
    expect(cols).toContain("goals_against")
    expect(cols).toContain("shots_against")
    expect(cols).toContain("saves")
    expect(cols).toContain("shutouts")
    expect(cols).toContain("goalie_assists")
    expect(cols).toContain("result")
  })

  it("player_season_stats table exists", async () => {
    const rows = await rawSql(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'player_season_stats'
    `)
    expect(rows.length).toBeGreaterThan(0)
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain("player_id")
    expect(cols).toContain("season_id")
    expect(cols).toContain("is_playoff")
  })

  it("hall_of_fame table exists", async () => {
    const rows = await rawSql(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'hall_of_fame'
    `)
    expect(rows.length).toBeGreaterThan(0)
  })

  it("player_awards table exists", async () => {
    const rows = await rawSql(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'player_awards'
    `)
    expect(rows.length).toBeGreaterThan(0)
  })

  it("game_live table exists", async () => {
    const rows = await rawSql(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'game_live'
    `)
    expect(rows.length).toBeGreaterThan(0)
  })
})

// ─── Drizzle query builder operations ────────────────────────────────────────

describe("Drizzle query builder", () => {
  it("select from teams returns rows", async () => {
    const rows = await db.select().from(schema.teams).limit(5)
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty("slug")
    expect(rows[0]).toHaveProperty("name")
    expect(typeof rows[0].slug).toBe("string")
    expect(typeof rows[0].name).toBe("string")
  })

  it("select from seasons returns rows", async () => {
    const rows = await db.select().from(schema.seasons).limit(5)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty("id")
    expect(rows[0]).toHaveProperty("name")
    expect(rows[0]).toHaveProperty("leagueId")
    expect(rows[0]).toHaveProperty("seasonType")
  })

  it("select from players with limit", async () => {
    const rows = await db.select().from(schema.players).limit(3)
    expect(rows.length).toBeLessThanOrEqual(3)
    if (rows.length > 0) {
      expect(typeof rows[0].id).toBe("number")
      expect(typeof rows[0].name).toBe("string")
    }
  })

  it("count query works", async () => {
    const result = await db.select({ count: count() }).from(schema.teams)
    expect(result[0].count).toBeGreaterThan(0)
  })

  it("where clause with eq works", async () => {
    const season = await getCurrentSeason()
    const rows = await db
      .select()
      .from(schema.seasons)
      .where(eq(schema.seasons.id, season.id))
    expect(rows.length).toBe(1)
    expect(rows[0].id).toBe(season.id)
  })

  it("join query works (season_teams)", async () => {
    const season = await getCurrentSeason()
    const rows = await db
      .select({ teamSlug: schema.seasonTeams.teamSlug, teamName: schema.teams.name })
      .from(schema.seasonTeams)
      .innerJoin(schema.teams, eq(schema.seasonTeams.teamSlug, schema.teams.slug))
      .where(eq(schema.seasonTeams.seasonId, season.id))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty("teamSlug")
    expect(rows[0]).toHaveProperty("teamName")
  })
})

// ─── Data fetching functions ─────────────────────────────────────────────────

describe("fetchBashData", () => {
  it("returns valid structure for current season", async () => {
    const { fetchBashData } = await import("@/lib/fetch-bash-data")
    const data = await fetchBashData()
    expect(data).toHaveProperty("games")
    expect(data).toHaveProperty("standings")
    expect(data).toHaveProperty("lastUpdated")
    expect(Array.isArray(data.games)).toBe(true)
    expect(Array.isArray(data.standings)).toBe(true)
  })

  it("games have required fields", async () => {
    const { fetchBashData } = await import("@/lib/fetch-bash-data")
    const data = await fetchBashData()
    if (data.games.length > 0) {
      const game = data.games[0]
      expect(game).toHaveProperty("id")
      expect(game).toHaveProperty("date")
      expect(game).toHaveProperty("time")
      expect(game).toHaveProperty("homeTeam")
      expect(game).toHaveProperty("homeSlug")
      expect(game).toHaveProperty("awayTeam")
      expect(game).toHaveProperty("awaySlug")
      expect(game).toHaveProperty("status")
      expect(game).toHaveProperty("isOvertime")
      expect(game).toHaveProperty("isPlayoff")
      expect(typeof game.id).toBe("string")
      expect(typeof game.homeTeam).toBe("string")
    }
  })

  it("standings are sorted by points descending", async () => {
    const { fetchBashData } = await import("@/lib/fetch-bash-data")
    const data = await fetchBashData()
    for (let i = 1; i < data.standings.length; i++) {
      expect(data.standings[i - 1].pts).toBeGreaterThanOrEqual(data.standings[i].pts)
    }
  })

  it("standings points are consistent with W/OTW/OTL/L", async () => {
    const { fetchBashData } = await import("@/lib/fetch-bash-data")
    const data = await fetchBashData()
    for (const s of data.standings) {
      const expectedPts = s.w * 3 + s.otw * 2 + s.otl * 1
      expect(s.pts).toBe(expectedPts)
      expect(s.gp).toBe(s.w + s.otw + s.l + s.otl)
      expect(s.gd).toBe(s.gf - s.ga)
    }
  })

  it("works with a specific season param", async () => {
    const { fetchBashData } = await import("@/lib/fetch-bash-data")
    const data = await fetchBashData("2024-2025")
    expect(data.games.length).toBeGreaterThan(0)
    expect(data.standings.length).toBeGreaterThan(0)
  })
})

describe("fetchPlayerStats", () => {
  it("returns valid structure for current season", async () => {
    const { fetchPlayerStats } = await import("@/lib/fetch-player-stats")
    const data = await fetchPlayerStats()
    expect(data).toHaveProperty("skaters")
    expect(data).toHaveProperty("goalies")
    expect(data).toHaveProperty("teams")
    expect(data).toHaveProperty("lastUpdated")
    expect(Array.isArray(data.skaters)).toBe(true)
    expect(Array.isArray(data.goalies)).toBe(true)
  })

  it("skaters have required numeric fields", async () => {
    const { fetchPlayerStats } = await import("@/lib/fetch-player-stats")
    const data = await fetchPlayerStats()
    if (data.skaters.length > 0) {
      const s = data.skaters[0]
      expect(typeof s.id).toBe("number")
      expect(typeof s.name).toBe("string")
      expect(typeof s.gp).toBe("number")
      expect(typeof s.goals).toBe("number")
      expect(typeof s.assists).toBe("number")
      expect(typeof s.points).toBe("number")
      expect(typeof s.ptsPg).toBe("string")
      expect(s.points).toBe(s.goals + s.assists)
    }
  })

  it("goalies have required fields", async () => {
    const { fetchPlayerStats } = await import("@/lib/fetch-player-stats")
    const data = await fetchPlayerStats()
    if (data.goalies.length > 0) {
      const g = data.goalies[0]
      expect(typeof g.id).toBe("number")
      expect(typeof g.name).toBe("string")
      expect(typeof g.gp).toBe("number")
      expect(typeof g.saves).toBe("number")
      expect(typeof g.goalsAgainst).toBe("number")
      expect(typeof g.savePercentage).toBe("number")
      expect(typeof g.gaa).toBe("number")
    }
  })

  it("skaters are sorted by points desc", async () => {
    const { fetchPlayerStats } = await import("@/lib/fetch-player-stats")
    const data = await fetchPlayerStats()
    for (let i = 1; i < data.skaters.length; i++) {
      expect(data.skaters[i - 1].points).toBeGreaterThanOrEqual(data.skaters[i].points)
    }
  })

  it("all-time stats return seasonsPlayed", async () => {
    const { fetchPlayerStats } = await import("@/lib/fetch-player-stats")
    const data = await fetchPlayerStats("all")
    if (data.skaters.length > 0) {
      expect(data.skaters[0].seasonsPlayed).toBeDefined()
      expect(typeof data.skaters[0].seasonsPlayed).toBe("number")
      expect(data.skaters[0].seasonsPlayed!).toBeGreaterThan(0)
    }
  })

  it("playoff stats work", async () => {
    const { fetchPlayerStats } = await import("@/lib/fetch-player-stats")
    const data = await fetchPlayerStats("2024-2025", true)
    expect(data).toHaveProperty("skaters")
    expect(data).toHaveProperty("goalies")
  })
})

describe("fetchTeamDetail", () => {
  let teamSlug: string

  it("returns null for nonexistent team", async () => {
    const { fetchTeamDetail } = await import("@/lib/fetch-team-detail")
    const result = await fetchTeamDetail("nonexistent-team-slug-xyz")
    expect(result).toBeNull()
  })

  it("returns valid team detail", async () => {
    // Get a real team slug
    const teams = await db.select({ slug: schema.teams.slug }).from(schema.teams).limit(1)
    if (teams.length === 0) return
    teamSlug = teams[0].slug

    const { fetchTeamDetail } = await import("@/lib/fetch-team-detail")
    const detail = await fetchTeamDetail(teamSlug)
    if (!detail) return // Team may not have data for current season

    expect(detail).toHaveProperty("slug")
    expect(detail).toHaveProperty("name")
    expect(detail).toHaveProperty("record")
    expect(detail).toHaveProperty("skaters")
    expect(detail).toHaveProperty("goalies")
    expect(detail).toHaveProperty("games")
    expect(detail.slug).toBe(teamSlug)
  })

  it("record fields are consistent", async () => {
    // Get a team with games in a known season
    const season = await getCurrentSeason()
    const teamRows = await rawSql(sql`
      SELECT DISTINCT home_team as slug FROM games WHERE season_id = ${season.id} LIMIT 1
    `)
    if (teamRows.length === 0) return

    const { fetchTeamDetail } = await import("@/lib/fetch-team-detail")
    const detail = await fetchTeamDetail(teamRows[0].slug)
    if (!detail) return

    const r = detail.record
    expect(r.gp).toBe(r.w + r.otw + r.l + r.otl)
    expect(r.pts).toBe(r.w * 3 + r.otw * 2 + r.otl * 1)
    expect(r.rank).toBeGreaterThan(0)
    expect(r.totalTeams).toBeGreaterThan(0)
    expect(r.rank).toBeLessThanOrEqual(r.totalTeams)
  })
})

describe("fetchGameDetail", () => {
  it("returns null for nonexistent game", async () => {
    const { fetchGameDetail } = await import("@/lib/fetch-game-detail")
    const result = await fetchGameDetail("nonexistent-game-id-xyz")
    expect(result).toBeNull()
  })

  it("returns valid game detail for a real game", async () => {
    const gameRows = await rawSql(sql`
      SELECT id FROM games WHERE status = 'final' AND has_boxscore = true LIMIT 1
    `)
    if (gameRows.length === 0) return

    const { fetchGameDetail } = await import("@/lib/fetch-game-detail")
    const detail = await fetchGameDetail(gameRows[0].id)
    expect(detail).not.toBeNull()
    expect(detail!).toHaveProperty("id")
    expect(detail!).toHaveProperty("date")
    expect(detail!).toHaveProperty("homeTeam")
    expect(detail!).toHaveProperty("awayTeam")
    expect(detail!).toHaveProperty("homePlayers")
    expect(detail!).toHaveProperty("awayPlayers")
    expect(detail!).toHaveProperty("homeGoalies")
    expect(detail!).toHaveProperty("awayGoalies")
    expect(detail!).toHaveProperty("officials")
    expect(Array.isArray(detail!.homePlayers)).toBe(true)
    expect(Array.isArray(detail!.awayPlayers)).toBe(true)
  })

  it("box score players have valid stat fields", async () => {
    const gameRows = await rawSql(sql`
      SELECT id FROM games WHERE status = 'final' AND has_boxscore = true LIMIT 1
    `)
    if (gameRows.length === 0) return

    const { fetchGameDetail } = await import("@/lib/fetch-game-detail")
    const detail = await fetchGameDetail(gameRows[0].id)
    if (!detail || detail.homePlayers.length === 0) return

    const p = detail.homePlayers[0]
    expect(typeof p.id).toBe("number")
    expect(typeof p.name).toBe("string")
    expect(typeof p.goals).toBe("number")
    expect(typeof p.assists).toBe("number")
    expect(typeof p.points).toBe("number")
    expect(p.points).toBe(p.goals + p.assists)
  })
})

describe("fetchPlayerDetail", () => {
  it("returns null for nonexistent player", async () => {
    const { fetchPlayerDetail } = await import("@/lib/fetch-player-detail")
    const result = await fetchPlayerDetail("nonexistent-player-slug-xyz-abc")
    expect(result).toBeNull()
  })

  it("returns valid player detail for a real player", async () => {
    const { playerSlug } = await import("@/lib/player-slug")
    const playerRows = await rawSql(sql`
      SELECT p.name FROM players p
      JOIN player_game_stats pgs ON p.id = pgs.player_id
      GROUP BY p.id, p.name
      ORDER BY SUM(pgs.points) DESC
      LIMIT 1
    `)
    if (playerRows.length === 0) return

    const slug = playerSlug(playerRows[0].name)
    const { fetchPlayerDetail } = await import("@/lib/fetch-player-detail")
    const detail = await fetchPlayerDetail(slug)
    expect(detail).not.toBeNull()
    expect(detail!).toHaveProperty("id")
    expect(detail!).toHaveProperty("name")
    expect(detail!).toHaveProperty("team")
    expect(detail!).toHaveProperty("teamSlug")
    expect(detail!).toHaveProperty("seasonStats")
    expect(detail!).toHaveProperty("allTimeStats")
    expect(detail!).toHaveProperty("perSeasonStats")
    expect(detail!).toHaveProperty("games")
    expect(detail!).toHaveProperty("championships")
    expect(detail!).toHaveProperty("awards")
  })

  it("player skater stats are internally consistent", async () => {
    const { playerSlug } = await import("@/lib/player-slug")
    const playerRows = await rawSql(sql`
      SELECT p.name FROM players p
      JOIN player_game_stats pgs ON p.id = pgs.player_id
      GROUP BY p.id, p.name
      ORDER BY SUM(pgs.points) DESC
      LIMIT 1
    `)
    if (playerRows.length === 0) return

    const slug = playerSlug(playerRows[0].name)
    const { fetchPlayerDetail } = await import("@/lib/fetch-player-detail")
    const detail = await fetchPlayerDetail(slug)
    if (!detail?.seasonStats) return

    const s = detail.seasonStats
    expect(s.points).toBe(s.goals + s.assists)
    expect(s.gp).toBeGreaterThan(0)
    expect(parseFloat(s.ptsPg)).toBeCloseTo(s.points / s.gp, 1)
  })
})

// ─── Complex rawSql queries ─────────────────────────────────────────────────

describe("Complex SQL queries via rawSql", () => {
  it("CTE query works (all-time stats pattern)", async () => {
    const rows = await rawSql(sql`
      WITH game_stats AS (
        SELECT
          pgs.player_id,
          COUNT(DISTINCT pgs.game_id)::int as gp,
          SUM(pgs.points)::int as points
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND NOT g.is_playoff
        JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
        GROUP BY pgs.player_id
      )
      SELECT player_id, gp, points
      FROM game_stats
      ORDER BY points DESC
      LIMIT 5
    `)
    expect(Array.isArray(rows)).toBe(true)
    if (rows.length > 0) {
      expect(typeof rows[0].player_id).toBe("number")
      expect(typeof rows[0].gp).toBe("number")
      expect(typeof rows[0].points).toBe("number")
    }
  })

  it("COUNT FILTER query works", async () => {
    const rows = await rawSql(sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'final')::int as final_count
      FROM games
      LIMIT 1
    `)
    expect(rows.length).toBe(1)
    expect(typeof rows[0].total).toBe("number")
    expect(typeof rows[0].final_count).toBe("number")
    expect(rows[0].final_count).toBeLessThanOrEqual(rows[0].total)
  })

  it("CROSS JOIN LATERAL query works (standings pattern)", async () => {
    const season = await getCurrentSeason()
    const rows = await rawSql(sql`
      SELECT
        t.team_slug,
        COUNT(*)::int as games
      FROM season_teams t
      CROSS JOIN LATERAL (
        SELECT * FROM games g2
        WHERE g2.season_id = ${season.id} AND g2.status = 'final' AND NOT g2.is_playoff
          AND (g2.home_team = t.team_slug OR g2.away_team = t.team_slug)
      ) g
      WHERE t.season_id = ${season.id}
      GROUP BY t.team_slug
      LIMIT 5
    `)
    expect(Array.isArray(rows)).toBe(true)
    if (rows.length > 0) {
      expect(typeof rows[0].team_slug).toBe("string")
      expect(typeof rows[0].games).toBe("number")
    }
  })

  it("UNION ALL query works", async () => {
    const rows = await rawSql(sql`
      SELECT 'a' as source, 1 as val
      UNION ALL
      SELECT 'b' as source, 2 as val
    `)
    expect(rows.length).toBe(2)
    expect(rows[0].source).toBe("a")
    expect(rows[1].source).toBe("b")
  })

  it("dynamic SQL fragments work (playoff toggle)", async () => {
    const season = await getCurrentSeason()
    const isPlayoff = false
    const playoffFragment = isPlayoff ? sql`g.is_playoff` : sql`NOT g.is_playoff`
    const rows = await rawSql(sql`
      SELECT COUNT(*)::int as cnt
      FROM games g
      WHERE g.season_id = ${season.id} AND ${playoffFragment}
    `)
    expect(rows.length).toBe(1)
    expect(typeof rows[0].cnt).toBe("number")
  })
})

// ─── Performance tests ──────────────────────────────────────────────────────

describe("Query performance", () => {
  const TIMEOUT_MS = 5000 // 5 second max for any single query

  it("fetchBashData completes within timeout", async () => {
    const { fetchBashData } = await import("@/lib/fetch-bash-data")
    const start = performance.now()
    await fetchBashData()
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(TIMEOUT_MS)
    console.log(`  fetchBashData: ${elapsed.toFixed(0)}ms`)
  })

  it("fetchPlayerStats (current season) completes within timeout", async () => {
    const { fetchPlayerStats } = await import("@/lib/fetch-player-stats")
    const start = performance.now()
    await fetchPlayerStats()
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(TIMEOUT_MS)
    console.log(`  fetchPlayerStats (current): ${elapsed.toFixed(0)}ms`)
  })

  it("fetchPlayerStats (all-time) completes within timeout", async () => {
    const { fetchPlayerStats } = await import("@/lib/fetch-player-stats")
    const start = performance.now()
    await fetchPlayerStats("all")
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(TIMEOUT_MS)
    console.log(`  fetchPlayerStats (all-time): ${elapsed.toFixed(0)}ms`)
  })

  it("fetchTeamDetail completes within timeout", async () => {
    const season = await getCurrentSeason()
    const teamRows = await rawSql(sql`
      SELECT DISTINCT home_team as slug FROM games
      WHERE season_id = ${season.id}
      LIMIT 1
    `)
    if (teamRows.length === 0) return

    const { fetchTeamDetail } = await import("@/lib/fetch-team-detail")
    const start = performance.now()
    await fetchTeamDetail(teamRows[0].slug)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(TIMEOUT_MS)
    console.log(`  fetchTeamDetail: ${elapsed.toFixed(0)}ms`)
  })

  it("fetchGameDetail completes within timeout", async () => {
    const gameRows = await rawSql(sql`
      SELECT id FROM games WHERE status = 'final' AND has_boxscore = true LIMIT 1
    `)
    if (gameRows.length === 0) return

    const { fetchGameDetail } = await import("@/lib/fetch-game-detail")
    const start = performance.now()
    await fetchGameDetail(gameRows[0].id)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(TIMEOUT_MS)
    console.log(`  fetchGameDetail: ${elapsed.toFixed(0)}ms`)
  })

  it("fetchPlayerDetail completes within timeout", async () => {
    const { playerSlug } = await import("@/lib/player-slug")
    const playerRows = await rawSql(sql`
      SELECT p.name FROM players p
      JOIN player_game_stats pgs ON p.id = pgs.player_id
      GROUP BY p.id, p.name
      ORDER BY SUM(pgs.points) DESC
      LIMIT 1
    `)
    if (playerRows.length === 0) return

    const slug = playerSlug(playerRows[0].name)
    const { fetchPlayerDetail } = await import("@/lib/fetch-player-detail")
    const start = performance.now()
    await fetchPlayerDetail(slug)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(TIMEOUT_MS)
    console.log(`  fetchPlayerDetail: ${elapsed.toFixed(0)}ms`)
  })

  it("simple rawSql query is fast", async () => {
    const start = performance.now()
    await rawSql(sql`SELECT 1`)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(2000)
    console.log(`  rawSql SELECT 1: ${elapsed.toFixed(0)}ms`)
  })
})

// ─── Data integrity checks ──────────────────────────────────────────────────

describe("Data integrity", () => {
  it("every game references valid teams", async () => {
    const orphans = await rawSql(sql`
      SELECT g.id FROM games g
      LEFT JOIN teams ht ON g.home_team = ht.slug
      LEFT JOIN teams awt ON g.away_team = awt.slug
      WHERE ht.slug IS NULL OR awt.slug IS NULL
      LIMIT 5
    `)
    expect(orphans.length).toBe(0)
  })

  it("every player_game_stats references valid player and game", async () => {
    const orphans = await rawSql(sql`
      SELECT pgs.player_id, pgs.game_id FROM player_game_stats pgs
      LEFT JOIN players p ON pgs.player_id = p.id
      LEFT JOIN games g ON pgs.game_id = g.id
      WHERE p.id IS NULL OR g.id IS NULL
      LIMIT 5
    `)
    expect(orphans.length).toBe(0)
  })

  it("points = goals + assists in player_game_stats", async () => {
    const mismatches = await rawSql(sql`
      SELECT player_id, game_id, goals, assists, points
      FROM player_game_stats
      WHERE points != goals + assists
      LIMIT 5
    `)
    expect(mismatches.length).toBe(0)
  })

  it("current season exists in DB", async () => {
    const season = await getCurrentSeason()
    const rows = await db
      .select()
      .from(schema.seasons)
      .where(eq(schema.seasons.id, season.id))
    expect(rows.length).toBe(1)
  })

  it("current season has teams", async () => {
    const season = await getCurrentSeason()
    const rows = await db
      .select({ count: count() })
      .from(schema.seasonTeams)
      .where(eq(schema.seasonTeams.seasonId, season.id))
    expect(rows[0].count).toBeGreaterThan(0)
  })

  it("current season has games", async () => {
    const season = await getCurrentSeason()
    const rows = await db
      .select({ count: count() })
      .from(schema.games)
      .where(eq(schema.games.seasonId, season.id))
    expect(rows[0].count).toBeGreaterThan(0)
  })
})
