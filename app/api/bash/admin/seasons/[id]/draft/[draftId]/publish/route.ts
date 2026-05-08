import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; draftId: string }>
}

// POST — Publish draft (draft → published)
export async function POST(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { draftId } = await context.params

  const [draft] = await db
    .select()
    .from(schema.draftInstances)
    .where(eq(schema.draftInstances.id, draftId))
    .limit(1)

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  }

  if (draft.status !== "draft") {
    return NextResponse.json(
      { error: `Cannot publish from '${draft.status}' status. Must be in 'draft' status.` },
      { status: 400 }
    )
  }

  // Validate minimum requirements
  const teamOrder = await db
    .select()
    .from(schema.draftTeamOrder)
    .where(eq(schema.draftTeamOrder.draftId, draftId))

  if (teamOrder.length < 2) {
    return NextResponse.json(
      { error: "At least 2 teams are required to publish a draft" },
      { status: 400 }
    )
  }

  try {
    // Transition to published
    await db
      .update(schema.draftInstances)
      .set({
        status: "published",
        updatedAt: new Date(),
      })
      .where(eq(schema.draftInstances.id, draftId))

    return NextResponse.json({ ok: true, status: "published" })
  } catch (err) {
    console.error("Failed to publish draft:", err)
    return NextResponse.json({ error: "Failed to publish draft" }, { status: 500 })
  }
}

// DELETE — Unpublish draft (published → draft)
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { draftId } = await context.params

  const [draft] = await db
    .select()
    .from(schema.draftInstances)
    .where(eq(schema.draftInstances.id, draftId))
    .limit(1)

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  }

  if (draft.status !== "published") {
    return NextResponse.json(
      { error: `Cannot unpublish from '${draft.status}' status. Must be in 'published' status.` },
      { status: 400 }
    )
  }

  try {
    await db
      .update(schema.draftInstances)
      .set({
        status: "draft",
        updatedAt: new Date(),
      })
      .where(eq(schema.draftInstances.id, draftId))

    return NextResponse.json({ ok: true, status: "draft" })
  } catch (err) {
    console.error("Failed to unpublish draft:", err)
    return NextResponse.json({ error: "Failed to unpublish draft" }, { status: 500 })
  }
}
