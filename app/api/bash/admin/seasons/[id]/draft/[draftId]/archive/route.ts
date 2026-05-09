import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; draftId: string }>
}

/**
 * POST — Archive a completed draft (remove from public nav links).
 * The draft results page remains accessible by direct URL,
 * but header/footer nav links will no longer point to it.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { draftId } = await context.params

  const [existing] = await db
    .select()
    .from(schema.draftInstances)
    .where(eq(schema.draftInstances.id, draftId))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  }

  if (existing.status !== "completed") {
    return NextResponse.json(
      { error: "Only completed drafts can be archived" },
      { status: 400 }
    )
  }

  await db
    .update(schema.draftInstances)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(schema.draftInstances.id, draftId))

  return NextResponse.json({ ok: true })
}

/**
 * DELETE — Restore an archived draft back to completed status,
 * re-enabling public nav links.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { draftId } = await context.params

  const [existing] = await db
    .select()
    .from(schema.draftInstances)
    .where(eq(schema.draftInstances.id, draftId))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  }

  if (existing.status !== "archived") {
    return NextResponse.json(
      { error: "Only archived drafts can be restored" },
      { status: 400 }
    )
  }

  await db
    .update(schema.draftInstances)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(schema.draftInstances.id, draftId))

  return NextResponse.json({ ok: true })
}
