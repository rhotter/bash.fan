import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST — Replace placeholder team slugs in schedule games with real team slugs.
 *
 * Body: { mappings: { placeholder: string; realSlug: string }[] }
 *
 * Example:
 *   mappings: [
 *     { placeholder: "placeholder-1", realSlug: "mustangs" },
 *     { placeholder: "placeholder-2", realSlug: "wolves" },
 *   ]
 *
 * Replaces homeTeam/awayTeam in all games for this season where the
 * current value matches a placeholder slug.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  try {
    const { mappings } = (await request.json()) as {
      mappings: { placeholder: string; realSlug: string }[]
    }

    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      return NextResponse.json(
        { error: "mappings array is required" },
        { status: 400 }
      )
    }

    // Validate all real slugs exist in the teams table
    for (const m of mappings) {
      if (!m.placeholder.startsWith("placeholder-")) {
        return NextResponse.json(
          { error: `Invalid placeholder slug: ${m.placeholder}` },
          { status: 400 }
        )
      }

      const [team] = await db
        .select({ slug: schema.teams.slug })
        .from(schema.teams)
        .where(eq(schema.teams.slug, m.realSlug))
        .limit(1)

      if (!team) {
        return NextResponse.json(
          { error: `Team not found: ${m.realSlug}` },
          { status: 400 }
        )
      }
    }

    // Get all games in this season that have placeholder teams
    const placeholderSlugs = mappings.map((m) => m.placeholder)
    const games = await db
      .select({
        id: schema.games.id,
        homeTeam: schema.games.homeTeam,
        awayTeam: schema.games.awayTeam,
      })
      .from(schema.games)
      .where(eq(schema.games.seasonId, seasonId))

    // Filter to only games with placeholder references
    const affectedGames = games.filter(
      (g) =>
        placeholderSlugs.includes(g.homeTeam) ||
        placeholderSlugs.includes(g.awayTeam)
    )

    if (affectedGames.length === 0) {
      return NextResponse.json({
        message: "No placeholder games found to update",
        updated: 0,
      })
    }

    // Build lookup map: placeholder → realSlug
    const slugMap = new Map(
      mappings.map((m) => [m.placeholder, m.realSlug])
    )

    // Update games in batches
    let updated = 0
    for (const game of affectedGames) {
      const newHome = slugMap.get(game.homeTeam) || game.homeTeam
      const newAway = slugMap.get(game.awayTeam) || game.awayTeam

      if (newHome !== game.homeTeam || newAway !== game.awayTeam) {
        await db
          .update(schema.games)
          .set({ homeTeam: newHome, awayTeam: newAway })
          .where(eq(schema.games.id, game.id))
        updated++
      }
    }

    return NextResponse.json({
      message: `Updated ${updated} game(s) with real team slugs`,
      updated,
      mappings: mappings.map((m) => `${m.placeholder} → ${m.realSlug}`),
    })
  } catch (err) {
    console.error("replace-placeholders error:", err)
    return NextResponse.json(
      { error: "Failed to replace placeholders" },
      { status: 500 }
    )
  }
}
