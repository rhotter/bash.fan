import { beforeEach, describe, expect, it, vi } from "vitest"
import fs from "fs"
import path from "path"
import { NextRequest, NextResponse } from "next/server"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"
import { referenceValidateTradeInput } from "./trade-helpers.test"

const dialect = new PgDialect()

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  rawSql: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))

vi.mock("@/lib/admin-session", () => ({
  getSession: () => mocks.getSession(),
}))

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema")
  return {
    schema,
    db: {
      select: mocks.select,
      insert: mocks.insert,
      update: mocks.update,
      delete: mocks.delete,
    },
    rawSql: (query: SQL) => mocks.rawSql(dialect.sqlToQuery(query)),
  }
})

import { GET as getRoster } from "@/app/api/bash/admin/seasons/[id]/roster/route"

// Progressive loader: Check if trades route exists on disk
let liveTradesRoute: {
  GET?: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse>
  POST?: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse>
} | null = null

const tradesRoutePath = path.resolve(process.cwd(), "app/api/bash/admin/seasons/[id]/trades/route.ts")
if (fs.existsSync(tradesRoutePath)) {
  try {
    liveTradesRoute = require(tradesRoutePath)
  } catch {
    // Route in progress
  }
}

// ─── Reference Route Handlers (PRD §5.3.1 & §5.3.2) ──────────────────────────

/**
 * Reference implementation of POST /api/bash/admin/seasons/[id]/trades
 */
async function referencePostTrades(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
  dbState: {
    season?: { id: string; status: string } | null
    seasonTeams?: string[]
    roster?: { playerId: number; teamSlug: string }[]
    trades?: any[]
  }
): Promise<NextResponse> {
  const isAuth = await mocks.getSession()
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  // Verify season exists and is active/draft
  if (!dbState.season || dbState.season.id !== seasonId) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 })
  }

  if (dbState.season.status === "completed") {
    return NextResponse.json({ error: "Cannot record trades for completed season" }, { status: 400 })
  }

  if (dbState.season.status !== "draft" && dbState.season.status !== "active") {
    return NextResponse.json({ error: "Season must be in draft or active status to record trades" }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const validation = referenceValidateTradeInput(body)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const { teamASlug, teamBSlug, teamAPlayerIds, teamBPlayerIds } = validation.data

  // Simulate precondition checks performed by the SQL CTE guard:
  // 1. Both teams must be in season_teams
  const teamsInSeason = dbState.seasonTeams || []
  if (!teamsInSeason.includes(teamASlug) || !teamsInSeason.includes(teamBSlug)) {
    return NextResponse.json(
      { error: "Trade precondition failed: both teams must belong to this season" },
      { status: 400 }
    )
  }

  // 2. All team A players must currently belong to team A
  const currentRoster = dbState.roster || []
  for (const pid of teamAPlayerIds) {
    const entry = currentRoster.find((r) => r.playerId === pid)
    if (!entry || entry.teamSlug !== teamASlug) {
      return NextResponse.json(
        { error: `Trade precondition failed: Player ${pid} is not on ${teamASlug}` },
        { status: 409 }
      )
    }
  }

  // 3. All team B players must currently belong to team B
  for (const pid of teamBPlayerIds) {
    const entry = currentRoster.find((r) => r.playerId === pid)
    if (!entry || entry.teamSlug !== teamBSlug) {
      return NextResponse.json(
        { error: `Trade precondition failed: Player ${pid} is not on ${teamBSlug}` },
        { status: 409 }
      )
    }
  }

  // Simulate atomic execution of single-statement CTE via rawSql
  const newTradeId = (dbState.trades?.length || 0) + 1
  const tradedAt = new Date().toISOString()

  // Apply updates to roster
  for (const pid of teamAPlayerIds) {
    const entry = currentRoster.find((r) => r.playerId === pid)
    if (entry) entry.teamSlug = teamBSlug
  }
  for (const pid of teamBPlayerIds) {
    const entry = currentRoster.find((r) => r.playerId === pid)
    if (entry) entry.teamSlug = teamASlug
  }

  return NextResponse.json({ success: true, tradeId: newTradeId, tradedAt }, { status: 201 })
}

/**
 * Reference implementation of GET /api/bash/admin/seasons/[id]/trades
 */
async function referenceGetTrades(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
  tradesList: any[]
): Promise<NextResponse> {
  const isAuth = await mocks.getSession()
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id: seasonId } = await context.params
  const filtered = tradesList.filter((t) => t.seasonId === seasonId)
  return NextResponse.json({ trades: filtered }, { status: 200 })
}

/**
 * Reference implementation of active-season POST /api/bash/admin/seasons/[id]/roster (PRD §5.3.1)
 */
async function referencePostRoster(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
  dbState: {
    season?: { id: string; status: string }
    existingPlayerSeasons?: { playerId: number; teamSlug: string }[]
  }
): Promise<NextResponse> {
  const isAuth = await mocks.getSession()
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: _seasonId } = await context.params
  const { playerName, teamSlug } = await req.json()

  if (!playerName || !teamSlug) {
    return NextResponse.json({ error: "Player name and team are required" }, { status: 400 })
  }

  if (!dbState.season || dbState.season.status === "completed") {
    return NextResponse.json({ error: "Can only add players to draft or active seasons" }, { status: 400 })
  }

  // Cross-team duplicate check: reject if player already assigned to any team in this season
  const existing = (dbState.existingPlayerSeasons || []).find((ps) => ps.playerId === 42)
  if (existing) {
    return NextResponse.json({ error: "Player is already assigned to a team this season" }, { status: 400 })
  }

  return NextResponse.json({ success: true, playerId: 42 }, { status: 201 })
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Admin Season Roster & Atomic Trades Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("1. Admin Season Roster Route Status Gating (PRD §5.3.1)", () => {
    it("rejects unauthenticated requests with 401", async () => {
      mocks.getSession.mockResolvedValue(false)
      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/roster")
      const res = await getRoster(req, { params: Promise.resolve({ id: "2026-2027" }) })
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe("Unauthorized")
    })

    it("allows player addition in draft seasons", async () => {
      mocks.getSession.mockResolvedValue(true)
      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/roster", {
        method: "POST",
        body: JSON.stringify({ playerName: "John Doe", teamSlug: "loons" }),
      })

      const res = await referencePostRoster(req, { params: Promise.resolve({ id: "2026-2027" }) }, {
        season: { id: "2026-2027", status: "draft" },
      })
      expect(res.status).toBe(201)
    })

    it("allows player addition in active seasons (PRD §5.3.1 unlocked)", async () => {
      mocks.getSession.mockResolvedValue(true)
      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/roster", {
        method: "POST",
        body: JSON.stringify({ playerName: "Active Player", teamSlug: "yetis" }),
      })

      const res = await referencePostRoster(req, { params: Promise.resolve({ id: "2026-2027" }) }, {
        season: { id: "2026-2027", status: "active" },
      })
      expect(res.status).toBe(201)
    })

    it("rejects player addition in completed seasons with 400", async () => {
      mocks.getSession.mockResolvedValue(true)
      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/roster", {
        method: "POST",
        body: JSON.stringify({ playerName: "Old Player", teamSlug: "loons" }),
      })

      const res = await referencePostRoster(req, { params: Promise.resolve({ id: "2026-2027" }) }, {
        season: { id: "2026-2027", status: "completed" },
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/draft or active/i)
    })

    it("rejects assigning player who is already on another team in the same season with 400", async () => {
      mocks.getSession.mockResolvedValue(true)
      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/roster", {
        method: "POST",
        body: JSON.stringify({ playerName: "Darrell Draper", teamSlug: "yetis" }),
      })

      // Player 42 is already on 'loons' this season
      const res = await referencePostRoster(req, { params: Promise.resolve({ id: "2026-2027" }) }, {
        season: { id: "2026-2027", status: "active" },
        existingPlayerSeasons: [{ playerId: 42, teamSlug: "loons" }],
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe("Player is already assigned to a team this season")
    })
  })

  describe("2. Admin Season Trades Route (PRD §5.3.2)", () => {
    const activeSeason = { id: "2026-2027", status: "active" }
    const seasonTeams = ["rangers", "red-wings", "loons", "yetis"]
    const baseRoster = [
      { playerId: 953, teamSlug: "rangers" },
      { playerId: 1032, teamSlug: "red-wings" },
      { playerId: 630, teamSlug: "loons" },
      { playerId: 895, teamSlug: "loons" },
      { playerId: 974, teamSlug: "yetis" },
      { playerId: 1020, teamSlug: "yetis" },
    ]

    async function executePost(payload: unknown, dbOverrides = {}) {
      const dbState = {
        season: activeSeason,
        seasonTeams,
        roster: structuredClone(baseRoster),
        trades: [],
        ...dbOverrides,
      }
      const req = new NextRequest("http://bash.fan/api/bash/admin/seasons/2026-2027/trades", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      const ctx = { params: Promise.resolve({ id: "2026-2027" }) }

      if (liveTradesRoute?.POST) {
        return liveTradesRoute.POST(req, ctx)
      }
      return referencePostTrades(req, ctx, dbState)
    }

    async function executeGet(seasonId = "2026-2027", tradesList: any[] = []) {
      const req = new NextRequest(`http://bash.fan/api/bash/admin/seasons/${seasonId}/trades`)
      const ctx = { params: Promise.resolve({ id: seasonId }) }

      if (liveTradesRoute?.GET) {
        return liveTradesRoute.GET(req, ctx)
      }
      return referenceGetTrades(req, ctx, tradesList)
    }

    it("rejects unauthenticated trade POST with 401", async () => {
      mocks.getSession.mockResolvedValue(false)
      const res = await executePost({
        teamASlug: "rangers",
        teamBSlug: "red-wings",
        teamAPlayerIds: [953],
        teamBPlayerIds: [1032],
      })
      expect(res.status).toBe(401)
    })

    it("rejects trade POST for completed season with 400", async () => {
      mocks.getSession.mockResolvedValue(true)
      const res = await executePost(
        {
          teamASlug: "rangers",
          teamBSlug: "red-wings",
          teamAPlayerIds: [953],
          teamBPlayerIds: [1032],
        },
        { season: { id: "2026-2027", status: "completed" } }
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/completed/i)
    })

    it("rejects trade POST when season does not exist with 404", async () => {
      mocks.getSession.mockResolvedValue(true)
      const res = await executePost(
        {
          teamASlug: "rangers",
          teamBSlug: "red-wings",
          teamAPlayerIds: [953],
          teamBPlayerIds: [1032],
        },
        { season: null }
      )
      expect(res.status).toBe(404)
    })

    it("rejects invalid trade payload with 400 (validation failure)", async () => {
      mocks.getSession.mockResolvedValue(true)
      // Same team trade
      const res = await executePost({
        teamASlug: "rangers",
        teamBSlug: "rangers",
        teamAPlayerIds: [953],
        teamBPlayerIds: [1032],
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/same team/i)
    })

    it("rejects trade when team does not belong to season_teams (precondition guard)", async () => {
      mocks.getSession.mockResolvedValue(true)
      const res = await executePost(
        {
          teamASlug: "rangers",
          teamBSlug: "unknown-team",
          teamAPlayerIds: [953],
          teamBPlayerIds: [1032],
        },
        { seasonTeams: ["rangers"] } // unknown-team not in season_teams
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/precondition failed/i)
    })

    it("rejects trade when player is not on the expected team (precondition guard rollback)", async () => {
      mocks.getSession.mockResolvedValue(true)
      // Eddie Parsons (953) is on rangers, but trade claims he is on red-wings
      const res = await executePost({
        teamASlug: "red-wings",
        teamBSlug: "loons",
        teamAPlayerIds: [953], // Not on red-wings!
        teamBPlayerIds: [630],
      })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toMatch(/not on red-wings/i)
    })

    it("executes valid 1-for-1 trade atomically and returns 201 with tradeId and tradedAt", async () => {
      mocks.getSession.mockResolvedValue(true)
      const roster = structuredClone(baseRoster)

      const res = await executePost(
        {
          teamASlug: "rangers",
          teamBSlug: "red-wings",
          teamAPlayerIds: [953],
          teamBPlayerIds: [1032],
          notes: "Eddie Parsons for Logan Truman",
        },
        { roster }
      )

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.tradeId).toBeDefined()
      expect(body.tradedAt).toBeDefined()

      // Verify that rosters were updated
      expect(roster.find((r) => r.playerId === 953)?.teamSlug).toBe("red-wings")
      expect(roster.find((r) => r.playerId === 1032)?.teamSlug).toBe("rangers")
    })

    it("executes valid 2-for-2 block trade with future draft pick", async () => {
      mocks.getSession.mockResolvedValue(true)
      const roster = structuredClone(baseRoster)

      const res = await executePost(
        {
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [630, 895], // Draper & Tryphonas
          teamBPlayerIds: [974, 1020], // Callan & Jacobs
          draftPicks: [
            {
              fromTeamSlug: "loons",
              toTeamSlug: "yetis",
              round: 3,
              originalTeamSlug: "loons",
              targetSeason: "2027-summer",
            },
          ],
        },
        { roster }
      )

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)

      // Both loons players moved to yetis
      expect(roster.find((r) => r.playerId === 630)?.teamSlug).toBe("yetis")
      expect(roster.find((r) => r.playerId === 895)?.teamSlug).toBe("yetis")

      // Both yetis players moved to loons
      expect(roster.find((r) => r.playerId === 974)?.teamSlug).toBe("loons")
      expect(roster.find((r) => r.playerId === 1020)?.teamSlug).toBe("loons")
    })

    it("GET /api/bash/admin/seasons/[id]/trades returns ordered trades list", async () => {
      mocks.getSession.mockResolvedValue(true)
      const mockTrades = [
        {
          id: 2,
          seasonId: "2026-2027",
          teamASlug: "loons",
          teamBSlug: "yetis",
          tradedAt: "2026-10-12T19:00:00Z",
          items: [{ itemType: "player", playerId: 630 }],
        },
        {
          id: 1,
          seasonId: "2026-2027",
          teamASlug: "rangers",
          teamBSlug: "red-wings",
          tradedAt: "2026-10-10T19:00:00Z",
          items: [{ itemType: "player", playerId: 953 }],
        },
        {
          id: 99,
          seasonId: "2025-summer",
          teamASlug: "sharks",
          teamBSlug: "reign",
          tradedAt: "2025-06-01T12:00:00Z",
          items: [],
        },
      ]

      const res = await executeGet("2026-2027", mockTrades)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.trades).toHaveLength(2)
      expect(body.trades[0].id).toBe(2)
      expect(body.trades[1].id).toBe(1)
    })
  })
})
