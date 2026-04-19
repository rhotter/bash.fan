import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { count } from "drizzle-orm"
import { getAllSeasons, getCurrentSeason } from "@/lib/seasons"

export interface SeasonInfo {
  id: string
  name: string
  isCurrent: boolean
  hasGames: boolean
  hasStats: boolean
}

export interface SeasonsData {
  seasons: SeasonInfo[]
}

export async function GET() {
  try {
    // Check which seasons have games or stats in the DB
    const [dbSeasons, dbStats] = await Promise.all([
      db
        .select({
          seasonId: schema.games.seasonId,
          gameCount: count().mapWith(Number).as("game_count"),
        })
        .from(schema.games)
        .groupBy(schema.games.seasonId),
      db
        .selectDistinct({ seasonId: schema.playerSeasonStats.seasonId })
        .from(schema.playerSeasonStats),
    ])

    const seasonGameCounts = new Map<string, number>()
    for (const row of dbSeasons) {
      seasonGameCounts.set(row.seasonId, row.gameCount)
    }
    const seasonsWithStats = new Set<string>()
    for (const row of dbStats) {
      seasonsWithStats.add(row.seasonId)
    }

    const allSeasons = await getAllSeasons() // newest first
    const currentSeason = await getCurrentSeason()
    const seasons: SeasonInfo[] = allSeasons.map((s) => ({
      id: s.id,
      name: s.name,
      isCurrent: s.id === currentSeason.id,
      hasGames: (seasonGameCounts.get(s.id) ?? 0) > 0,
      hasStats: seasonsWithStats.has(s.id),
    }))

    return NextResponse.json({ seasons } satisfies SeasonsData, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    })
  } catch (error) {
    console.error("Failed to fetch seasons:", error)
    return NextResponse.json({ seasons: [] }, { status: 500 })
  }
}
