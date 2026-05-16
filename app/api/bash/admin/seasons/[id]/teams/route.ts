import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and, ne } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string }>
}

// GET /api/bash/admin/seasons/[id]/teams — list teams with franchise assignments
export async function GET(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  try {
    const teams = await db
      .select({
        teamSlug: schema.seasonTeams.teamSlug,
        teamName: schema.teams.name,
        franchiseSlug: schema.seasonTeams.franchiseSlug,
        color: schema.seasonTeams.color,
      })
      .from(schema.seasonTeams)
      .innerJoin(schema.teams, eq(schema.seasonTeams.teamSlug, schema.teams.slug))
      .where(and(eq(schema.seasonTeams.seasonId, seasonId), ne(schema.seasonTeams.teamSlug, "tbd")))

    const franchises = await db
      .select()
      .from(schema.franchises)
      .orderBy(schema.franchises.name)

    return NextResponse.json({ teams, franchises })
  } catch (err) {
    console.error("Failed to fetch teams:", err)
    return NextResponse.json({ error: "Failed to fetch teams" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  try {
    const { teamSlug, color } = await request.json()

    if (!teamSlug) {
      return NextResponse.json({ error: "teamSlug is required" }, { status: 400 })
    }

    // Verify season exists
    const [season] = await db
      .select({ id: schema.seasons.id })
      .from(schema.seasons)
      .where(eq(schema.seasons.id, seasonId))
      .limit(1)

    if (!season) {
      return NextResponse.json({ error: "Season not found" }, { status: 404 })
    }

    await db.insert(schema.seasonTeams).values({
      seasonId,
      teamSlug,
      ...(color ? { color } : {}),
    })

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    console.error("Failed to add team:", err)
    return NextResponse.json({ error: "Failed to add team" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  // Only allow removing teams from draft seasons
  const [season] = await db
    .select({ status: schema.seasons.status })
    .from(schema.seasons)
    .where(eq(schema.seasons.id, seasonId))
    .limit(1)

  if (!season) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 })
  }

  if (season.status !== "draft") {
    return NextResponse.json(
      { error: "Can only remove teams from draft seasons" },
      { status: 400 }
    )
  }

  try {
    const { teamSlug } = await request.json()

    await db
      .delete(schema.seasonTeams)
      .where(
        and(
          eq(schema.seasonTeams.seasonId, seasonId),
          eq(schema.seasonTeams.teamSlug, teamSlug)
        )
      )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to remove team:", err)
    return NextResponse.json({ error: "Failed to remove team" }, { status: 500 })
  }
}

// PATCH /api/bash/admin/seasons/[id]/teams — bulk franchise assignment
// Body: { assignments: [{ teamSlug: string, franchiseSlug: string | null }] }
export async function PATCH(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  try {
    const { assignments } = await request.json()

    if (!Array.isArray(assignments)) {
      return NextResponse.json({ error: "assignments must be an array" }, { status: 400 })
    }

    // Validate all franchise slugs exist (skip nulls — clearing assignment)
    const slugsToCheck = [
      ...new Set(
        assignments
          .map((a: { franchiseSlug: string | null }) => a.franchiseSlug)
          .filter(Boolean) as string[]
      ),
    ]
    if (slugsToCheck.length > 0) {
      const existing = await db
        .select({ slug: schema.franchises.slug })
        .from(schema.franchises)
      const existingSlugs = new Set(existing.map((f) => f.slug))
      const invalid = slugsToCheck.filter((s) => !existingSlugs.has(s))
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Unknown franchise slugs: ${invalid.join(", ")}` },
          { status: 400 }
        )
      }
    }

    // Apply each assignment (no transaction support with neon-http, but each
    // update is idempotent so partial failure is recoverable)
    let updated = 0
    for (const { teamSlug, franchiseSlug, color } of assignments) {
      if (!teamSlug) continue
      const setValues: Record<string, string | null> = {
        franchiseSlug: franchiseSlug || null,
      }
      // Only include color in update if it was explicitly provided
      if (color !== undefined) {
        setValues.color = color || null
      }
      await db
        .update(schema.seasonTeams)
        .set(setValues)
        .where(
          and(
            eq(schema.seasonTeams.seasonId, seasonId),
            eq(schema.seasonTeams.teamSlug, teamSlug)
          )
        )
      updated++
    }

    return NextResponse.json({ ok: true, updated })
  } catch (err) {
    console.error("Failed to update franchise assignments:", err)
    return NextResponse.json({ error: "Failed to update franchise assignments" }, { status: 500 })
  }
}
