import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { revalidateTag } from "next/cache"

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
    const body = await request.json()
    const { games, playoffTeams } = body

    if (!games || !Array.isArray(games)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    // Overwrite any existing playoff games for the season
    // We only delete non-final playoff games to be safe, but typically this is used once
    await db.delete(schema.games).where(and(
      eq(schema.games.seasonId, seasonId),
      eq(schema.games.gameType, "playoff"),
      eq(schema.games.status, "upcoming")
    ))

    // Ensure the sentinel "tbd" team exists for placeholder games
    const hasTbd = games.some((g: Record<string, unknown>) => g.homeTeam === "tbd" || g.awayTeam === "tbd")
    if (hasTbd) {
      await db.insert(schema.teams)
        .values({ slug: "tbd", name: "(TBD)" })
        .onConflictDoNothing()
    }

    // Generate unique IDs for all incoming games to prevent collision with other seasons,
    // while maintaining the relative nextGameId pointers for the bracket tree.
    const idMap = new Map<string, string>()
    for (const g of games) {
      idMap.set(g.id, "gen-" + crypto.randomUUID().slice(0, 8))
    }

    // Insert new playoff games
    if (games.length > 0) {
      const insertData = games.map((g: Record<string, unknown>) => ({
        id: idMap.get(g.id as string) as string,
        seasonId,
        date: g.date as string,
        time: g.time as string,
        homeTeam: g.homeTeam as string,
        awayTeam: g.awayTeam as string,
        homePlaceholder: (g.homePlaceholder as string | null) ?? null,
        awayPlaceholder: (g.awayPlaceholder as string | null) ?? null,
        location: (g.location as string) || "James Lick Arena",
        gameType: "playoff" as const,
        isPlayoff: true,
        status: "upcoming" as const,
        bracketRound: (g.bracketRound as string | null) ?? null,
        seriesId: (g.seriesId as string | null) ?? null,
        seriesGameNumber: (g.seriesGameNumber as number | null) ?? null,
        nextGameId: g.nextGameId ? idMap.get(g.nextGameId as string) ?? null : null,
        nextGameSlot: (g.nextGameSlot as string | null) ?? null,
      }))

      // Topological sort: insert games that are referenced by nextGameId first
      // (finals before semis, semis before quarters) to satisfy FK constraints
      const idSet = new Set(insertData.map(g => g.id))
      const sorted: typeof insertData = []
      const remaining = [...insertData]

      while (remaining.length > 0) {
        const batch = remaining.filter(g =>
          !g.nextGameId || !idSet.has(g.nextGameId) || sorted.some(s => s.id === g.nextGameId)
        )
        if (batch.length === 0) {
          // Fallback: break cycle by inserting everything remaining
          sorted.push(...remaining)
          break
        }
        sorted.push(...batch)
        for (const b of batch) {
          remaining.splice(remaining.indexOf(b), 1)
        }
      }

      await db.insert(schema.games).values(sorted)
    }

    if (typeof playoffTeams === "number") {
      await db.update(schema.seasons)
        .set({ playoffTeams })
        .where(eq(schema.seasons.id, seasonId))
    }

    // @ts-expect-error - Next.js canary changed the signature of revalidateTag
    revalidateTag("seasons")
    return NextResponse.json({ success: true, count: games.length })
  } catch (error) {
    console.error("Failed to generate playoffs:", error)
    const message = error instanceof Error ? error.message : "Internal Server Error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
