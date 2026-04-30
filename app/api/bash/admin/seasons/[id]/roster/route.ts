import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, ilike, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  try {
    const { playerName, teamSlug, isGoalie } = await request.json()

    if (!playerName || !teamSlug) {
      return NextResponse.json({ error: "Player name and team are required" }, { status: 400 })
    }

    // Verify season is draft
    const [season] = await db
      .select({ status: schema.seasons.status, seasonType: schema.seasons.seasonType })
      .from(schema.seasons)
      .where(eq(schema.seasons.id, seasonId))
      .limit(1)

    if (!season) {
      return NextResponse.json({ error: "Season not found" }, { status: 404 })
    }
    if (season.status !== "draft") {
      return NextResponse.json({ error: "Can only add players to draft seasons" }, { status: 400 })
    }

    // 1. Find or create player. Rookie status is derived on read, not stored.
    let playerId: number

    const existingPlayers = await db
      .select({ id: schema.players.id })
      .from(schema.players)
      .where(ilike(schema.players.name, playerName))
      .limit(1)

    if (existingPlayers.length > 0) {
      playerId = existingPlayers[0].id
    } else {
      const [newPlayer] = await db
        .insert(schema.players)
        .values({ name: playerName })
        .returning({ id: schema.players.id })
      playerId = newPlayer.id
    }

    // 2. Add to roster
    await db.insert(schema.playerSeasons).values({
      playerId,
      seasonId,
      teamSlug,
      isGoalie: isGoalie ?? false,
    })

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err: unknown) {
    // If unique constraint violation (player already on a team this season)
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
        return NextResponse.json({ error: "Player is already assigned to a team this season" }, { status: 400 })
    }
    console.error("Failed to add player:", err)
    return NextResponse.json({ error: "Failed to add player" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  try {
    const { playerId, oldTeamSlug, playerName, teamSlug, isGoalie } = await request.json()

    if (!playerId || !oldTeamSlug || !playerName || !teamSlug) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Update global player name
    await db
      .update(schema.players)
      .set({ name: playerName })
      .where(eq(schema.players.id, playerId))

    // Update player_seasons record
    await db
      .update(schema.playerSeasons)
      .set({
        teamSlug,
        isGoalie: isGoalie ?? false,
      })
      .where(
        and(
          eq(schema.playerSeasons.playerId, playerId),
          eq(schema.playerSeasons.seasonId, seasonId),
          eq(schema.playerSeasons.teamSlug, oldTeamSlug)
        )
      )

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: "Player is already assigned to this team" }, { status: 400 })
    }
    console.error("Failed to update player:", err)
    return NextResponse.json({ error: "Failed to update player" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params
  const url = new URL(request.url)
  const playerId = url.searchParams.get("playerId")

  if (!playerId) {
    return NextResponse.json({ error: "playerId is required" }, { status: 400 })
  }

  try {
    await db
      .delete(schema.playerSeasons)
      .where(
        and(
          eq(schema.playerSeasons.playerId, parseInt(playerId)),
          eq(schema.playerSeasons.seasonId, seasonId)
        )
      )

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error("Failed to remove player from season:", err)
    return NextResponse.json({ error: "Failed to remove player" }, { status: 500 })
  }
}
