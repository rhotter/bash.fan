import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  parseArgs,
  describeDbEndpoint,
  assertConfirmedHost,
  loadHistoricalTradedPlayers,
  normalizePlayerNameKey,
  duplicatePsKey,
  transitionH2HKey,
  MANUAL_REVIEW_HOLD_OUT_KEYS,
  DETERMINISTIC_TRANSITION_H2H_RESOLUTIONS,
  EXPECTED_DUPLICATE_PLAYER_SEASONS,
  resolveEntriesForDatabase,
  auditBoxscoreRegressions,
  buildBackfillPlan,
  clusterTradeMoves,
  isPlanEmpty,
  isSnapshotFullyApplied,
  updateSnapshot,
  rollbackFromSnapshot,
  applyBackfillPlan,
  createPreBackfillSnapshot,
  scanApplySnapshots,
  runApply,
  withBackfillLock,
  type BackfillPlan,
  type BackfillSnapshot,
  type HistoricalTradeEntry,
  type ResolvedHistoricalTradeEntry,
  type Sql,
} from "../scripts/backfill-historical-trades"

type MockHandler = (q: string, values: unknown[]) => unknown[] | undefined

/** Tagged-template mock: routes each query by substring to `handler`, recording every call. */
function makeMockSql(handler: MockHandler) {
  const calls: { q: string; values: unknown[] }[] = []
  const fn = vi.fn().mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join("?")
    calls.push({ q, values })
    return handler(q, values) ?? []
  })
  return { sql: fn as unknown as Sql, calls }
}

const BREHT: HistoricalTradeEntry = {
  seasonId: "2002-2003",
  leagueId: 1901,
  playerName: "Breht Clark",
  sportabilityPlayerId: 120001,
  fromTeamSlug: "red-leafs",
  toTeamSlug: "landsharks",
  gameDates: ["2003-01-12"],
}

const RESOLVED_BREHT: ResolvedHistoricalTradeEntry = {
  ...BREHT,
  playerId: 7338,
}

function gameRow(overrides: Record<string, unknown>) {
  return {
    kind: "skater",
    player_id: 7338,
    playerName: "Breht Clark",
    seasonId: "2002-2003",
    fromTeamSlug: "red-leafs",
    toTeamSlug: "landsharks",
    team_slug: null,
    ...overrides,
  }
}

const TEAMS = [
  { slug: "red-leafs", name: "Red Leafs" },
  { slug: "landsharks", name: "Landsharks" },
]

function planHandler(
  gameRows: unknown[],
  extra: {
    players?: { id: number; name: string }[]
    seasonTeams?: { season_id: string; team_slug: string }[]
    resolvedPlayerSeasons?: { player_id: number; season_id: string; team_slug: string }[]
    ps?: unknown[]
    existingMoves?: unknown[]
    gamesForAudit?: unknown[]
    pgsForAudit?: unknown[]
  } = {}
): MockHandler {
  const players = extra.players ?? [
    { id: 7338, name: "Breht Clark" },
    { id: 9999, name: "Pat Partner" },
  ]
  const seasonTeams = extra.seasonTeams ?? [
    { season_id: "2002-2003", team_slug: "red-leafs" },
    { season_id: "2002-2003", team_slug: "landsharks" },
  ]
  const resolvedPlayerSeasons = extra.resolvedPlayerSeasons ?? [
    { player_id: 7338, season_id: "2002-2003", team_slug: "landsharks" },
    { player_id: 9999, season_id: "2002-2003", team_slug: "red-leafs" },
  ]
  return (q) => {
    if (q.includes("FROM players")) return players
    if (q.includes("FROM season_teams")) return seasonTeams
    if (q.includes("FROM player_seasons\n") || q.includes("FROM player_seasons ")) {
      if (q.includes("FROM player_seasons ps")) return extra.ps ?? []
      return resolvedPlayerSeasons
    }
    if (q.includes("JOIN combined c")) return gameRows
    if (q.includes("SELECT slug, name FROM teams")) return TEAMS
    if (q.includes("FROM season_trade_items sti")) return extra.existingMoves ?? []
    if (q.includes("FROM games\n") || q.includes("FROM games ")) return extra.gamesForAudit ?? []
    if (q.includes("FROM player_game_stats\n") || q.includes("FROM player_game_stats ")) return extra.pgsForAudit ?? []
    return []
  }
}

describe("scripts/backfill-historical-trades.ts", () => {
  describe("CLI Argument Parsing", () => {
    it("defaults to dry-run mode", () => {
      expect(parseArgs([]).mode).toBe("dry-run")
    })

    it("parses --apply, --dry-run, --snapshot, --rollback, --url and --confirm-host", () => {
      expect(parseArgs(["--apply"]).mode).toBe("apply")
      expect(parseArgs(["--dry-run"]).mode).toBe("dry-run")
      expect(parseArgs(["-n"]).mode).toBe("dry-run")

      const snapArgs = parseArgs(["--snapshot", "/tmp/snap.json"])
      expect(snapArgs.mode).toBe("snapshot")
      expect(snapArgs.snapshotPath).toBe("/tmp/snap.json")

      const rollArgs = parseArgs(["--rollback", "/tmp/snap.json", "--url", "postgres://host/db", "--confirm-host", "host"])
      expect(rollArgs).toMatchObject({
        mode: "rollback",
        snapshotPath: "/tmp/snap.json",
        url: "postgres://host/db",
        confirmHost: "host",
      })

      expect(parseArgs(["--url=postgres://h/db?sslmode=require&x=1"]).url).toBe("postgres://h/db?sslmode=require&x=1")
    })

    it("rejects conflicting modes regardless of order", () => {
      expect(() => parseArgs(["--apply", "--snapshot", "/tmp/x.json"])).toThrow("Conflicting modes")
      expect(() => parseArgs(["--snapshot", "/tmp/x.json", "--apply"])).toThrow("Conflicting modes")
      expect(() => parseArgs(["--apply", "--rollback", "/tmp/x.json"])).toThrow("Conflicting modes")
    })

    it("throws on missing values and unknown flags", () => {
      expect(() => parseArgs(["--rollback"])).toThrow("Missing snapshot file path")
      expect(() => parseArgs(["--rollback="])).toThrow("Missing snapshot file path")
      expect(() => parseArgs(["--url"])).toThrow("Missing value for --url")
      expect(() => parseArgs(["--url", "--apply"])).toThrow("Missing value for --url")
      expect(() => parseArgs(["--url="])).toThrow("Missing value for --url")
      expect(() => parseArgs(["--confirm-host"])).toThrow("Missing value for --confirm-host")
      expect(() => parseArgs(["--aply"])).toThrow("Unknown argument")
    })

    it("never guesses dev/prod from the hostname", () => {
      const prev = process.env.DB_LABEL
      delete process.env.DB_LABEL
      try {
        const d = describeDbEndpoint("postgres://u:p@ep-winter-bird-123.neon.tech/db")
        expect(d.host).toBe("ep-winter-bird-123.neon.tech")
        expect(d.label).not.toMatch(/dev|prod/i)
      } finally {
        if (prev !== undefined) process.env.DB_LABEL = prev
      }
    })

    it("requires --confirm-host to exactly match the target host for writes", () => {
      const url = "postgres://u:p@ep-abc-123.neon.tech/db"
      expect(() => assertConfirmedHost(url, undefined)).toThrow("--confirm-host ep-abc-123.neon.tech")
      expect(() => assertConfirmedHost(url, "ep-other.neon.tech")).toThrow("does not match")
      expect(() => assertConfirmedHost(url, "ep-abc-123.neon.tech")).not.toThrow()
    })
  })

  describe("Vendored Dataset Contract (data/historical-traded-players.json)", () => {
    it("contains 163 verified historical trade entries with no hardcoded playerIds", () => {
      const entries = loadHistoricalTradedPlayers()
      expect(entries.length).toBe(163)

      const holford = entries.find((e) => e.seasonId === "2015-2016" && normalizePlayerNameKey(e.playerName) === "tom holford")
      expect(holford?.fromTeamSlug).toBe("rink-rats")
      expect(holford?.toTeamSlug).toBe("roadrunners")

      // Upstream dataset fix: 2022-summer Thijs van Klaveren moved from little-piggies -> the-vim
      const thijs = entries.find((e) => e.seasonId === "2022-summer" && e.playerName === "Thijs van Klaveren")
      expect(thijs?.fromTeamSlug).toBe("little-piggies")
      expect(thijs?.toTeamSlug).toBe("the-vim")

      // Upstream dataset fix: 2001-2002 Robert Tucker moved from rink-rats -> seals (paired 1-for-1 with Alan Eidinger)
      const tucker = entries.find((e) => e.seasonId === "2001-2002" && e.playerName === "Robert Tucker")
      expect(tucker?.fromTeamSlug).toBe("rink-rats")
      expect(tucker?.toTeamSlug).toBe("seals")

      const p2001Names = ["Richard Deming", "Parker Colvin", "Christian Beausejour", "Kerry Hew"]
      const p2001 = entries.filter((e) => e.seasonId === "2001-2002" && p2001Names.includes(e.playerName))
      expect(p2001.length).toBe(4)
      // Allow-listed dedupe keys correspond to each player's pre-trade (fromTeamSlug) row
      for (const e of p2001) {
        expect(EXPECTED_DUPLICATE_PLAYER_SEASONS.has(duplicatePsKey(e.seasonId, e.playerName, e.fromTeamSlug))).toBe(true)
      }

      const seen = new Set<string>()
      for (const e of entries) {
        expect("playerId" in (e as unknown as Record<string, unknown>)).toBe(false)
        expect(e.playerName.trim().length).toBeGreaterThan(0)
        expect(e.fromTeamSlug).not.toBe(e.toTeamSlug)
        const k = `${e.seasonId}:${normalizePlayerNameKey(e.playerName)}`
        expect(seen.has(k)).toBe(false)
        seen.add(k)
      }
    })

    it("holds out the exact 16 zero-goal transition-window H2H skater rows and fixes Parker Colvin 68462", () => {
      expect(MANUAL_REVIEW_HOLD_OUT_KEYS.size).toBe(16)
      for (const key of MANUAL_REVIEW_HOLD_OUT_KEYS) {
        expect(DETERMINISTIC_TRANSITION_H2H_RESOLUTIONS[`skater:${key}`]).toBeUndefined()
      }
      // Regression guard: Parker Colvin scored 1G for landsharks (not seals) in 2001-2002 game 68462
      expect(
        DETERMINISTIC_TRANSITION_H2H_RESOLUTIONS[transitionH2HKey("skater", "2001-2002", "Parker Colvin", "68462")]?.targetTeamSlug
      ).toBe("landsharks")
    })
  })

  describe("resolveEntriesForDatabase (runtime name -> target DB player_id resolution)", () => {
    it("resolves player IDs dynamically from target DB using SQL whitespace-collapsing normalization", async () => {
      const { sql, calls } = makeMockSql((q) => {
        if (q.includes("FROM players")) return [{ id: 42424, name: "  Breht  Clark  " }]
        if (q.includes("FROM season_teams")) {
          return [
            { season_id: "2002-2003", team_slug: "red-leafs" },
            { season_id: "2002-2003", team_slug: "landsharks" },
          ]
        }
        if (q.includes("FROM player_seasons")) {
          return [{ player_id: 42424, season_id: "2002-2003", team_slug: "landsharks" }]
        }
        return []
      })
      const resolved = await resolveEntriesForDatabase(sql, [BREHT])
      expect(resolved).toHaveLength(1)
      expect(resolved[0].playerId).toBe(42424)
      expect(calls.find((c) => c.q.includes("FROM players"))?.q).toContain("TRIM(regexp_replace(LOWER(name), '[[:space:]]+', ' ', 'g'))")
    })

    it("aborts when a player is missing, ambiguous, missing season_teams, or missing toTeamSlug player_seasons", async () => {
      const missing = makeMockSql((q) => {
        if (q.includes("FROM players")) return []
        if (q.includes("FROM season_teams")) return [{ season_id: "2002-2003", team_slug: "red-leafs" }]
        return []
      })
      await expect(resolveEntriesForDatabase(missing.sql, [BREHT])).rejects.toThrow(
        /toTeamSlug "landsharks" missing from season_teams[\s\S]*expected exactly 1 player match in target DB, found 0/
      )

      const duplicate = makeMockSql((q) => {
        if (q.includes("FROM players")) {
          return [
            { id: 10, name: "Breht Clark" },
            { id: 20, name: "breht clark" },
          ]
        }
        if (q.includes("FROM season_teams")) {
          return [
            { season_id: "2002-2003", team_slug: "red-leafs" },
            { season_id: "2002-2003", team_slug: "landsharks" },
          ]
        }
        return []
      })
      await expect(resolveEntriesForDatabase(duplicate.sql, [BREHT])).rejects.toThrow(
        /expected exactly 1 player match in target DB, found 2/
      )

      const missingPs = makeMockSql((q) => {
        if (q.includes("FROM players")) return [{ id: 10, name: "Breht Clark" }]
        if (q.includes("FROM season_teams")) {
          return [
            { season_id: "2002-2003", team_slug: "red-leafs" },
            { season_id: "2002-2003", team_slug: "landsharks" },
          ]
        }
        if (q.includes("FROM player_seasons")) return []
        return []
      })
      await expect(resolveEntriesForDatabase(missingPs.sql, [BREHT])).rejects.toThrow(
        /missing player_seasons row for toTeamSlug "landsharks"/
      )
    })
  })

  describe("auditBoxscoreRegressions", () => {
    it("detects boxscore goal-sum regressions and counts exact-parity fixes", async () => {
      const { sql } = makeMockSql((q) => {
        if (q.includes("FROM games")) {
          return [
            { id: "g_good", season_id: "2001-2002", date: "2002-01-26", home_team: "seals", away_team: "landsharks", home_score: 7, away_score: 3, is_forfeit: false },
            { id: "g_bad", season_id: "2001-2002", date: "2002-01-26", home_team: "seals", away_team: "landsharks", home_score: 7, away_score: 3, is_forfeit: false },
          ]
        }
        if (q.includes("FROM player_game_stats")) {
          return [
            // g_good: seals=7, landsharks=2, colvin=1 (NULL -> landsharks fixes 2 -> 0)
            { game_id: "g_good", player_id: 1, team_slug: "seals", goals: 7 },
            { game_id: "g_good", player_id: 2, team_slug: "landsharks", goals: 2 },
            { game_id: "g_good", player_id: 3, team_slug: null, goals: 1 },
            // g_bad: seals=7, landsharks=3 (flipping colvin to seals regresses 0 -> 2)
            { game_id: "g_bad", player_id: 1, team_slug: "seals", goals: 7 },
            { game_id: "g_bad", player_id: 2, team_slug: "landsharks", goals: 2 },
            { game_id: "g_bad", player_id: 3, team_slug: "landsharks", goals: 1 },
          ]
        }
        return []
      })

      const audit = await auditBoxscoreRegressions(sql, [
        { kind: "skater", pass: "pass2_h2h", seasonId: "2001-2002", playerId: 3, playerName: "Parker Colvin", gameId: "g_good", date: "2002-01-26", homeTeam: "seals", awayTeam: "landsharks", previousTeamSlug: null, newTeamSlug: "landsharks", reason: "fix" },
        { kind: "skater", pass: "pass2_h2h", seasonId: "2001-2002", playerId: 3, playerName: "Parker Colvin", gameId: "g_bad", date: "2002-01-26", homeTeam: "seals", awayTeam: "landsharks", previousTeamSlug: "landsharks", newTeamSlug: "seals", reason: "wrong" },
      ])
      expect(audit.fixedExactCount).toBe(1)
      expect(audit.regressions).toHaveLength(1)
      expect(audit.regressions[0]).toMatchObject({ gameId: "g_bad", preError: 0, postError: 2 })
    })

    it("catches wrong NULL -> shutout/full team and NULL -> score overshoot regressions, without false-positiving mercy-capped games", async () => {
      const { sql } = makeMockSql((q) => {
        if (q.includes("FROM games")) {
          return [
            // g_shutout: home 0 - away 2; wrongly stamping NULL 1G scorer onto shutout home team
            { id: "g_shutout", season_id: "2001-2002", date: "2001-09-29", home_team: "roadrunners", away_team: "rink-rats", home_score: 0, away_score: 2, is_forfeit: false },
            // g_overshoot: home 4 - away 2; preH=3, preOther=2 -> stamping onto home overshoots 4 -> 5
            { id: "g_overshoot", season_id: "2001-2002", date: "2001-09-29", home_team: "roadrunners", away_team: "rink-rats", home_score: 4, away_score: 2, is_forfeit: false },
            // g_mercy: home 8 - away 1 (scoreboard capped; preH=9 >= 8 && preA=1 >= 1 already full)
            { id: "g_mercy", season_id: "2017-2018", date: "2017-10-14", home_team: "seals", away_team: "roadrunners", home_score: 8, away_score: 1, is_forfeit: false },
          ]
        }
        if (q.includes("FROM player_game_stats")) {
          return [
            { game_id: "g_shutout", player_id: 1, team_slug: "rink-rats", goals: 1 },
            { game_id: "g_shutout", player_id: 2, team_slug: null, goals: 1 },
            { game_id: "g_overshoot", player_id: 1, team_slug: "roadrunners", goals: 3 },
            { game_id: "g_overshoot", player_id: 2, team_slug: null, goals: 2 },
            { game_id: "g_mercy", player_id: 1, team_slug: "seals", goals: 9 },
            { game_id: "g_mercy", player_id: 2, team_slug: "roadrunners", goals: 1 },
            { game_id: "g_mercy", player_id: 3, team_slug: null, goals: 1 },
          ]
        }
        return []
      })

      const audit = await auditBoxscoreRegressions(sql, [
        { kind: "skater", pass: "pass1_orphan_3rd_team", seasonId: "2001-2002", playerId: 2, playerName: "A", gameId: "g_shutout", date: "2001-09-29", homeTeam: "roadrunners", awayTeam: "rink-rats", previousTeamSlug: null, newTeamSlug: "roadrunners", reason: "wrong" },
        { kind: "skater", pass: "pass1_orphan_3rd_team", seasonId: "2001-2002", playerId: 2, playerName: "B", gameId: "g_overshoot", date: "2001-09-29", homeTeam: "roadrunners", awayTeam: "rink-rats", previousTeamSlug: null, newTeamSlug: "roadrunners", reason: "wrong" },
        { kind: "skater", pass: "pass1_orphan_3rd_team", seasonId: "2017-2018", playerId: 3, playerName: "C", gameId: "g_mercy", date: "2017-10-14", homeTeam: "seals", awayTeam: "roadrunners", previousTeamSlug: null, newTeamSlug: "seals", reason: "mercy" },
      ])
      expect(audit.regressions.map((r) => r.gameId)).toEqual(["g_shutout", "g_overshoot"])
      expect(audit.regressions[0]).toMatchObject({ preError: 2, postError: 2, preTeamError: 1, postTeamError: 2, preExcess: 0, postExcess: 1 })
      expect(audit.regressions[1]).toMatchObject({ preError: 5, postError: 3, preExcess: 0, postExcess: 1 })
    })

    it("never allows bothTeamsAlreadyFull to bypass stamping a NULL goal onto a 0-goal shutout team", async () => {
      const { sql } = makeMockSql((q) => {
        if (q.includes("FROM games")) {
          return [
            // Mercy-capped shutout: home 8 - away 0, preH=8 (>=8), preA=0 (>=0), preOther=1
            { id: "g_mercy_shutout_ok", season_id: "2017-2018", date: "2017-10-14", home_team: "seals", away_team: "roadrunners", home_score: 8, away_score: 0, is_forfeit: false },
            { id: "g_mercy_shutout_bad", season_id: "2017-2018", date: "2017-10-14", home_team: "seals", away_team: "roadrunners", home_score: 8, away_score: 0, is_forfeit: false },
          ]
        }
        if (q.includes("FROM player_game_stats")) {
          return [
            { game_id: "g_mercy_shutout_ok", player_id: 1, team_slug: "seals", goals: 8 },
            { game_id: "g_mercy_shutout_ok", player_id: 2, team_slug: null, goals: 1 },
            { game_id: "g_mercy_shutout_bad", player_id: 1, team_slug: "seals", goals: 8 },
            { game_id: "g_mercy_shutout_bad", player_id: 2, team_slug: null, goals: 1 },
          ]
        }
        return []
      })

      const audit = await auditBoxscoreRegressions(sql, [
        { kind: "skater", pass: "pass1_orphan_3rd_team", seasonId: "2017-2018", playerId: 2, playerName: "W", gameId: "g_mercy_shutout_ok", date: "2017-10-14", homeTeam: "seals", awayTeam: "roadrunners", previousTeamSlug: null, newTeamSlug: "seals", reason: "winner" },
        { kind: "skater", pass: "pass1_orphan_3rd_team", seasonId: "2017-2018", playerId: 2, playerName: "L", gameId: "g_mercy_shutout_bad", date: "2017-10-14", homeTeam: "seals", awayTeam: "roadrunners", previousTeamSlug: null, newTeamSlug: "roadrunners", reason: "wrong shutout loser" },
      ])
      expect(audit.regressions.map((r) => r.gameId)).toEqual(["g_mercy_shutout_bad"])
      expect(audit.regressions[0]).toMatchObject({ preError: 1, postError: 1, preTeamError: 0, postTeamError: 1, preExcess: 0, postExcess: 1 })
    })
  })

  describe("buildBackfillPlan", () => {
    it("skips manual-review hold-out rows and stamps Pass 1 + Pass 2 rows", async () => {
      const { sql } = makeMockSql(
        planHandler([
          gameRow({ game_id: "142850", date: "2003-01-12", home_team: "red-leafs", away_team: "seals" }),
          gameRow({ game_id: "142840", date: "2002-11-10", home_team: "red-leafs", away_team: "landsharks", team_slug: "landsharks" }),
          gameRow({ game_id: "142863", date: "2003-02-02", home_team: "red-leafs", away_team: "landsharks", team_slug: "landsharks" }),
          gameRow({ game_id: "142870", date: "2003-02-09", home_team: "landsharks", away_team: "bruins", team_slug: "landsharks" }),
        ])
      )

      const plan = await buildBackfillPlan(sql, [BREHT])
      expect(plan.manualReviewSkippedCount).toBe(1)
      expect(plan.statChanges).toHaveLength(2)
      expect(plan.statChanges[0]).toMatchObject({ pass: "pass1_orphan_3rd_team", gameId: "142850", previousTeamSlug: null, newTeamSlug: "red-leafs" })
      expect(plan.statChanges[1]).toMatchObject({ pass: "pass2_h2h", gameId: "142840", previousTeamSlug: "landsharks", newTeamSlug: "red-leafs" })
      expect(plan.plannedTrades).toHaveLength(1)
      expect(plan.plannedTrades[0].notes).toBe("Historical trade: Breht Clark to Landsharks")
    })

    it("Pass 1 never overwrites a non-NULL slug, never stamps post-trade fromTeam-only rows, and excludes skipped/sub rows from maxFrom/minTo", async () => {
      const { sql } = makeMockSql(
        planHandler([
          gameRow({ game_id: "g0", date: "2002-09-20", home_team: "landsharks", away_team: "bruins", team_slug: "bruins" }), // 3rd-team sub in a toTeam game (must NOT pull minToDate early)
          gameRow({ game_id: "g1", date: "2002-10-01", home_team: "red-leafs", away_team: "seals" }), // pre-trade NULL -> stamp (maxFromDate = 2002-10-01)
          gameRow({ game_id: "g2", date: "2002-10-08", home_team: "red-leafs", away_team: "bruins", team_slug: "bruins" }), // sub for 3rd team (must NOT extend maxFromDate)
          gameRow({ game_id: "g_h2h", date: "2002-11-25", home_team: "red-leafs", away_team: "landsharks", team_slug: "landsharks" }), // transition-window H2H (must NOT flip because maxFromDate=10-01)
          gameRow({ game_id: "g3", date: "2002-12-01", home_team: "landsharks", away_team: "seals", team_slug: "landsharks" }), // minToDate = 2002-12-01
          gameRow({ game_id: "g4", date: "2002-12-15", home_team: "red-leafs", away_team: "bruins" }), // post-trade NULL (must NOT extend maxFromDate)
        ])
      )
      const plan = await buildBackfillPlan(sql, [BREHT])
      expect(plan.statChanges.map((c) => c.gameId)).toEqual(["g1"])
      expect(plan.pass1SkippedNonNull.map((c) => c.gameId)).toEqual(["g2"])
      expect(plan.pass1SkippedPostTrade.map((c) => c.gameId)).toEqual(["g4"])
      expect(plan.plannedTrades).toHaveLength(1)
      // Midpoint of 2002-10-01 .. 2002-12-01 (61 days) is 2002-11-01 (not poisoned by g2/g4/g0)
      expect(plan.plannedTrades[0].tradeDate).toBe("2002-11-01")
      expect(plan.tradeDateContradictions).toEqual([])
    })

    it("flags a fromTeamSlug game played ON trade.tradeDate as a trade-date contradiction (matching forfeit-sync boundary)", async () => {
      const { sql } = makeMockSql(
        planHandler([
          // maxFrom = 2002-10-01, minTo = 2002-10-05 -> midpoint tradeDate = 2002-10-03
          gameRow({ game_id: "g_from", date: "2002-10-01", home_team: "red-leafs", away_team: "seals" }),
          // Already-stamped H2H game ON tradeDate 2002-10-03 with fromTeamSlug (violates g.date < tradeDate boundary)
          gameRow({ game_id: "g_same_day", date: "2002-10-03", home_team: "red-leafs", away_team: "landsharks", team_slug: "red-leafs" }),
          gameRow({ game_id: "g_to", date: "2002-10-05", home_team: "landsharks", away_team: "seals", team_slug: "landsharks" }),
        ])
      )
      const plan = await buildBackfillPlan(sql, [BREHT])
      expect(plan.plannedTrades[0].tradeDate).toBe("2002-10-03")
      expect(plan.tradeDateContradictions).toHaveLength(1)
      expect(plan.tradeDateContradictions[0]).toMatchObject({
        gameId: "g_same_day",
        gameDate: "2002-10-03",
        tradeDate: "2002-10-03",
        stampedTeamSlug: "red-leafs",
      })
    })

    it("refuses to plan deletes for dual player_seasons rows outside the 2001-2002 allow-list", async () => {
      const { sql } = makeMockSql(
        planHandler([], {
          ps: [{ player_id: 7338, season_id: "2002-2003", team_slug: "red-leafs", is_goalie: false, is_captain: true, is_rookie: false, registration_meta: null }],
        })
      )
      await expect(buildBackfillPlan(sql, [BREHT])).rejects.toThrow("Unexpected dual player_seasons rows")
    })

    it("plans only unrecorded moves and rebuilds notes/team_slugs from them on a partial re-run", async () => {
      const partner: HistoricalTradeEntry = { ...BREHT, playerName: "Pat Partner", fromTeamSlug: "landsharks", toTeamSlug: "red-leafs" }
      const rows = [
        gameRow({ game_id: "a1", date: "2002-11-01", home_team: "red-leafs", away_team: "seals" }),
        gameRow({ game_id: "a2", date: "2002-11-20", home_team: "landsharks", away_team: "seals" }),
        gameRow({ player_id: 9999, playerName: "Pat Partner", fromTeamSlug: "landsharks", toTeamSlug: "red-leafs", game_id: "b1", date: "2002-11-02", home_team: "landsharks", away_team: "bruins" }),
        gameRow({ player_id: 9999, playerName: "Pat Partner", fromTeamSlug: "landsharks", toTeamSlug: "red-leafs", game_id: "b2", date: "2002-11-21", home_team: "red-leafs", away_team: "bruins" }),
      ]

      const full = await buildBackfillPlan(makeMockSql(planHandler(rows)).sql, [BREHT, partner])
      expect(full.allTradeClusters).toHaveLength(1)
      expect(full.plannedTrades[0].moves).toHaveLength(2)

      const partial = await buildBackfillPlan(
        makeMockSql(
          planHandler(rows, {
            existingMoves: [{ season_id: "2002-2003", player_id: 7338, from_team_slug: "red-leafs", to_team_slug: "landsharks" }],
          })
        ).sql,
        [BREHT, partner]
      )
      expect(partial.allTradeClusters).toHaveLength(1)
      expect(partial.plannedTrades).toHaveLength(1)
      expect(partial.plannedTrades[0].moves.map((m) => m.playerId)).toEqual([9999])
      expect(partial.plannedTrades[0].notes).toBe("Historical trade: Pat Partner to Red Leafs")
      expect(partial.plannedTrades[0].notes).not.toContain("Breht")
    })
  })

  describe("clusterTradeMoves", () => {
    it("merges moves whose combined [maxFrom, minTo] window is non-empty", () => {
      const clusters = clusterTradeMoves([
        { item: "a", maxFrom: "2002-11-01", minTo: "2002-11-20" },
        { item: "b", maxFrom: "2002-11-05", minTo: "2002-11-15" },
      ])
      expect(clusters).toHaveLength(1)
      expect(clusters[0]).toMatchObject({ clusterMaxFrom: "2002-11-05", clusterMinTo: "2002-11-15" })
    })

    it("keeps disjoint same-pair trades separate even when one bound is unknown", () => {
      const clusters = clusterTradeMoves([
        { item: "oct", maxFrom: "2002-10-01", minTo: "2002-10-10" },
        { item: "dec-no-post", maxFrom: "2002-12-10", minTo: null },
        { item: "dec-no-pre", maxFrom: null, minTo: "2002-12-20" },
      ])
      expect(clusters.map((c) => c.items.map((i) => i.item))).toEqual([["oct"], ["dec-no-post", "dec-no-pre"]])
    })

    it("does not merge a dateless move into another cluster", () => {
      const clusters = clusterTradeMoves([
        { item: "a", maxFrom: "2002-10-01", minTo: "2002-10-10" },
        { item: "none", maxFrom: null, minTo: null },
      ])
      expect(clusters).toHaveLength(2)
    })

    it("does not chain moves forward week after week past the proximity window", () => {
      const clusters = clusterTradeMoves([
        { item: "10-01", maxFrom: "2002-10-01", minTo: null },
        { item: "10-25", maxFrom: "2002-10-25", minTo: null },
        { item: "11-20", maxFrom: "2002-11-20", minTo: null },
        { item: "12-15", maxFrom: "2002-12-15", minTo: null },
      ])
      expect(clusters.map((c) => c.items.map((i) => i.item))).toEqual([["10-01", "10-25"], ["11-20", "12-15"]])
    })

    it("still accepts a partner near the seed of a cluster with a long [maxFrom, minTo] gap", () => {
      const clusters = clusterTradeMoves([
        { item: "seed", maxFrom: "2002-10-01", minTo: "2002-12-20" },
        { item: "partner", maxFrom: "2002-12-01", minTo: null },
      ])
      expect(clusters).toHaveLength(1)
      expect(clusters[0]).toMatchObject({ clusterMaxFrom: "2002-12-01", clusterMinTo: "2002-12-20" })
    })
  })

  describe("apply guards", () => {
    it("treats a plan with no pending work as empty (no snapshot / no writes)", () => {
      const empty = { statChanges: [], playerSeasonsToDelete: [], plannedTrades: [] } as unknown as BackfillPlan
      expect(isPlanEmpty(empty)).toBe(true)
      expect(isPlanEmpty({ ...empty, plannedTrades: [{}] } as unknown as BackfillPlan)).toBe(false)
    })
  })

  describe("rollbackFromSnapshot", () => {
    const baseChecksum = {
      season_id: "2001-2002",
      skater_total: 100,
      skater_stamped: 90,
      skater_null: 10,
      skater_hash: "abc123skater",
      goalie_total: 20,
      goalie_stamped: 19,
      goalie_null: 1,
      goalie_hash: "def456goalie",
    }

    /** Rollback with the snapshot scan scoped to the snapshot's own temp dir (never the real .backups/). */
    const rb = (sql: Sql, file: string, host: string) =>
      rollbackFromSnapshot(sql, file, host, { backupsDir: path.dirname(file) })

    function writeSnapshot(overrides: Partial<BackfillSnapshot> = {}): string {
      const snapshot: BackfillSnapshot = {
        version: 1,
        createdAt: "2026-10-27T00:00:00.000Z",
        dbHost: "unit-test-host",
        dbLabel: "Unit Test DB",
        totals: {
          skaterTotal: 100, skaterStamped: 90, skaterNull: 10,
          goalieTotal: 20, goalieStamped: 19, goalieNull: 1,
          playerSeasonsTotal: 50, seasonTradesTotal: 1, seasonTradeItemsTotal: 0,
        },
        seasonChecksums: [baseChecksum, { ...baseChecksum, season_id: "bash-2026-2027", skater_hash: "live" }],
        skaterRowsToModify: [{ player_id: 6989, game_id: "68421", team_slug: null, target_team_slug: "rink-rats" }],
        goalieRowsToModify: [{ player_id: 3806, game_id: "68426", team_slug: null, target_team_slug: "landsharks" }],
        playerSeasonsToDelete: [
          { player_id: 6989, season_id: "2001-2002", team_slug: "rink-rats", is_goalie: false, is_captain: false, is_rookie: false, registration_meta: null },
        ],
        existingSeasonTrades: [
          { id: 1, season_id: "bash-2026-2027", team_slugs: ["reign", "seals"], notes: "Week 1 trade", traded_at: "2026-10-12", created_at: "2026-10-12" },
        ],
        existingSeasonTradeItems: [],
        historicalSeasonIds: ["2001-2002"],
        applyStatus: "complete",
        insertedTradeIds: [99],
        plannedTradeMoveKeys: ["2001-2002:6989:rink-rats:seals"],
        ...overrides,
      }
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-test-"))
      const file = path.join(dir, "snapshot.json")
      fs.writeFileSync(file, JSON.stringify(snapshot, null, 2))
      return file
    }

    function rollbackHandler(
      opts: {
        liveSeasonDrift?: boolean
        historicalDrift?: boolean
        strayTrade?: boolean
        skaterDrift?: boolean
        skaterMissing?: boolean
        psMissing?: boolean
        insertedLeft?: boolean
        seasonSet?: "missing" | "unexpected"
      } = {}
    ): MockHandler {
      return (q) => {
        if (q.includes("INSERT INTO player_seasons")) return [{ player_id: 6989 }]
        if (q.includes("UPDATE player_game_stats")) return [{ player_id: 6989 }]
        if (q.includes("UPDATE goalie_game_stats")) return [{ player_id: 3806 }]
        if (q.includes("DELETE FROM season_trades")) return [{ id: 99 }]
        if (q.includes("FROM r LEFT JOIN player_game_stats")) {
          if (opts.skaterMissing) return [{ player_id: 6989, game_id: "68421", expected: null, actual: null, missing: true }]
          return opts.skaterDrift ? [{ player_id: 6989, game_id: "68421", expected: null, actual: "seals", missing: false }] : []
        }
        if (q.includes("JOIN player_seasons ps")) return [{ n: opts.psMissing ? 0 : 1 }]
        if (q.includes("SELECT id FROM season_trades WHERE id = ANY(")) return opts.insertedLeft ? [{ id: 99 }] : []
        if (q.includes("SELECT st.id FROM season_trades st")) return opts.strayTrade ? [{ id: 99 }] : []
        if (q.includes("(SELECT count(*)::int FROM player_game_stats)")) {
          throw new Error("verifyRollback must not run the global totals query")
        }
        if (q.includes("WITH sk AS")) {
          const historical = [
            opts.historicalDrift ? { ...baseChecksum, skater_hash: "drifted" } : baseChecksum,
            ...(opts.seasonSet === "unexpected" ? [{ ...baseChecksum, season_id: "2002-2003" }] : []),
          ]
          return [
            ...(opts.seasonSet === "missing" ? [] : historical),
            { ...baseChecksum, season_id: "bash-2026-2027", skater_hash: opts.liveSeasonDrift ? "changed-by-sync" : "live" },
          ]
        }
        return []
      }
    }

    it("restores rows, scopes trade deletion to recorded insertedTradeIds for completed applies, and ignores live-season drift", async () => {
      const file = writeSnapshot({ applyStatus: "complete", insertedTradeIds: [99] })
      const { sql, calls } = makeMockSql(rollbackHandler({ liveSeasonDrift: true }))
      const res = await rb(sql, file, "unit-test-host")
      expect(res).toMatchObject({ restoredPlayerSeasons: 1, restoredSkaters: 1, restoredGoalies: 1, deletedTradesCount: 1, verifiedSeasonsCount: 1, statusWriteError: null })

      const del = calls.find((c) => c.q.includes("DELETE FROM season_trades"))!
      const stray = calls.find((c) => c.q.includes("SELECT st.id FROM season_trades st"))!
      expect(del.q).toContain("st.id = ANY(")
      expect(del.values).toEqual([[99], [1], "Historical trade: %", ["2001-2002"]])
      expect(stray.values).toEqual(del.values)
      expect(calls.some((c) => c.q.includes("setval"))).toBe(false)
    })

    it("scopes pending rollback deletion to recorded IDs OR exact plannedTradeMoveKeys subsets (never unrelated historical trades)", async () => {
      const file = writeSnapshot({
        applyStatus: "pending",
        insertedTradeIds: [99],
        plannedTradeMoveKeys: ["2001-2002:6989:rink-rats:seals"],
      })
      const { sql, calls } = makeMockSql(rollbackHandler())
      await rb(sql, file, "unit-test-host")

      const del = calls.find((c) => c.q.includes("DELETE FROM season_trades"))!
      const stray = calls.find((c) => c.q.includes("SELECT st.id FROM season_trades st"))!
      expect(del.q).toContain("EXISTS (")
      expect(del.q).toContain("AND NOT EXISTS (")
      expect(del.values).toEqual([
        [1],
        "Historical trade: %",
        ["2001-2002"],
        [99],
        ["2001-2002:6989:rink-rats:seals"],
        ["2001-2002:6989:rink-rats:seals"],
      ])
      expect(stray.values).toEqual(del.values)
    })

    it("skips season_trades deletion when a completed apply inserted 0 trades", async () => {
      const file = writeSnapshot({ applyStatus: "complete", insertedTradeIds: [], plannedTradeMoveKeys: [] })
      const { sql, calls } = makeMockSql(rollbackHandler())
      const res = await rb(sql, file, "unit-test-host")
      expect(res.deletedTradesCount).toBe(0)
      expect(calls.some((c) => c.q.includes("DELETE FROM season_trades"))).toBe(false)
      expect(calls.some((c) => c.q.includes("SELECT st.id FROM season_trades st"))).toBe(false)
    })

    it("refuses read-only --snapshot files and apply snapshots missing trade provenance before any SQL runs", async () => {
      const readOnlySnap = writeSnapshot({ applyStatus: undefined, insertedTradeIds: undefined, plannedTradeMoveKeys: undefined })
      const ro = makeMockSql(rollbackHandler())
      await expect(rb(ro.sql, readOnlySnap, "unit-test-host")).rejects.toThrow(
        "Snapshot was created by --snapshot (read-only), not by --apply. Refusing to roll back."
      )
      expect(ro.calls).toHaveLength(0)

      const pendingNoKeys = writeSnapshot({ applyStatus: "pending", insertedTradeIds: [99], plannedTradeMoveKeys: undefined })
      const pnk = makeMockSql(rollbackHandler())
      await expect(rb(pnk.sql, pendingNoKeys, "unit-test-host")).rejects.toThrow("lacks plannedTradeMoveKeys")
      expect(pnk.calls).toHaveLength(0)

      const completeNoProv = writeSnapshot({ applyStatus: "complete", insertedTradeIds: undefined, plannedTradeMoveKeys: undefined })
      const cnp = makeMockSql(rollbackHandler())
      await expect(rb(cnp.sql, completeNoProv, "unit-test-host")).rejects.toThrow("lacks plannedTradeMoveKeys and insertedTradeIds")
      expect(cnp.calls).toHaveLength(0)
    })

    it("throws when a historical season checksum or stray backfill trade does not match", async () => {
      await expect(rb(makeMockSql(rollbackHandler({ historicalDrift: true })).sql, writeSnapshot(), "unit-test-host")).rejects.toThrow(
        /Season 2001-2002 checksum mismatch on skater_hash/
      )
      await expect(rb(makeMockSql(rollbackHandler({ strayTrade: true })).sql, writeSnapshot(), "unit-test-host")).rejects.toThrow(
        /Historical season_trades still present: 99/
      )
    })

    it("reports per-row drift, missing rows (LEFT JOIN), missing player_seasons, and missing/unexpected historical seasons", async () => {
      const run = (o: Parameters<typeof rollbackHandler>[0]) =>
        rb(makeMockSql(rollbackHandler(o)).sql, writeSnapshot(), "unit-test-host")
      await expect(run({ skaterDrift: true })).rejects.toThrow("player_game_stats 6989:68421 expected null, got seals")
      await expect(run({ skaterMissing: true })).rejects.toThrow("player_game_stats 6989:68421 missing row (expected null)")
      await expect(run({ psMissing: true })).rejects.toThrow("player_seasons: expected 1 restored rows, found 0")
      await expect(run({ seasonSet: "missing" })).rejects.toThrow("Season 2001-2002 missing after rollback")
      // An extra season only counts when it is in the historical scope
      const file = writeSnapshot({ historicalSeasonIds: ["2001-2002", "2002-2003"] })
      await expect(
        rb(makeMockSql(rollbackHandler({ seasonSet: "unexpected" })).sql, file, "unit-test-host")
      ).rejects.toThrow("Season 2002-2003 unexpected after rollback")
    })

    it("refuses to roll back a snapshot taken on a different host, before any SQL runs", async () => {
      const { sql, calls } = makeMockSql(rollbackHandler())
      await expect(rb(sql, writeSnapshot(), "ep-frosty-shadow.neon.tech")).rejects.toThrow(
        'Snapshot was taken on "unit-test-host" but target is "ep-frosty-shadow.neon.tech"'
      )
      expect(calls).toHaveLength(0)
    })

    it("gives a friendly error for a missing snapshot file", async () => {
      const { sql } = makeMockSql(rollbackHandler())
      await expect(rb(sql, "/nonexistent/snap.json", "h")).rejects.toThrow("Snapshot file not found")
    })

    it("restores player_seasons in a single statement and marks the snapshot rolled-back", async () => {
      const file = writeSnapshot({ applyStatus: "pending" })
      const { sql, calls } = makeMockSql(rollbackHandler())
      await rb(sql, file, "unit-test-host")
      expect(calls.filter((c) => c.q.includes("INSERT INTO player_seasons"))).toHaveLength(1)
      expect((JSON.parse(fs.readFileSync(file, "utf8")) as BackfillSnapshot).applyStatus).toBe("rolled-back")
    })

    it("still reports success when the DB rollback verified but the status write fails", async () => {
      const file = writeSnapshot({ applyStatus: "pending" })
      fs.mkdirSync(`${file}.tmp`) // writeFileSync(tmp) now hits EISDIR — enforced even for root
      const res = await rb(makeMockSql(rollbackHandler()).sql, file, "unit-test-host")
      expect(res.statusWriteError).toMatch(/EISDIR/)
    })

    it("verifies the apply's recorded trade IDs are gone, independent of the delete predicate", async () => {
      await expect(
        rb(makeMockSql(rollbackHandler({ insertedLeft: true })).sql, writeSnapshot({ insertedTradeIds: [99] }), "unit-test-host")
      ).rejects.toThrow("Trades inserted by this apply still present: 99")
    })

    it("refuses to roll back an older apply while a newer active apply exists (before any SQL)", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-order-"))
      const base = JSON.parse(fs.readFileSync(writeSnapshot(), "utf8")) as BackfillSnapshot
      const older = path.join(dir, "pre-historical-trades-unit-test-host-A.json")
      const newer = path.join(dir, "pre-historical-trades-unit-test-host-B.json")
      fs.writeFileSync(older, JSON.stringify({ ...base, createdAt: "2026-10-27T01:00:00.000Z", applyStatus: "complete" }))
      fs.writeFileSync(newer, JSON.stringify({ ...base, createdAt: "2026-10-27T02:00:00.000Z", applyStatus: "complete" }))

      const blocked = makeMockSql(rollbackHandler())
      await expect(rb(blocked.sql, older, "unit-test-host")).rejects.toThrow(/newer apply[\s\S]*host-B\.json/)
      expect(blocked.calls).toHaveLength(0)

      // Newest-first works, after which the older one is unblocked.
      await rb(makeMockSql(rollbackHandler()).sql, newer, "unit-test-host")
      await expect(rb(makeMockSql(rollbackHandler()).sql, older, "unit-test-host")).resolves.toBeTruthy()
    })

    it.each([
      { newerStatus: "pending", blocks: true },
      { newerStatus: "complete", blocks: true },
      { newerStatus: "rolled-back", blocks: false },
      { newerStatus: undefined, blocks: false }, // --snapshot-mode or legacy file
    ])("newer snapshot with applyStatus=$newerStatus blocks older rollback: $blocks", async ({ newerStatus, blocks }) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-order-"))
      const base = JSON.parse(fs.readFileSync(writeSnapshot(), "utf8")) as BackfillSnapshot
      const older = path.join(dir, "pre-historical-trades-unit-test-host-A.json")
      fs.writeFileSync(older, JSON.stringify({ ...base, createdAt: "2026-10-27T01:00:00.000Z", applyStatus: "complete" }))
      fs.writeFileSync(
        path.join(dir, "pre-historical-trades-unit-test-host-B.json"),
        JSON.stringify({ ...base, createdAt: "2026-10-27T02:00:00.000Z", applyStatus: newerStatus })
      )
      const run = rb(makeMockSql(rollbackHandler()).sql, older, "unit-test-host")
      if (blocks) await expect(run).rejects.toThrow("newer apply")
      else await expect(run).resolves.toBeTruthy()
    })

    it("rejects an external rollback snapshot missing createdAt before any SQL runs", async () => {
      const file = writeSnapshot()
      const malformed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
      delete malformed.createdAt
      fs.writeFileSync(file, JSON.stringify(malformed))
      const { sql, calls } = makeMockSql(rollbackHandler())
      await expect(rb(sql, file, "unit-test-host")).rejects.toThrow("Malformed snapshot header")
      expect(calls).toHaveLength(0)
    })

    it("compares snapshot timestamps numerically (not lexicographically) when checking newer applies", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-tz-"))
      const base = JSON.parse(fs.readFileSync(writeSnapshot(), "utf8")) as BackfillSnapshot
      // 01:30Z is NEWER than 02:00+02:00 (= 00:00Z), even though "02:00" > "01:30" lexicographically.
      const older = path.join(dir, "pre-historical-trades-unit-test-host-A.json")
      const newer = path.join(dir, "pre-historical-trades-unit-test-host-B.json")
      fs.writeFileSync(older, JSON.stringify({ ...base, createdAt: "2026-10-27T02:00:00+02:00", applyStatus: "complete" }))
      fs.writeFileSync(newer, JSON.stringify({ ...base, createdAt: "2026-10-27T01:30:00Z", applyStatus: "complete" }))

      const blocked = makeMockSql(rollbackHandler())
      await expect(rb(blocked.sql, older, "unit-test-host")).rejects.toThrow(/newer apply[\s\S]*host-B\.json/)
      expect(blocked.calls).toHaveLength(0)

      await expect(rb(makeMockSql(rollbackHandler()).sql, newer, "unit-test-host")).resolves.toBeTruthy()
    })

    it("treats a same-host snapshot missing createdAt as unreadable (never as inactive)", async () => {
      const file = writeSnapshot()
      const base = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
      delete base.createdAt
      fs.writeFileSync(path.join(path.dirname(file), "pre-historical-trades-unit-test-host-X.json"), JSON.stringify({ ...base, applyStatus: "complete" }))
      const { sql, calls } = makeMockSql(rollbackHandler())
      await expect(rb(sql, file, "unit-test-host")).rejects.toThrow("Unreadable snapshot file(s)")
      expect(calls).toHaveLength(0)
    })

    it("marks the in-.backups/ original rolled-back when rolling back an archived copy", async () => {
      const backupsDir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-orig-"))
      const archived = writeSnapshot({ applyStatus: "complete" })
      const original = path.join(backupsDir, "pre-historical-trades-unit-test-host-orig.json")
      fs.copyFileSync(archived, original)
      await rollbackFromSnapshot(makeMockSql(rollbackHandler()).sql, archived, "unit-test-host", { backupsDir })
      for (const f of [archived, original]) {
        expect((JSON.parse(fs.readFileSync(f, "utf8")) as BackfillSnapshot).applyStatus).toBe("rolled-back")
      }
    })

    it("refuses to roll back when another snapshot in .backups/ is unreadable", async () => {
      const file = writeSnapshot()
      fs.writeFileSync(path.join(path.dirname(file), "pre-historical-trades-corrupt.json"), "{trunc")
      const { sql, calls } = makeMockSql(rollbackHandler())
      await expect(rb(sql, file, "unit-test-host")).rejects.toThrow("Unreadable snapshot file(s)")
      expect(calls).toHaveLength(0)
    })

    it("updates snapshots atomically (no leftover .tmp file)", () => {
      const file = writeSnapshot()
      updateSnapshot(file, (s) => {
        s.insertedTradeIds = [5, 6, 7]
      })
      const saved = JSON.parse(fs.readFileSync(file, "utf8")) as BackfillSnapshot
      expect(saved.insertedTradeIds).toEqual([5, 6, 7])
      expect(saved.existingSeasonTrades).toHaveLength(1)
      expect(fs.existsSync(`${file}.tmp`)).toBe(false)
    })
  })

  describe("applyBackfillPlan", () => {
    const plan = {
      entries: [RESOLVED_BREHT],
      statChanges: [
        { kind: "skater", pass: "pass1_orphan_3rd_team", playerId: 7338, gameId: "g1", newTeamSlug: "red-leafs" },
      ],
      playerSeasonsToDelete: [],
      plannedTrades: [
        { seasonId: "2002-2003", teamSlugs: ["landsharks", "red-leafs"], tradeDate: "2002-11-15", tradedAt: "2002-11-15T12:00:00-08:00", notes: "Historical trade: A", moves: [{ playerId: 1, playerName: "A", fromTeamSlug: "red-leafs", toTeamSlug: "landsharks" }] },
        { seasonId: "2002-2003", teamSlugs: ["landsharks", "red-leafs"], tradeDate: "2003-01-15", tradedAt: "2003-01-15T12:00:00-08:00", notes: "Historical trade: B", moves: [{ playerId: 2, playerName: "B", fromTeamSlug: "landsharks", toTeamSlug: "red-leafs" }] },
      ],
      boxscoreRegressions: [],
      tradeDateContradictions: [],
      holdOutDateOverlaps: [],
      boxscoreFixedExactCount: 0,
    } as unknown as BackfillPlan

    it("runs only non-empty statements, enforces SQL-level WHERE NOT EXISTS on Pass 3, and reports each insert", async () => {
      let nextId = 500
      const { sql, calls } = makeMockSql((q) => {
        if (q.includes("UPDATE player_game_stats")) return [{ player_id: 7338 }]
        if (q.includes("INSERT INTO season_trades")) return [{ trade_id: nextId++, item_count: 1 }]
        return []
      })
      const seen: number[] = []
      const res = await applyBackfillPlan(sql, plan, (id) => seen.push(id))
      expect(res).toMatchObject({ updatedSkaters: 1, updatedGoalies: 0, deletedPlayerSeasons: 0, insertedTrades: 2, insertedTradeItems: 2, insertedTradeIds: [500, 501] })
      expect(seen).toEqual([500, 501])
      expect(calls.some((c) => c.q.includes("UPDATE goalie_game_stats"))).toBe(false)
      expect(calls.some((c) => c.q.includes("DELETE FROM player_seasons"))).toBe(false)
      expect(calls.find((c) => c.q.includes("UPDATE player_game_stats"))!.q).toContain("IS DISTINCT FROM")
      const tradeInsertSql = calls.find((c) => c.q.includes("INSERT INTO season_trades"))!.q
      expect(tradeInsertSql).toContain("WHERE NOT EXISTS")
      expect(tradeInsertSql).toContain("pending_m")
    })

    it("skips counting a Pass 3 trade when SQL WHERE NOT EXISTS finds it already inserted", async () => {
      const { sql } = makeMockSql((q) => {
        if (q.includes("UPDATE player_game_stats")) return [{ player_id: 7338 }]
        if (q.includes("INSERT INTO season_trades")) return [] // guarded skip
        return []
      })
      const seen: number[] = []
      const res = await applyBackfillPlan(sql, plan, (id) => seen.push(id))
      expect(res).toMatchObject({ insertedTrades: 0, insertedTradeItems: 0, insertedTradeIds: [] })
      expect(seen).toEqual([])
    })

    it("has already reported inserted IDs when a later insert fails", async () => {
      let n = 0
      const { sql } = makeMockSql((q) => {
        if (q.includes("INSERT INTO season_trades")) {
          if (n++ === 1) throw new Error("boom")
          return [{ trade_id: 700, item_count: 1 }]
        }
        return []
      })
      const seen: number[] = []
      await expect(applyBackfillPlan(sql, plan, (id) => seen.push(id))).rejects.toThrow("boom")
      expect(seen).toEqual([700])
    })
  })

  describe("runApply (--apply orchestration)", () => {
    const URL = "postgres://u:p@ep-run-1.neon.tech/db"
    const HOST = "ep-run-1.neon.tech"
    const plan = {
      entries: [RESOLVED_BREHT],
      statChanges: [{ kind: "skater", playerId: 7338, gameId: "g1", previousTeamSlug: null, newTeamSlug: "red-leafs" }],
      playerSeasonsToDelete: [],
      plannedTrades: [
        { seasonId: "2002-2003", teamSlugs: ["landsharks", "red-leafs"], tradeDate: "2002-11-15", tradedAt: "2002-11-15T12:00:00-08:00", notes: "Historical trade: Breht Clark to Landsharks", moves: [{ playerId: 7338, playerName: "Breht Clark", fromTeamSlug: "red-leafs", toTeamSlug: "landsharks" }] },
      ],
      boxscoreRegressions: [],
      tradeDateContradictions: [],
      holdOutDateOverlaps: [],
      boxscoreFixedExactCount: 0,
    } as unknown as BackfillPlan
    const emptyPlan = { ...plan, statChanges: [], plannedTrades: [] } as unknown as BackfillPlan

    function applyHandler(opts: { failInsert?: boolean; failOnSecondInsert?: boolean; landed?: boolean } = {}): MockHandler {
      let insertCount = 0
      return (q) => {
        if (q.includes("(SELECT count(*)::int FROM player_game_stats)")) {
          return [{ skater_total: 1, skater_stamped: 0, skater_null: 1, goalie_total: 0, goalie_stamped: 0, goalie_null: 0, ps_total: 0, st_total: 0, sti_total: 0 }]
        }
        if (q.includes("UPDATE player_game_stats")) return [{ player_id: 7338 }]
        if (q.includes("INSERT INTO season_trades")) {
          if (opts.failInsert) throw new Error("neon down")
          if (opts.failOnSecondInsert && insertCount++ === 1) throw new Error("mid-batch boom")
          return [{ trade_id: 320 + insertCount, item_count: 1 }]
        }
        // isSnapshotFullyApplied probes (now using LEFT JOIN)
        if (q.includes("target_team_slug")) return [{ n: opts.landed ? 0 : 1 }]
        if (q.includes("JOIN player_seasons ps")) return [{ n: 0 }]
        if (q.includes("FROM season_trade_items sti")) {
          return opts.landed ? [{ season_id: "2002-2003", player_id: 7338, from_team_slug: "red-leafs", to_team_slug: "landsharks" }] : []
        }
        return []
      }
    }
    const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "backfill-run-"))
    const snapshotsIn = (dir: string) =>
      fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as BackfillSnapshot)

    it("snapshots (pending) → applies → finalizes complete with IDs and planned move keys", async () => {
      const dir = tmp()
      const out = await runApply(makeMockSql(applyHandler()).sql, URL, plan, { backupsDir: dir })
      expect(out.status).toBe("applied")
      if (out.status !== "applied") return
      expect(out.finalizeError).toBeNull()
      expect(out.rollbackCmd).toContain(`--confirm-host ${HOST}`)
      const [snap] = snapshotsIn(dir)
      expect(snap).toMatchObject({
        dbHost: HOST,
        applyStatus: "complete",
        insertedTradeIds: [320],
        plannedTradeMoveKeys: ["2002-2003:7338:red-leafs:landsharks"],
      })
    })

    it("refuses to apply when boxscoreRegressions or tradeDateContradictions are non-empty (0 writes, 0 snapshots)", async () => {
      const dir = tmp()
      const { sql, calls } = makeMockSql(applyHandler())
      await expect(
        runApply(sql, URL, {
          ...plan,
          boxscoreRegressions: [{ gameId: "68462", seasonId: "2001-2002", date: "2002-01-26", homeTeam: "seals", awayTeam: "landsharks", homeScore: 7, awayScore: 3, preError: 0, postError: 2, preTeamError: 0, postTeamError: 2, preExcess: 0, postExcess: 1 }],
        }, { backupsDir: dir })
      ).rejects.toThrow(/Refusing to apply: 1 game\(s\) would regress box-score goal parity/)
      await expect(
        runApply(sql, URL, {
          ...plan,
          tradeDateContradictions: [{ seasonId: "2023-2024", playerName: "Nicholas MacNab", gameId: "1668591", gameDate: "2024-01-20", tradeDate: "2024-01-13", stampedTeamSlug: "rink-rats", fromTeamSlug: "rink-rats", toTeamSlug: "reign", isManualHoldOut: false }],
        }, { backupsDir: dir })
      ).rejects.toThrow(/Refusing to apply: 1 non-hold-out trade-date contradiction\(s\) detected/)
      expect(calls).toHaveLength(0)
      expect(snapshotsIn(dir)).toHaveLength(0)
    })

    it("writes no snapshot when nothing is pending", async () => {
      const dir = tmp()
      const out = await runApply(makeMockSql(applyHandler()).sql, URL, emptyPlan, { backupsDir: dir })
      expect(out.status).toBe("nothing-to-apply")
      expect(snapshotsIn(dir)).toHaveLength(0)
    })

    it("leaves the snapshot pending with persisted partial insertedTradeIds when apply fails partway", async () => {
      const dir = tmp()
      const twoTradePlan = {
        ...plan,
        plannedTrades: [
          ...plan.plannedTrades,
          { seasonId: "2002-2003", teamSlugs: ["landsharks", "red-leafs"], tradeDate: "2003-01-15", tradedAt: "2003-01-15T12:00:00-08:00", notes: "Historical trade: Pat Partner to Red Leafs", moves: [{ playerId: 9999, playerName: "Pat Partner", fromTeamSlug: "landsharks", toTeamSlug: "red-leafs" }] },
        ],
      } as unknown as BackfillPlan
      await expect(runApply(makeMockSql(applyHandler({ failOnSecondInsert: true })).sql, URL, twoTradePlan, { backupsDir: dir })).rejects.toThrow(
        /Apply failed partway \(1 trade\(s\) inserted: 321\): mid-batch boom[\s\S]*--rollback/
      )
      expect(snapshotsIn(dir)[0]).toMatchObject({ applyStatus: "pending", insertedTradeIds: [321] })
    })

    it("isSnapshotFullyApplied uses LEFT JOIN so missing stat rows cannot pass as applied", async () => {
      const { sql, calls } = makeMockSql((q) => {
        if (q.includes("target_team_slug")) return [{ n: 1 }] // e.g. missing row flagged by LEFT JOIN
        if (q.includes("JOIN player_seasons ps")) return [{ n: 0 }]
        return []
      })
      const ok = await isSnapshotFullyApplied(sql, {
        version: 1,
        createdAt: "2026-10-27T00:00:00.000Z",
        dbHost: HOST,
        dbLabel: "test",
        totals: { skaterTotal: 1, skaterStamped: 1, skaterNull: 0, goalieTotal: 0, goalieStamped: 0, goalieNull: 0, playerSeasonsTotal: 1, seasonTradesTotal: 0, seasonTradeItemsTotal: 0 },
        seasonChecksums: [],
        skaterRowsToModify: [{ player_id: 7338, game_id: "g1", team_slug: null, target_team_slug: "red-leafs" }],
        goalieRowsToModify: [],
        playerSeasonsToDelete: [],
        existingSeasonTrades: [],
        existingSeasonTradeItems: [],
        historicalSeasonIds: ["2002-2003"],
        plannedTradeMoveKeys: [],
      })
      expect(ok).toBe(false)
      expect(calls.some((c) => c.q.includes("LEFT JOIN player_game_stats pgs") && c.q.includes("pgs.player_id IS NULL"))).toBe(true)
      expect(calls.some((c) => c.q.includes("LEFT JOIN goalie_game_stats ggs") && c.q.includes("ggs.player_id IS NULL"))).toBe(true)
    })

    it("refuses a new apply while an unfinished pending snapshot exists for the host", async () => {
      const dir = tmp()
      await expect(runApply(makeMockSql(applyHandler({ failInsert: true })).sql, URL, plan, { backupsDir: dir })).rejects.toThrow()
      const { sql, calls } = makeMockSql(applyHandler())
      await expect(runApply(sql, URL, plan, { backupsDir: dir })).rejects.toThrow(/did not complete[\s\S]*only checks this checkout/)
      expect(calls.some((c) => c.q.includes("UPDATE player_game_stats"))).toBe(false)
      expect(snapshotsIn(dir)).toHaveLength(1)
    })

    it("auto-completes a pending snapshot whose apply provably landed (e.g. finalize crashed)", async () => {
      const dir = tmp()
      const first = await runApply(makeMockSql(applyHandler()).sql, URL, plan, { backupsDir: dir })
      if (first.status !== "applied") throw new Error("expected applied")
      updateSnapshot(first.filePath, (s) => {
        s.applyStatus = "pending" // simulate a crash between the last insert and finalize
      })

      const out = await runApply(makeMockSql(applyHandler({ landed: true })).sql, URL, emptyPlan, { backupsDir: dir })
      expect(out).toMatchObject({ status: "nothing-to-apply", completedPending: [first.filePath] })
      expect(snapshotsIn(dir)[0].applyStatus).toBe("complete")
    })
  })

  describe("snapshot lifecycle", () => {
    const totalsRow = [{ skater_total: 1, skater_stamped: 1, skater_null: 0, goalie_total: 0, goalie_stamped: 0, goalie_null: 0, ps_total: 1, st_total: 0, sti_total: 0 }]
    const snapHandler: MockHandler = (q) => {
      if (q.includes("(SELECT count(*)::int FROM player_game_stats)")) return totalsRow
      return []
    }
    const plan = {
      entries: [RESOLVED_BREHT, { ...RESOLVED_BREHT, seasonId: "2001-2002", playerId: 1 }],
      statChanges: [{ kind: "goalie", playerId: 3806, gameId: "68426", previousTeamSlug: null, newTeamSlug: "landsharks" }],
      playerSeasonsToDelete: [],
      plannedTrades: [],
    } as unknown as BackfillPlan

    it("stamps historicalSeasonIds and applyStatus=pending only for --apply snapshots", async () => {
      const backupsDir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-snap-"))
      const url = "postgres://u:p@ep-test-1.neon.tech/db"
      const forApply = await createPreBackfillSnapshot(makeMockSql(snapHandler).sql, url, plan, { forApply: true, backupsDir })
      expect(forApply.filePath.startsWith(backupsDir)).toBe(true)
      expect(forApply.snapshot).toMatchObject({
        dbHost: "ep-test-1.neon.tech",
        applyStatus: "pending",
        historicalSeasonIds: ["2001-2002", "2002-2003"],
        goalieRowsToModify: [{ player_id: 3806, game_id: "68426", team_slug: null, target_team_slug: "landsharks" }],
      })
      expect(fs.readdirSync(backupsDir).some((f) => f.endsWith(".tmp"))).toBe(false)

      const plain = await createPreBackfillSnapshot(makeMockSql(snapHandler).sql, url, plan, {
        customSnapshotPath: path.join(backupsDir, "manual.json"),
      })
      expect(plain.snapshot.applyStatus).toBeUndefined()
    })

    it("scans same-host snapshots and reports (never skips) unreadable files", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-scan-"))
      const write = (name: string, s: Partial<BackfillSnapshot>) =>
        fs.writeFileSync(path.join(dir, name), JSON.stringify({ version: 1, createdAt: "2026-10-27T00:00:00.000Z", ...s }))
      write("pre-historical-trades-a-1.json", { dbHost: "a", applyStatus: "pending" })
      write("pre-historical-trades-a-2.json", { dbHost: "a", applyStatus: "complete" })
      write("pre-historical-trades-b-1.json", { dbHost: "b", applyStatus: "pending" })
      write("pre-historical-trades-nohost.json", { applyStatus: "pending" })
      write("pre-historical-trades-a-oddstatus.json", { dbHost: "a", createdAt: "2026-10-27T00:00:00.000Z", applyStatus: "weird" as never })
      write("pre-historical-trades-a-v2.json", { dbHost: "a", createdAt: "2026-10-27T00:00:00.000Z", version: 2 as never })
      write("unrelated.json", { dbHost: "a", applyStatus: "pending" })
      fs.writeFileSync(path.join(dir, "pre-historical-trades-a-bad.json"), "{not json")

      const scan = scanApplySnapshots("a", dir)
      expect(scan.entries.map((e) => path.basename(e.file))).toEqual(["pre-historical-trades-a-1.json", "pre-historical-trades-a-2.json"])
      expect(scan.unreadable.map((f) => path.basename(f))).toEqual([
        "pre-historical-trades-a-bad.json",
        "pre-historical-trades-a-oddstatus.json",
        "pre-historical-trades-a-v2.json",
        "pre-historical-trades-nohost.json",
      ])
      expect(scanApplySnapshots("a", path.join(dir, "missing"))).toEqual({ entries: [], unreadable: [] })
    })

    it("runApply refuses when any snapshot in .backups/ is unreadable", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-scan-"))
      fs.writeFileSync(path.join(dir, "pre-historical-trades-x.json"), "")
      const { sql, calls } = makeMockSql(() => [])
      await expect(
        runApply(sql, "postgres://u:p@h.neon.tech/db", { statChanges: [], playerSeasonsToDelete: [], plannedTrades: [] } as unknown as BackfillPlan, { backupsDir: dir })
      ).rejects.toThrow("Unreadable snapshot file(s)")
      expect(calls).toHaveLength(0)
    })
  })

  describe("withBackfillLock", () => {
    it("serializes processes per host and always releases the lock", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-lock-"))
      const lockFile = path.join(dir, ".lock-h.neon.tech")
      let release!: () => void
      const holder = withBackfillLock("h.neon.tech", dir, () => new Promise<string>((r) => (release = () => r("first"))))
      await Promise.resolve()
      expect(fs.readFileSync(lockFile, "utf8")).toMatch(/^pid \d+ since /)

      await expect(withBackfillLock("h.neon.tech", dir, async () => "second")).rejects.toThrow(/holds the lock[\s\S]*rm "/)
      await expect(withBackfillLock("other.neon.tech", dir, async () => "other host ok")).resolves.toBe("other host ok")

      release()
      await expect(holder).resolves.toBe("first")
      expect(fs.existsSync(lockFile)).toBe(false)

      await expect(withBackfillLock("h.neon.tech", dir, async () => { throw new Error("boom") })).rejects.toThrow("boom")
      expect(fs.existsSync(lockFile)).toBe(false)
    })

    it("handles lock-holder disappearance during EEXIST read without throwing raw ENOENT", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-lock-race-"))
      const lockFile = path.join(dir, ".lock-race.neon.tech")
      fs.writeFileSync(lockFile, "pid 123 since 2026-01-01T00:00:00Z")

      const origRead = fs.readFileSync
      const spy = vi.spyOn(fs, "readFileSync").mockImplementation((p, ...rest) => {
        if (String(p) === lockFile) {
          const err = new Error("ENOENT") as NodeJS.ErrnoException
          err.code = "ENOENT"
          throw err
        }
        return (origRead as (...args: unknown[]) => unknown)(p, ...rest) as never
      })
      try {
        await expect(withBackfillLock("race.neon.tech", dir, async () => "x")).rejects.toThrow(
          /Another backfill process holds the lock for race\.neon\.tech \(unknown holder\)/
        )
      } finally {
        spy.mockRestore()
      }
    })
  })

  it("does not use db.transaction()", () => {
    const content = fs.readFileSync(path.resolve(__dirname, "../scripts/backfill-historical-trades.ts"), "utf8")
    expect(content).not.toMatch(/db\.transaction\(/)
  })
})
