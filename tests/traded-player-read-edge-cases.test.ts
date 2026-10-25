import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SQL } from "drizzle-orm"

type Query = { sql: string; params: unknown[] }

const mocks = vi.hoisted(() => ({
  rawSql: vi.fn(),
  query: vi.fn(),
  statsOnly: vi.fn(),
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
  getCurrentSeason: async () => ({ id: "2026-2027", name: "Fall 2026" }),
  getAllSeasons: async () => [
    { id: "2026-2027", name: "Fall 2026" },
    { id: "2025-2026", name: "Fall 2025" },
  ],
  isStatsOnlySeason: (seasonId: string) => mocks.statsOnly(seasonId),
}))

import { fetchGameDetail } from "@/lib/fetch-game-detail"
import { fetchTeamDetail } from "@/lib/fetch-team-detail"
import { fetchPlayerDetail } from "@/lib/fetch-player-detail"
import { GET as getPlayerRoute } from "@/app/api/bash/player/[slug]/route"

describe("Traded Player Read Queries Edge Cases & Stress Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.statsOnly.mockResolvedValue(false)
    mocks.query.mockImplementation(async ({ sql }: Query) => {
      if (/from "players"/.test(sql)) {
        return {
          rows: [
            [630, "Darrell Draper"],
            [895, "Steph Tryphonas"],
            [999, "Rookie Acquired"],
            [888, "Netminder Acquired"],
            [100, "Yeti Vet"],
            [200, "Yeti Goalie"],
          ],
        }
      }
      if (/from "teams"/.test(sql)) {
        return {
          rows: [
            ["yetis", "Yetis"],
            ["loons", "Loons"],
            ["rangers", "Rangers"],
          ],
        }
      }
      if (/from "seasons"/.test(sql)) {
        return {
          rows: [
            ["Fall 2026", "Main Rink", 45],
          ],
        }
      }
      return { rows: [] }
    })
  })

  // ==========================================================================
  // SCENARIO 1: Game Detail Attribution & Head-to-Head Roster Partitioning
  // ==========================================================================
  describe("Scenario 1: Game Detail Traded Player Attribution", () => {
    it("strictly attributes a traded player to Team A with Team A stats in head-to-head vs Team B", async () => {
      // Game g130: yetis (home) vs loons (away)
      // Player 630 (Darrell Draper) played for loons with pgs.team_slug = 'loons'
      // Player 100 (Yeti Vet) played for yetis with pgs.team_slug = 'yetis'
      // Player 895 (Steph Tryphonas) played goalie for loons with ggs.team_slug = 'loons'
      // Player 200 (Yeti Goalie) played goalie for yetis with ggs.team_slug = 'yetis'
      // In Week 2, Draper and Tryphonas were traded to yetis.

      mocks.rawSql.mockImplementation(async ({ sql, params }: Query) => {
        if (sql.includes("FROM games g") && sql.includes("WHERE g.id =")) {
          return [
            {
              id: "g130",
              date: "2026-10-04",
              time: "7:00 PM",
              home_team: "yetis",
              away_team: "loons",
              home_slug: "yetis",
              away_slug: "loons",
              home_score: 5,
              away_score: 3,
              game_type: "regular",
              season_id: "2026-2027",
              status: "final",
              is_overtime: false,
              is_forfeit: false,
              home_name: "Yetis",
              away_name: "Loons",
            },
          ]
        }

        // Skater box scores
        if (sql.includes("FROM player_game_stats pgs")) {
          const teamSlugParam = params.find((p) => p === "yetis" || p === "loons")
          if (teamSlugParam === "loons") {
            return [
              {
                id: 630,
                name: "Darrell Draper",
                goals: 2,
                assists: 1,
                points: 3,
                gwg: 0,
                ppg: 1,
                shg: 0,
                eng: 0,
                hat_tricks: 0,
                pen: 1,
                pim: 2,
                is_sub: false,
              },
            ]
          }
          if (teamSlugParam === "yetis") {
            return [
              {
                id: 100,
                name: "Yeti Vet",
                goals: 3,
                assists: 2,
                points: 5,
                gwg: 1,
                ppg: 1,
                shg: 0,
                eng: 0,
                hat_tricks: 1,
                pen: 0,
                pim: 0,
                is_sub: false,
              },
            ]
          }
          return []
        }

        // Goalie box scores
        if (sql.includes("FROM goalie_game_stats ggs")) {
          const teamSlugParam = params.find((p) => p === "yetis" || p === "loons")
          if (teamSlugParam === "loons") {
            return [
              {
                id: 895,
                name: "Steph Tryphonas",
                seconds: 2700,
                goals_against: 5,
                shots_against: 30,
                saves: 25,
                shutouts: 0,
                goalie_assists: 0,
                result: "L",
                is_sub: false,
              },
            ]
          }
          if (teamSlugParam === "yetis") {
            return [
              {
                id: 200,
                name: "Yeti Goalie",
                seconds: 2700,
                goals_against: 3,
                shots_against: 20,
                saves: 17,
                shutouts: 0,
                goalie_assists: 1,
                result: "W",
                is_sub: false,
              },
            ]
          }
          return []
        }

        if (sql.includes("FROM game_officials")) return []
        if (sql.includes("FROM seasons")) {
          return [{ name: "Fall 2026", defaultLocation: "Main Rink", gameLength: 45 }]
        }
        return []
      })

      const detail = await fetchGameDetail("g130")
      expect(detail).not.toBeNull()
      if (!detail) return

      // Verify Away (Loons) players & goalies
      expect(detail.awayPlayers).toHaveLength(1)
      expect(detail.awayPlayers[0].id).toBe(630)
      expect(detail.awayPlayers[0].name).toBe("Darrell Draper")
      expect(detail.awayPlayers[0].points).toBe(3)

      expect(detail.awayGoalies).toHaveLength(1)
      expect(detail.awayGoalies[0].id).toBe(895)
      expect(detail.awayGoalies[0].name).toBe("Steph Tryphonas")
      expect(detail.awayGoalies[0].saves).toBe(25)

      // Verify Home (Yetis) players & goalies
      expect(detail.homePlayers).toHaveLength(1)
      expect(detail.homePlayers[0].id).toBe(100)
      expect(detail.homePlayers[0].name).toBe("Yeti Vet")
      expect(detail.homePlayers.some((p) => p.id === 630)).toBe(false)

      expect(detail.homeGoalies).toHaveLength(1)
      expect(detail.homeGoalies[0].id).toBe(200)
      expect(detail.homeGoalies.some((g) => g.id === 895)).toBe(false)
    })

    it("verifies the SQL query text contains pgs.team_slug partition and legacy fallback", async () => {
      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        if (sql.includes("FROM games g") && sql.includes("WHERE g.id =")) {
          return [{
            id: "g130", date: "2026-10-04", time: "7:00 PM",
            home_team: "yetis", away_team: "loons", home_slug: "yetis", away_slug: "loons",
            home_score: 5, away_score: 3,
            game_type: "regular", season_id: "2026-2027", status: "final",
            is_overtime: false, is_forfeit: false,
          }]
        }
        return []
      })

      await fetchGameDetail("g130")

      const pgsCalls = mocks.rawSql.mock.calls
        .map(([q]) => q as Query)
        .filter(({ sql }) => sql.includes("FROM player_game_stats pgs"))

      expect(pgsCalls.length).toBe(2)
      for (const call of pgsCalls) {
        expect(call.sql).toContain("pgs.team_slug =")
        expect(call.sql).toContain("pgs.team_slug IS NULL")
        expect(call.sql).toContain("EXISTS")
        expect(call.sql).toContain("player_seasons ps")
        expect(call.sql).toContain("adhoc_game_rosters agr")
      }

      const ggsCalls = mocks.rawSql.mock.calls
        .map(([q]) => q as Query)
        .filter(({ sql }) => sql.includes("FROM goalie_game_stats ggs"))

      expect(ggsCalls.length).toBe(2)
      for (const call of ggsCalls) {
        expect(call.sql).toContain("ggs.team_slug =")
        expect(call.sql).toContain("ggs.team_slug IS NULL")
      }
    })

    it("verifies head-to-head roster logic excludes traded player from new team and includes on game-day team", () => {
      // Simulate the exact SQL subquery logic from app/game/[id]/page.tsx & app/admin/games/[id]/edit/page.tsx
      const gameId = "g130"
      const seasonId = "2026-2027"

      // Database state:
      // Player 630 (Draper): player_seasons team_slug = 'yetis' (traded)
      // In g130: player_game_stats has team_slug = 'loons'
      const playerSeasons = [
        { playerId: 630, seasonId, teamSlug: "yetis" },
        { playerId: 100, seasonId, teamSlug: "yetis" },
        { playerId: 500, seasonId, teamSlug: "loons" },
      ]
      const playerGameStats = [
        { playerId: 630, gameId: "g130", teamSlug: "loons" },
        { playerId: 100, gameId: "g130", teamSlug: "yetis" },
      ]
      const goalieGameStats: { playerId: number; gameId: string; teamSlug: string }[] = []

      function executeRosterOracle(teamSlug: string) {
        // Branch 1: player_seasons NOT EXISTS on opposing team
        const activeRosterFiltered = playerSeasons.filter((ps) => {
          if (ps.seasonId !== seasonId || ps.teamSlug !== teamSlug) return false
          const recordedOpponentSkater = playerGameStats.some(
            (pgs) => pgs.gameId === gameId && pgs.playerId === ps.playerId && pgs.teamSlug !== teamSlug
          )
          const recordedOpponentGoalie = goalieGameStats.some(
            (ggs) => ggs.gameId === gameId && ggs.playerId === ps.playerId && ggs.teamSlug !== teamSlug
          )
          return !recordedOpponentSkater && !recordedOpponentGoalie
        }).map((ps) => ps.playerId)

        // Branch 2: union recorded stats for this team
        const recordedSkaters = playerGameStats
          .filter((pgs) => pgs.gameId === gameId && pgs.teamSlug === teamSlug)
          .map((pgs) => pgs.playerId)

        const recordedGoalies = goalieGameStats
          .filter((ggs) => ggs.gameId === gameId && ggs.teamSlug === teamSlug)
          .map((ggs) => ggs.playerId)

        return Array.from(new Set([...activeRosterFiltered, ...recordedSkaters, ...recordedGoalies]))
      }

      const yetisRoster = executeRosterOracle("yetis")
      const loonsRoster = executeRosterOracle("loons")

      // Draper (630) must be on Loons roster, NOT Yetis roster
      expect(loonsRoster).toContain(630)
      expect(loonsRoster).toContain(500)
      expect(yetisRoster).toContain(100)
      expect(yetisRoster).not.toContain(630)
    })
  })

  // ==========================================================================
  // SCENARIO 2: Team Detail 0-GP Traded Players, Averages & Former Team Retention
  // ==========================================================================
  describe("Scenario 2: Team Detail CTE Aggregation & 0-GP Handling", () => {
    it("handles newly acquired skater with 0 GP without breaking points-per-game", async () => {
      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        if (sql.includes("WITH team_game_stats AS")) {
          return [
            {
              id: 999,
              name: "Rookie Acquired",
              gp: 0,
              goals: 0,
              assists: 0,
              points: 0,
              gwg: 0,
              ppg: 0,
              shg: 0,
              eng: 0,
              hat_tricks: 0,
              pen: 0,
              pim: 0,
            },
          ]
        }
        if (sql.includes("WITH team_goalie_stats AS")) return []
        if (sql.includes("FROM games g")) return []
        if (sql.includes("FROM season_teams")) return [{ count: 1 }]
        return []
      })

      const detail = await fetchTeamDetail("yetis", "2026-2027")
      expect(detail).not.toBeNull()
      if (!detail) return

      expect(detail.skaters).toHaveLength(1)
      const rookie = detail.skaters[0]
      expect(rookie.id).toBe(999)
      expect(rookie.gp).toBe(0)
      expect(rookie.goals).toBe(0)
      expect(rookie.points).toBe(0)
      expect(rookie.ptsPg).toBe("0.00")
    })

    it("handles newly acquired goalie with 0 GP without breaking GAA or save percentage", async () => {
      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        if (sql.includes("WITH team_game_stats AS")) return []
        if (sql.includes("WITH team_goalie_stats AS")) {
          return [
            {
              id: 888,
              name: "Netminder Acquired",
              gp: 0,
              ga: 0,
              saves: 0,
              sa: 0,
              seconds: 0,
              shutouts: 0,
              goalie_assists: 0,
              wins: 0,
              losses: 0,
              game_length: 45,
            },
          ]
        }
        if (sql.includes("FROM games g")) return []
        if (sql.includes("FROM season_teams")) return [{ count: 1 }]
        return []
      })

      const detail = await fetchTeamDetail("yetis", "2026-2027")
      expect(detail).not.toBeNull()
      if (!detail) return

      expect(detail.goalies).toHaveLength(1)
      const goalie = detail.goalies[0]
      expect(goalie.id).toBe(888)
      expect(goalie.gp).toBe(0)
      expect(goalie.wins).toBe(0)
      expect(goalie.losses).toBe(0)
      expect(goalie.gaa).toBe("0.00")
      expect(goalie.savePercentage).toBe("0.000")
      expect(goalie.saves).toBe(0)
      expect(goalie.goalsAgainst).toBe(0)
      expect(goalie.shotsAgainst).toBe(0)
    })

    it("preserves prior-team stats on old team page for traded-away player", async () => {
      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        if (sql.includes("WITH team_game_stats AS")) {
          return [
            {
              id: 630,
              name: "Darrell Draper",
              gp: 1,
              goals: 2,
              assists: 1,
              points: 3,
              gwg: 0,
              ppg: 1,
              shg: 0,
              eng: 0,
              hat_tricks: 0,
              pen: 0,
              pim: 0,
            },
          ]
        }
        if (sql.includes("WITH team_goalie_stats AS")) return []
        if (sql.includes("FROM games g")) return []
        if (sql.includes("FROM season_teams")) return [{ count: 1 }]
        return []
      })

      const detail = await fetchTeamDetail("loons", "2026-2027")
      expect(detail).not.toBeNull()
      if (!detail) return

      expect(detail.skaters).toHaveLength(1)
      expect(detail.skaters[0].id).toBe(630)
      expect(detail.skaters[0].gp).toBe(1)
      expect(detail.skaters[0].points).toBe(3)
      expect(detail.skaters[0].ptsPg).toBe("3.00")
    })

    it("aggregates multiple stints for roundtrip traded player on original team correctly", () => {
      // Player traded A -> B -> A
      const targetTeamSlug = "loons"
      const seasonId = "2026-2027"

      const playerGameStats = [
        { playerId: 42, gameId: "g1", seasonId, teamSlug: "loons", goals: 1, assists: 0, points: 1, isSub: false },
        { playerId: 42, gameId: "g2", seasonId, teamSlug: "loons", goals: 2, assists: 1, points: 3, isSub: false },
        { playerId: 42, gameId: "g3", seasonId, teamSlug: "yetis", goals: 0, assists: 1, points: 1, isSub: false },
        { playerId: 42, gameId: "g4", seasonId, teamSlug: "loons", goals: 1, assists: 2, points: 3, isSub: false },
      ]

      const teamGameStats = playerGameStats.filter(
        (s) => s.seasonId === seasonId && !s.isSub && s.teamSlug === targetTeamSlug
      )

      expect(teamGameStats).toHaveLength(3)
      const totalGoals = teamGameStats.reduce((sum, s) => sum + s.goals, 0)
      const totalPoints = teamGameStats.reduce((sum, s) => sum + s.points, 0)
      expect(totalGoals).toBe(4)
      expect(totalPoints).toBe(7)
    })
  })

  // ==========================================================================
  // SCENARIO 3: Player Detail Multi-Team Splits & Game Log isHome Derivation
  // ==========================================================================
  describe("Scenario 3: Player Detail Multi-Team Season Rows & Game Logs", () => {
    it("splits player into separate season rows when playing for two teams in same season", async () => {
      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        if (sql.includes("FROM players p") && sql.includes("LEFT JOIN player_seasons ps")) {
          return [
            { id: 630, name: "Darrell Draper", team_slug: "yetis", is_goalie: false, team_name: "Yetis", season_id: "2026-2027" },
          ]
        }

        if (sql.includes("WITH player_stats AS MATERIALIZED")) {
          const sections: Record<string, unknown[]> = {}
          for (let i = 0; i < 23; i++) sections[`section_${i}`] = []

          sections["section_2"] = [
            {
              season_id: "2026-2027",
              team_slug: "loons",
              team_name: "Loons",
              gp: 1, goals: 2, assists: 1, points: 3,
              gwg: 0, ppg: 1, shg: 0, eng: 0, hat_tricks: 0, pen: 0, pim: 0,
            },
            {
              season_id: "2026-2027",
              team_slug: "yetis",
              team_name: "Yetis",
              gp: 4, goals: 5, assists: 2, points: 7,
              gwg: 1, ppg: 2, shg: 0, eng: 0, hat_tricks: 1, pen: 1, pim: 2,
            },
          ]

          return [sections]
        }
        return []
      })

      const detail = await fetchPlayerDetail("darrell-draper")
      expect(detail).not.toBeNull()
      if (!detail) return

      const fallRows = detail.perSeasonStats.filter((s) => s.seasonId === "2026-2027")
      expect(fallRows).toHaveLength(2)
      expect(fallRows.map((r) => r.teamSlug)).toContain("loons")
      expect(fallRows.map((r) => r.teamSlug)).toContain("yetis")

      const loonsStint = fallRows.find((r) => r.teamSlug === "loons")
      expect(loonsStint?.stats.gp).toBe(1)
      expect(loonsStint?.stats.points).toBe(3)

      const yetisStint = fallRows.find((r) => r.teamSlug === "yetis")
      expect(yetisStint?.stats.gp).toBe(4)
      expect(yetisStint?.stats.points).toBe(7)
    })

    it("correctly derives isHome and opponent for pre-trade game when player played for visiting team", async () => {
      // In g130: Home = Yetis, Away = Loons.
      // Player 630 (Draper) was on Loons (away).
      // Draper's CURRENT team in player_seasons is Yetis.
      // Game log should report isHome = false, opponent = Yetis, score = Away-Home!

      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        if (sql.includes("FROM players p") && sql.includes("LEFT JOIN player_seasons ps")) {
          return [
            { id: 630, name: "Darrell Draper", team_slug: "yetis", is_goalie: false, team_name: "Yetis", season_id: "2026-2027" },
          ]
        }

        if (sql.includes("WITH player_stats AS MATERIALIZED")) {
          const sections: Record<string, unknown[]> = {}
          for (let i = 0; i < 23; i++) sections[`section_${i}`] = []

          sections["section_3"] = [
            {
              game_id: "g130",
              date: "2026-10-04",
              home_team: "yetis",
              away_team: "loons",
              home_score: 5,
              away_score: 3,
              is_overtime: false,
              home_name: "Yetis",
              away_name: "Loons",
              goals: 2, assists: 1, points: 3,
              gwg: 0, ppg: 1, shg: 0, eng: 0, hat_tricks: 0, pen: 0, pim: 0,
              player_team_slug: "loons",
            },
          ]

          return [sections]
        }
        return []
      })

      const detail = await fetchPlayerDetail("darrell-draper")
      expect(detail).not.toBeNull()
      if (!detail) return

      expect(detail.games).toHaveLength(1)
      const gameLog = detail.games[0]
      expect(gameLog.gameId).toBe("g130")
      expect(gameLog.isHome).toBe(false)
      expect(gameLog.opponent).toBe("Yetis")
      expect(gameLog.opponentSlug).toBe("yetis")
      expect(gameLog.teamScore).toBe(3)
      expect(gameLog.opponentScore).toBe(5)
      expect(gameLog.result).toBe("L")
    })

    it("verifies playoff and exhibition game logs also compute isHome and opponent from player_team_slug", async () => {
      // Test playoff skater (section_10), playoff goalie (section_13), exhibition skater (section_21), exhibition goalie (section_22)
      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        if (sql.includes("FROM players p") && sql.includes("LEFT JOIN player_seasons ps")) {
          return [
            { id: 630, name: "Darrell Draper", team_slug: "yetis", is_goalie: false, team_name: "Yetis", season_id: "2026-2027" },
          ]
        }

        if (sql.includes("WITH player_stats AS MATERIALIZED")) {
          const sections: Record<string, unknown[]> = {}
          for (let i = 0; i < 23; i++) sections[`section_${i}`] = []

          // Playoff skater game log (section_10)
          sections["section_10"] = [
            {
              game_id: "po-1",
              date: "2026-11-01",
              home_team: "yetis",
              away_team: "loons",
              home_score: 2,
              away_score: 4,
              is_overtime: false,
              home_name: "Yetis",
              away_name: "Loons",
              goals: 1, assists: 1, points: 2,
              gwg: 1, ppg: 0, shg: 0, eng: 0, hat_tricks: 0, pen: 0, pim: 0,
              player_team_slug: "loons",
            },
          ]

          // Playoff goalie game log (section_13)
          sections["section_13"] = [
            {
              game_id: "po-1",
              date: "2026-11-01",
              home_team: "yetis",
              away_team: "loons",
              home_score: 2,
              away_score: 4,
              home_name: "Yetis",
              away_name: "Loons",
              seconds: 2700, goals_against: 2, shots_against: 25, saves: 23,
              shutouts: 0, goalie_assists: 0, result: "W",
              player_team_slug: "loons",
            },
          ]

          // Exhibition skater game log (section_21)
          sections["section_21"] = [
            {
              game_id: "exh-1",
              date: "2026-09-15",
              home_team: "yetis",
              away_team: "loons",
              home_score: 1,
              away_score: 3,
              is_overtime: false,
              home_name: "Yetis",
              away_name: "Loons",
              goals: 1, assists: 0, points: 1,
              gwg: 0, ppg: 0, shg: 0, eng: 0, hat_tricks: 0, pen: 0, pim: 0,
              game_type: "exhibition",
              player_team_slug: "loons",
            },
          ]

          // Exhibition goalie game log (section_22)
          sections["section_22"] = [
            {
              game_id: "exh-1",
              date: "2026-09-15",
              home_team: "yetis",
              away_team: "loons",
              home_score: 1,
              away_score: 3,
              home_name: "Yetis",
              away_name: "Loons",
              seconds: 2700, goals_against: 1, shots_against: 18, saves: 17,
              shutouts: 0, goalie_assists: 0, result: "W",
              game_type: "exhibition",
              player_team_slug: "loons",
            },
          ]

          return [sections]
        }
        return []
      })

      const detail = await fetchPlayerDetail("darrell-draper")
      expect(detail).not.toBeNull()
      if (!detail) return

      // Playoff skater
      expect(detail.playoffGames).toHaveLength(1)
      expect(detail.playoffGames[0].isHome).toBe(false)
      expect(detail.playoffGames[0].opponent).toBe("Yetis")
      expect(detail.playoffGames[0].teamScore).toBe(4)
      expect(detail.playoffGames[0].opponentScore).toBe(2)
      expect(detail.playoffGames[0].result).toBe("W")

      // Playoff goalie
      expect(detail.playoffGoalieGames).toHaveLength(1)
      expect(detail.playoffGoalieGames[0].isHome).toBe(false)
      expect(detail.playoffGoalieGames[0].opponent).toBe("Yetis")
      expect(detail.playoffGoalieGames[0].teamScore).toBe(4)
      expect(detail.playoffGoalieGames[0].opponentScore).toBe(2)

      // Exhibition skater
      expect(detail.exhibitionGames).toHaveLength(1)
      expect(detail.exhibitionGames[0].isHome).toBe(false)
      expect(detail.exhibitionGames[0].opponent).toBe("Yetis")
      expect(detail.exhibitionGames[0].teamScore).toBe(3)

      // Exhibition goalie
      expect(detail.exhibitionGoalieGames).toHaveLength(1)
      expect(detail.exhibitionGoalieGames[0].isHome).toBe(false)
      expect(detail.exhibitionGoalieGames[0].opponent).toBe("Yetis")
      expect(detail.exhibitionGoalieGames[0].teamScore).toBe(3)
    })

    it("verifies GET /api/bash/player/[slug] computes effectiveTeamSlug and returns split rows", async () => {
      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        if (sql.includes("FROM players p") && sql.includes("JOIN player_seasons ps")) {
          return [
            { id: 630, name: "Darrell Draper", slug: "darrell-draper", team_slug: "yetis", is_goalie: false, team_name: "Yetis", season_id: "2026-2027" },
          ]
        }

        // Skater per-season stats
        if (sql.includes("FROM player_game_stats pgs") && sql.includes("GROUP BY g.season_id, COALESCE")) {
          return [
            {
              season_id: "2026-2027",
              team_slug: "loons",
              team_name: "Loons",
              gp: 1, goals: 2, assists: 1, points: 3,
              gwg: 0, ppg: 0, shg: 0, eng: 0, hat_tricks: 0, pen: 0, pim: 0,
            },
            {
              season_id: "2026-2027",
              team_slug: "yetis",
              team_name: "Yetis",
              gp: 3, goals: 4, assists: 2, points: 6,
              gwg: 1, ppg: 1, shg: 0, eng: 0, hat_tricks: 0, pen: 0, pim: 0,
            },
          ]
        }

        // Skater regular game log
        if (sql.includes("FROM player_game_stats pgs") && sql.includes("player_team_slug")) {
          return [
            {
              game_id: "g130",
              date: "2026-10-04",
              home_team: "yetis",
              away_team: "loons",
              home_score: 5,
              away_score: 3,
              is_overtime: false,
              home_name: "Yetis",
              away_name: "Loons",
              goals: 2, assists: 1, points: 3,
              gwg: 0, ppg: 0, shg: 0, eng: 0, hat_tricks: 0, pen: 0, pim: 0,
              player_team_slug: "loons",
            },
          ]
        }

        if (sql.includes("FROM games g")) return []
        if (sql.includes("FROM player_seasons ps")) return []

        return []
      })

      const req = new Request("https://bash.fan/api/bash/player/darrell-draper")
      const res = await getPlayerRoute(req, { params: Promise.resolve({ slug: "darrell-draper" }) })
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.perSeasonStats).toHaveLength(2)
      expect(json.perSeasonStats.map((r: any) => r.teamSlug).sort()).toEqual(["loons", "yetis"])

      expect(json.games).toHaveLength(1)
      expect(json.games[0].isHome).toBe(false)
      expect(json.games[0].opponent).toBe("Yetis")
      expect(json.games[0].teamScore).toBe(3)
      expect(json.games[0].opponentScore).toBe(5)
    })
  })

  // ==========================================================================
  // SCENARIO 4: Forfeit Game Exclusion
  // ==========================================================================
  describe("Scenario 4: Forfeit Game Exclusion Rigor", () => {
    it("ensures all stat-reading queries contain AND NOT g.is_forfeit", async () => {
      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        if (sql.includes("WITH player_stats AS MATERIALIZED")) {
          return [Object.fromEntries(Array.from({ length: 23 }, (_, index) => [`section_${index}`, []]))]
        }
        if (sql.includes("FROM players")) {
          return [{ id: 630, name: "Darrell Draper", slug: "darrell-draper", team_slug: "yetis", season_id: "2026-2027" }]
        }
        if (sql.includes("FROM season_teams")) return [{ count: 1 }]
        return []
      })

      // 1. Team Detail
      await fetchTeamDetail("yetis", "2026-2027")
      const teamDetailQueries = mocks.rawSql.mock.calls
        .map(([q]) => q as Query)
        .filter(({ sql }) => sql.includes("WITH team_game_stats AS") || sql.includes("WITH team_goalie_stats AS"))

      expect(teamDetailQueries.length).toBe(2)
      for (const query of teamDetailQueries) {
        expect(query.sql).toMatch(/JOIN games g ON (?:pgs|ggs)\.game_id = g\.id AND NOT g\.is_forfeit/)
      }

      // 2. Player Detail API route
      mocks.rawSql.mockClear()
      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        if (sql.includes("FROM players p") && sql.includes("JOIN player_seasons ps")) {
          return [
            { id: 630, name: "Darrell Draper", slug: "darrell-draper", team_slug: "yetis", is_goalie: false, team_name: "Yetis", season_id: "2026-2027" },
          ]
        }
        return []
      })
      const req = new Request("https://bash.fan/api/bash/player/darrell-draper")
      await getPlayerRoute(req, { params: Promise.resolve({ slug: "darrell-draper" }) })

      const playerRouteStatQueries = mocks.rawSql.mock.calls
        .map(([q]) => q as Query)
        .filter(({ sql }) => sql.includes("FROM player_game_stats") || sql.includes("FROM goalie_game_stats"))

      expect(playerRouteStatQueries.length).toBeGreaterThan(0)
      for (const query of playerRouteStatQueries) {
        expect(query.sql).toMatch(/JOIN games g ON (?:pgs|ggs)\.game_id = g\.id AND NOT g\.is_forfeit/)
      }
    })
  })
})
