import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, desc, isNull, and, ne, inArray } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ slug: string }>
}

/**
 * GET /api/bash/admin/franchises/[slug]/teams
 *
 * Returns two lists:
 *   - linkedTeams: season_teams currently assigned to this franchise (with season + team name)
 *   - unlinkedTeams: season_teams that have no franchise assigned (available to claim)
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { slug } = await context.params

  // Verify franchise exists
  const [franchise] = await db
    .select()
    .from(schema.franchises)
    .where(eq(schema.franchises.slug, slug))
    .limit(1)

  if (!franchise) {
    return NextResponse.json({ error: "Franchise not found" }, { status: 404 })
  }

  // Linked teams: season_teams where franchise_slug = this franchise
  const linked = await db
    .select({
      seasonId: schema.seasonTeams.seasonId,
      teamSlug: schema.seasonTeams.teamSlug,
      teamName: schema.teams.name,
      seasonName: schema.seasons.name,
    })
    .from(schema.seasonTeams)
    .innerJoin(schema.teams, eq(schema.seasonTeams.teamSlug, schema.teams.slug))
    .innerJoin(schema.seasons, eq(schema.seasonTeams.seasonId, schema.seasons.id))
    .where(eq(schema.seasonTeams.franchiseSlug, slug))
    .orderBy(desc(schema.seasonTeams.seasonId))

  // Unlinked teams: season_teams with no franchise (available to claim)
  // Only include teams from non-draft seasons — draft season teams should be
  // assigned via the season teams tab instead.
  const unlinked = await db
    .select({
      seasonId: schema.seasonTeams.seasonId,
      teamSlug: schema.seasonTeams.teamSlug,
      teamName: schema.teams.name,
      seasonName: schema.seasons.name,
    })
    .from(schema.seasonTeams)
    .innerJoin(schema.teams, eq(schema.seasonTeams.teamSlug, schema.teams.slug))
    .innerJoin(schema.seasons, eq(schema.seasonTeams.seasonId, schema.seasons.id))
    .where(
      and(
        isNull(schema.seasonTeams.franchiseSlug),
        ne(schema.seasonTeams.teamSlug, "tbd"),
        inArray(schema.seasons.status, ["active", "completed", "archived"]),
      )
    )
    .orderBy(desc(schema.seasonTeams.seasonId))

  return NextResponse.json({
    franchise,
    linkedTeams: linked,
    unlinkedTeams: unlinked.filter(t => !t.teamSlug.startsWith("seed-")),
  })
}

/**
 * PATCH /api/bash/admin/franchises/[slug]/teams
 *
 * Bulk assign or unassign season_teams to/from this franchise.
 * Body: {
 *   assign: [{ seasonId, teamSlug }]    — set franchise_slug to this franchise
 *   unassign: [{ seasonId, teamSlug }]  — clear franchise_slug back to null
 * }
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { slug } = await context.params

  // Verify franchise exists
  const [franchise] = await db
    .select()
    .from(schema.franchises)
    .where(eq(schema.franchises.slug, slug))
    .limit(1)

  if (!franchise) {
    return NextResponse.json({ error: "Franchise not found" }, { status: 404 })
  }

  try {
    const { assign = [], unassign = [] } = await request.json() as {
      assign?: { seasonId: string; teamSlug: string }[]
      unassign?: { seasonId: string; teamSlug: string }[]
    }

    let updated = 0

    // Assign: set franchise_slug to this franchise
    for (const { seasonId, teamSlug } of assign) {
      await db
        .update(schema.seasonTeams)
        .set({ franchiseSlug: slug })
        .where(
          and(
            eq(schema.seasonTeams.seasonId, seasonId),
            eq(schema.seasonTeams.teamSlug, teamSlug),
          )
        )
      updated++
    }

    // Unassign: clear franchise_slug
    for (const { seasonId, teamSlug } of unassign) {
      await db
        .update(schema.seasonTeams)
        .set({ franchiseSlug: null })
        .where(
          and(
            eq(schema.seasonTeams.seasonId, seasonId),
            eq(schema.seasonTeams.teamSlug, teamSlug),
          )
        )
      updated++
    }

    return NextResponse.json({ ok: true, updated })
  } catch (err) {
    console.error("Failed to update franchise teams:", err)
    return NextResponse.json({ error: "Failed to update" }, { status: 500 })
  }
}
