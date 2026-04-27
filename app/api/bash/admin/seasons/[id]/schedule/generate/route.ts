import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and, ne } from "drizzle-orm"
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
    const { mode, games, force } = body

    if (!mode || !games || !Array.isArray(games)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    if (mode === "overwrite") {
      // First, check if there are any final games
      const existingFinalGames = await db.select()
        .from(schema.games)
        .where(and(
          eq(schema.games.seasonId, seasonId),
          eq(schema.games.status, "final")
        ))
        
      if (existingFinalGames.length > 0 && !force) {
        return NextResponse.json(
          { error: "Cannot overwrite schedule because final games exist. Please use force mode or append." },
          { status: 400 }
        )
      }

      // Delete existing non-final games (or all if forced, but we'd need to delete child records for finals first if forcing)
      // Since generator is for regular season, we'll just delete non-finals.
      await db.delete(schema.games).where(and(
        eq(schema.games.seasonId, seasonId),
        ne(schema.games.status, "final")
      ))
    }

    // Ensure the sentinel "tbd" team exists for placeholder games
    const hasTbd = games.some((g: Record<string, unknown>) => g.homeTeam === "tbd" || g.awayTeam === "tbd")
    if (hasTbd) {
      await db.insert(schema.teams)
        .values({ slug: "tbd", name: "(TBD)" })
        .onConflictDoNothing()
    }

    // Insert new games
    if (games.length > 0) {
      const insertData = games.map(g => ({
        ...g,
        seasonId,
        id: "gen-" + crypto.randomUUID().slice(0, 8),
        isPlayoff: g.gameType === "playoff" || g.gameType === "championship"
      }))

      await db.insert(schema.games).values(insertData)
    }

    // @ts-expect-error - Next.js canary changed revalidateTag signature // TODO: Remove after Next.js stabilizes
    revalidateTag("seasons")
    return NextResponse.json({ success: true, count: games.length })
  } catch (error) {
    console.error("Failed to generate schedule:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
