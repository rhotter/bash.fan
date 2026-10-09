import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and, ne, gt, sql } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { revalidateTag } from "next/cache"
import { nextGameIds } from "@/lib/db/game-id"
import { normalizeTimeForStorage } from "@/lib/format-time"

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
    const { mode, games, force, preserveWeek1 } = body

    if (!mode || !games || !Array.isArray(games)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    let minDate: string | null = null
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

      if (preserveWeek1) {
        const earliest = await db.select({ minDate: sql<string>`MIN(date)` })
          .from(schema.games)
          .where(eq(schema.games.seasonId, seasonId))
        minDate = earliest[0]?.minDate ?? null
      }

      // Delete existing non-final games (preserving Week 1 if requested)
      if (preserveWeek1 && minDate) {
        await db.delete(schema.games).where(and(
          eq(schema.games.seasonId, seasonId),
          gt(schema.games.date, minDate),
          ne(schema.games.status, "final")
        ))
      } else {
        await db.delete(schema.games).where(and(
          eq(schema.games.seasonId, seasonId),
          ne(schema.games.status, "final")
        ))
      }
    }

    // Ensure the sentinel "tbd" team exists for placeholder games
    const hasTbd = games.some((g: Record<string, unknown>) => g.homeTeam === "tbd" || g.awayTeam === "tbd")
    if (hasTbd) {
      await db.insert(schema.teams)
        .values({ slug: "tbd", name: "(TBD)" })
        .onConflictDoNothing()
    }

    // Insert new games (skip Week 1 games if preserving them)
    const gamesToInsert = (preserveWeek1 && minDate)
      ? games.filter((g: Record<string, unknown>) => (g.date as string) > minDate!)
      : games

    if (gamesToInsert.length > 0) {
      const ids = await nextGameIds(gamesToInsert.length)
      const insertData = gamesToInsert.map((g: Record<string, unknown>, i: number) => ({
        id: ids[i],
        seasonId,
        date: g.date as string,
        time: normalizeTimeForStorage(g.time as string),
        homeTeam: g.homeTeam as string,
        awayTeam: g.awayTeam as string,
        homePlaceholder: (g.homePlaceholder as string) ?? null,
        awayPlaceholder: (g.awayPlaceholder as string) ?? null,
        location: (g.location as string) || "The Lick",
        gameType: (g.gameType as string) || "regular",
        status: "upcoming" as const,
        isPlayoff: g.gameType === "playoff" || g.gameType === "championship",
      }))

      await db.insert(schema.games).values(insertData)
    }

    // @ts-expect-error - Next.js canary changed revalidateTag signature // TODO: Remove after Next.js stabilizes
    revalidateTag("seasons")
    return NextResponse.json({
      success: true,
      count: gamesToInsert.length,
      preservedCount: games.length - gamesToInsert.length,
    })
  } catch (error) {
    console.error("Failed to generate schedule:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
