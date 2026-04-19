import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

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
    const { teamSlug } = await request.json()

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

    await db.insert(schema.seasonTeams).values({ seasonId, teamSlug })

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch {
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
  } catch {
    return NextResponse.json({ error: "Failed to remove team" }, { status: 500 })
  }
}
