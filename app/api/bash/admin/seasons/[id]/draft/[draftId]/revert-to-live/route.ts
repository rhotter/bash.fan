import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; draftId: string }>
}

// POST — Revert a completed draft back to live status
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

  if (draft.status !== "completed") {
    return NextResponse.json(
      { error: `Can only revert from 'completed' status. Current status: '${draft.status}'.` },
      { status: 400 }
    )
  }

  try {
    await db
      .update(schema.draftInstances)
      .set({
        status: "live",
        timerRunning: false,
        timerStartedAt: null,
        timerCountdown: draft.timerSeconds,
        updatedAt: new Date(),
      })
      .where(eq(schema.draftInstances.id, draftId))

    // Log the revert
    await db.insert(schema.draftLog).values({
      draftId,
      action: "revert_to_live",
      detail: { previousStatus: "completed" },
    })

    return NextResponse.json({ ok: true, status: "live" })
  } catch (err) {
    console.error("Failed to revert draft to live:", err)
    return NextResponse.json({ error: "Failed to revert draft" }, { status: 500 })
  }
}
