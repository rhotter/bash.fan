import { NextResponse } from "next/server"
import { fetchPlayerStats } from "@/lib/fetch-player-stats"
import { fetchTeamStats } from "@/lib/fetch-team-stats"

export type { SkaterStat, GoalieStat, PlayerStatsData, TeamSkaterStat, TeamGoalieStat, TeamStatsData } from "@/lib/fetch-player-stats"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const seasonParam = searchParams.get("season")
    const playoff = searchParams.get("playoff") === "true"
    const seasonType = searchParams.get("seasonType") || "fall"
    const gameType = searchParams.get("gameType") || undefined
    const [result, teamStats] = await Promise.all([
      fetchPlayerStats(seasonParam, playoff, seasonType, gameType),
      fetchTeamStats(seasonParam, playoff, seasonType, gameType),
    ])

    return NextResponse.json(
      {
        ...result,
        teamSkaters: teamStats.teamSkaters,
        teamGoalies: teamStats.teamGoalies,
      },
      {
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
      }
    )
  } catch (error) {
    console.error("Failed to fetch player stats:", error)
    return NextResponse.json(
      { error: "Failed to fetch player stats", skaters: [], goalies: [], teamSkaters: [], teamGoalies: [], teams: [], lastUpdated: new Date().toISOString() },
      { status: 500 },
    )
  }
}
