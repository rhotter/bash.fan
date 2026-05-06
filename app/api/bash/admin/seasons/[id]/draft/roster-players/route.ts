import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET — List roster players for captain picker in the draft wizard.
 * Returns a lightweight array of { playerId, playerName, teamSlug }
 * from player_seasons joined with players for the given season.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  const rows = await db
    .select({
      playerId: schema.playerSeasons.playerId,
      playerName: schema.players.name,
      teamSlug: schema.playerSeasons.teamSlug,
    })
    .from(schema.playerSeasons)
    .innerJoin(schema.players, eq(schema.players.id, schema.playerSeasons.playerId))
    .where(eq(schema.playerSeasons.seasonId, seasonId))
    .orderBy(schema.players.name)

  return NextResponse.json({ players: rows })
}
