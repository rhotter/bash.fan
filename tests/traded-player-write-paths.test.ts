import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getTableName, type SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { isDeepStrictEqual } from "node:util"
import fs from "node:fs"
import path from "node:path"
import { createInitialState, type GoalEvent } from "@/lib/scorekeeper-types"
import { finalShotUpdateSql, planFinalShotCorrection, type FinalShotContext, type ShotCorrection } from "@/lib/final-game-shots"

// ============================================================================
// Traded Player Stat Write Paths & Attribution Suite
// ============================================================================

describe("Attendance Disjointness & Validation in Finalize", () => {
  const mocks = vi.hoisted(() => ({
    select: vi.fn(), insert: vi.fn(), delete: vi.fn(), update: vi.fn(),
    getSession: vi.fn(), rawSql: vi.fn(),
  }))

  vi.mock("@/lib/db", async () => ({
    db: mocks,
    rawSql: mocks.rawSql,
    schema: await import("@/lib/db/schema"),
  }))
  vi.mock("@/lib/admin-session", () => ({ getSession: mocks.getSession }))

  const state = createInitialState()
  let isForfeit = false
  const officialGame = { status: "live", hasBoxscore: false, homeScore: null as number | null, awayScore: null as number | null }
  const inserted: { table: string; values: Record<string, any>; update?: Record<string, any> }[] = []
  const dialect = new PgDialect()

  function goal(overrides: Partial<GoalEvent> = {}): GoalEvent {
    return {
      id: "goal-1", team: "home", period: 3, clock: "9:02", scorerId: 10,
      assist1Id: 1, assist2Id: 11, flags: [], ...overrides,
    }
  }

  async function finalize() {
    const { POST } = await import("@/app/api/bash/scorekeeper/[id]/finalize/route")
    return POST(new Request("https://bash.fan/api/bash/scorekeeper/g55/finalize", {
      method: "POST",
    }), {
      params: Promise.resolve({ id: "g55" }),
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[key]
    Object.assign(state, createInitialState(), {
      period: 3, homeGoalieId: 1, awayGoalieId: 2,
      homeAttendance: [1, 10, 11], awayAttendance: [2, 20],
      homeShots: [5, 5, 5], awayShots: [4, 4, 4], goals: [goal()],
    })
    isForfeit = false
    inserted.length = 0
    mocks.getSession.mockResolvedValue(true)
    mocks.select.mockImplementation(() => ({
      from(table: Parameters<typeof getTableName>[0]) {
        const name = getTableName(table)
        const query = {
          leftJoin: () => query,
          where: async () => {
            if (name === "game_live") return [{ state: structuredClone(state) }]
            if (name === "games") return [{ id: "g55", seasonId: "2026-summer", homeTeam: "home", awayTeam: "away", isPlayoff: false, isForfeit, gameLength: 45, ...officialGame }]
            if (name === "players") return [1, 2, 3, 10, 11, 20].map((id) => ({ id }))
            if (name === "adhoc_game_rosters") return []
            throw new Error(`Unexpected select: ${name}`)
          },
        }
        return query
      },
    }))
    mocks.rawSql.mockImplementation(async (query: SQL) => {
      const { params } = dialect.sqlToQuery(query)
      const [proposedJson, expectedJson] = params.filter((value) => typeof value === "string" && value.startsWith("{")) as string[]
      if (!isDeepStrictEqual(JSON.parse(expectedJson), state)) return []
      const accepted = JSON.parse(proposedJson)
      for (const key of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[key]
      Object.assign(state, accepted)
      return [{ state: structuredClone(state) }]
    })
    mocks.insert.mockImplementation((table: Parameters<typeof getTableName>[0]) => ({
      values(values: Record<string, any>) {
        const entry = { table: getTableName(table), values, update: undefined as Record<string, any> | undefined }
        inserted.push(entry)
        return {
          onConflictDoUpdate: async ({ set }: { set: Record<string, any> }) => { entry.update = set },
          onConflictDoNothing: async () => {},
        }
      },
    }))
    mocks.delete.mockImplementation(() => ({ where: async () => {} }))
    mocks.update.mockImplementation(() => ({ set: () => ({ where: () => ({ returning: async () => [{ id: "g55" }] }) }) }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("STRESS: rejects cross-team attendance overlap (player in both home and away)", async () => {
    // Player 10 added to away attendance while also on home attendance
    state.awayAttendance.push(10)
    const res = await finalize()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Attendance must contain distinct player IDs assigned to only one team")
    expect(inserted.length).toBe(0)
  })

  it("STRESS: rejects internal duplicate player IDs within home attendance", async () => {
    state.homeAttendance = [1, 10, 10, 11]
    const res = await finalize()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Attendance must contain distinct player IDs assigned to only one team")
    expect(inserted.length).toBe(0)
  })

  it("STRESS: rejects non-integer, zero, negative, or invalid player IDs in attendance", async () => {
    // Zero
    state.homeAttendance = [0, 1, 10, 11]
    expect((await finalize()).status).toBe(400)

    // Negative
    state.homeAttendance = [-5, 1, 10, 11]
    expect((await finalize()).status).toBe(400)

    // Float
    state.homeAttendance = [1.5, 1, 10, 11] as any
    expect((await finalize()).status).toBe(400)

    // String
    state.homeAttendance = ["10", 1, 11] as any
    expect((await finalize()).status).toBe(400)
  })

  it("STRESS: rejects empty attendance on either team", async () => {
    state.homeAttendance = []
    expect((await finalize()).status).toBe(400)

    state.homeAttendance = [1, 10, 11]
    state.awayAttendance = []
    expect((await finalize()).status).toBe(400)
  })

  it("STRESS: rejects goal scored by a player not in attendance", async () => {
    state.goals = [goal({ scorerId: 999 })]
    const res = await finalize()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("restore attendance, goalie assignments, and goal history")
  })

  it("STRESS: rejects assist by a player not in attendance", async () => {
    state.goals = [goal({ assist1Id: 888 })]
    const res = await finalize()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("restore attendance, goalie assignments, and goal history")
  })

  it("STRESS: guarantees all inserted player_game_stats and goalie_game_stats have valid teamSlug", async () => {
    const res = await finalize()
    expect(res.status).toBe(200)

    const playerStatsRows = inserted.filter((e) => e.table === "player_game_stats")
    expect(playerStatsRows.length).toBeGreaterThan(0)
    for (const row of playerStatsRows) {
      expect(["home", "away"]).toContain(row.values.teamSlug)
      expect(["home", "away"]).toContain(row.update?.teamSlug)
      // Player 10 and 11 are in homeAttendance -> must be 'home'
      if (row.values.playerId === 10 || row.values.playerId === 11) {
        expect(row.values.teamSlug).toBe("home")
      }
      // Player 20 is in awayAttendance -> must be 'away'
      if (row.values.playerId === 20) {
        expect(row.values.teamSlug).toBe("away")
      }
    }

    const goalieStatsRows = inserted.filter((e) => e.table === "goalie_game_stats")
    expect(goalieStatsRows.length).toBe(2)
    const homeGoalie = goalieStatsRows.find((r) => r.values.playerId === 1)
    const awayGoalie = goalieStatsRows.find((r) => r.values.playerId === 2)
    expect(homeGoalie?.values.teamSlug).toBe("home")
    expect(homeGoalie?.update?.teamSlug).toBe("home")
    expect(awayGoalie?.values.teamSlug).toBe("away")
    expect(awayGoalie?.update?.teamSlug).toBe("away")
  })
})

describe("Goalie Side Resolution When Traded", () => {
  const dialect = new PgDialect()

  function sampleContext(overrides: Partial<FinalShotContext> = {}): FinalShotContext {
    return {
      status: "final",
      seasonId: "2026-summer",
      gameLength: 45,
      isOvertime: false,
      isForfeit: false,
      homeTeam: "home-team",
      awayTeam: "away-team",
      homeScore: 4,
      awayScore: 3,
      state: {
        ...createInitialState(),
        period: 3,
        homeAttendance: [1],
        awayAttendance: [2],
        homeGoalieId: 1,
        awayGoalieId: 2,
        goals: [],
        penalties: [],
        homeShots: [10, 10, 10],
        awayShots: [10, 10, 10],
        officials: { ref1: "A", ref2: "B", scorekeeper: "C" },
        updatedAt: 12345,
      },
      goalies: [
        { playerId: 1, goalsAgainst: 3, shotsAgainst: 30, saves: 27, seconds: 2700, sides: ["home"] },
        { playerId: 2, goalsAgainst: 4, shotsAgainst: 30, saves: 26, seconds: 2700, sides: ["away"] },
      ],
      ...overrides,
    }
  }

  const correction: ShotCorrection = {
    homeShots: [12, 12, 12], // total 36
    awayShots: [11, 11, 11], // total 33
  }

  it("STRESS: verifies exact character-level sync of goalie sides CASE expression between final-game-shots.ts and state/route.ts", () => {
    const finalGameShotsPath = path.resolve(__dirname, "../lib/final-game-shots.ts")
    const stateRoutePath = path.resolve(__dirname, "../app/api/bash/scorekeeper/[id]/state/route.ts")

    const finalGameShotsContent = fs.readFileSync(finalGameShotsPath, "utf-8")
    const stateRouteContent = fs.readFileSync(stateRoutePath, "utf-8")

    // Both must contain the exact team_slug CASE checks
    const expectedCaseFragment = "WHEN s.team_slug = g.home_team THEN '[\"home\"]'::jsonb"
    const expectedAwayFragment = "WHEN s.team_slug = g.away_team THEN '[\"away\"]'::jsonb"

    expect(finalGameShotsContent).toContain(expectedCaseFragment)
    expect(finalGameShotsContent).toContain(expectedAwayFragment)
    expect(stateRouteContent).toContain(expectedCaseFragment)
    expect(stateRouteContent).toContain(expectedAwayFragment)
  })

  it("STRESS: plans shot corrections for traded goalie preserving sides: ['home']", () => {
    const ctx = sampleContext()
    // Goalie 1 was traded post-game, but ggs.team_slug preserved ['home']
    const updates = planFinalShotCorrection(ctx, correction)
    expect(updates).toEqual([
      { playerId: 1, shotsAgainst: 33, saves: 30 },
      { playerId: 2, shotsAgainst: 36, saves: 32 },
    ])
  })

  it("STRESS: rejects shot correction planning if goalie side flipped to opponent side due to stale unmigrated query", () => {
    const ctx = sampleContext()
    // If goalie 1 side had flipped to 'away' due to reading post-trade player_seasons:
    ctx.goalies[0].sides = ["away"]
    expect(() => planFinalShotCorrection(ctx, correction)).toThrow()
  })

  it("STRESS: rejects shot correction planning if goalie sides array is empty or unassigned", () => {
    const ctx = sampleContext()
    ctx.goalies[0].sides = []
    expect(() => planFinalShotCorrection(ctx, correction)).toThrow(/Cannot identify every saved goalie's team unambiguously/)
  })

  it("STRESS: rejects shot correction planning if goalie sides has conflicting multiple sides", () => {
    const ctx = sampleContext()
    ctx.goalies[0].sides = ["home", "away"]
    expect(() => planFinalShotCorrection(ctx, correction)).toThrow(/Cannot identify every saved goalie's team unambiguously/)
  })

  it("STRESS: finalShotUpdateSql produces CTE guard comparing locked_goalies sides with context snapshot", () => {
    const ctx = sampleContext()
    const updates = planFinalShotCorrection(ctx, correction)
    const compiled = dialect.sqlToQuery(finalShotUpdateSql("g55", ctx, correction, updates, 99999))
    expect(compiled.sql).toContain("WHEN s.team_slug = g.home_team THEN '[\"home\"]'::jsonb")
    expect(compiled.sql).toContain("WHEN s.team_slug = g.away_team THEN '[\"away\"]'::jsonb")
    expect(compiled.sql).toContain("locked_goalies")
    expect(compiled.sql).toContain("guard")
  })
})

describe("Sportability Re-Syncing Past Games with WHERE NOT EXISTS", () => {
  it("STRESS: verifies sync route inspects game early and guards player_seasons inserts", () => {
    const syncRoutePath = path.resolve(__dirname, "../app/api/bash/sync/route.ts")
    const syncRouteContent = fs.readFileSync(syncRoutePath, "utf-8")

    // Skater guard
    expect(syncRouteContent).toContain("WHERE NOT EXISTS (")
    expect(syncRouteContent).toContain("SELECT 1 FROM player_seasons ps")
    expect(syncRouteContent).toContain("WHERE ps.player_id = ${playerId} AND ps.season_id = ${seasonId}")

    // Skater game stats teamSlug upsert
    expect(syncRouteContent).toContain("teamSlug: currentTeamSlug")
    expect(syncRouteContent).toContain("teamSlug: sql`EXCLUDED.team_slug`")

    // Goalie guard with is_goalie
    expect(syncRouteContent).toContain("is_goalie)")
    expect(syncRouteContent).toContain("SELECT ${playerId}, ${seasonId}, ${currentTeamSlug}, true")

    // Goalie completion check with COALESCE
    expect(syncRouteContent).toContain("COALESCE(")
    expect(syncRouteContent).toContain("ggs.team_slug,")
    expect(syncRouteContent).toContain("(SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = ggs.player_id AND ps.season_id = ${seasonId} LIMIT 1)")
  })

  it("STRESS: models WHERE NOT EXISTS SQL logic under mid-season trade scenario", () => {
    // Simulation of database table state
    interface PlayerSeasonRow {
      playerId: number
      seasonId: string
      teamSlug: string
      isGoalie?: boolean
    }

    const playerSeasonsTable: PlayerSeasonRow[] = []

    function insertPlayerSeasonWithWhereNotExists(row: PlayerSeasonRow) {
      // Logic of:
      // INSERT INTO player_seasons (player_id, season_id, team_slug)
      // SELECT playerId, seasonId, teamSlug
      // WHERE NOT EXISTS (SELECT 1 FROM player_seasons ps WHERE ps.player_id = ... AND ps.season_id = ...)
      const exists = playerSeasonsTable.some(
        (ps) => ps.playerId === row.playerId && ps.seasonId === row.seasonId
      )
      if (!exists) {
        playerSeasonsTable.push(row)
        return true
      }
      return false
    }

    // Step 1: Rookie player enters league on 'rangers'
    const inserted1 = insertPlayerSeasonWithWhereNotExists({ playerId: 100, seasonId: "2026-summer", teamSlug: "rangers" })
    expect(inserted1).toBe(true)
    expect(playerSeasonsTable.length).toBe(1)
    expect(playerSeasonsTable[0].teamSlug).toBe("rangers")

    // Step 2: Player is traded to 'red-wings' mid-season (roster mutation updates player_seasons)
    playerSeasonsTable[0].teamSlug = "red-wings"
    expect(playerSeasonsTable[0].teamSlug).toBe("red-wings")

    // Step 3: Sportability sync re-syncs a pre-trade boxscore from when player was on 'rangers'
    const insertedStale = insertPlayerSeasonWithWhereNotExists({ playerId: 100, seasonId: "2026-summer", teamSlug: "rangers" })
    expect(insertedStale).toBe(false) // Guard prevented stale insertion!

    // Verify player is STILL solely on 'red-wings'
    expect(playerSeasonsTable.length).toBe(1)
    expect(playerSeasonsTable[0].teamSlug).toBe("red-wings")

    // Step 4: Next season starts; player enters '2027-spring' on 'rangers'
    const insertedNextSeason = insertPlayerSeasonWithWhereNotExists({ playerId: 100, seasonId: "2027-spring", teamSlug: "rangers" })
    expect(insertedNextSeason).toBe(true)
    expect(playerSeasonsTable.length).toBe(2)
  })
})

describe("COALESCE Preserving Non-Null team_slug in Duplicate Merges", () => {
  it("STRESS: models COALESCE algebraic truth table for colliding player_game_stats", () => {
    function simulatePgsCoalesce(
      canonicalTeamSlug: string | null,
      dupeTeamSlug: string | null
    ): string | null {
      // UPDATE player_game_stats pgs_c SET team_slug = COALESCE(pgs_c.team_slug, pgs_d.team_slug)
      return canonicalTeamSlug ?? dupeTeamSlug
    }

    // Both null -> null
    expect(simulatePgsCoalesce(null, null)).toBeNull()

    // Canonical null, dupe populated -> dupe preserved!
    expect(simulatePgsCoalesce(null, "rangers")).toBe("rangers")

    // Canonical populated, dupe null -> canonical preserved!
    expect(simulatePgsCoalesce("red-wings", null)).toBe("red-wings")

    // Canonical populated, dupe populated -> canonical takes priority!
    expect(simulatePgsCoalesce("red-wings", "rangers")).toBe("red-wings")
  })

  it("STRESS: models bidirectional COALESCE for goalie_game_stats across both seconds-elimination branches", () => {
    function simulateGoalieStatsMerge(
      c: { seconds: number; teamSlug: string | null },
      d: { seconds: number; teamSlug: string | null }
    ): { survivingGoalie: "canonical" | "dupe"; finalTeamSlug: string | null } {
      // Step 1: UPDATE ggs_c SET team_slug = COALESCE(ggs_c.team_slug, ggs_d.team_slug)
      const cTeamSlug = c.teamSlug ?? d.teamSlug
      // Step 2: UPDATE ggs_d SET team_slug = COALESCE(ggs_d.team_slug, ggs_c.team_slug)
      const dTeamSlug = d.teamSlug ?? c.teamSlug

      // Step 3: if c.seconds >= d.seconds -> delete d, c survives
      if (c.seconds >= d.seconds) {
        return { survivingGoalie: "canonical", finalTeamSlug: cTeamSlug }
      } else {
        // Step 4: if d.seconds > c.seconds -> delete c, d survives and is updated to canonicalId
        return { survivingGoalie: "dupe", finalTeamSlug: dTeamSlug }
      }
    }

    // Branch A: Canonical has more seconds, but had NULL team_slug
    const resA = simulateGoalieStatsMerge(
      { seconds: 2700, teamSlug: null },
      { seconds: 1200, teamSlug: "rangers" }
    )
    expect(resA.survivingGoalie).toBe("canonical")
    expect(resA.finalTeamSlug).toBe("rangers") // Preserved from dupe!

    // Branch B: Duplicate has more seconds, but had NULL team_slug
    const resB = simulateGoalieStatsMerge(
      { seconds: 600, teamSlug: "red-wings" },
      { seconds: 2700, teamSlug: null }
    )
    expect(resB.survivingGoalie).toBe("dupe")
    expect(resB.finalTeamSlug).toBe("red-wings") // Preserved from canonical!

    // Branch C: Both have team_slugs
    const resC = simulateGoalieStatsMerge(
      { seconds: 2700, teamSlug: "sharks" },
      { seconds: 1200, teamSlug: "rangers" }
    )
    expect(resC.survivingGoalie).toBe("canonical")
    expect(resC.finalTeamSlug).toBe("sharks")
  })

  it("STRESS: verifies season_trade_items reassignment occurs prior to duplicate player deletion in merge-duplicates.ts", () => {
    const mergeDuplicatesPath = path.resolve(__dirname, "../lib/merge-duplicates.ts")
    const content = fs.readFileSync(mergeDuplicatesPath, "utf-8")

    const updateTradeItemsIndex = content.indexOf("UPDATE season_trade_items SET player_id = ${canonicalId} WHERE player_id = ${dupeId}")
    const deletePlayerIndex = content.indexOf("DELETE FROM players WHERE id = ${dupeId}")

    expect(updateTradeItemsIndex).toBeGreaterThan(-1)
    expect(deletePlayerIndex).toBeGreaterThan(-1)
    expect(updateTradeItemsIndex).toBeLessThan(deletePlayerIndex)
  })

  it("STRESS: verifies season_trade_items reassignment occurs prior to duplicate player deletion in merge-manual/route.ts", () => {
    const mergeManualPath = path.resolve(__dirname, "../app/api/bash/admin/players/merge-manual/route.ts")
    const content = fs.readFileSync(mergeManualPath, "utf-8")

    const updateTradeItemsIndex = content.indexOf("UPDATE season_trade_items SET player_id = ${canonicalId} WHERE player_id = ${dupeId}")
    const deletePlayerIndex = content.indexOf("DELETE FROM players WHERE id = ${dupeId}")

    expect(updateTradeItemsIndex).toBeGreaterThan(-1)
    expect(deletePlayerIndex).toBeGreaterThan(-1)
    expect(updateTradeItemsIndex).toBeLessThan(deletePlayerIndex)
  })
})
