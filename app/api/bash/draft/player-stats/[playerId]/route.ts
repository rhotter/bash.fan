import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import { eq, and, sql, ne } from "drizzle-orm"
import { NextResponse } from "next/server"
import { compareSeasonsDesc } from "@/lib/seasons"

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
        seasonType: schema.seasons.seasonType,
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
      .orderBy(
        sql`(SUBSTRING(${schema.seasons.id} FROM '(\\d{4})'))::int DESC NULLS LAST`,
        sql`CASE WHEN ${schema.seasons.seasonType} = 'fall' OR ${schema.seasons.id} NOT LIKE '%summer%' THEN 2 ELSE 1 END DESC`
      )

    // Deduplicate by seasonId, preserving the first (latest) entry per season
    const uniqueSortedEntries: typeof seasonEntries = []
    const seenSeasonIds = new Set<string>()
    for (const entry of [...seasonEntries].sort(compareSeasonsDesc)) {
      if (!seenSeasonIds.has(entry.seasonId)) {
        seenSeasonIds.add(entry.seasonId)
        uniqueSortedEntries.push(entry)
      }
    }

    if (uniqueSortedEntries.length === 0) {
      return NextResponse.json({ seasons: [] }, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
      })
    }

    // Iterate through chronological seasons and take up to 3 seasons with active game appearances
    const filteredSeasons = []

    for (const entry of uniqueSortedEntries) {
      if (filteredSeasons.length >= 3) break

      const aggregateSkater = async (isPlayoff: boolean) => {
        const [ss] = await db
          .select({
            gp: sql<number>`count(*)`,
            goals: sql<number>`sum(${schema.playerGameStats.goals})`,
            assists: sql<number>`sum(${schema.playerGameStats.assists})`,
            points: sql<number>`sum(${schema.playerGameStats.points})`,
            pim: sql<number>`sum(${schema.playerGameStats.pim})`,
          })
          .from(schema.playerGameStats)
          .innerJoin(schema.games, eq(schema.playerGameStats.gameId, schema.games.id))
          .where(
            and(
              eq(schema.playerGameStats.playerId, playerId),
              eq(schema.games.seasonId, entry.seasonId),
              eq(schema.games.isPlayoff, isPlayoff),
              eq(schema.playerGameStats.isSub, false)
            )
          )
        const gp = Number(ss?.gp ?? 0)
        if (gp <= 0) return null
        return {
          type: "skater" as const,
          gp,
          goals: Number(ss.goals ?? 0),
          assists: Number(ss.assists ?? 0),
          points: Number(ss.points ?? 0),
          pim: Number(ss.pim ?? 0),
        }
      }

      const aggregateGoalie = async (isPlayoff: boolean) => {
        const [gs] = await db
          .select({
            gp: sql<number>`count(*)`,
            goalsAgainst: sql<number>`sum(${schema.goalieGameStats.goalsAgainst})`,
            shotsAgainst: sql<number>`sum(${schema.goalieGameStats.shotsAgainst})`,
            saves: sql<number>`sum(${schema.goalieGameStats.saves})`,
            shutouts: sql<number>`sum(${schema.goalieGameStats.shutouts})`,
          })
          .from(schema.goalieGameStats)
          .innerJoin(schema.games, eq(schema.goalieGameStats.gameId, schema.games.id))
          .where(
            and(
              eq(schema.goalieGameStats.playerId, playerId),
              eq(schema.games.seasonId, entry.seasonId),
              eq(schema.games.isPlayoff, isPlayoff),
              eq(schema.goalieGameStats.isSub, false)
            )
          )
        const gp = Number(gs?.gp ?? 0)
        if (gp <= 0) return null
        const shotsAgainst = Number(gs.shotsAgainst ?? 0)
        const saves = Number(gs.saves ?? 0)
        return {
          type: "goalie" as const,
          gp,
          goalsAgainst: Number(gs.goalsAgainst ?? 0),
          shotsAgainst,
          saves,
          shutouts: Number(gs.shutouts ?? 0),
          savePct: shotsAgainst > 0 ? ((saves / shotsAgainst) * 100).toFixed(1) : "0.0",
        }
      }

      const primaryAggregate = entry.isGoalie ? aggregateGoalie : aggregateSkater
      let [stats, playoffStats] = await Promise.all([
        primaryAggregate(false),
        primaryAggregate(true),
      ])

      let actualIsGoalie = entry.isGoalie
      if (stats === null && playoffStats === null) {
        // Fall back to checking the other position in case registered position differed from games played
        const fallbackAggregate = entry.isGoalie ? aggregateSkater : aggregateGoalie
        const [fbStats, fbPlayoff] = await Promise.all([
          fallbackAggregate(false),
          fallbackAggregate(true),
        ])
        if (fbStats !== null || fbPlayoff !== null) {
          stats = fbStats
          playoffStats = fbPlayoff
          actualIsGoalie = !entry.isGoalie
        }
      }

      if (stats !== null || playoffStats !== null) {
        filteredSeasons.push({
          seasonId: entry.seasonId,
          seasonName: entry.seasonName,
          teamName: entry.teamName,
          teamSlug: entry.teamSlug,
          isGoalie: actualIsGoalie,
          isCaptain: entry.isCaptain,
          stats,
          playoffStats,
        })
      }
    }

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

