import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SQL } from "drizzle-orm"

type Query = { sql: string; params: unknown[] }

const mocks = vi.hoisted(() => ({
  rawSql: vi.fn(),
  query: vi.fn(),
  statsOnly: vi.fn(),
  currentSeason: vi.fn(),
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

vi.mock("@/lib/seasons", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seasons")>()),
  getCurrentSeason: () => mocks.currentSeason(),
  getAllSeasons: async () => [{ id: "bash-2026-2027", name: "Fall 2026" }],
  isStatsOnlySeason: (seasonId: string) => mocks.statsOnly(seasonId),
}))

import { fetchTeamStats } from "@/lib/fetch-team-stats"

describe("fetchTeamStats aggregation logic", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.statsOnly.mockResolvedValue(false)
    mocks.currentSeason.mockResolvedValue({ id: "bash-2026-2027", name: "Fall 2026", statsOnly: false })
  })

  it("calculates distinct team GP, PTS/G, and includes substitute and traded player stats in single-season mode", async () => {
    mocks.rawSql.mockImplementation(async ({ sql, params: _params }: Query) => {
      if (sql.includes("FROM seasons WHERE id =")) {
        return [{ id: "bash-2026-2027", name: "Fall 2026-2027", game_length: 60, stats_only: false }]
      }
      if (sql.includes("FROM season_teams st")) {
        return [
          { slug: "seals", name: "Seals" },
          { slug: "reign", name: "Reign" },
          { slug: "yetis", name: "Yetis" }, // Team with 0 games
        ]
      }
      if (sql.includes("FROM player_game_stats pgs")) {
        // Seals: 2 distinct games, 10 total points (5 goals, 5 assists)
        // Reign: 1 distinct game, 4 total points (2 goals, 2 assists)
        // Includes sub player stats and traded player stats attributed to game_team_slug
        return [
          {
            team_slug: "seals",
            team: "Seals",
            gp: 2,
            pgp: 22,
            goals: 5,
            assists: 5,
            points: 10,
            gwg: 1,
            ppg: 1,
            shg: 0,
            eng: 0,
            hat_tricks: 0,
            pen: 2,
            pim: 4,
          },
          {
            team_slug: "reign",
            team: "Reign",
            gp: 1,
            pgp: 11,
            goals: 2,
            assists: 2,
            points: 4,
            gwg: 0,
            ppg: 0,
            shg: 0,
            eng: 0,
            hat_tricks: 0,
            pen: 1,
            pim: 2,
          },
        ]
      }
      if (sql.includes("FROM goalie_game_stats ggs")) {
        // Seals goalie stats: 2 games, 7200s (120 min), 4 GA, 50 SA, 46 saves, 1 W, 1 L, 0 SO, 0 assists
        // SV% = 46/50 = 0.920, GAA = (4 / 7200) * 3600 = 2.00
        return [
          {
            team_slug: "seals",
            team: "Seals",
            gp: 2,
            pgp: 3,
            seconds: 7200,
            goals_against: 4,
            shots_against: 50,
            saves: 46,
            shutouts: 0,
            goalie_assists: 0,
            game_length: 60,
            wins: 1,
            losses: 1,
          },
        ]
      }
      return []
    })

    const res = await fetchTeamStats("bash-2026-2027")

    // Every active non-legacy team appears in the Skater table
    expect(res.teamSkaters).toHaveLength(3)

    // Ranked by points desc
    const sealsSkater = res.teamSkaters.find((t) => t.teamSlug === "seals")!
    expect(sealsSkater).toBeDefined()
    expect(sealsSkater.gp).toBe(2)
    expect(sealsSkater.pgp).toBe(22)
    expect(sealsSkater.points).toBe(10)
    expect(sealsSkater.ptsPg).toBe("5.00") // 10 / 2 = 5.00
    expect(sealsSkater.seasonId).toBe("bash-2026-2027")

    const reignSkater = res.teamSkaters.find((t) => t.teamSlug === "reign")!
    expect(reignSkater).toBeDefined()
    expect(reignSkater.gp).toBe(1)
    expect(reignSkater.pgp).toBe(11)
    expect(reignSkater.points).toBe(4)
    expect(reignSkater.ptsPg).toBe("4.00") // 4 / 1 = 4.00

    const yetisSkater = res.teamSkaters.find((t) => t.teamSlug === "yetis")!
    expect(yetisSkater).toBeDefined()
    expect(yetisSkater.gp).toBe(0)
    expect(yetisSkater.pgp).toBe(0)
    expect(yetisSkater.points).toBe(0)
    expect(yetisSkater.ptsPg).toBe("0.00")

    // Goalie table: Only teams with goalie stats appear
    expect(res.teamGoalies).toHaveLength(1)
    const sealsGoalie = res.teamGoalies[0]
    expect(sealsGoalie.teamSlug).toBe("seals")
    expect(sealsGoalie.gp).toBe(2)
    expect(sealsGoalie.pgp).toBe(3)
    expect(sealsGoalie.saPg).toBe("25.00")
    expect(sealsGoalie.savePercentage).toBeCloseTo(0.92, 3)
    expect(sealsGoalie.gaa).toBeCloseTo(2.0, 2)
    expect(sealsGoalie.wins).toBe(1)
    expect(sealsGoalie.losses).toBe(1)
  })

  it("verifies SQL query structure excludes forfeits and includes substitutes", async () => {
    mocks.rawSql.mockResolvedValue([])

    await fetchTeamStats("bash-2026-2027", false)

    const calls = mocks.rawSql.mock.calls.map(([query]) => query as Query)
    const skaterQuery = calls.find((q) => q.sql.includes("FROM player_game_stats pgs"))
    const goalieQuery = calls.find((q) => q.sql.includes("FROM goalie_game_stats ggs"))

    expect(skaterQuery).toBeDefined()
    expect(skaterQuery!.sql).toContain("JOIN games g ON pgs.game_id = g.id AND NOT g.is_forfeit")
    // Team stats must NOT filter out subs
    expect(skaterQuery!.sql).not.toContain("NOT pgs.is_sub")
    // Traded player support via COALESCE
    expect(skaterQuery!.sql).toContain("COALESCE(pgs.team_slug, ps.team_slug)")

    expect(goalieQuery).toBeDefined()
    expect(goalieQuery!.sql).toContain("JOIN games g ON ggs.game_id = g.id AND NOT g.is_forfeit")
    expect(goalieQuery!.sql).not.toContain("NOT ggs.is_sub")
    expect(goalieQuery!.sql).toContain("COALESCE(ggs.team_slug, ps.team_slug)")
  })

  it("aggregates by (team, season) in All-Time mode and incorporates stats_only historical seasons", async () => {
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("SELECT slug, name FROM teams")) {
        return [
          { slug: "seals", name: "Seals" },
          { slug: "landsharks", name: "Landsharks" },
          { slug: "retro-team", name: "Retro Team" },
        ]
      }
      if (sql.includes("FROM player_game_stats pgs")) {
        return [
          {
            team_slug: "seals",
            team: "Seals",
            season_id: "2026-2027",
            season_name: "Fall 2026-2027",
            gp: 10,
            goals: 40,
            assists: 60,
            points: 100,
            gwg: 8,
            ppg: 5,
            shg: 1,
            eng: 2,
            hat_tricks: 2,
            pen: 10,
            pim: 20,
          },
          {
            team_slug: "seals",
            team: "Seals",
            season_id: "2025-2026",
            season_name: "Fall 2025-2026",
            gp: 10,
            goals: 30,
            assists: 45,
            points: 75,
            gwg: 6,
            ppg: 4,
            shg: 0,
            eng: 1,
            hat_tricks: 1,
            pen: 8,
            pim: 16,
          },
        ]
      }
      if (sql.includes("FROM player_season_stats pss")) {
        return [
          {
            team_slug: "retro-team",
            team: "Retro Team",
            season_id: "1995-1996",
            season_name: "1995-1996",
            gp: 12,
            goals: 50,
            assists: 70,
            points: 120,
            gwg: 7,
            ppg: 6,
            shg: 1,
            eng: 0,
            hat_tricks: 3,
            pen: 12,
            pim: 24,
          },
        ]
      }
      if (sql.includes("FROM goalie_game_stats ggs")) {
        return [
          {
            team_slug: "seals",
            team: "Seals",
            season_id: "2026-2027",
            season_name: "Fall 2026-2027",
            gp: 10,
            seconds: 36000,
            goals_against: 20,
            shots_against: 300,
            saves: 280,
            shutouts: 2,
            goalie_assists: 1,
            game_length: 60,
            wins: 8,
            losses: 2,
          },
        ]
      }
      if (sql.includes("champion_slug")) {
        return [{ season_id: "2026-2027", champion_slug: "seals", finalist_slug: "landsharks" }]
      }
      if (sql.includes("FROM season_teams st") && sql.includes("JOIN franchises f")) {
        return [{ season_id: "2026-2027", team_slug: "seals", franchise_slug: "blue", franchise_name: "Blue" }]
      }
      return []
    })

    const res = await fetchTeamStats("all", false, "fall", "regular")

    // 2 modern single-seasons for Seals + 1 historical season for Retro Team = 3 team-seasons
    expect(res.teamSkaters).toHaveLength(3)

    // Ranked by points: Retro Team (120) -> Seals 2026-27 (100) -> Seals 2025-26 (75)
    expect(res.teamSkaters[0].teamSlug).toBe("retro-team")
    expect(res.teamSkaters[0].points).toBe(120)
    expect(res.teamSkaters[0].seasonId).toBe("1995-1996")
    expect(res.teamSkaters[0].ptsPg).toBe("10.00") // 120 / 12
    expect(res.teamSkaters[0].isChampion).toBeUndefined()

    expect(res.teamSkaters[1].teamSlug).toBe("seals")
    expect(res.teamSkaters[1].seasonId).toBe("2026-2027")
    expect(res.teamSkaters[1].points).toBe(100)
    expect(res.teamSkaters[1].ptsPg).toBe("10.00") // 100 / 10
    expect(res.teamSkaters[1].isChampion).toBe(true)
    expect(res.teamSkaters[1].franchiseSlug).toBe("blue")
    expect(res.teamSkaters[1].franchiseName).toBe("Blue")

    expect(res.teamSkaters[2].teamSlug).toBe("seals")
    expect(res.teamSkaters[2].seasonId).toBe("2025-2026")
    expect(res.teamSkaters[2].points).toBe(75)
    expect(res.teamSkaters[2].ptsPg).toBe("7.50") // 75 / 10
    expect(res.teamSkaters[2].isChampion).toBeUndefined()

    // Goalies table in All-Time mode
    expect(res.teamGoalies).toHaveLength(1)
    expect(res.teamGoalies[0].isChampion).toBe(true)
    expect(res.teamGoalies[0].teamSlug).toBe("seals")
    expect(res.teamGoalies[0].seasonId).toBe("2026-2027")
    expect(res.teamGoalies[0].savePercentage).toBeCloseTo(280 / 300, 3)
    expect(res.teamGoalies[0].gaa).toBeCloseTo((20 / 36000) * 3600, 2)
  })

  it("handles stats_only single-season mode correctly", async () => {
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("FROM seasons WHERE id =")) {
        return [{ id: "1992-1993", name: "1992-1993", game_length: 60, stats_only: true }]
      }
      if (sql.includes("FROM season_teams st")) {
        return [{ slug: "blades", name: "Blades" }]
      }
      if (sql.includes("FROM player_season_stats pss")) {
        return [
          {
            team_slug: "blades",
            team: "Blades",
            gp: 10,
            goals: 30,
            assists: 40,
            points: 70,
            gwg: 5,
            ppg: 3,
            shg: 0,
            eng: 0,
            hat_tricks: 1,
            pen: 4,
            pim: 8,
          },
        ]
      }
      return []
    })

    const res = await fetchTeamStats("1992-1993")
    expect(res.teamSkaters).toHaveLength(1)
    expect(res.teamSkaters[0].teamSlug).toBe("blades")
    expect(res.teamSkaters[0].points).toBe(70)
    expect(res.teamSkaters[0].ptsPg).toBe("7.00")
    expect(res.teamGoalies).toHaveLength(0) // No goalies in historical stats_only seasons
  })

  it("resolves default current season and assigns resolved seasonId when season parameter is omitted", async () => {
    mocks.currentSeason.mockResolvedValue({ id: "bash-current-2026", name: "Summer 2026", statsOnly: false })
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("FROM seasons WHERE id =")) {
        return [{ id: "bash-current-2026", name: "Summer 2026", game_length: 60, stats_only: false }]
      }
      if (sql.includes("FROM season_teams st")) {
        return [{ slug: "yetis", name: "Yetis" }]
      }
      if (sql.includes("FROM player_game_stats pgs")) {
        return [
          {
            team_slug: "yetis",
            team: "Yetis",
            gp: 3,
            goals: 12,
            assists: 18,
            points: 30,
            gwg: 2,
            ppg: 1,
            shg: 0,
            eng: 0,
            hat_tricks: 1,
            pen: 2,
            pim: 4,
          },
        ]
      }
      if (sql.includes("FROM goalie_game_stats ggs")) {
        return [
          {
            team_slug: "yetis",
            team: "Yetis",
            gp: 3,
            seconds: 10800,
            goals_against: 6,
            shots_against: 60,
            saves: 54,
            shutouts: 1,
            goalie_assists: 0,
            game_length: 60,
            wins: 2,
            losses: 1,
          },
        ]
      }
      return []
    })

    const res = await fetchTeamStats() // No arguments -> default current season

    expect(res.teamSkaters).toHaveLength(1)
    expect(res.teamSkaters[0].seasonId).toBe("bash-current-2026")
    expect(res.teamGoalies).toHaveLength(1)
    expect(res.teamGoalies[0].seasonId).toBe("bash-current-2026")
  })

  it("verifies goalie wins and losses use COUNT(DISTINCT ggs.game_id) to prevent multi-goalie inflation", async () => {
    mocks.rawSql.mockResolvedValue([])

    await fetchTeamStats("bash-2026-2027", false)

    const calls = mocks.rawSql.mock.calls.map(([query]) => query as Query)
    const goalieQuery = calls.find((q) => q.sql.includes("FROM goalie_game_stats ggs"))

    expect(goalieQuery).toBeDefined()
    expect(goalieQuery!.sql).toContain("COUNT(DISTINCT ggs.game_id) FILTER (WHERE ggs.result = 'W')")
    expect(goalieQuery!.sql).toContain("COUNT(DISTINCT ggs.game_id) FILTER (WHERE ggs.result = 'L')")
  })

  it("handles empty database where no seasons exist without throwing, keeping seasonId undefined", async () => {
    mocks.currentSeason.mockRejectedValue(new Error("No seasons configured in the database."))
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("FROM seasons")) return []
      if (sql.includes("FROM season_teams st")) return [{ slug: "yetis", name: "Yetis" }]
      if (sql.includes("FROM player_game_stats pgs")) return []
      if (sql.includes("FROM goalie_game_stats ggs")) return []
      return []
    })

    const res = await fetchTeamStats()
    expect(res.teamSkaters).toHaveLength(1)
    expect(res.teamSkaters[0].seasonId).toBeUndefined()
    expect(res.teamSkaters[0].ptsPg).toBe("0.00")
  })

  it("computes GAA accurately using custom season game_length and handles 0 seconds cleanly", async () => {
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("FROM seasons WHERE id =")) {
        return [{ id: "custom-season", name: "Custom 45min", game_length: 45, stats_only: false }]
      }
      if (sql.includes("FROM season_teams st")) {
        return [{ slug: "yetis", name: "Yetis" }, { slug: "seals", name: "Seals" }]
      }
      if (sql.includes("FROM player_game_stats pgs")) return []
      if (sql.includes("FROM goalie_game_stats ggs")) {
        return [
          {
            team_slug: "yetis",
            team: "Yetis",
            gp: 2,
            seconds: 5400, // 90 min (2 games of 45 min)
            goals_against: 3,
            shots_against: 60,
            saves: 57,
            game_length: 45,
            wins: 2,
            losses: 0,
            shutouts: 0,
            goalie_assists: 0,
          },
          {
            team_slug: "seals",
            team: "Seals",
            gp: 0,
            seconds: 0,
            goals_against: 0,
            shots_against: 0,
            saves: 0,
            game_length: 45,
            wins: 0,
            losses: 0,
            shutouts: 0,
            goalie_assists: 0,
          },
        ]
      }
      return []
    })

    const res = await fetchTeamStats("custom-season")
    expect(res.teamGoalies).toHaveLength(2)
    // GAA for 45 min game: (3 / 5400) * (45 * 60) = (3 / 5400) * 2700 = 1.50
    const yetisGoalie = res.teamGoalies.find((g) => g.teamSlug === "yetis")!
    expect(yetisGoalie.gaa).toBeCloseTo(1.5, 2)
    expect(yetisGoalie.savePercentage).toBeCloseTo(57 / 60, 3)

    // 0 seconds should yield 0 GAA and 0 SV%, not NaN or Infinity
    const sealsGoalie = res.teamGoalies.find((g) => g.teamSlug === "seals")!
    expect(sealsGoalie.gaa).toBe(0)
    expect(sealsGoalie.savePercentage).toBe(0)
  })

  it("defensively includes teams with game stats even if season_teams record is missing", async () => {
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("FROM seasons WHERE id =")) {
        return [{ id: "season-missing-teams", name: "Missing Season Teams", game_length: 60, stats_only: false }]
      }
      if (sql.includes("FROM season_teams st")) {
        return [] // season_teams is empty!
      }
      if (sql.includes("FROM player_game_stats pgs")) {
        return [
          {
            team_slug: "ghost-riders",
            team: "Ghost Riders",
            gp: 2,
            goals: 6,
            assists: 4,
            points: 10,
            gwg: 1,
            ppg: 1,
            shg: 0,
            eng: 0,
            hat_tricks: 0,
            pen: 1,
            pim: 2,
          },
        ]
      }
      if (sql.includes("FROM goalie_game_stats ggs")) {
        return [
          {
            team_slug: "ghost-riders",
            team: "Ghost Riders",
            gp: 2,
            seconds: 7200,
            goals_against: 4,
            shots_against: 40,
            saves: 36,
            game_length: 60,
            wins: 1,
            losses: 1,
            shutouts: 0,
            goalie_assists: 0,
          },
        ]
      }
      return []
    })

    const res = await fetchTeamStats("season-missing-teams")
    expect(res.teamSkaters).toHaveLength(1)
    expect(res.teamSkaters[0].teamSlug).toBe("ghost-riders")
    expect(res.teamSkaters[0].points).toBe(10)

    expect(res.teamGoalies).toHaveLength(1)
    expect(res.teamGoalies[0].teamSlug).toBe("ghost-riders")
    expect(res.teamGoalies[0].savePercentage).toBeCloseTo(0.9, 2)
  })

  it("breaks ties deterministically in All-Time query when franchise has identical stats across different seasons", async () => {
    mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
      if (sql.includes("SELECT slug, name FROM teams")) {
        return [{ slug: "seals", name: "Seals" }]
      }
      if (sql.includes("FROM player_game_stats pgs")) {
        return [
          {
            team_slug: "seals",
            team: "Seals",
            season_id: "2024-summer",
            season_name: "Summer 2024",
            gp: 10,
            goals: 30,
            assists: 30,
            points: 60,
            gwg: 5,
            ppg: 2,
            shg: 0,
            eng: 0,
            hat_tricks: 1,
            pen: 2,
            pim: 4,
          },
          {
            team_slug: "seals",
            team: "Seals",
            season_id: "2025-summer",
            season_name: "Summer 2025",
            gp: 10,
            goals: 30,
            assists: 30,
            points: 60,
            gwg: 5,
            ppg: 2,
            shg: 0,
            eng: 0,
            hat_tricks: 1,
            pen: 2,
            pim: 4,
          },
        ]
      }
      if (sql.includes("FROM player_season_stats pss")) return []
      if (sql.includes("FROM goalie_game_stats ggs")) {
        return [
          {
            team_slug: "seals",
            team: "Seals",
            season_id: "2024-summer",
            season_name: "Summer 2024",
            gp: 10,
            seconds: 6000,
            goals_against: 10,
            shots_against: 100,
            saves: 90,
            game_length: 60,
            wins: 8,
            losses: 2,
            shutouts: 1,
            goalie_assists: 0,
          },
          {
            team_slug: "seals",
            team: "Seals",
            season_id: "2025-summer",
            season_name: "Summer 2025",
            gp: 10,
            seconds: 6000,
            goals_against: 10,
            shots_against: 100,
            saves: 90,
            game_length: 60,
            wins: 8,
            losses: 2,
            shutouts: 1,
            goalie_assists: 0,
          },
        ]
      }
      return []
    })

    const res = await fetchTeamStats("all", false, "summer", "regular")
    expect(res.teamSkaters).toHaveLength(2)
    // 2025-summer ranks before 2024-summer by seasonId desc tiebreaker
    expect(res.teamSkaters[0].seasonId).toBe("2025-summer")
    expect(res.teamSkaters[1].seasonId).toBe("2024-summer")

    expect(res.teamGoalies).toHaveLength(2)
    expect(res.teamGoalies[0].seasonId).toBe("2025-summer")
    expect(res.teamGoalies[1].seasonId).toBe("2024-summer")
  })

  it("sums regular and playoff max GP in historical stats_only All-Time query and filters non-final bracket rounds in champion query", async () => {
    mocks.rawSql.mockResolvedValue([])

    await fetchTeamStats("all", false, "all", "all")

    const calls = mocks.rawSql.mock.calls.map(([query]) => query as Query)
    const histSkaterQuery = calls.find((q) => q.sql.includes("FROM player_season_stats pss"))
    const championQuery = calls.find((q) => q.sql.includes("champion_slug"))

    expect(histSkaterQuery).toBeDefined()
    expect(histSkaterQuery!.sql).toContain("MAX(pss.gp) FILTER (WHERE NOT pss.is_playoff)")
    expect(histSkaterQuery!.sql).toContain("MAX(pss.gp) FILTER (WHERE pss.is_playoff)")

    expect(championQuery).toBeDefined()
    expect(championQuery!.sql).toContain("g.bracket_round NOT IN ('play-in', 'quarterfinal', 'semifinal')")
  })
})
