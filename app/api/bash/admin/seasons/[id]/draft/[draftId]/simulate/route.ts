import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; draftId: string }>
}

// POST — Enter simulation mode
// PUT — Update simulation state (toggle)
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
      { error: "Simulation is only available in 'draft' status" },
      { status: 400 }
    )
  }

  const newState = !draft.isSimulating

  await db
    .update(schema.draftInstances)
    .set({
      isSimulating: newState,
      updatedAt: new Date(),
    })
    .where(eq(schema.draftInstances.id, draftId))

  return NextResponse.json({ ok: true, isSimulating: newState })
}
