import { NextRequest, NextResponse } from "next/server"
import { db, schema, rawSql } from "@/lib/db"
import { eq, and, sql } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; gameId: string }>
}

// GET /api/bash/admin/seasons/[id]/adhoc/[gameId]/roster — list ad-hoc roster
export async function GET(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { gameId } = await context.params

  try {
    const rows = await rawSql(sql`
      SELECT agr.player_id, agr.team_side, p.name
      FROM adhoc_game_rosters agr
      JOIN players p ON agr.player_id = p.id
      WHERE agr.game_id = ${gameId}
      ORDER BY agr.team_side, p.name
    `)

    return NextResponse.json({
      roster: rows.map((r) => ({
        playerId: r.player_id,
        name: r.name,
        teamSide: r.team_side,
      })),
    })
  } catch (err) {
    console.error("Failed to fetch adhoc roster:", err)
    return NextResponse.json({ error: "Failed to fetch roster" }, { status: 500 })
  }
}

// PUT /api/bash/admin/seasons/[id]/adhoc/[gameId]/roster — bulk upsert roster
// Body: { players: [{ playerId: number, teamSide: "home" | "away" }] }
export async function PUT(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { gameId } = await context.params

  try {
    const { players } = await request.json()

    if (!Array.isArray(players)) {
      return NextResponse.json({ error: "players must be an array" }, { status: 400 })
    }

    // Verify game exists and is exhibition/tryout
    const gameRows = await db
      .select({ gameType: schema.games.gameType })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }
    if (gameRows[0].gameType !== "exhibition" && gameRows[0].gameType !== "tryout") {
      return NextResponse.json({ error: "Roster only available for exhibition/tryout games" }, { status: 400 })
    }

    // Clear existing roster then insert new one (idempotent)
    await db
      .delete(schema.adhocGameRosters)
      .where(eq(schema.adhocGameRosters.gameId, gameId))

    if (players.length > 0) {
      const values = players.map((p: { playerId: number; teamSide: string }) => ({
        gameId,
        playerId: p.playerId,
        teamSide: p.teamSide,
      }))
      await db.insert(schema.adhocGameRosters).values(values)
    }

    return NextResponse.json({ ok: true, count: players.length })
  } catch (err) {
    console.error("Failed to update adhoc roster:", err)
    return NextResponse.json({ error: "Failed to update roster" }, { status: 500 })
  }
}

// POST /api/bash/admin/seasons/[id]/adhoc/[gameId]/roster — add single player
// Body: { playerId: number, teamSide: "home" | "away" }
export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { gameId } = await context.params

  try {
    const { playerId, teamSide } = await request.json()

    if (!playerId || !teamSide) {
      return NextResponse.json({ error: "playerId and teamSide are required" }, { status: 400 })
    }

    await db.insert(schema.adhocGameRosters).values({
      gameId,
      playerId,
      teamSide,
    }).onConflictDoUpdate({
      target: [schema.adhocGameRosters.gameId, schema.adhocGameRosters.playerId],
      set: { teamSide },
    })

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    console.error("Failed to add player to adhoc roster:", err)
    return NextResponse.json({ error: "Failed to add player" }, { status: 500 })
  }
}

// DELETE /api/bash/admin/seasons/[id]/adhoc/[gameId]/roster — remove single player
// Body: { playerId: number }
export async function DELETE(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { gameId } = await context.params

  try {
    const { playerId } = await request.json()

    if (!playerId) {
      return NextResponse.json({ error: "playerId is required" }, { status: 400 })
    }

    await db
      .delete(schema.adhocGameRosters)
      .where(
        and(
          eq(schema.adhocGameRosters.gameId, gameId),
          eq(schema.adhocGameRosters.playerId, playerId)
        )
      )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to remove player from adhoc roster:", err)
    return NextResponse.json({ error: "Failed to remove player" }, { status: 500 })
  }
}
