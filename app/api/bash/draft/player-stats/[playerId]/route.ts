import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import { eq, and, sql, ne, inArray } from "drizzle-orm"
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

    // Batch query all skater and goalie game stats grouped by season and playoff status in parallel
    const [skaterRows, goalieRows] = await Promise.all([
      db
        .select({
          seasonId: schema.games.seasonId,
          isPlayoff: schema.games.isPlayoff,
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
            eq(schema.playerGameStats.isSub, false),
            inArray(schema.games.gameType, ["regular", "playoff", "championship"])
          )
        )
        .groupBy(schema.games.seasonId, schema.games.isPlayoff),

      db
        .select({
          seasonId: schema.games.seasonId,
          isPlayoff: schema.games.isPlayoff,
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
            eq(schema.goalieGameStats.isSub, false),
            inArray(schema.games.gameType, ["regular", "playoff", "championship"])
          )
        )
        .groupBy(schema.games.seasonId, schema.games.isPlayoff),
    ])

    type SkaterStatObj = {
      type: "skater"
      gp: number
      goals: number
      assists: number
      points: number
      pim: number
    }
    type GoalieStatObj = {
      type: "goalie"
      gp: number
      goalsAgainst: number
      shotsAgainst: number
      saves: number
      shutouts: number
      savePct: string
    }

    const skaterMap = new Map<string, SkaterStatObj>()
    for (const row of skaterRows) {
      const gp = Number(row.gp ?? 0)
      if (gp > 0 && row.seasonId) {
        skaterMap.set(`${row.seasonId}_${row.isPlayoff}`, {
          type: "skater",
          gp,
          goals: Number(row.goals ?? 0),
          assists: Number(row.assists ?? 0),
          points: Number(row.points ?? 0),
          pim: Number(row.pim ?? 0),
        })
      }
    }

    const goalieMap = new Map<string, GoalieStatObj>()
    for (const row of goalieRows) {
      const gp = Number(row.gp ?? 0)
      if (gp > 0 && row.seasonId) {
        const shotsAgainst = Number(row.shotsAgainst ?? 0)
        const saves = Number(row.saves ?? 0)
        goalieMap.set(`${row.seasonId}_${row.isPlayoff}`, {
          type: "goalie",
          gp,
          goalsAgainst: Number(row.goalsAgainst ?? 0),
          shotsAgainst,
          saves,
          shutouts: Number(row.shutouts ?? 0),
          savePct: shotsAgainst > 0 ? ((saves / shotsAgainst) * 100).toFixed(1) : "0.0",
        })
      }
    }

    // Iterate through chronological seasons and take up to 3 seasons with active game appearances
    const filteredSeasons = []

    for (const entry of uniqueSortedEntries) {
      if (filteredSeasons.length >= 3) break

      const getStatsForSeason = (asGoalie: boolean) => {
        const map = asGoalie ? (goalieMap as Map<string, SkaterStatObj | GoalieStatObj>) : (skaterMap as Map<string, SkaterStatObj | GoalieStatObj>)
        const regular = map.get(`${entry.seasonId}_false`) ?? null
        const playoff = map.get(`${entry.seasonId}_true`) ?? null
        return [regular, playoff] as const
      }

      let [stats, playoffStats] = getStatsForSeason(entry.isGoalie)
      let actualIsGoalie = entry.isGoalie

      if (stats === null && playoffStats === null) {
        // Fall back to checking the other position in case registered position differed from games played
        const [fbStats, fbPlayoff] = getStatsForSeason(!entry.isGoalie)
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

