import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and, inArray } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; draftId: string }>
}

// GET — List pool players
export async function GET(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { draftId } = await context.params

  const pool = await db
    .select({
      playerId: schema.draftPool.playerId,
      playerName: schema.players.name,
      isKeeper: schema.draftPool.isKeeper,
      keeperTeamSlug: schema.draftPool.keeperTeamSlug,
      keeperRound: schema.draftPool.keeperRound,
      isGoalie: schema.playerSeasons.isGoalie,
    })
    .from(schema.draftPool)
    .innerJoin(schema.players, eq(schema.draftPool.playerId, schema.players.id))
    .leftJoin(
      schema.playerSeasons,
      and(
        eq(schema.playerSeasons.playerId, schema.draftPool.playerId),
        eq(schema.playerSeasons.seasonId, schema.draftInstances.seasonId)
      )
    )
    .innerJoin(schema.draftInstances, eq(schema.draftInstances.id, schema.draftPool.draftId))
    .where(eq(schema.draftPool.draftId, draftId))
    .orderBy(schema.players.name)

  return NextResponse.json({ pool })
}

// POST — Add players to pool
export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { draftId } = await context.params

  // Verify draft is in draft status
  const [draft] = await db
    .select()
    .from(schema.draftInstances)
    .where(eq(schema.draftInstances.id, draftId))
    .limit(1)

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  }

  if (draft.status !== "draft") {
    return NextResponse.json({ error: "Can only modify pool in draft status" }, { status: 400 })
  }

  try {
    const { playerIds } = await request.json() as { playerIds: number[] }

    if (!playerIds || !Array.isArray(playerIds) || playerIds.length === 0) {
      return NextResponse.json({ error: "playerIds array required" }, { status: 400 })
    }

    // Validate players exist
    const players = await db
      .select({ id: schema.players.id })
      .from(schema.players)
      .where(inArray(schema.players.id, playerIds))

    const validIds = new Set(players.map((p) => p.id))

    // Filter to only valid, non-duplicate entries
    const existingPool = await db
      .select({ playerId: schema.draftPool.playerId })
      .from(schema.draftPool)
      .where(eq(schema.draftPool.draftId, draftId))

    const existingIds = new Set(existingPool.map((p) => p.playerId))
    const newIds = playerIds.filter((id) => validIds.has(id) && !existingIds.has(id))

    if (newIds.length > 0) {
      await db.insert(schema.draftPool).values(
        newIds.map((playerId) => ({
          draftId,
          playerId,
        }))
      )
    }

    return NextResponse.json({
      added: newIds.length,
      skipped: playerIds.length - newIds.length,
    })
  } catch (err) {
    console.error("Failed to add to pool:", err)
    return NextResponse.json({ error: "Failed to add players" }, { status: 500 })
  }
}

// DELETE — Remove a player from pool
export async function DELETE(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { draftId } = await context.params

  try {
    const { playerId } = await request.json() as { playerId: number }

    await db
      .delete(schema.draftPool)
      .where(
        and(
          eq(schema.draftPool.draftId, draftId),
          eq(schema.draftPool.playerId, playerId)
        )
      )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to remove from pool:", err)
    return NextResponse.json({ error: "Failed to remove player" }, { status: 500 })
  }
}
