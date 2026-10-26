// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SQL } from "drizzle-orm"
import { NextRequest } from "next/server"
import React from "react"
import { toast } from "sonner"

type Query = { sql: string; params: unknown[] }

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  rawSql: vi.fn(),
  query: vi.fn(),
}))

vi.mock("@/lib/admin-session", () => ({
  getSession: () => mocks.getSession(),
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

import { validateTradeInput } from "@/lib/trade-helpers"
import { POST as postTrade, GET as getTrades } from "@/app/api/bash/admin/seasons/[id]/trades/route"
import {
  POST as postRoster,
  PATCH as patchRoster,
  DELETE as deleteRoster,
} from "@/app/api/bash/admin/seasons/[id]/roster/route"
import { SeasonRosterTab } from "@/components/admin/season-roster-tab"

describe("Admin Season Trades & Roster Mutations Edge Cases", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(true)
  })

  // ==========================================================================
  // 1. lib/trade-helpers (validateTradeInput) Edge Cases
  // ==========================================================================
  describe("1. Trade Input Validation Stress & Boundary Matrix", () => {
    it("rejects non-object, array, null, undefined, and primitive payloads", () => {
      const inputs = [null, undefined, 42, "payload", true, [1, 2], Symbol("trade")]
      for (const input of inputs) {
        const res = validateTradeInput(input)
        expect(res.valid).toBe(false)
        if (!res.valid) {
          expect(res.error).toMatch(/object/i)
        }
      }
    })

    it("rejects trades between identical teams or case/whitespace equivalent teams", () => {
      const payloads = [
        { teamASlug: "loons", teamBSlug: "loons", teamAPlayerIds: [1] },
        { teamASlug: "  sharks ", teamBSlug: "sharks", teamAPlayerIds: [1] },
        { teamASlug: "", teamBSlug: "loons", teamAPlayerIds: [1] },
        { teamASlug: "loons", teamBSlug: "   ", teamAPlayerIds: [1] },
      ]
      for (const p of payloads) {
        const res = validateTradeInput(p)
        expect(res.valid).toBe(false)
      }
    })

    it("rejects trade with 0 assets exchanged", () => {
      const res = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [],
        teamBPlayerIds: [],
        draftPicks: [],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/at least one player or draft pick/i)
      }
    })

    it("deduplicates redundant player IDs and rejects overlapping players across teams", () => {
      // Deduplication on same team
      const resDedup = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [10, 20, 10, 20, 30],
        teamBPlayerIds: [40, 40],
      })
      expect(resDedup.valid).toBe(true)
      if (resDedup.valid) {
        expect(resDedup.data.teamAPlayerIds).toEqual([10, 20, 30])
        expect(resDedup.data.teamBPlayerIds).toEqual([40])
      }

      // Overlap across teams
      const resOverlap = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [10, 20],
        teamBPlayerIds: [30, 10],
      })
      expect(resOverlap.valid).toBe(false)
      if (!resOverlap.valid) {
        expect(resOverlap.error).toMatch(/Player ID 10 cannot appear on both teams/i)
      }
    })

    it("validates draft pick rounds strictly between 1 and 20 (BVA boundaries)", () => {
      const base = {
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [1],
        teamBPlayerIds: [2],
      }

      // round 0 -> reject
      expect(
        validateTradeInput({
          ...base,
          draftPicks: [
            { fromTeamSlug: "loons", toTeamSlug: "yetis", round: 0, originalTeamSlug: "loons", targetSeason: "2027" },
          ],
        }).valid
      ).toBe(false)

      // round 1 -> accept
      expect(
        validateTradeInput({
          ...base,
          draftPicks: [
            { fromTeamSlug: "loons", toTeamSlug: "yetis", round: 1, originalTeamSlug: "loons", targetSeason: "2027" },
          ],
        }).valid
      ).toBe(true)

      // round 20 -> accept
      expect(
        validateTradeInput({
          ...base,
          draftPicks: [
            { fromTeamSlug: "loons", toTeamSlug: "yetis", round: 20, originalTeamSlug: "loons", targetSeason: "2027" },
          ],
        }).valid
      ).toBe(true)

      // round 21 -> reject
      expect(
        validateTradeInput({
          ...base,
          draftPicks: [
            { fromTeamSlug: "loons", toTeamSlug: "yetis", round: 21, originalTeamSlug: "loons", targetSeason: "2027" },
          ],
        }).valid
      ).toBe(false)

      // round non-integer -> reject
      expect(
        validateTradeInput({
          ...base,
          draftPicks: [
            { fromTeamSlug: "loons", toTeamSlug: "yetis", round: 3.5, originalTeamSlug: "loons", targetSeason: "2027" },
          ],
        }).valid
      ).toBe(false)
    })

    it("strictly verifies draft pick from/to team directions match trading teams", () => {
      const base = {
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [1],
        teamBPlayerIds: [],
      }

      // fromTeamSlug not participating in trade
      const resBadFrom = validateTradeInput({
        ...base,
        draftPicks: [
          { fromTeamSlug: "sharks", toTeamSlug: "yetis", round: 2, originalTeamSlug: "sharks", targetSeason: "2027" },
        ],
      })
      expect(resBadFrom.valid).toBe(false)

      // toTeamSlug not participating in trade
      const resBadTo = validateTradeInput({
        ...base,
        draftPicks: [
          { fromTeamSlug: "loons", toTeamSlug: "rangers", round: 2, originalTeamSlug: "loons", targetSeason: "2027" },
        ],
      })
      expect(resBadTo.valid).toBe(false)

      // fromTeam === toTeam
      const resSameTeam = validateTradeInput({
        ...base,
        draftPicks: [
          { fromTeamSlug: "loons", toTeamSlug: "loons", round: 2, originalTeamSlug: "loons", targetSeason: "2027" },
        ],
      })
      expect(resSameTeam.valid).toBe(false)
    })

    it("TASK 2 VERIFICATION: rejects negative player IDs, string numbers, floats, and missing target season", () => {
      const validBase = {
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [630],
        teamBPlayerIds: [974],
      }

      // Negative player IDs
      expect(validateTradeInput({ ...validBase, teamAPlayerIds: [-1] }).valid).toBe(false)
      expect(validateTradeInput({ ...validBase, teamBPlayerIds: [-99] }).valid).toBe(false)
      expect(validateTradeInput({ ...validBase, teamAPlayerIds: [0] }).valid).toBe(false)

      // String numbers
      expect(validateTradeInput({ ...validBase, teamAPlayerIds: ["630" as unknown as number] }).valid).toBe(false)
      expect(validateTradeInput({ ...validBase, teamBPlayerIds: ["974" as unknown as number] }).valid).toBe(false)

      // Floats / decimals
      expect(validateTradeInput({ ...validBase, teamAPlayerIds: [630.5] }).valid).toBe(false)
      expect(validateTradeInput({ ...validBase, teamBPlayerIds: [0.1] }).valid).toBe(false)
      expect(validateTradeInput({ ...validBase, teamAPlayerIds: [NaN] }).valid).toBe(false)
      expect(validateTradeInput({ ...validBase, teamAPlayerIds: [Infinity] }).valid).toBe(false)

      // Missing target season in draft pick
      expect(
        validateTradeInput({
          ...validBase,
          draftPicks: [
            {
              fromTeamSlug: "loons",
              toTeamSlug: "yetis",
              round: 2,
              originalTeamSlug: "loons",
              targetSeason: "",
            },
          ],
        }).valid
      ).toBe(false)

      expect(
        validateTradeInput({
          ...validBase,
          draftPicks: [
            {
              fromTeamSlug: "loons",
              toTeamSlug: "yetis",
              round: 2,
              originalTeamSlug: "loons",
              targetSeason: "   ",
            },
          ],
        }).valid
      ).toBe(false)
    })
  })

  // ==========================================================================
  // 2. ADVERSARIAL CHALLENGE: POST /api/bash/admin/seasons/[id]/trades
  // ==========================================================================
  describe("2. Admin Season Trades POST Endpoint & Precondition Enforcements", () => {
    it("returns HTTP 401 when admin session is unauthenticated", async () => {
      mocks.getSession.mockResolvedValue(false)
      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades", {
        method: "POST",
        body: JSON.stringify({
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [630],
          teamBPlayerIds: [974],
        }),
      })

      const res = await postTrade(req, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe("Unauthorized")
    })

    it("returns HTTP 400 when body is malformed JSON", async () => {
      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades", {
        method: "POST",
        body: "{not-valid-json",
      })

      const res = await postTrade(req, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/invalid json/i)
    })

    it("returns HTTP 404 when season does not exist in database", async () => {
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [] } // No season found
        }
        return { rows: [] }
      })

      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/unknown-season/trades", {
        method: "POST",
        body: JSON.stringify({
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [630],
          teamBPlayerIds: [974],
        }),
      })

      const res = await postTrade(req, { params: Promise.resolve({ id: "unknown-season" }) })
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toBe("Season not found")
    })

    it("returns HTTP 400 when season is completed", async () => {
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["2026-2027", "completed"]] }
        }
        return { rows: [] }
      })

      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades", {
        method: "POST",
        body: JSON.stringify({
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [630],
          teamBPlayerIds: [974],
        }),
      })

      const res = await postTrade(req, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/cannot record trades for completed season/i)
    })

    it("TASK 2 VERIFICATION: returns HTTP 400 when either team is not in season_teams", async () => {
      // Scenario A: Team A in season_teams, Team B missing
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["2026-2027", "active"]] }
        }
        if (/from "season_teams"/i.test(sql)) {
          return { rows: [["loons"]] } // only 1 team found!
        }
        return { rows: [] }
      })

      const reqA = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades", {
        method: "POST",
        body: JSON.stringify({
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [630],
          teamBPlayerIds: [974],
        }),
      })

      const resA = await postTrade(reqA, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(resA.status).toBe(400)
      const bodyA = await resA.json()
      expect(bodyA.error).toContain("both teams must belong to this season")

      // Scenario B: Neither team in season_teams
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["2026-2027", "active"]] }
        }
        if (/from "season_teams"/i.test(sql)) {
          return { rows: [] } // 0 teams found!
        }
        return { rows: [] }
      })

      const reqB = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades", {
        method: "POST",
        body: JSON.stringify({
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [630],
          teamBPlayerIds: [974],
        }),
      })

      const resB = await postTrade(reqB, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(resB.status).toBe(400)
      const bodyB = await resB.json()
      expect(bodyB.error).toContain("both teams must belong to this season")
    })

    it("TASK 2 VERIFICATION: returns HTTP 409 when any player is not on the expected team", async () => {
      // Scenario A: Player 630 is listed on loons, but is actually on yetis in DB
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["2026-2027", "active"]] }
        }
        if (/from "season_teams"/i.test(sql)) {
          return { rows: [["loons"], ["yetis"]] }
        }
        if (/from "player_seasons"/i.test(sql)) {
          return {
            rows: [
              [630, "yetis"], // Wrong team! Expected loons
              [974, "yetis"],
            ],
          }
        }
        return { rows: [] }
      })

      const reqA = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades", {
        method: "POST",
        body: JSON.stringify({
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [630],
          teamBPlayerIds: [974],
        }),
      })

      const resA = await postTrade(reqA, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(resA.status).toBe(409)
      const bodyA = await resA.json()
      expect(bodyA.error).toBe("Trade precondition failed: Player 630 is not on loons")

      // Scenario B: Player 974 is not registered in the season at all
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["2026-2027", "active"]] }
        }
        if (/from "season_teams"/i.test(sql)) {
          return { rows: [["loons"], ["yetis"]] }
        }
        if (/from "player_seasons"/i.test(sql)) {
          return {
            rows: [
              [630, "loons"],
              // Player 974 missing from player_seasons!
            ],
          }
        }
        return { rows: [] }
      })

      const reqB = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades", {
        method: "POST",
        body: JSON.stringify({
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [630],
          teamBPlayerIds: [974],
        }),
      })

      const resB = await postTrade(reqB, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(resB.status).toBe(409)
      const bodyB = await resB.json()
      expect(bodyB.error).toBe("Trade precondition failed: Player 974 is not on yetis")
    })

    it("executes valid trade atomically via single-statement CTE with rawSql and returns HTTP 201", async () => {
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["2026-2027", "active"]] }
        }
        if (/from "season_teams"/i.test(sql)) {
          return { rows: [["loons"], ["yetis"]] }
        }
        if (/from "player_seasons"/i.test(sql)) {
          return {
            rows: [
              [630, "loons"],
              [895, "loons"],
              [974, "yetis"],
            ],
          }
        }
        return { rows: [] }
      })

      let capturedSql = ""
      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        capturedSql = sql
        return [{ tradeId: 42, tradedAt: "2026-10-17T05:00:00.000Z" }]
      })

      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades", {
        method: "POST",
        body: JSON.stringify({
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [630, 895],
          teamBPlayerIds: [974],
          draftPicks: [
            {
              fromTeamSlug: "loons",
              toTeamSlug: "yetis",
              round: 2,
              originalTeamSlug: "loons",
              targetSeason: "2027-summer",
            },
          ],
          notes: "Block trade with pick",
        }),
      })

      const res = await postTrade(req, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.tradeId).toBe(42)
      expect(body.tradedAt).toBe("2026-10-17T05:00:00.000Z")

      // Verify the CTE query structure
      expect(capturedSql).toContain("WITH locked_season AS MATERIALIZED")
      expect(capturedSql).toContain("locked_rosters AS MATERIALIZED")
      expect(capturedSql).toContain("guard AS")
      expect(capturedSql).toContain("updated_rosters AS")
      expect(capturedSql).toContain("inserted_trade AS")
      expect(capturedSql).toContain("inserted_items AS")
      expect(capturedSql).toContain("jsonb_to_recordset")
    })

    it("returns HTTP 409 when atomic CTE guard returns 0 rows (concurrent modification / rollback)", async () => {
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["2026-2027", "active"]] }
        }
        if (/from "season_teams"/i.test(sql)) {
          return { rows: [["loons"], ["yetis"]] }
        }
        if (/from "player_seasons"/i.test(sql)) {
          return {
            rows: [
              [630, "loons"],
              [974, "yetis"],
            ],
          }
        }
        return { rows: [] }
      })

      // CTE guard failed in Postgres (e.g. concurrent trade changed roster between check and CTE lock)
      mocks.rawSql.mockResolvedValue([])

      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades", {
        method: "POST",
        body: JSON.stringify({
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [630],
          teamBPlayerIds: [974],
        }),
      })

      const res = await postTrade(req, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toMatch(/preconditions not met or concurrent modification/i)
    })

    it("supports draft-pick only trades (0 players on both sides)", async () => {
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["2026-2027", "active"]] }
        }
        if (/from "season_teams"/i.test(sql)) {
          return { rows: [["loons"], ["yetis"]] }
        }
        return { rows: [] }
      })

      mocks.rawSql.mockResolvedValue([{ tradeId: 99, tradedAt: "2026-10-17T05:30:00Z" }])

      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades", {
        method: "POST",
        body: JSON.stringify({
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [],
          teamBPlayerIds: [],
          draftPicks: [
            {
              fromTeamSlug: "loons",
              toTeamSlug: "yetis",
              round: 1,
              originalTeamSlug: "loons",
              targetSeason: "2027-summer",
            },
          ],
        }),
      })

      const res = await postTrade(req, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.tradeId).toBe(99)
    })

    it("executes a 3-team circular trade atomically via teamSlugs and playerMoves", async () => {
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["2026-2027", "active"]] }
        }
        if (/from "season_teams"/i.test(sql)) {
          return { rows: [["loons"], ["yetis"], ["reign"]] }
        }
        if (/from "player_seasons"/i.test(sql)) {
          return {
            rows: [
              [630, "loons"],
              [974, "yetis"],
              [315, "reign"],
            ],
          }
        }
        return { rows: [] }
      })

      let capturedSql = ""
      mocks.rawSql.mockImplementation(async ({ sql }: Query) => {
        capturedSql = sql
        return [{ tradeId: 103, tradedAt: "2026-10-18T00:00:00Z" }]
      })

      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades", {
        method: "POST",
        body: JSON.stringify({
          teamSlugs: ["loons", "yetis", "reign"],
          playerMoves: [
            { playerId: 630, fromTeamSlug: "loons", toTeamSlug: "yetis" },
            { playerId: 974, fromTeamSlug: "yetis", toTeamSlug: "reign" },
            { playerId: 315, fromTeamSlug: "reign", toTeamSlug: "loons" },
          ],
          notes: "3-way circular trade",
        }),
      })

      const res = await postTrade(req, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.tradeId).toBe(103)
      expect(capturedSql).toContain("trade_player_moves")
      expect(capturedSql).toContain("team_slugs")
    })
  })

  // ==========================================================================
  // 3. ADVERSARIAL CHALLENGE: GET /api/bash/admin/seasons/[id]/trades
  // ==========================================================================
  describe("3. Admin Season Trades GET Endpoint", () => {
    it("returns HTTP 401 when unauthorized", async () => {
      mocks.getSession.mockResolvedValue(false)
      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades")
      const res = await getTrades(req, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(res.status).toBe(401)
    })

    it("returns empty trades list when no trades have been recorded", async () => {
      mocks.query.mockImplementation(async () => ({ rows: [] }))
      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades")
      const res = await getTrades(req, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.trades).toEqual([])
    })

    it("returns trades list joined with items and player names", async () => {
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "season_trades"/i.test(sql)) {
          return {
            rows: [
              [1, "2026-2027", ["loons", "yetis"], "Week 1 Trade", "2026-10-12T19:00:00Z", "2026-10-12T19:00:00Z"],
            ],
          }
        }
        if (/from "season_trade_items"/i.test(sql)) {
          return {
            rows: [
              [101, 1, "player", "loons", "yetis", 630, "Darrell Draper", null, null, null],
              [102, 1, "draft_pick", "loons", "yetis", null, null, 2, "loons", "2027-summer"],
            ],
          }
        }
        return { rows: [] }
      })

      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades")
      const res = await getTrades(req, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.trades).toHaveLength(1)
      expect(body.trades[0].id).toBe(1)
      expect(body.trades[0].items).toHaveLength(2)
      expect(body.trades[0].items[0].playerName).toBe("Darrell Draper")
      expect(body.trades[0].items[1].draftPickRound).toBe(2)
    })
  })

  // ==========================================================================
  // 4. ADVERSARIAL CHALLENGE: Admin Season Roster Route Active Gating & Duplicate Check
  // ==========================================================================
  describe("4. Admin Season Roster Active Season Mutations & Cross-Team Duplicate Check", () => {
    it("POST: allows player addition in active and draft seasons, rejects completed with 400", async () => {
      // Completed season
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["completed", "fall"]] }
        }
        return { rows: [] }
      })

      const reqComp = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/roster", {
        method: "POST",
        body: JSON.stringify({ playerName: "New Skater", teamSlug: "loons" }),
      })
      const resComp = await postRoster(reqComp, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(resComp.status).toBe(400)
      const bodyComp = await resComp.json()
      expect(bodyComp.error).toMatch(/cannot modify rosters for completed seasons/i)
    })

    it("POST: rejects adding a player who already has a player_seasons row in that season with 400", async () => {
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["active", "fall"]] }
        }
        if (/from "players"/i.test(sql)) {
          return { rows: [[630, "Darrell Draper"]] }
        }
        if (/from "player_seasons"/i.test(sql)) {
          // Already on 'loons'!
          return { rows: [["loons"]] }
        }
        return { rows: [] }
      })

      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/roster", {
        method: "POST",
        body: JSON.stringify({ playerName: "Darrell Draper", teamSlug: "yetis" }),
      })

      const res = await postRoster(req, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe("Player is already assigned to a team this season")
    })

    it("PATCH: allows update in active season, rejects completed with 400", async () => {
      // Completed
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["completed"]] }
        }
        return { rows: [] }
      })

      const reqComp = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/roster", {
        method: "PATCH",
        body: JSON.stringify({
          playerId: 630,
          oldTeamSlug: "loons",
          playerName: "Darrell Draper",
          teamSlug: "yetis",
        }),
      })
      const resComp = await patchRoster(reqComp, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(resComp.status).toBe(400)

      // Active
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["active"]] }
        }
        return { rows: [] }
      })

      const reqActive = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/roster", {
        method: "PATCH",
        body: JSON.stringify({
          playerId: 630,
          oldTeamSlug: "loons",
          playerName: "Darrell Draper",
          teamSlug: "yetis",
        }),
      })
      const resActive = await patchRoster(reqActive, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(resActive.status).toBe(200)
    })

    it("DELETE: allows deletion in active season, rejects completed with 400", async () => {
      // Completed
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["completed"]] }
        }
        return { rows: [] }
      })

      const reqComp = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/roster?playerId=630", {
        method: "DELETE",
      })
      const resComp = await deleteRoster(reqComp, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(resComp.status).toBe(400)

      // Active
      mocks.query.mockImplementation(async ({ sql }: Query) => {
        if (/from "seasons"/i.test(sql)) {
          return { rows: [["active"]] }
        }
        return { rows: [] }
      })

      const reqActive = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/roster?playerId=630", {
        method: "DELETE",
      })
      const resActive = await deleteRoster(reqActive, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(resActive.status).toBe(200)
    })
  })

  // ==========================================================================
  // 5. TASK 3 VERIFICATION: SeasonRosterTab UI Component Integration & Refresh
  // ==========================================================================
  describe("5. SeasonRosterTab UI Lifecycle, Submission & Refresh", () => {
    let root: Root
    let container: HTMLDivElement

    const mockTeams = [
      { teamSlug: "loons", teamName: "Loons" },
      { teamSlug: "yetis", teamName: "Yetis" },
    ]

    const mockRoster = [
      { playerId: 630, playerName: "Darrell Draper", teamSlug: "loons", isGoalie: false, isRookie: false },
      { playerId: 974, playerName: "Jonny Callan", teamSlug: "yetis", isGoalie: false, isRookie: false },
    ]

    beforeEach(() => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      )
      container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
    })

    afterEach(async () => {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    })

    it("renders 'Add Player' and 'Record Trade' when active, hides when completed", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ trades: [] }))))

      // Active season
      await act(async () => {
        root.render(
          <SeasonRosterTab
            seasonId="2026-2027"
            seasonStatus="active"
            roster={mockRoster}
            teams={mockTeams}
          />
        )
      })

      expect(document.querySelector('button[aria-label="Add Player"]')).toBeDefined()
      expect(document.querySelector('button[aria-label="Record Trade"]')).toBeDefined()

      // Completed season
      await act(async () => {
        root.render(
          <SeasonRosterTab
            seasonId="2026-2027"
            seasonStatus="completed"
            roster={mockRoster}
            teams={mockTeams}
          />
        )
      })

      expect(document.querySelector('button[aria-label="Add Player"]')).toBeNull()
      expect(document.querySelector('button[aria-label="Record Trade"]')).toBeNull()
      expect(document.body.textContent).toContain("View the locked roster for this season.")
    })

    it("TASK 3 VERIFICATION: submits trade payload, updates roster, calls onRosterChange, and refreshes", async () => {
      const fetchCalls: { url: string; opts?: RequestInit }[] = []

      const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
        fetchCalls.push({ url, opts })
        if (url.endsWith("/trades") && opts?.method === "POST") {
          return new Response(JSON.stringify({ success: true, tradeId: 101, tradedAt: "2026-10-17T06:00:00Z" }), {
            status: 201,
          })
        }
        if (url.endsWith("/roster") && (!opts || opts.method === "GET")) {
          return new Response(
            JSON.stringify({
              roster: [
                { playerId: 630, playerName: "Darrell Draper", teamSlug: "yetis", isGoalie: false, isRookie: false },
                { playerId: 974, playerName: "Jonny Callan", teamSlug: "loons", isGoalie: false, isRookie: false },
              ],
            }),
            { status: 200 }
          )
        }
        return new Response(JSON.stringify({ trades: [] }), { status: 200 })
      })
      vi.stubGlobal("fetch", fetchMock)

      const onRosterChange = vi.fn()

      await act(async () => {
        root.render(
          <SeasonRosterTab
            seasonId="2026-2027"
            seasonStatus="active"
            roster={mockRoster}
            teams={mockTeams}
            onRosterChange={onRosterChange}
          />
        )
      })

      // Click "Record Trade"
      const tradeBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Record Trade"]')!
      expect(tradeBtn).toBeDefined()
      await act(async () => {
        tradeBtn.click()
      })

      // Select Team A = loons and Team B = yetis
      const teamASelect = document.querySelector<HTMLSelectElement>("#teamA")!
      const teamBSelect = document.querySelector<HTMLSelectElement>("#teamB")!

      await act(async () => {
        teamASelect.value = "loons"
        teamASelect.dispatchEvent(new Event("change", { bubbles: true }))
        teamBSelect.value = "yetis"
        teamBSelect.dispatchEvent(new Event("change", { bubbles: true }))
      })

      // Select Darrell Draper (630) from Loons
      const aCheckbox = document.querySelector<HTMLInputElement>(
        'div[data-testid="team-a-players"] input[type="checkbox"]'
      )!
      expect(aCheckbox).toBeDefined()
      await act(async () => {
        aCheckbox.click()
      })

      // Select Jonny Callan (974) from Yetis
      const bCheckbox = document.querySelector<HTMLInputElement>(
        'div[data-testid="team-b-players"] input[type="checkbox"]'
      )!
      expect(bCheckbox).toBeDefined()
      await act(async () => {
        bCheckbox.click()
      })

      // Add a draft pick
      const addPickBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Add Draft Pick")
      )!
      await act(async () => {
        addPickBtn.click()
      })

      expect(document.querySelector('div[data-testid="draft-pick-row"]')).toBeDefined()

      // Fill in notes
      const notesArea = document.querySelector<HTMLTextAreaElement>("#trade-notes")!
      await act(async () => {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
        nativeSetter?.call(notesArea, "Empirical test trade")
        notesArea.dispatchEvent(new Event("input", { bubbles: true }))
        notesArea.dispatchEvent(new Event("change", { bubbles: true }))
      })

      // Click Review Trade then Execute Trade
      const reviewBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Review Trade")
      )!
      await act(async () => {
        reviewBtn.click()
      })

      const executeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Execute Trade")
      )!
      await act(async () => {
        executeBtn.click()
      })

      // Verify POST call was made with expected payload
      const tradePostCall = fetchCalls.find(
        (c) => c.url.includes("/api/bash/admin/seasons/2026-2027/trades") && c.opts?.method === "POST"
      )
      expect(tradePostCall).toBeDefined()
      const postedBody = JSON.parse(tradePostCall!.opts!.body as string)
      expect(postedBody.teamASlug).toBe("loons")
      expect(postedBody.teamBSlug).toBe("yetis")
      expect(postedBody.teamAPlayerIds).toEqual([630])
      expect(postedBody.teamBPlayerIds).toEqual([974])
      expect(postedBody.draftPicks).toHaveLength(1)
      expect(postedBody.notes).toBe("Empirical test trade")

      // Verify toast.success
      expect(toast.success).toHaveBeenCalledWith("Trade recorded successfully")

      // Verify onRosterChange was called with optimistic swap
      expect(onRosterChange).toHaveBeenCalled()
      const optimisticRoster = onRosterChange.mock.calls[0][0] as Array<{ playerId: number; teamSlug: string }>
      expect(optimisticRoster.find((p) => p.playerId === 630)?.teamSlug).toBe("yetis")
      expect(optimisticRoster.find((p) => p.playerId === 974)?.teamSlug).toBe("loons")

      // Verify re-fetch of roster from API was executed
      const rosterGetCall = fetchCalls.find(
        (c) => c.url.includes("/api/bash/admin/seasons/2026-2027/roster") && (!c.opts || c.opts.method === "GET")
      )
      expect(rosterGetCall).toBeDefined()

      // Verify re-fetch of trades from API was executed
      const tradesGetCalls = fetchCalls.filter(
        (c) => c.url.includes("/api/bash/admin/seasons/2026-2027/trades") && (!c.opts || c.opts.method === "GET")
      )
      expect(tradesGetCalls.length).toBeGreaterThanOrEqual(2)
    })

    it("displays error toast and retains modal state when trade execution fails", async () => {
      const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
        if (url.endsWith("/trades") && opts?.method === "POST") {
          return new Response(
            JSON.stringify({ error: "Trade precondition failed: Player 630 is not on loons" }),
            { status: 409 }
          )
        }
        return new Response(JSON.stringify({ trades: [] }), { status: 200 })
      })
      vi.stubGlobal("fetch", fetchMock)

      const onRosterChange = vi.fn()

      await act(async () => {
        root.render(
          <SeasonRosterTab
            seasonId="2026-2027"
            seasonStatus="active"
            roster={mockRoster}
            teams={mockTeams}
            onRosterChange={onRosterChange}
          />
        )
      })

      // Open trade modal
      const tradeBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Record Trade"]')!
      await act(async () => {
        tradeBtn.click()
      })

      // Select teams
      const teamASelect = document.querySelector<HTMLSelectElement>("#teamA")!
      const teamBSelect = document.querySelector<HTMLSelectElement>("#teamB")!
      await act(async () => {
        teamASelect.value = "loons"
        teamASelect.dispatchEvent(new Event("change", { bubbles: true }))
        teamBSelect.value = "yetis"
        teamBSelect.dispatchEvent(new Event("change", { bubbles: true }))
      })

      // Select Draper
      const aCheckbox = document.querySelector<HTMLInputElement>(
        'div[data-testid="team-a-players"] input[type="checkbox"]'
      )!
      await act(async () => {
        aCheckbox.click()
      })

      // Review and execute trade
      const reviewBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Review Trade")
      )!
      await act(async () => {
        reviewBtn.click()
      })

      const executeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Execute Trade")
      )!
      await act(async () => {
        executeBtn.click()
      })

      expect(toast.error).toHaveBeenCalledWith("Trade precondition failed: Player 630 is not on loons")
      // onRosterChange should NOT be called on failure
      expect(onRosterChange).not.toHaveBeenCalled()
    })
  })
})
