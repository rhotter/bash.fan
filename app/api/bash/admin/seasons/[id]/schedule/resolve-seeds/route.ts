import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and, inArray } from "drizzle-orm"
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
    const { mappings } = await request.json()

    if (!mappings || Object.keys(mappings).length === 0) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    // Pre-validate all target team slugs exist
    const targetSlugs = [...new Set(Object.values(mappings))] as string[]
    const existingTeams = await db.select({ slug: schema.teams.slug })
      .from(schema.teams)
      .where(inArray(schema.teams.slug, targetSlugs))
    const validSlugs = new Set(existingTeams.map(t => t.slug))
    const invalidSlugs = targetSlugs.filter(s => !validSlugs.has(s))
    if (invalidSlugs.length > 0) {
      return NextResponse.json(
        { error: `Unknown team slug(s): ${invalidSlugs.join(", ")}` },
        { status: 400 }
      )
    }

    const playoffGames = await db.select().from(schema.games).where(
      and(
        eq(schema.games.seasonId, seasonId),
        eq(schema.games.gameType, "playoff")
      )
    )

    let updatedCount = 0

    for (const game of playoffGames) {
      let needsUpdate = false
      const updates: Partial<typeof schema.games.$inferInsert> = {}

      if (game.homeTeam === "tbd" && game.homePlaceholder && mappings[game.homePlaceholder]) {
        updates.homeTeam = mappings[game.homePlaceholder]
        updates.homePlaceholder = null
        needsUpdate = true
      }

      if (game.awayTeam === "tbd" && game.awayPlaceholder && mappings[game.awayPlaceholder]) {
        updates.awayTeam = mappings[game.awayPlaceholder]
        updates.awayPlaceholder = null
        needsUpdate = true
      }

      if (needsUpdate) {
        await db.update(schema.games)
          .set(updates)
          .where(eq(schema.games.id, game.id))
        updatedCount++
      }
    }

    // @ts-expect-error - Next.js canary signature change
    revalidateTag("seasons")
    return NextResponse.json({ success: true, count: updatedCount })
  } catch (error) {
    console.error("Failed to resolve seeds:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
