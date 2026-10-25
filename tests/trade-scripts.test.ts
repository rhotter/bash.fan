import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  parseArgs as parseWeek1Args,
  verifyDarrellDraperPreFlight,
  resolveSeasonId,
  checkTradeStatus,
  buildTradeCte,
  compileTradeCte,
  executeWeek1Trades,
  FALL_2026_WEEK1_TRADE_1,
  FALL_2026_WEEK1_TRADE_2,
} from "../scripts/apply-fall-2026-week1-trades"
import {
  parseArgs as parseExportArgs,
  syncTrades,
} from "../scripts/export-prod-db"

describe("scripts/apply-fall-2026-week1-trades.ts", () => {
  describe("CLI Argument Parsing", () => {
    it("parses --dry-run and -n flags", () => {
      expect(parseWeek1Args(["--dry-run"]).dryRun).toBe(true)
      expect(parseWeek1Args(["-n"]).dryRun).toBe(true)
      expect(parseWeek1Args([]).dryRun).toBe(false)
    })

    it("parses --url flag with space or equals", () => {
      expect(parseWeek1Args(["--url", "postgres://custom-host/db"]).url).toBe(
        "postgres://custom-host/db"
      )
      expect(parseWeek1Args(["--url=postgres://equals-host/db"]).url).toBe(
        "postgres://equals-host/db"
      )
      expect(parseWeek1Args(["--db", "postgres://db-flag/db"]).url).toBe(
        "postgres://db-flag/db"
      )
    })

    it("parses --season flag with space or equals", () => {
      expect(parseWeek1Args(["--season", "2026-2027"]).season).toBe("2026-2027")
      expect(parseWeek1Args(["--season=bash-2026-2027"]).season).toBe(
        "bash-2026-2027"
      )
      expect(parseWeek1Args(["-s", "custom-season"]).season).toBe("custom-season")
      expect(parseWeek1Args([]).season).toBeUndefined()
    })

    it("handles multiple combined flags", () => {
      const opts = parseWeek1Args([
        "-n",
        "--url",
        "postgres://test-url/dev",
        "--season",
        "bash-2026-2027",
      ])
      expect(opts.dryRun).toBe(true)
      expect(opts.url).toBe("postgres://test-url/dev")
      expect(opts.season).toBe("bash-2026-2027")
    })
  })

  describe("Darrell Draper Pre-Flight Safety Check", () => {
    it("passes when Draper's stat row in g130 has team_slug === 'loons'", async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ team_slug: "loons" }])
      const result = await verifyDarrellDraperPreFlight(mockQuery)

      expect(result.passed).toBe(true)
      expect(result.teamSlug).toBe("loons")
      expect(result.found).toBe(true)
      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(mockQuery.mock.calls[0][0]).toContain("g130")
      expect(mockQuery.mock.calls[0][0]).toContain("Darrell Draper")
    })

    it("throws when Draper's stat row in g130 has team_slug !== 'loons' (e.g. 'yetis')", async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ team_slug: "yetis" }])

      await expect(verifyDarrellDraperPreFlight(mockQuery)).rejects.toThrow(
        "Pre-flight safety check failed: Darrell Draper's stat row in g130 has team_slug 'yetis', expected 'loons'"
      )
    })

    it("throws when Draper's stat row in g130 has null team_slug", async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ team_slug: null }])

      await expect(verifyDarrellDraperPreFlight(mockQuery)).rejects.toThrow(
        "Pre-flight safety check failed: Darrell Draper's stat row in g130 has team_slug 'NULL', expected 'loons'"
      )
    })

    it("passes cleanly when Draper has no stat row in g130", async () => {
      const mockQuery = vi.fn().mockResolvedValue([])
      const result = await verifyDarrellDraperPreFlight(mockQuery)

      expect(result.passed).toBe(true)
      expect(result.teamSlug).toBeNull()
      expect(result.found).toBe(false)
    })
  })

  describe("Season ID Auto-Detection", () => {
    it("uses seasonOverride when explicitly passed", async () => {
      const mockQuery = vi.fn()
      const seasonId = await resolveSeasonId(mockQuery, "custom-2026")

      expect(seasonId).toBe("custom-2026")
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it("detects bash-2026-2027 if available in database", async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ id: "bash-2026-2027" }])
      const seasonId = await resolveSeasonId(mockQuery)

      expect(seasonId).toBe("bash-2026-2027")
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    it("detects 2026-2027 if available in database", async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ id: "2026-2027" }])
      const seasonId = await resolveSeasonId(mockQuery)

      expect(seasonId).toBe("2026-2027")
    })

    it("falls back to bash-2026-2027 if no seasons match", async () => {
      const mockQuery = vi.fn().mockResolvedValue([])
      const seasonId = await resolveSeasonId(mockQuery)

      expect(seasonId).toBe("bash-2026-2027")
    })
  })

  describe("Idempotency Detection (checkTradeStatus)", () => {
    it("detects when both trades exist in season_trades", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM season_trades")) {
          return [
            {
              id: 1,
              notes: "Week 1 trade: Eddie Parsons to Seals, Logan Truman to Reign",
            },
            {
              id: 2,
              notes:
                "Week 1 trade: Jonny Callan & Lee Jacobs to Loons, Steph Tryphonas & Darrell Draper to Yetis",
            },
          ]
        }
        return []
      })

      const status = await checkTradeStatus(mockQuery, "bash-2026-2027")
      expect(status.trade1Applied).toBe(true)
      expect(status.trade2Applied).toBe(true)
      expect(status.allApplied).toBe(true)
    })

    it("detects when players are already on their post-trade teams in player_seasons", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM season_trades")) {
          return []
        }
        if (sqlText.includes("FROM player_seasons")) {
          return [
            { player_id: 315, team_slug: "seals" },
            { player_id: 102, team_slug: "reign" },
            { player_id: 3640, team_slug: "loons" },
            { player_id: 50003, team_slug: "loons" },
            { player_id: 61, team_slug: "yetis" },
            { player_id: 49983, team_slug: "yetis" },
          ]
        }
        return []
      })

      const status = await checkTradeStatus(mockQuery, "bash-2026-2027")
      expect(status.trade1Applied).toBe(true)
      expect(status.trade2Applied).toBe(true)
      expect(status.allApplied).toBe(true)
    })

    it("detects partial application: Trade #1 applied, Trade #2 pending", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM season_trades")) {
          return [
            {
              id: 1,
              notes: "Week 1 trade: Eddie Parsons to Seals, Logan Truman to Reign",
            },
          ]
        }
        if (sqlText.includes("FROM player_seasons")) {
          return [
            { player_id: 315, team_slug: "seals" },
            { player_id: 102, team_slug: "reign" },
            // Trade 2 players still on pre-trade teams:
            { player_id: 3640, team_slug: "yetis" },
            { player_id: 50003, team_slug: "yetis" },
            { player_id: 61, team_slug: "loons" },
            { player_id: 49983, team_slug: "loons" },
          ]
        }
        return []
      })

      const status = await checkTradeStatus(mockQuery, "bash-2026-2027")
      expect(status.trade1Applied).toBe(true)
      expect(status.trade2Applied).toBe(false)
      expect(status.allApplied).toBe(false)
    })

    it("detects when neither trade has been applied", async () => {
      const mockQuery = vi.fn().mockResolvedValue([])
      const status = await checkTradeStatus(mockQuery, "bash-2026-2027")
      expect(status.trade1Applied).toBe(false)
      expect(status.trade2Applied).toBe(false)
      expect(status.allApplied).toBe(false)
    })
  })

  describe("Atomic CTE Generation (buildTradeCte & compileTradeCte)", () => {
    it("generates atomic single-statement data-modifying CTE for Trade #1", () => {
      const rawCte = buildTradeCte("bash-2026-2027", FALL_2026_WEEK1_TRADE_1)
      expect(rawCte).toBeDefined()
      const compiled = compileTradeCte("bash-2026-2027", FALL_2026_WEEK1_TRADE_1)
      const sqlLower = compiled.sql.toLowerCase()

      // Verifies all required CTE components match PRD §5.3.2 and trades/route.ts
      expect(sqlLower).toContain("with locked_season as materialized")
      expect(sqlLower).toContain("locked_rosters as materialized")
      expect(sqlLower).toContain("guard as")
      expect(sqlLower).toContain("updated_rosters as")
      expect(sqlLower).toContain("inserted_trade as")
      expect(sqlLower).toContain("inserted_items as")

      // Check teams and players in params
      expect(compiled.params).toContain("reign")
      expect(compiled.params).toContain("seals")
      expect(compiled.params).toContain(315) // Eddie Parsons
      expect(compiled.params).toContain(102) // Logan Truman
      expect(compiled.params).toContain("bash-2026-2027")
      expect(compiled.params).toContain(
        "Week 1 trade: Eddie Parsons to Seals, Logan Truman to Reign"
      )
    })

    it("generates atomic single-statement data-modifying CTE for Trade #2", () => {
      const compiled = compileTradeCte("bash-2026-2027", FALL_2026_WEEK1_TRADE_2)
      const sqlLower = compiled.sql.toLowerCase()

      expect(sqlLower).toContain("with locked_season as materialized")
      expect(sqlLower).toContain("locked_rosters as materialized")
      expect(sqlLower).toContain("guard as")
      expect(sqlLower).toContain("updated_rosters as")
      expect(sqlLower).toContain("inserted_trade as")
      expect(sqlLower).toContain("inserted_items as")

      expect(compiled.params).toContain("yetis")
      expect(compiled.params).toContain("loons")
      expect(compiled.params).toContain(3640) // Jonny Callan
      expect(compiled.params).toContain(50003) // Lee Jacobs
      expect(compiled.params).toContain(61) // Steph Tryphonas
      expect(compiled.params).toContain(49983) // Darrell Draper
      expect(compiled.params).toContain(
        "Week 1 trade: Jonny Callan & Lee Jacobs to Loons, Steph Tryphonas & Darrell Draper to Yetis"
      )
    })
  })

  describe("executeWeek1Trades Execution Flow", () => {
    it("aborts when Draper pre-flight check fails", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM player_game_stats")) {
          return [{ team_slug: "yetis" }]
        }
        return []
      })
      const mockRawSql = vi.fn()

      await expect(
        executeWeek1Trades({
          queryFn: mockQuery,
          rawSqlFn: mockRawSql,
          season: "bash-2026-2027",
        })
      ).rejects.toThrow("Pre-flight safety check failed")

      expect(mockRawSql).not.toHaveBeenCalled()
    })

    it("exits early without mutations when all trades are already applied", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM player_game_stats")) {
          return [{ team_slug: "loons" }]
        }
        if (sqlText.includes("FROM season_trades")) {
          return [
            { id: 1, notes: "Week 1 trade: Eddie Parsons to Seals, Logan Truman to Reign" },
            {
              id: 2,
              notes:
                "Week 1 trade: Jonny Callan & Lee Jacobs to Loons, Steph Tryphonas & Darrell Draper to Yetis",
            },
          ]
        }
        return []
      })
      const mockRawSql = vi.fn()

      const result = await executeWeek1Trades({
        queryFn: mockQuery,
        rawSqlFn: mockRawSql,
        season: "bash-2026-2027",
      })

      expect(result.alreadyComplete).toBe(true)
      expect(result.trade1Executed).toBe(false)
      expect(result.trade2Executed).toBe(false)
      expect(mockRawSql).not.toHaveBeenCalled()
    })

    it("executes in dry-run mode without modifying the database", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM player_game_stats")) {
          return [{ team_slug: "loons" }]
        }
        return [] // No trades applied yet
      })
      const mockRawSql = vi.fn()

      const result = await executeWeek1Trades({
        dryRun: true,
        queryFn: mockQuery,
        rawSqlFn: mockRawSql,
        season: "bash-2026-2027",
      })

      expect(result.dryRun).toBe(true)
      expect(result.alreadyComplete).toBe(false)
      expect(result.trade1Executed).toBe(false)
      expect(result.trade2Executed).toBe(false)
      expect(mockRawSql).not.toHaveBeenCalled()
    })

    it("executes both trades when non-dry-run and both trades are pending", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM player_game_stats")) {
          return [{ team_slug: "loons" }]
        }
        return []
      })
      const mockRawSql = vi
        .fn()
        .mockResolvedValueOnce([{ tradeId: 101, tradedAt: "2026-09-24T00:00:00Z" }])
        .mockResolvedValueOnce([{ tradeId: 102, tradedAt: "2026-09-25T00:00:00Z" }])

      const result = await executeWeek1Trades({
        dryRun: false,
        queryFn: mockQuery,
        rawSqlFn: mockRawSql,
        season: "bash-2026-2027",
      })

      expect(result.trade1Executed).toBe(true)
      expect(result.trade2Executed).toBe(true)
      expect(mockRawSql).toHaveBeenCalledTimes(2)
    })

    it("executes only Trade #2 if Trade #1 was already applied", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM player_game_stats")) {
          return [{ team_slug: "loons" }]
        }
        if (sqlText.includes("FROM season_trades")) {
          return [
            { id: 1, notes: "Week 1 trade: Eddie Parsons to Seals, Logan Truman to Reign" },
          ]
        }
        return []
      })
      const mockRawSql = vi
        .fn()
        .mockResolvedValueOnce([{ tradeId: 102, tradedAt: "2026-09-25T00:00:00Z" }])

      const result = await executeWeek1Trades({
        dryRun: false,
        queryFn: mockQuery,
        rawSqlFn: mockRawSql,
        season: "bash-2026-2027",
      })

      expect(result.trade1Executed).toBe(false)
      expect(result.trade2Executed).toBe(true)
      expect(mockRawSql).toHaveBeenCalledTimes(1)
    })

    it("throws if trade execution CTE returns zero rows (precondition failed)", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM player_game_stats")) {
          return [{ team_slug: "loons" }]
        }
        return []
      })
      const mockRawSql = vi.fn().mockResolvedValue([]) // returns 0 rows

      await expect(
        executeWeek1Trades({
          dryRun: false,
          queryFn: mockQuery,
          rawSqlFn: mockRawSql,
          season: "bash-2026-2027",
        })
      ).rejects.toThrow("Trade #1 execution failed: preconditions not met or concurrent modification")
    })
  })
})

describe("scripts/export-prod-db.ts", () => {
  describe("CLI Argument Parsing", () => {
    it("parses valid --from, --to, and --seasons arguments", () => {
      const opts = parseExportArgs([
        "--from",
        "postgres://prod-db/bash",
        "--to",
        "postgres://dev-db/bash",
        "--seasons",
        "2025-2026,bash-2026-2027",
      ])

      expect(opts.prodUrl).toBe("postgres://prod-db/bash")
      expect(opts.devUrl).toBe("postgres://dev-db/bash")
      expect(opts.seasons).toEqual(["2025-2026", "bash-2026-2027"])
    })

    it("throws when production URL is missing", () => {
      const originalProd = process.env.PROD_URL
      delete process.env.PROD_URL
      try {
        expect(() =>
          parseExportArgs(["--to", "postgres://dev-db/bash"])
        ).toThrow("Missing production database URL")
      } finally {
        if (originalProd) process.env.PROD_URL = originalProd
      }
    })

    it("throws when destination URL is missing", () => {
      const originalDev = process.env.DEV_URL
      const originalDb = process.env.DATABASE_URL
      delete process.env.DEV_URL
      delete process.env.DATABASE_URL
      try {
        expect(() =>
          parseExportArgs(["--from", "postgres://prod-db/bash"])
        ).toThrow("Missing target dev database URL")
      } finally {
        if (originalDev) process.env.DEV_URL = originalDev
        if (originalDb) process.env.DATABASE_URL = originalDb
      }
    })

    it("throws safety error when source and target URLs are identical", () => {
      expect(() =>
        parseExportArgs([
          "--from",
          "postgres://same-db/bash",
          "--to",
          "postgres://same-db/bash",
        ])
      ).toThrow("Safety Error: Source (prod) and Target (dev) database URLs are identical!")
    })
  })

  describe("Trade Replication Engine (syncTrades)", () => {
    it("replicates season_trades and season_trade_items and aligns sequences", async () => {
      const prodQueries: string[] = []
      const devQueries: string[] = []
      const devInserts: any[] = []

      const mockProdTrades = [
        {
          id: 5,
          season_id: "bash-2026-2027",
          team_a_slug: "rangers",
          team_b_slug: "red-wings",
          notes: "Week 1 trade: Eddie Parsons to Red Wings, Logan Truman to Rangers",
          traded_at: new Date("2026-09-24T00:00:00Z"),
          created_at: new Date("2026-09-24T00:00:00Z"),
        },
      ]

      const mockProdItems = [
        {
          id: 10,
          trade_id: 5,
          item_type: "player",
          from_team_slug: "rangers",
          to_team_slug: "red-wings",
          player_id: 953,
          draft_pick_round: null,
          draft_pick_original_team_slug: null,
          draft_pick_target_season: null,
        },
        {
          id: 11,
          trade_id: 5,
          item_type: "draft_pick",
          from_team_slug: "red-wings",
          to_team_slug: "rangers",
          player_id: null,
          draft_pick_round: 1,
          draft_pick_original_team_slug: "red-wings",
          draft_pick_target_season: "2027-summer",
        },
      ]

      const mockProd = vi.fn().mockImplementation(async (strings: TemplateStringsArray, ..._args: any[]) => {
        const queryText = strings.join("?")
        prodQueries.push(queryText)
        if (queryText.includes("FROM season_trades")) {
          return mockProdTrades
        }
        if (queryText.includes("FROM season_trade_items")) {
          return mockProdItems
        }
        return []
      })

      const mockDev = vi.fn().mockImplementation(async (strings: TemplateStringsArray, ...args: any[]) => {
        const queryText = strings.join("?")
        devQueries.push(queryText)
        devInserts.push({ queryText, args })
        return []
      })

      const devIdByProdId = new Map<number, number>([
        [953, 1953], // Maps prod player 953 to dev player 1953
      ])

      const result = await syncTrades(
        mockProd,
        mockDev,
        ["bash-2026-2027"],
        devIdByProdId
      )

      expect(result.tradesCount).toBe(1)
      expect(result.itemsCount).toBe(2)

      // Verifies prod queries
      expect(prodQueries.some((q) => q.includes("FROM season_trades WHERE season_id = ANY"))).toBe(true)
      expect(prodQueries.some((q) => q.includes("FROM season_trade_items WHERE trade_id = ANY"))).toBe(true)

      // Verifies dev delete
      expect(devQueries.some((q) => q.includes("DELETE FROM season_trades WHERE season_id = ANY"))).toBe(true)

      // Verifies trade insert
      expect(devQueries.some((q) => q.includes("INSERT INTO season_trades"))).toBe(true)

      // Verifies item insert and player_id mapping
      const itemInserts = devInserts.filter((i) => i.queryText.includes("INSERT INTO season_trade_items"))
      expect(itemInserts.length).toBe(2)

      // First item: mapped player 953 -> 1953
      expect(itemInserts[0].args).toContain(1953)

      // Second item: draft pick, player_id remains null
      expect(itemInserts[1].args).toContain(null)
      expect(itemInserts[1].args).toContain("2027-summer")

      // Verifies sequence alignment queries executed
      expect(devQueries.some((q) => q.includes("setval('season_trades_id_seq'"))).toBe(true)
      expect(devQueries.some((q) => q.includes("setval('season_trade_items_id_seq'"))).toBe(true)
    })

    it("handles zero prod trades cleanly", async () => {
      const mockProd = vi.fn().mockResolvedValue([])
      const mockDev = vi.fn().mockResolvedValue([])
      const devIdByProdId = new Map<number, number>()

      const result = await syncTrades(mockProd, mockDev, ["2025-2026"], devIdByProdId)

      expect(result.tradesCount).toBe(0)
      expect(result.itemsCount).toBe(0)
      expect(mockDev).toHaveBeenCalled() // Deletes existing and aligns sequences
    })
  })

  describe("Static Source Code Contract Audit", () => {
    it("confirms scripts/export-prod-db.ts stamps team_slug on player_game_stats and goalie_game_stats", () => {
      const scriptPath = path.resolve(__dirname, "../scripts/export-prod-db.ts")
      const content = fs.readFileSync(scriptPath, "utf-8")

      // Verify player_game_stats
      expect(content).toMatch(
        /INSERT INTO player_game_stats\s*\([^)]*team_slug[^)]*\)/
      )
      expect(content).toMatch(
        /VALUES\s*\([^)]*\$\{stat\.team_slug\}[^)]*\)/
      )

      // Verify goalie_game_stats
      expect(content).toMatch(
        /INSERT INTO goalie_game_stats\s*\([^)]*team_slug[^)]*\)/
      )
      expect(content).toMatch(
        /VALUES\s*\([^)]*\$\{stat\.team_slug\}[^)]*\)/
      )

      // Verify sequence alignment calls
      expect(content).toContain("setval('season_trades_id_seq'")
      expect(content).toContain("setval('season_trade_items_id_seq'")
    })

    it("confirms scripts/apply-fall-2026-week1-trades.ts respects repository architectural constraints", () => {
      const scriptPath = path.resolve(
        __dirname,
        "../scripts/apply-fall-2026-week1-trades.ts"
      )
      const content = fs.readFileSync(scriptPath, "utf-8")

      // Strictly NO db.transaction() or tx.
      expect(content).not.toMatch(/db\.transaction\(/)
      expect(content).not.toMatch(/\btx\./)

      // Pre-flight Draper safety check present
      expect(content).toContain("g130")
      expect(content).toContain("Darrell Draper")
      expect(content).toContain("loons")

      // Data-modifying CTE components present
      expect(content).toContain("locked_season AS MATERIALIZED")
      expect(content).toContain("locked_rosters AS MATERIALIZED")
      expect(content).toContain("guard AS")
      expect(content).toContain("updated_rosters AS")
      expect(content).toContain("inserted_trade AS")
      expect(content).toContain("inserted_items AS")
    })
  })
})
