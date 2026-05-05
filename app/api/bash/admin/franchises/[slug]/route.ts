import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ slug: string }>
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { slug } = await context.params

  const [existing] = await db
    .select()
    .from(schema.franchises)
    .where(eq(schema.franchises.slug, slug))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: "Franchise not found" }, { status: 404 })
  }

  try {
    const { name, color } = await request.json()

    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name
    if (color !== undefined) updates.color = color

    await db
      .update(schema.franchises)
      .set(updates)
      .where(eq(schema.franchises.slug, slug))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to update franchise:", err)
    return NextResponse.json({ error: "Failed to update franchise" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { slug } = await context.params

  // Check if any season_teams reference this franchise
  const refs = await db
    .select({ seasonId: schema.seasonTeams.seasonId })
    .from(schema.seasonTeams)
    .where(eq(schema.seasonTeams.franchiseSlug, slug))
    .limit(1)

  if (refs.length > 0) {
    return NextResponse.json(
      { error: "Cannot delete franchise while season teams reference it. Remove associations first." },
      { status: 400 }
    )
  }

  try {
    await db.delete(schema.franchises).where(eq(schema.franchises.slug, slug))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to delete franchise:", err)
    return NextResponse.json({ error: "Failed to delete franchise" }, { status: 500 })
  }
}
