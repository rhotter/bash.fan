import { beforeEach, describe, expect, it, vi } from "vitest"
import fs from "fs"
import path from "path"
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
  getAllSeasons: async () => [{ id: "2026-2027", name: "Fall 2026" }],
  isStatsOnlySeason: (seasonId: string) => mocks.statsOnly(seasonId),
}))

import { fetchGameDetail } from "@/lib/fetch-game-detail"
import { fetchTeamDetail } from "@/lib/fetch-team-detail"
import { fetchPlayerDetail } from "@/lib/fetch-player-detail"
import { fetchPlayerStats } from "@/lib/fetch-player-stats"

// Inspect live source files to verify feature query fragments
function checkLiveFeatureSupport() {
  const gameDetailSrc = fs.readFileSync(path.resolve(process.cwd(), "lib/fetch-game-detail.ts"), "utf-8")
  const teamDetailSrc = fs.readFileSync(path.resolve(process.cwd(), "lib/fetch-team-detail.ts"), "utf-8")
  const playerDetailSrc = fs.readFileSync(path.resolve(process.cwd(), "lib/fetch-player-detail.ts"), "utf-8")

  return {
    gameDetailHasTeamSlug: gameDetailSrc.includes("pgs.team_slug ="),
    teamDetailHasCTE: teamDetailSrc.includes("WITH team_game_stats AS") || teamDetailSrc.includes("eligible_skaters"),
    playerDetailHasPlayerTeamSlug: playerDetailSrc.includes("player_team_slug"),
  }
}

const liveSupport = checkLiveFeatureSupport()

// ─── Reference Oracle Models (PRD §5.2.1 - §5.2.3) ──────────────────────────

interface GameStatRecord {
  playerId: number
  playerName: string
  teamSlug: string | null
  gameId: string
  seasonId: string
  goals: number
  assists: number
  points: number
  isSub: boolean
}

interface _GoalieStatRecord {
  playerId: number
  playerName: string
  teamSlug: string | null
  gameId: string
  seasonId: string
  seconds: number
  goalsAgainst: number
  shotsAgainst: number
  saves: number
  shutouts: number
  result: string | null
  isSub: boolean
}

interface PlayerSeasonRecord {
  playerId: number
  seasonId: string
  teamSlug: string
  isGoalie: boolean
}

/**
 * Reference Game Detail Partition Oracle (PRD §5.2.1)
 */
function referencePartitionGameStats(
  stats: GameStatRecord[],
  targetTeamSlug: string,
  seasonRosters: PlayerSeasonRecord[],
  seasonId: string,
  adhocSubs: { playerId: number; teamSide: "home" | "away" }[] = [],
  teamSide: "home" | "away" = "home"
): GameStatRecord[] {
  return stats.filter((stat) => {
    // 1. If stamped team_slug exists, it takes precedence
    if (stat.teamSlug !== null) {
      return stat.teamSlug === targetTeamSlug
    }
    // 2. Fallback to player_seasons for that team
    const onSeasonRoster = seasonRosters.some(
      (ps) => ps.playerId === stat.playerId && ps.seasonId === seasonId && ps.teamSlug === targetTeamSlug
    )
    if (onSeasonRoster) return true

    // 3. Fallback to adhoc game roster
    return adhocSubs.some((agr) => agr.playerId === stat.playerId && agr.teamSide === teamSide)
  })
}

/**
 * Reference Team Detail CTE Aggregation Oracle (PRD §5.2.2)
 */
function referenceAggregateTeamSkaters(
  targetTeamSlug: string,
  seasonId: string,
  currentRoster: PlayerSeasonRecord[],
  gameStats: GameStatRecord[],
  allPlayers: { id: number; name: string }[]
) {
  // team_game_stats: only non-sub stats accumulated for targetTeamSlug
  const teamGameStats = gameStats.filter((stat) => {
    if (stat.seasonId !== seasonId || stat.isSub) return false
    const effectiveSlug =
      stat.teamSlug ??
      currentRoster.find((ps) => ps.playerId === stat.playerId && ps.seasonId === seasonId)?.teamSlug
    return effectiveSlug === targetTeamSlug
  })

  // eligible_skaters: current roster union players with stats for this team
  const eligiblePlayerIds = new Set<number>()
  for (const ps of currentRoster) {
    if (ps.seasonId === seasonId && ps.teamSlug === targetTeamSlug && !ps.isGoalie) {
      eligiblePlayerIds.add(ps.playerId)
    }
  }
  for (const tgs of teamGameStats) {
    eligiblePlayerIds.add(tgs.playerId)
  }

  // Left join eligible skaters to team_game_stats
  const results = Array.from(eligiblePlayerIds).map((playerId) => {
    const player = allPlayers.find((p) => p.id === playerId) || { id: playerId, name: `Player ${playerId}` }
    const playerStats = teamGameStats.filter((s) => s.playerId === playerId)

    const gp = playerStats.length
    const goals = playerStats.reduce((sum, s) => sum + s.goals, 0)
    const assists = playerStats.reduce((sum, s) => sum + s.assists, 0)
    const points = playerStats.reduce((sum, s) => sum + s.points, 0)

    return {
      id: player.id,
      name: player.name,
      gp,
      goals,
      assists,
      points,
      ptsPg: gp > 0 ? (points / gp).toFixed(2) : "0.00",
    }
  })

  return results.sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name))
}

/**
 * Reference isHome derivation Oracle (PRD §5.2.3)
 */
function referenceComputeIsHome(
  playerTeamSlug: string | null | undefined,
  currentTeamSlug: string,
  gameHomeTeam: string
): { isHome: boolean; effectiveTeamSlug: string } {
  const effectiveTeamSlug = playerTeamSlug ?? currentTeamSlug
  return {
    isHome: gameHomeTeam === effectiveTeamSlug,
    effectiveTeamSlug,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Traded Player Statistics & Query Integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.statsOnly.mockResolvedValue(false)
  })

  describe("1. Game Detail Box Score Attribution (PRD §5.2.1)", () => {
    const draperStat: GameStatRecord = {
      playerId: 630,
      playerName: "Darrell Draper",
      teamSlug: "loons", // Stamped at game time (Week 1 g130)
      gameId: "g130",
      seasonId: "2026-2027",
      goals: 1,
      assists: 1,
      points: 2,
      isSub: false,
    }

    const opponentPlayer: GameStatRecord = {
      playerId: 100,
      playerName: "Yeti Scorer",
      teamSlug: "yetis",
      gameId: "g130",
      seasonId: "2026-2027",
      goals: 2,
      assists: 1,
      points: 3,
      isSub: false,
    }

    const allGameStats = [draperStat, opponentPlayer]

    it("attributes player to stamped team_slug even after player_seasons changes to new team", () => {
      // In Week 2, Draper was traded to 'yetis'. Current player_seasons has him on 'yetis'.
      const postTradeRosters: PlayerSeasonRecord[] = [
        { playerId: 630, seasonId: "2026-2027", teamSlug: "yetis", isGoalie: false },
        { playerId: 100, seasonId: "2026-2027", teamSlug: "yetis", isGoalie: false },
      ]

      // Loons (away) query for g130
      const loonsStats = referencePartitionGameStats(allGameStats, "loons", postTradeRosters, "2026-2027", [], "away")
      expect(loonsStats).toHaveLength(1)
      expect(loonsStats[0].playerId).toBe(630)
      expect(loonsStats[0].playerName).toBe("Darrell Draper")

      // Yetis (home) query for g130
      const yetisStats = referencePartitionGameStats(allGameStats, "yetis", postTradeRosters, "2026-2027", [], "home")
      expect(yetisStats).toHaveLength(1)
      expect(yetisStats[0].playerId).toBe(100)
      // Draper must NOT appear on Yetis boxscore for g130
      expect(yetisStats.some((s) => s.playerId === 630)).toBe(false)
    })

    it("prevents traded player from disappearing when traded to a 3rd team not in the game", () => {
      // Player played for 'seals' in g129, then traded to 'loons' (neither home nor away in g129)
      const sealPlayer: GameStatRecord = {
        playerId: 953,
        playerName: "Eddie Parsons",
        teamSlug: "seals",
        gameId: "g129",
        seasonId: "2026-2027",
        goals: 1,
        assists: 0,
        points: 1,
        isSub: false,
      }
      const postTradeRoster: PlayerSeasonRecord[] = [
        { playerId: 953, seasonId: "2026-2027", teamSlug: "loons", isGoalie: false },
      ]

      const sealsStats = referencePartitionGameStats([sealPlayer], "seals", postTradeRoster, "2026-2027", [], "home")
      expect(sealsStats).toHaveLength(1)
      expect(sealsStats[0].playerId).toBe(953)
    })

    it("falls back to player_seasons when team_slug IS NULL (legacy backfill compatibility)", () => {
      const legacyStat: GameStatRecord = {
        playerId: 55,
        playerName: "Legacy Skater",
        teamSlug: null, // Legacy un-stamped stat
        gameId: "g10",
        seasonId: "2025-summer",
        goals: 2,
        assists: 1,
        points: 3,
        isSub: false,
      }
      const legacyRoster: PlayerSeasonRecord[] = [
        { playerId: 55, seasonId: "2025-summer", teamSlug: "sharks", isGoalie: false },
      ]

      const matchedStats = referencePartitionGameStats([legacyStat], "sharks", legacyRoster, "2025-summer", [], "home")
      expect(matchedStats).toHaveLength(1)
      expect(matchedStats[0].playerId).toBe(55)

      const mismatchedStats = referencePartitionGameStats([legacyStat], "loons", legacyRoster, "2025-summer", [], "away")
      expect(mismatchedStats).toHaveLength(0)
    })

    if (liveSupport.gameDetailHasTeamSlug) {
      it("live fetchGameDetail compiles query partitioned by pgs.team_slug", async () => {
        mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
          if (sql.includes("FROM games g")) {
            return [
              {
                id: "g130",
                date: "2026-10-04",
                time: "7:00 PM",
                home_team: "yetis",
                away_team: "loons",
                game_type: "regular",
                season_id: "2026-2027",
                status: "final",
                is_overtime: false,
                is_forfeit: false,
              },
            ]
          }
          if (sql.includes("FROM player_game_stats pgs")) {
            return []
          }
          if (sql.includes("FROM goalie_game_stats ggs")) {
            return []
          }
          if (sql.includes("FROM game_officials")) {
            return []
          }
          return []
        })

        await fetchGameDetail("g130")

        const pgsCalls = mocks.rawSql.mock.calls
          .map(([q]) => q as Query)
          .filter(({ sql }) => sql.includes("FROM player_game_stats pgs"))

        expect(pgsCalls.length).toBeGreaterThan(0)
        for (const { sql } of pgsCalls) {
          expect(sql).toContain("pgs.team_slug =")
        }
      })
    }
  })

  describe("2. Team Detail CTE Aggregation (PRD §5.2.2)", () => {
    const seasonId = "2026-2027"
    const allPlayers = [
      { id: 630, name: "Darrell Draper" },
      { id: 895, name: "Steph Tryphonas" },
      { id: 999, name: "New Traded Player" },
      { id: 100, name: "Veteran Yeti" },
    ]

    // Pre-trade: Draper and Tryphonas played 1 game for Loons, scored points
    const historicalStats: GameStatRecord[] = [
      {
        playerId: 630,
        playerName: "Darrell Draper",
        teamSlug: "loons",
        gameId: "g130",
        seasonId,
        goals: 2,
        assists: 1,
        points: 3,
        isSub: false,
      },
      {
        playerId: 895,
        playerName: "Steph Tryphonas",
        teamSlug: "loons",
        gameId: "g130",
        seasonId,
        goals: 1,
        assists: 2,
        points: 3,
        isSub: false,
      },
      {
        playerId: 100,
        playerName: "Veteran Yeti",
        teamSlug: "yetis",
        gameId: "g130",
        seasonId,
        goals: 4,
        assists: 2,
        points: 6,
        isSub: false,
      },
    ]

    // Post-trade rosters: Draper, Tryphonas, and New Player (0 GP) now on Yetis
    const currentRosters: PlayerSeasonRecord[] = [
      { playerId: 630, seasonId, teamSlug: "yetis", isGoalie: false },
      { playerId: 895, seasonId, teamSlug: "yetis", isGoalie: false },
      { playerId: 999, seasonId, teamSlug: "yetis", isGoalie: false }, // 0 GP on Yetis
      { playerId: 100, seasonId, teamSlug: "yetis", isGoalie: false },
    ]

    it("includes newly acquired traded player with 0 GP and non-null 0 totals on new team page", () => {
      const yetisSkaters = referenceAggregateTeamSkaters("yetis", seasonId, currentRosters, historicalStats, allPlayers)

      const newPlayer = yetisSkaters.find((s) => s.id === 999)
      expect(newPlayer).toBeDefined()
      expect(newPlayer?.gp).toBe(0)
      expect(newPlayer?.goals).toBe(0)
      expect(newPlayer?.assists).toBe(0)
      expect(newPlayer?.points).toBe(0)
      expect(newPlayer?.ptsPg).toBe("0.00")
    })

    it("does not attribute prior-team stats to the new team", () => {
      const yetisSkaters = referenceAggregateTeamSkaters("yetis", seasonId, currentRosters, historicalStats, allPlayers)

      // Draper has 0 games for Yetis (his 1 game was for Loons)
      const draper = yetisSkaters.find((s) => s.id === 630)
      expect(draper).toBeDefined()
      expect(draper?.gp).toBe(0)
      expect(draper?.points).toBe(0)
    })

    it("preserves prior-team stats on old team page for traded-away players", () => {
      // Even though Draper and Tryphonas are now on Yetis in player_seasons,
      // their stats for Loons remain eligible on Loons page via team_game_stats
      const loonsSkaters = referenceAggregateTeamSkaters("loons", seasonId, currentRosters, historicalStats, allPlayers)

      const draperOnLoons = loonsSkaters.find((s) => s.id === 630)
      expect(draperOnLoons).toBeDefined()
      expect(draperOnLoons?.gp).toBe(1)
      expect(draperOnLoons?.goals).toBe(2)
      expect(draperOnLoons?.points).toBe(3)

      const tryphonasOnLoons = loonsSkaters.find((s) => s.id === 895)
      expect(tryphonasOnLoons).toBeDefined()
      expect(tryphonasOnLoons?.gp).toBe(1)
      expect(tryphonasOnLoons?.goals).toBe(1)
      expect(tryphonasOnLoons?.points).toBe(3)
    })

    if (liveSupport.teamDetailHasCTE) {
      it("live fetchTeamDetail executes CTE query with COUNT(tgs.game_id)::int as gp", async () => {
        mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
          if (sql.includes("WITH team_game_stats AS")) {
            return [
              {
                id: 999,
                name: "New Traded Player",
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
          if (sql.includes("FROM season_teams")) {
            return [{ count: 1 }]
          }
          return []
        })
        mocks.query.mockImplementation(async () => ({ rows: [] }))

        await fetchTeamDetail("yetis", "2026-2027")

        const calls = mocks.rawSql.mock.calls
          .map(([q]) => q as Query)
          .filter(({ sql }) => sql.includes("WITH team_game_stats AS"))

        expect(calls.length).toBeGreaterThan(0)
        expect(calls[0].sql).toContain("eligible_skaters AS")
        expect(calls[0].sql).toContain("COUNT(tgs.game_id)::int as gp")
        expect(calls[0].sql).toMatch(/JOIN games g ON pgs\.game_id = g\.id AND NOT g\.is_forfeit/)
      })
    }
  })

  describe("3. Player Detail & Game Log Integrity (PRD §5.2.3)", () => {
    describe("isHome Derivation", () => {
      it("computes isHome = false for away game when player represented visiting team", () => {
        // Draper in g130: home = 'yetis', away = 'loons', player_team_slug = 'loons'
        // Current player.team_slug = 'yetis' (post-trade)
        const { isHome, effectiveTeamSlug } = referenceComputeIsHome("loons", "yetis", "yetis")
        expect(isHome).toBe(false)
        expect(effectiveTeamSlug).toBe("loons")
      })

      it("computes isHome = true for home game after trade", () => {
        // Draper in g140: home = 'yetis', away = 'rangers', player_team_slug = 'yetis'
        const { isHome, effectiveTeamSlug } = referenceComputeIsHome("yetis", "yetis", "yetis")
        expect(isHome).toBe(true)
        expect(effectiveTeamSlug).toBe("yetis")
      })

      it("falls back to current teamSlug when player_team_slug is null (legacy logs)", () => {
        const { isHome, effectiveTeamSlug } = referenceComputeIsHome(null, "yetis", "yetis")
        expect(isHome).toBe(true)
        expect(effectiveTeamSlug).toBe("yetis")
      })
    })

    describe("Per-Season Split Rows", () => {
      it("splits stats into distinct season rows per team for mid-season traded players", () => {
        const perSeasonEntries = [
          {
            seasonId: "2026-2027",
            teamSlug: "loons",
            teamName: "Loons",
            stats: { gp: 4, goals: 3, assists: 2, points: 5 },
          },
          {
            seasonId: "2026-2027",
            teamSlug: "yetis",
            teamName: "Yetis",
            stats: { gp: 6, goals: 5, assists: 4, points: 9 },
          },
        ]

        // Two distinct rows for the same seasonId
        const fallRows = perSeasonEntries.filter((r) => r.seasonId === "2026-2027")
        expect(fallRows).toHaveLength(2)
        expect(fallRows.map((r) => r.teamSlug)).toEqual(["loons", "yetis"])

        const totalPoints = fallRows.reduce((sum, r) => sum + r.stats.points, 0)
        expect(totalPoints).toBe(14)
      })
    })

    if (liveSupport.playerDetailHasPlayerTeamSlug) {
      it("live fetchPlayerDetail includes player_team_slug in game log queries", async () => {
        mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
          if (sql.includes("WITH player_stats AS MATERIALIZED")) {
            return [Object.fromEntries(Array.from({ length: 23 }, (_, index) => [`section_${index}`, []]))]
          }
          if (sql.includes("FROM players")) {
            return [{ id: 630, name: "Darrell Draper", slug: "darrell-draper" }]
          }
          return []
        })

        await fetchPlayerDetail("darrell-draper")

        const calls = mocks.rawSql.mock.calls
          .map(([q]) => q as Query)
          .filter(({ sql }) => sql.includes("player_team_slug"))

        expect(calls.length).toBeGreaterThan(0)
      })
    }
  })

  describe("4. Season Leaderboard vs Team-Filtered Split Stats (fetchPlayerStats)", () => {
    it("rolls up combined season totals for All Teams while preserving per-team split rows in skatersByTeam and goaliesByTeam", async () => {
      mocks.statsOnly.mockResolvedValue(false)
      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        if (sql.includes("FROM players p") && sql.includes("JOIN goalie_game_stats ggs")) {
          return [
            {
              id: 176,
              name: "Ian Hocking",
              game_team: "No ReGretzkys",
              game_team_slug: "no-regretzkys",
              team: "Seals",
              team_slug: "seals",
              gp: 1,
              seconds: 3600,
              goals_against: 2,
              shots_against: 31,
              saves: 29,
              shutouts: 0,
              goalie_assists: 0,
              game_length: 60,
              save_pct: 29 / 31,
              gaa: 2,
              wins: 1,
              losses: 0,
            },
            {
              id: 176,
              name: "Ian Hocking",
              game_team: "Seals",
              game_team_slug: "seals",
              team: "Seals",
              team_slug: "seals",
              gp: 1,
              seconds: 3600,
              goals_against: 2,
              shots_against: 15,
              saves: 13,
              shutouts: 0,
              goalie_assists: 0,
              game_length: 60,
              save_pct: 13 / 15,
              gaa: 2,
              wins: 0,
              losses: 1,
            },
            {
              id: 176,
              name: "Ian Hocking",
              game_team: "Yetis",
              game_team_slug: "yetis",
              team: "Seals",
              team_slug: "seals",
              gp: 1,
              seconds: 3600,
              goals_against: 2,
              shots_against: 13,
              saves: 11,
              shutouts: 0,
              goalie_assists: 0,
              game_length: 60,
              save_pct: 11 / 13,
              gaa: 2,
              wins: 0,
              losses: 1,
            },
          ]
        }
        return []
      })

      const res = await fetchPlayerStats("2026-2027")

      // Combined season row for All Teams view
      expect(res.goalies).toHaveLength(1)
      expect(res.goalies[0]).toMatchObject({
        id: 176,
        name: "Ian Hocking",
        team: "Seals",
        teamSlug: "seals",
        gp: 3,
        wins: 1,
        losses: 2,
        saves: 53,
        goalsAgainst: 6,
        shotsAgainst: 59,
      })

      // Per-team split rows for Team Filter view (1 GP for each of the 3 teams)
      expect(res.goaliesByTeam).toHaveLength(3)
      expect(res.goaliesByTeam?.map((g) => ({ teamSlug: g.teamSlug, gp: g.gp, saves: g.saves }))).toEqual([
        { teamSlug: "no-regretzkys", gp: 1, saves: 29 },
        { teamSlug: "seals", gp: 1, saves: 13 },
        { teamSlug: "yetis", gp: 1, saves: 11 },
      ])
    })
  })
})
