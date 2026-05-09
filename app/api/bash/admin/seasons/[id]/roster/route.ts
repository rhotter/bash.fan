import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, ilike, and, sql } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { canonicalizePlayerName, normalizePlayerName } from "@/lib/player-name"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  // Look up season type for rookie derivation
  const [season] = await db
    .select({ seasonType: schema.seasons.seasonType })
    .from(schema.seasons)
    .where(eq(schema.seasons.id, seasonId))
    .limit(1)

  if (!season) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 })
  }

  const isRookieExpr = season.seasonType === "fall"
    ? sql<boolean>`NOT EXISTS (
        SELECT 1 FROM player_seasons ps2
        JOIN seasons s2 ON s2.id = ps2.season_id
        WHERE ps2.player_id = players.id
          AND s2.season_type = 'fall'
          AND ps2.season_id < ${seasonId}
      )`
    : sql<boolean>`false`

  const roster = await db
    .select({
      playerId: schema.players.id,
      playerName: schema.players.name,
      teamSlug: schema.playerSeasons.teamSlug,
      isGoalie: schema.playerSeasons.isGoalie,
      isRookie: isRookieExpr,
    })
    .from(schema.playerSeasons)
    .innerJoin(schema.players, eq(schema.playerSeasons.playerId, schema.players.id))
    .where(eq(schema.playerSeasons.seasonId, seasonId))

  roster.sort((a, b) => a.playerName.localeCompare(b.playerName))

  return NextResponse.json({ roster })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  try {
    const { playerName, teamSlug, isGoalie } = await request.json()
    const canonicalPlayerName = typeof playerName === "string" ? canonicalizePlayerName(playerName) : ""

    if (!canonicalPlayerName || !teamSlug) {
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

    const exactMatch = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)
      .where(ilike(schema.players.name, canonicalPlayerName))
      .limit(1)

    const normalizedMatch = exactMatch[0]
      ? exactMatch[0]
      : (await db.select({ id: schema.players.id, name: schema.players.name }).from(schema.players))
          .find((player) => normalizePlayerName(player.name) === normalizePlayerName(canonicalPlayerName))

    if (normalizedMatch) {
      playerId = normalizedMatch.id
    } else {
      const [newPlayer] = await db
        .insert(schema.players)
        .values({ name: canonicalPlayerName })
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
    const canonicalPlayerName = typeof playerName === "string" ? canonicalizePlayerName(playerName) : ""

    if (!playerId || !oldTeamSlug || !canonicalPlayerName || !teamSlug) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Update global player name
    await db
      .update(schema.players)
      .set({ name: canonicalPlayerName })
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
