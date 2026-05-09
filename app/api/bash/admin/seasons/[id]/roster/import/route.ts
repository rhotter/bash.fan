import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { getSession } from "@/lib/admin-session"
import { eq, inArray } from "drizzle-orm"
import { canonicalizePlayerName, normalizePlayerName } from "@/lib/player-name"

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
    const { mode, players } = await request.json()

    if (!mode || !players || !Array.isArray(players)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    if (players.length === 0) {
      return NextResponse.json({ ok: true, count: 0 })
    }

    const normalizedPlayers = players
      .map((player: { playerName: string; teamSlug: string; isGoalie: boolean; isCaptain: boolean; isRookie: boolean; registrationMeta?: Record<string, unknown> }) => ({
        ...player,
        playerName: canonicalizePlayerName(player.playerName),
      }))
      .filter((player) => player.playerName.length > 0)

    const uniqueNamesByNormalized = new Map<string, string>()
    for (const player of normalizedPlayers) {
      const normalizedName = normalizePlayerName(player.playerName)
      if (!uniqueNamesByNormalized.has(normalizedName)) {
        uniqueNamesByNormalized.set(normalizedName, player.playerName)
      }
    }

    // 1. If Overwrite, wipe the existing roster for this season
    if (mode === "overwrite") {
      await db.delete(schema.playerSeasons).where(eq(schema.playerSeasons.seasonId, seasonId))
    }

    // 2. Ensure all players exist globally (upsert — do nothing if name exists)
    const existingPlayers = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)

    const existingPlayersByNormalized = new Map<string, { id: number; name: string }>()
    for (const player of existingPlayers) {
      const normalizedName = normalizePlayerName(player.name)
      if (!existingPlayersByNormalized.has(normalizedName)) {
        existingPlayersByNormalized.set(normalizedName, player)
      }
    }

    const namesToInsert = Array.from(uniqueNamesByNormalized.entries())
      .filter(([normalizedName]) => !existingPlayersByNormalized.has(normalizedName))
      .map(([, name]) => ({ name }))

    if (namesToInsert.length > 0) {
      await db.insert(schema.players).values(namesToInsert)
    }

    // 3. Fetch all relevant player IDs after inserting any missing players.
    const dbPlayers = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)
      .where(inArray(schema.players.name, Array.from(uniqueNamesByNormalized.values())))

    const nameToIdMap = new Map(
      dbPlayers.map((player) => [normalizePlayerName(player.name), player.id])
    )

    // 4. If Append, find who is already assigned so we can skip them
    let existingAssignedIds = new Set<number>()
    if (mode === "append") {
      const existingAssignments = await db
        .select({ playerId: schema.playerSeasons.playerId })
        .from(schema.playerSeasons)
        .where(eq(schema.playerSeasons.seasonId, seasonId))
      existingAssignedIds = new Set(existingAssignments.map(a => a.playerId))
    }

    // 5. Build player_seasons inserts
    const seasonInserts = []
    const processedIds = new Set<number>()

    for (const player of normalizedPlayers) {
      const pId = nameToIdMap.get(normalizePlayerName(player.playerName))

      if (!pId) {
        continue
      }

      // Skip if already assigned this season, or if we already processed them in this file loop
      if ((mode === "append" && existingAssignedIds.has(pId)) || processedIds.has(pId)) {
        continue
      }

      processedIds.add(pId)
      seasonInserts.push({
        playerId: pId,
        seasonId,
        teamSlug: player.teamSlug,
        isGoalie: player.isGoalie,
        isCaptain: player.isCaptain,
        isRookie: player.isRookie,
        registrationMeta: player.registrationMeta || null,
      })
    }

    if (seasonInserts.length > 0) {
      await db.insert(schema.playerSeasons).values(seasonInserts)
    }

    return NextResponse.json({ ok: true, count: seasonInserts.length })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("Failed to import Sportability roster:", message)
    return NextResponse.json(
      { error: `Import failed: ${message}` },
      { status: 500 }
    )
  }
}
