import { NextResponse } from "next/server"
import { fetchPlayerStats } from "@/lib/fetch-player-stats"

export type { SkaterStat, GoalieStat, PlayerStatsData } from "@/lib/fetch-player-stats"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const seasonParam = searchParams.get("season")
    const playoff = searchParams.get("playoff") === "true"
    const result = await fetchPlayerStats(seasonParam, playoff)

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("Failed to fetch player stats:", error)
    return NextResponse.json(
      { error: "Failed to fetch player stats", skaters: [], goalies: [], teams: [], lastUpdated: new Date().toISOString() },
      { status: 500 },
    )
  }
}
