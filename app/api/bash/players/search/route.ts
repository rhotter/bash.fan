import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, asc } from "drizzle-orm"
import { getCurrentSeason } from "@/lib/seasons"
import { playerSlug } from "@/lib/player-slug"

export interface PlayerSearchResult {
  name: string
  slug: string
  team: string
  teamSlug: string
}

export async function GET() {
  try {
    const season = await getCurrentSeason()
    const rows = await db
      .selectDistinct({
        name: schema.players.name,
        team: schema.teams.name,
        teamSlug: schema.teams.slug,
      })
      .from(schema.players)
      .innerJoin(
        schema.playerSeasons,
        eq(schema.playerSeasons.playerId, schema.players.id)
      )
      .innerJoin(
        schema.teams,
        eq(schema.teams.slug, schema.playerSeasons.teamSlug)
      )
      .where(eq(schema.playerSeasons.seasonId, season.id))
      .orderBy(asc(schema.players.name))

    const players: PlayerSearchResult[] = rows.map((r) => ({
      name: r.name,
      slug: playerSlug(r.name),
      team: r.team,
      teamSlug: r.teamSlug,
    }))

    return NextResponse.json({ players }, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    })
  } catch (error) {
    console.error("Failed to search players:", error)
    return NextResponse.json({ players: [] }, { status: 500 })
  }
}
