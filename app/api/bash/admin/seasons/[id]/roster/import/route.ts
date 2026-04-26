import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { getSession } from "@/lib/admin-session"
import { eq, inArray } from "drizzle-orm"

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

    const uniqueNames = Array.from(new Set(players.map((p: { playerName: string }) => p.playerName)))

    // 1. If Overwrite, wipe the existing roster for this season
    if (mode === "overwrite") {
      await db.delete(schema.playerSeasons).where(eq(schema.playerSeasons.seasonId, seasonId))
    }

    // 2. Ensure all players exist globally (upsert — do nothing if name exists)
    const playerInserts = uniqueNames.map(name => ({ name }))
    await db.insert(schema.players)
      .values(playerInserts)
      .onConflictDoNothing({ target: schema.players.name })

    // 3. Fetch all relevant player IDs
    const dbPlayers = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)
      .where(inArray(schema.players.name, uniqueNames))

    const nameToIdMap = new Map(dbPlayers.map(p => [p.name, p.id]))

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

    for (const p of players) {
      const pId = nameToIdMap.get(p.playerName) as number

      // Skip if already assigned this season, or if we already processed them in this file loop
      if ((mode === "append" && existingAssignedIds.has(pId)) || processedIds.has(pId)) {
        continue
      }

      processedIds.add(pId)
      seasonInserts.push({
        playerId: pId,
        seasonId,
        teamSlug: p.teamSlug,
        isGoalie: p.isGoalie,
        isRookie: p.isRookie,
      })
    }

    if (seasonInserts.length > 0) {
      await db.insert(schema.playerSeasons).values(seasonInserts)
    }

    return NextResponse.json({ ok: true, count: players.length })

  } catch (error: unknown) {
    console.error("Failed to import Sportability roster:", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Failed to import roster." }, { status: 500 })
  }
}
