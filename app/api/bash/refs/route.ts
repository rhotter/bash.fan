import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, sum, asc, desc, countDistinct } from "drizzle-orm"

export interface RefStat {
  name: string
  games: number
  totalPen: number
  totalPim: number
  avgPimPerGame: number
}

export interface RefStatsData {
  refs: RefStat[]
  lastUpdated: string
}

export async function GET() {
  try {
    // Get all refs and their game counts
    const refRows = await db
      .select({
        name: schema.gameOfficials.name,
        games: countDistinct(schema.gameOfficials.gameId).mapWith(Number),
      })
      .from(schema.gameOfficials)
      .where(eq(schema.gameOfficials.role, "ref"))
      .groupBy(schema.gameOfficials.name)
      .orderBy(
        desc(countDistinct(schema.gameOfficials.gameId)),
        asc(schema.gameOfficials.name)
      )

    // Get penalty totals per game (to attribute to refs)
    const penaltyRows = await db
      .select({
        refName: schema.gameOfficials.name,
        totalPen: sum(schema.playerGameStats.pen).mapWith(Number),
        totalPim: sum(schema.playerGameStats.pim).mapWith(Number),
      })
      .from(schema.gameOfficials)
      .innerJoin(
        schema.playerGameStats,
        eq(schema.gameOfficials.gameId, schema.playerGameStats.gameId)
      )
      .where(eq(schema.gameOfficials.role, "ref"))
      .groupBy(schema.gameOfficials.name)

    const penMap = new Map<string, { totalPen: number; totalPim: number }>()
    for (const r of penaltyRows) {
      penMap.set(r.refName, { totalPen: r.totalPen, totalPim: r.totalPim })
    }

    const refs: RefStat[] = refRows.map((r) => {
      const pen = penMap.get(r.name) ?? { totalPen: 0, totalPim: 0 }
      return {
        name: r.name,
        games: r.games,
        totalPen: pen.totalPen,
        totalPim: pen.totalPim,
        avgPimPerGame: r.games > 0 ? Math.round((pen.totalPim / r.games) * 10) / 10 : 0,
      }
    })

    const result: RefStatsData = { refs, lastUpdated: new Date().toISOString() }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("Failed to fetch ref stats:", error)
    return NextResponse.json(
      { error: "Failed to fetch ref stats", refs: [], lastUpdated: new Date().toISOString() },
      { status: 500 },
    )
  }
}
