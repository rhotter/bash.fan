import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  verifyDarrellDraperPreFlight,
  checkTradeStatus,
  compileTradeCte,
  executeWeek1Trades,
  FALL_2026_WEEK1_TRADE_1,
  FALL_2026_WEEK1_TRADE_2,
  type TradeDefinition,
} from "../scripts/apply-fall-2026-week1-trades"
import {
  syncTrades,
} from "../scripts/export-prod-db"

describe("Trade Scripts & Prod DB Export Edge Cases", () => {
  // ==========================================================================
  // 1. DARRELL DRAPER PRE-FLIGHT CHECK STRESS TESTING
  // ==========================================================================
  describe("Scenario 1: Darrell Draper Pre-Flight Safety Check Stress Harness", () => {
    it("passes when stat row is present with team_slug 'loons'", async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ team_slug: "loons" }])
      const res = await verifyDarrellDraperPreFlight(mockQuery)

      expect(res).toEqual({ passed: true, teamSlug: "loons", found: true })
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    it("throws when stat row is present with team_slug 'red-wings'", async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ team_slug: "red-wings" }])

      await expect(verifyDarrellDraperPreFlight(mockQuery)).rejects.toThrow(
        "Pre-flight safety check failed: Darrell Draper's stat row in g130 has team_slug 'red-wings', expected 'loons'. Run scripts/deploy-trades-schema.ts first."
      )
    })

    it("throws when stat row is present with team_slug null", async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ team_slug: null }])

      await expect(verifyDarrellDraperPreFlight(mockQuery)).rejects.toThrow(
        "Pre-flight safety check failed: Darrell Draper's stat row in g130 has team_slug 'NULL', expected 'loons'. Run scripts/deploy-trades-schema.ts first."
      )
    })

    it("throws when stat row has undefined team_slug", async () => {
      const mockQuery = vi.fn().mockResolvedValue([{}])

      await expect(verifyDarrellDraperPreFlight(mockQuery)).rejects.toThrow(
        "Pre-flight safety check failed: Darrell Draper's stat row in g130 has team_slug 'NULL', expected 'loons'. Run scripts/deploy-trades-schema.ts first."
      )
    })

    it("throws when stat row has adversarial team_slug (e.g. 'gold-seals', 'rangers')", async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ team_slug: "gold-seals" }])

      await expect(verifyDarrellDraperPreFlight(mockQuery)).rejects.toThrow(
        "Pre-flight safety check failed: Darrell Draper's stat row in g130 has team_slug 'gold-seals', expected 'loons'"
      )
    })

    it("passes when no row exists for g130 (empty array)", async () => {
      const mockQuery = vi.fn().mockResolvedValue([])
      const res = await verifyDarrellDraperPreFlight(mockQuery)

      expect(res).toEqual({ passed: true, teamSlug: null, found: false })
    })

    it("passes when query returns null or undefined", async () => {
      const mockNullQuery = vi.fn().mockResolvedValue(null)
      const resNull = await verifyDarrellDraperPreFlight(mockNullQuery)
      expect(resNull).toEqual({ passed: true, teamSlug: null, found: false })

      const mockUndefQuery = vi.fn().mockResolvedValue(undefined)
      const resUndef = await verifyDarrellDraperPreFlight(mockUndefQuery)
      expect(resUndef).toEqual({ passed: true, teamSlug: null, found: false })
    })

    it("evaluates the first row if multiple stat rows exist", async () => {
      const mockQuery = vi.fn().mockResolvedValue([
        { team_slug: "loons" },
        { team_slug: "gold-seals" },
      ])
      const res = await verifyDarrellDraperPreFlight(mockQuery)
      expect(res.passed).toBe(true)
      expect(res.teamSlug).toBe("loons")
    })

    it("propagates database query execution errors", async () => {
      const mockQuery = vi.fn().mockRejectedValue(new Error("Connection terminated unexpectedly"))
      await expect(verifyDarrellDraperPreFlight(mockQuery)).rejects.toThrow(
        "Connection terminated unexpectedly"
      )
    })

    it("verifies the exact query structure targets game_id = 'g130' and Darrell Draper / 49983", async () => {
      let executedSql = ""
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        executedSql = sqlText
        return [{ team_slug: "loons" }]
      })

      await verifyDarrellDraperPreFlight(mockQuery)
      expect(executedSql).toContain("WHERE pgs.game_id = 'g130'")
      expect(executedSql).toContain("pgs.player_id = 49983")
      expect(executedSql).toContain("p.name ILIKE '%Darrell Draper%'")
      expect(executedSql).toContain("LIMIT 1")
    })
  })

  // ==========================================================================
  // 2. IDEMPOTENCY CHECK STRESS TESTING (checkTradeStatus & executeWeek1Trades)
  // ==========================================================================
  describe("Scenario 2: Idempotency Check & Execution Matrix", () => {
    it("handles state when neither trade is recorded in season_trades or player_seasons", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM season_trades")) return []
        if (sqlText.includes("FROM player_seasons")) {
          // Pre-trade rosters:
          return [
            { player_id: 315, team_slug: "reign" },
            { player_id: 102, team_slug: "seals" },
            { player_id: 3640, team_slug: "yetis" },
            { player_id: 50003, team_slug: "yetis" },
            { player_id: 61, team_slug: "loons" },
            { player_id: 49983, team_slug: "loons" },
          ]
        }
        return []
      })

      const status = await checkTradeStatus(mockQuery, "bash-2026-2027")
      expect(status.trade1Applied).toBe(false)
      expect(status.trade2Applied).toBe(false)
      expect(status.allApplied).toBe(false)
      expect(status.trade1Reason).toBeUndefined()
      expect(status.trade2Reason).toBeUndefined()
    })

    it("handles state when Trade #1 is recorded but Trade #2 is not", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM season_trades")) {
          return [
            { id: 1, notes: "Week 1 trade: Eddie Parsons to Seals, Logan Truman to Reign" },
          ]
        }
        if (sqlText.includes("FROM player_seasons")) {
          return [
            { player_id: 315, team_slug: "seals" },
            { player_id: 102, team_slug: "reign" },
            // Trade 2 players not moved yet:
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
      expect(status.trade1Reason).toBe("in_season_trades")
      expect(status.trade2Reason).toBeUndefined()
    })

    it("handles state when Trade #2 is recorded but Trade #1 is not", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM season_trades")) {
          return [
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
      expect(status.trade1Applied).toBe(false)
      expect(status.trade2Applied).toBe(true)
      expect(status.allApplied).toBe(false)
      expect(status.trade2Reason).toBe("in_season_trades")
    })

    it("handles state when both trades are recorded in season_trades", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
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

      const status = await checkTradeStatus(mockQuery, "bash-2026-2027")
      expect(status.trade1Applied).toBe(true)
      expect(status.trade2Applied).toBe(true)
      expect(status.allApplied).toBe(true)
      expect(status.trade1Reason).toBe("in_season_trades")
      expect(status.trade2Reason).toBe("in_season_trades")
    })

    it("handles state when both trades are recorded via player_seasons without season_trades entries", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM season_trades")) return []
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
      expect(status.trade1Reason).toBe("in_player_seasons")
      expect(status.trade2Reason).toBe("in_player_seasons")
    })

    it("adversarial test: partial player move in Trade 2 does NOT falsely mark trade as applied", async () => {
      // Suppose only Jonny Callan (3640) and Lee Jacobs (50003) moved to loons,
      // but Darrell Draper (49983) is still on loons.
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM season_trades")) return []
        if (sqlText.includes("FROM player_seasons")) {
          return [
            { player_id: 3640, team_slug: "loons" },
            { player_id: 50003, team_slug: "loons" },
            { player_id: 61, team_slug: "yetis" },
            { player_id: 49983, team_slug: "loons" }, // NOT on yetis!
          ]
        }
        return []
      })

      const status = await checkTradeStatus(mockQuery, "bash-2026-2027")
      expect(status.trade2Applied).toBe(false)
      expect(status.allApplied).toBe(false)
    })

    it("adversarial test: partial player move in Trade 1 does NOT falsely mark trade as applied", async () => {
      // Eddie Parsons moved to seals, but Logan Truman is still on seals or missing
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM season_trades")) return []
        if (sqlText.includes("FROM player_seasons")) {
          return [
            { player_id: 315, team_slug: "seals" },
            { player_id: 102, team_slug: "seals" }, // NOT reign!
          ]
        }
        return []
      })

      const status = await checkTradeStatus(mockQuery, "bash-2026-2027")
      expect(status.trade1Applied).toBe(false)
      expect(status.allApplied).toBe(false)
    })

    it("executeWeek1Trades skips Trade #1 and executes Trade #2 when Trade #1 is applied", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM player_game_stats")) {
          return [{ team_slug: "loons" }]
        }
        if (sqlText.includes("FROM seasons")) {
          return [{ id: "bash-2026-2027" }]
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
        .mockResolvedValueOnce([{ tradeId: 202, tradedAt: "2026-09-25T00:00:00Z" }])

      const result = await executeWeek1Trades({
        queryFn: mockQuery,
        rawSqlFn: mockRawSql,
      })

      expect(result.alreadyComplete).toBe(false)
      expect(result.trade1Executed).toBe(false)
      expect(result.trade2Executed).toBe(true)
      expect(mockRawSql).toHaveBeenCalledTimes(1)
    })

    it("executeWeek1Trades skips Trade #2 and executes Trade #1 when Trade #2 is applied", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM player_game_stats")) {
          return [{ team_slug: "loons" }]
        }
        if (sqlText.includes("FROM seasons")) {
          return [{ id: "bash-2026-2027" }]
        }
        if (sqlText.includes("FROM season_trades")) {
          return [
            {
              id: 2,
              notes:
                "Week 1 trade: Jonny Callan & Lee Jacobs to Loons, Steph Tryphonas & Darrell Draper to Yetis",
            },
          ]
        }
        return []
      })

      const mockRawSql = vi
        .fn()
        .mockResolvedValueOnce([{ tradeId: 201, tradedAt: "2026-09-24T00:00:00Z" }])

      const result = await executeWeek1Trades({
        queryFn: mockQuery,
        rawSqlFn: mockRawSql,
      })

      expect(result.alreadyComplete).toBe(false)
      expect(result.trade1Executed).toBe(true)
      expect(result.trade2Executed).toBe(false)
      expect(mockRawSql).toHaveBeenCalledTimes(1)
    })

    it("executeWeek1Trades performs zero writes when all trades already applied", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM player_game_stats")) return [{ team_slug: "loons" }]
        if (sqlText.includes("FROM seasons")) return [{ id: "bash-2026-2027" }]
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
      })

      expect(result.alreadyComplete).toBe(true)
      expect(result.trade1Executed).toBe(false)
      expect(result.trade2Executed).toBe(false)
      expect(mockRawSql).not.toHaveBeenCalled()
    })

    it("executeWeek1Trades performs zero writes in dry-run mode when trades pending", async () => {
      const mockQuery = vi.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("FROM player_game_stats")) return [{ team_slug: "loons" }]
        if (sqlText.includes("FROM seasons")) return [{ id: "bash-2026-2027" }]
        return []
      })
      const mockRawSql = vi.fn()

      const result = await executeWeek1Trades({
        dryRun: true,
        queryFn: mockQuery,
        rawSqlFn: mockRawSql,
      })

      expect(result.dryRun).toBe(true)
      expect(result.alreadyComplete).toBe(false)
      expect(result.trade1Executed).toBe(false)
      expect(result.trade2Executed).toBe(false)
      expect(mockRawSql).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 3. DATABASE SYNC & SEQUENCE STRESS TESTING (export-prod-db.ts)
  // ==========================================================================
  describe("Scenario 3: Database Sync, Null Player ID Draft Pick Mapping & Sequence SQL", () => {
    it("handles draft pick item with player_id === null without throw or corruption", async () => {
      const prodQueries: string[] = []
      const devQueries: string[] = []
      const devInserts: { queryText: string; args: any[] }[] = []

      const mockProdTrades = [
        {
          id: 42,
          season_id: "bash-2026-2027",
          team_a_slug: "rangers",
          team_b_slug: "red-wings",
          notes: "Future draft pick trade",
          traded_at: new Date("2026-10-01T00:00:00Z"),
          created_at: new Date("2026-10-01T00:00:00Z"),
        },
      ]

      const mockProdTradeItems = [
        {
          id: 101,
          trade_id: 42,
          item_type: "draft_pick",
          from_team_slug: "rangers",
          to_team_slug: "red-wings",
          player_id: null, // Draft pick item has null player_id
          draft_pick_round: 2,
          draft_pick_original_team_slug: "rangers",
          draft_pick_target_season: "2027-summer",
        },
        {
          id: 102,
          trade_id: 42,
          item_type: "draft_pick",
          from_team_slug: "red-wings",
          to_team_slug: "rangers",
          player_id: null, // Draft pick item has null player_id
          draft_pick_round: 3,
          draft_pick_original_team_slug: "red-wings",
          draft_pick_target_season: "2027-summer",
        },
        {
          id: 103,
          trade_id: 42,
          item_type: "player",
          from_team_slug: "rangers",
          to_team_slug: "red-wings",
          player_id: 555, // Player item with ID
          draft_pick_round: null,
          draft_pick_original_team_slug: null,
          draft_pick_target_season: null,
        },
      ]

      const mockProd = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
        const queryText = strings.join("?")
        prodQueries.push(queryText)
        if (queryText.includes("FROM season_trades")) return mockProdTrades
        if (queryText.includes("FROM season_trade_items")) return mockProdTradeItems
        return []
      })

      const mockDev = vi.fn().mockImplementation(async (strings: TemplateStringsArray, ...args: any[]) => {
        const queryText = strings.join("?")
        devQueries.push(queryText)
        devInserts.push({ queryText, args })
        return []
      })

      const devIdByProdId = new Map<number, number>([
        [555, 999], // 555 mapped to 999
      ])

      const result = await syncTrades(mockProd, mockDev, ["bash-2026-2027"], devIdByProdId)

      expect(result.tradesCount).toBe(1)
      expect(result.itemsCount).toBe(3)

      const itemInserts = devInserts.filter((i) => i.queryText.includes("INSERT INTO season_trade_items"))
      expect(itemInserts.length).toBe(3)

      // First draft pick item: player_id is strictly null
      expect(itemInserts[0].args).toContain(null)
      expect(itemInserts[0].args).toContain(2) // round
      expect(itemInserts[0].args).toContain("2027-summer") // target season

      // Second draft pick item: player_id is strictly null
      expect(itemInserts[1].args).toContain(null)
      expect(itemInserts[1].args).toContain(3)

      // Third player item: player_id mapped from 555 to 999
      expect(itemInserts[2].args).toContain(999)
      expect(itemInserts[2].args).toContain("player")
    })

    it("verifies sequence setval queries are valid PostgreSQL syntax and target correct sequence names", async () => {
      const devQueries: string[] = []

      const mockProd = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
        const q = strings.join("?")
        if (q.includes("FROM season_trades")) {
          return [{ id: 15, season_id: "bash-2026-2027" }]
        }
        if (q.includes("FROM season_trade_items")) {
          return [
            {
              id: 30,
              trade_id: 15,
              item_type: "player",
              from_team_slug: "rangers",
              to_team_slug: "red-wings",
              player_id: 1,
            },
          ]
        }
        return []
      })

      const mockDev = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
        devQueries.push(strings.join("?"))
        return []
      })

      await syncTrades(mockProd, mockDev, ["bash-2026-2027"], new Map())

      const tradeSeqQuery = devQueries.find((q) => q.includes("season_trades_id_seq"))
      const tradeItemSeqQuery = devQueries.find((q) => q.includes("season_trade_items_id_seq"))

      expect(tradeSeqQuery).toBeDefined()
      expect(tradeItemSeqQuery).toBeDefined()

      // Exact valid PostgreSQL setval pattern:
      expect(tradeSeqQuery).toMatch(
        /SELECT setval\('season_trades_id_seq',\s*COALESCE\(\(SELECT MAX\(id\) FROM season_trades\),\s*1\)\);/
      )
      expect(tradeItemSeqQuery).toMatch(
        /SELECT setval\('season_trade_items_id_seq',\s*COALESCE\(\(SELECT MAX\(id\) FROM season_trade_items\),\s*1\)\);/
      )
    })

    it("unmapped player ID falls back to item.player_id in syncTrades", async () => {
      const devInserts: { queryText: string; args: any[] }[] = []

      const mockProd = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
        const q = strings.join("?")
        if (q.includes("FROM season_trades")) {
          return [{ id: 1, season_id: "bash-2026-2027" }]
        }
        if (q.includes("FROM season_trade_items")) {
          return [
            {
              id: 10,
              trade_id: 1,
              item_type: "player",
              from_team_slug: "a",
              to_team_slug: "b",
              player_id: 7777, // Unmapped ID
            },
          ]
        }
        return []
      })

      const mockDev = vi.fn().mockImplementation(async (strings: TemplateStringsArray, ...args: any[]) => {
        devInserts.push({ queryText: strings.join("?"), args })
        return []
      })

      const emptyMap = new Map<number, number>()
      await syncTrades(mockProd, mockDev, ["bash-2026-2027"], emptyMap)

      const itemInsert = devInserts.find((i) => i.queryText.includes("INSERT INTO season_trade_items"))
      expect(itemInsert).toBeDefined()
      expect(itemInsert?.args).toContain(7777)
    })

    it("verifies team_slug preservation in export-prod-db.ts static code inspection", () => {
      const exportScriptPath = path.resolve(__dirname, "../scripts/export-prod-db.ts")
      const content = fs.readFileSync(exportScriptPath, "utf-8")

      // player_game_stats column list & values
      expect(content).toContain("is_sub, team_slug")
      expect(content).toContain("${stat.team_slug}")

      // goalie_game_stats column list & values
      expect(content).toContain("is_sub, team_slug")

      // syncTrades call inside main()
      expect(content).toContain("syncTrades(prod, dev, seasons, devIdByProdId)")
    })
  })

  // ==========================================================================
  // 4. ATOMIC CTE GENERATION & PARAMETER INTEGRITY
  // ==========================================================================
  describe("Scenario 4: Atomic CTE Generation & Parameter Integrity", () => {
    it("generates valid SQL and parameter bindings for Trade #1", () => {
      const { sql, params } = compileTradeCte("bash-2026-2027", FALL_2026_WEEK1_TRADE_1)

      expect(sql).toContain("WITH locked_season AS MATERIALIZED")
      expect(sql).toContain("FOR UPDATE")
      expect(sql).toContain("locked_rosters AS MATERIALIZED")
      expect(sql).toContain("guard AS")
      expect(sql).toContain("updated_rosters AS")
      expect(sql).toContain("inserted_trade AS")
      expect(sql).toContain("inserted_items AS")
      expect(sql).toContain("jsonb_to_recordset")

      expect(params).toContain("bash-2026-2027")
      expect(params).toContain("reign")
      expect(params).toContain("seals")
      expect(params).toContain(315)
      expect(params).toContain(102)
      expect(params).toContain("2026-10-12T00:00:00Z")
    })

    it("generates valid SQL and parameter bindings for Trade #2", () => {
      const { sql, params } = compileTradeCte("bash-2026-2027", FALL_2026_WEEK1_TRADE_2)

      expect(sql).toContain("inserted_items AS")
      expect(params).toContain("yetis")
      expect(params).toContain("loons")
      expect(params).toContain(3640)
      expect(params).toContain(50003)
      expect(params).toContain(61)
      expect(params).toContain(49983)
      expect(params).toContain("2026-10-13T00:00:00Z")
    })

    it("correctly handles custom trade with draft picks in buildTradeCte", () => {
      const customTrade: TradeDefinition = {
        teamASlug: "rangers",
        teamBSlug: "red-wings",
        teamAPlayerIds: [953],
        teamBPlayerIds: [1032],
        tradedAt: "2026-10-15T00:00:00Z",
        notes: "Trade with draft pick",
        draftPicks: [
          {
            itemType: "draft_pick",
            fromTeamSlug: "rangers",
            toTeamSlug: "red-wings",
            playerId: null,
            draftPickRound: 1,
            draftPickOriginalTeamSlug: "rangers",
            draftPickTargetSeason: "2027-summer",
          },
        ],
      }

      const { sql, params } = compileTradeCte("bash-2026-2027", customTrade)
      expect(sql).toBeDefined()
      // JSON recordset should contain draft pick item
      const jsonParam = params.find((p) => typeof p === "string" && p.includes("2027-summer"))
      expect(jsonParam).toBeDefined()
      const parsedItems = JSON.parse(jsonParam as string)
      expect(parsedItems.length).toBe(3) // 2 players + 1 draft pick
      expect(parsedItems[2].itemType).toBe("draft_pick")
      expect(parsedItems[2].playerId).toBeNull()
      expect(parsedItems[2].draftPickRound).toBe(1)
    })
  })
})
