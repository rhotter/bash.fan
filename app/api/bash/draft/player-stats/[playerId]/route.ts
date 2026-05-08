import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import { eq, and, sql, desc, inArray, ne } from "drizzle-orm"
import { NextResponse } from "next/server"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ playerId: string }> }
) {
  try {
    const { playerId: playerIdStr } = await params
    const playerId = parseInt(playerIdStr, 10)

    if (isNaN(playerId)) {
      return NextResponse.json({ error: "Invalid player ID" }, { status: 400 })
    }

    // Optionally scope to a specific season via ?currentSeason=2026-summer
    const { searchParams } = new URL(req.url)
    const currentSeason = searchParams.get("currentSeason")

    // Find the player's most recent season entries (excluding the current draft season)
    const seasonEntries = await db
      .select({
        seasonId: schema.playerSeasons.seasonId,
        teamSlug: schema.playerSeasons.teamSlug,
        teamName: schema.teams.name,
        isGoalie: schema.playerSeasons.isGoalie,
        isCaptain: schema.playerSeasons.isCaptain,
        isRookie: schema.playerSeasons.isRookie,
        seasonName: schema.seasons.name,
      })
      .from(schema.playerSeasons)
      .innerJoin(schema.teams, eq(schema.playerSeasons.teamSlug, schema.teams.slug))
      .innerJoin(schema.seasons, eq(schema.playerSeasons.seasonId, schema.seasons.id))
      .where(
        currentSeason
          ? and(
              eq(schema.playerSeasons.playerId, playerId),
              ne(schema.playerSeasons.seasonId, currentSeason)
            )
          : eq(schema.playerSeasons.playerId, playerId)
      )
      .orderBy(desc(schema.playerSeasons.seasonId))
      .limit(3) // Last 3 seasons

    if (seasonEntries.length === 0) {
      return NextResponse.json({ seasons: [] }, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
      })
    }

    // For each season, aggregate their stats
    const seasonsWithStats = await Promise.all(
      seasonEntries.map(async (entry) => {
        // Get game IDs in this season
        const seasonGames = await db
          .select({ gameId: schema.games.id })
          .from(schema.games)
          .where(eq(schema.games.seasonId, entry.seasonId))

        const gameIds = seasonGames.map((g) => g.gameId)

        if (gameIds.length === 0) {
          return {
            seasonId: entry.seasonId,
            seasonName: entry.seasonName,
            teamName: entry.teamName,
            teamSlug: entry.teamSlug,
            isGoalie: entry.isGoalie,
            isCaptain: entry.isCaptain,
            stats: null,
          }
        }

        if (entry.isGoalie) {
          // Aggregate goalie stats
          const goalieStats = await db
            .select({
              gp: sql<number>`count(*)`,
              goalsAgainst: sql<number>`sum(${schema.goalieGameStats.goalsAgainst})`,
              shotsAgainst: sql<number>`sum(${schema.goalieGameStats.shotsAgainst})`,
              saves: sql<number>`sum(${schema.goalieGameStats.saves})`,
              shutouts: sql<number>`sum(${schema.goalieGameStats.shutouts})`,
            })
            .from(schema.goalieGameStats)
            .where(
              and(
                eq(schema.goalieGameStats.playerId, playerId),
                inArray(schema.goalieGameStats.gameId, gameIds)
              )
            )

          const gs = goalieStats[0]
          return {
            seasonId: entry.seasonId,
            seasonName: entry.seasonName,
            teamName: entry.teamName,
            teamSlug: entry.teamSlug,
            isGoalie: true,
            isCaptain: entry.isCaptain,
            stats: gs?.gp
              ? {
                  type: "goalie" as const,
                  gp: gs.gp,
                  goalsAgainst: gs.goalsAgainst ?? 0,
                  shotsAgainst: gs.shotsAgainst ?? 0,
                  saves: gs.saves ?? 0,
                  shutouts: gs.shutouts ?? 0,
                  savePct: gs.shotsAgainst ? ((gs.saves ?? 0) / gs.shotsAgainst * 100).toFixed(1) : "0.0",
                }
              : null,
          }
        } else {
          // Aggregate skater stats
          const skaterStats = await db
            .select({
              gp: sql<number>`count(*)`,
              goals: sql<number>`sum(${schema.playerGameStats.goals})`,
              assists: sql<number>`sum(${schema.playerGameStats.assists})`,
              points: sql<number>`sum(${schema.playerGameStats.points})`,
              gwg: sql<number>`sum(${schema.playerGameStats.gwg})`,
              pim: sql<number>`sum(${schema.playerGameStats.pim})`,
            })
            .from(schema.playerGameStats)
            .where(
              and(
                eq(schema.playerGameStats.playerId, playerId),
                inArray(schema.playerGameStats.gameId, gameIds)
              )
            )

          const ss = skaterStats[0]
          return {
            seasonId: entry.seasonId,
            seasonName: entry.seasonName,
            teamName: entry.teamName,
            teamSlug: entry.teamSlug,
            isGoalie: false,
            isCaptain: entry.isCaptain,
            stats: ss?.gp
              ? {
                  type: "skater" as const,
                  gp: ss.gp,
                  goals: ss.goals ?? 0,
                  assists: ss.assists ?? 0,
                  points: ss.points ?? 0,
                  gwg: ss.gwg ?? 0,
                  pim: ss.pim ?? 0,
                }
              : null,
          }
        }
      })
    )

    // Filter out seasons where the player had 0 game appearances
    // (e.g. rostered for a future season that hasn't started yet)
    const filteredSeasons = seasonsWithStats.filter(
      (s) => s.stats === null || Number(s.stats.gp) > 0
    )

    return NextResponse.json(
      { seasons: filteredSeasons },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      }
    )
  } catch (e) {
    console.error("Player stats error:", e)
    return NextResponse.json(
      { error: "Failed to fetch player stats", seasons: [] },
      { status: 500 }
    )
  }
}

