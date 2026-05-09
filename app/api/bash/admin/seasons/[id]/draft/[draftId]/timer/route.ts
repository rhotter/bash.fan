import { db } from "@/lib/db"
import { draftInstances } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { getSession } from "@/lib/admin-session"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; draftId: string }> }
) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { draftId } = await params
  const body = await req.json()
  const { action } = body

  const draft = await db.query.draftInstances.findFirst({
    where: eq(draftInstances.id, draftId),
  })

  if (!draft || draft.status !== "live") {
    return NextResponse.json({ error: "Timer controls are only available during a live draft" }, { status: 400 })
  }

  if (action === "pause") {
    // Calculate how much time was remaining when paused
    const now = Date.now()
    const startedAt = draft.timerStartedAt ? new Date(draft.timerStartedAt).getTime() : now
    const elapsed = Math.floor((now - startedAt) / 1000)
    const remaining = Math.max(0, (draft.timerCountdown ?? draft.timerSeconds) - elapsed)

    await db
      .update(draftInstances)
      .set({
        timerRunning: false,
        timerCountdown: remaining,
        timerStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(draftInstances.id, draftId))
  } else if (action === "resume") {
    await db
      .update(draftInstances)
      .set({
        timerRunning: true,
        timerStartedAt: new Date(),
        // timerCountdown stays as the remaining seconds from pause
        updatedAt: new Date(),
      })
      .where(eq(draftInstances.id, draftId))
  } else if (action === "reset") {
    await db
      .update(draftInstances)
      .set({
        timerRunning: true,
        timerCountdown: draft.timerSeconds,
        timerStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(draftInstances.id, draftId))
  } else if (action === "setDuration") {
    const duration = Number(body.duration)
    if (!duration || duration < 10 || duration > 600) {
      return NextResponse.json({ error: "Duration must be between 10 and 600 seconds" }, { status: 400 })
    }
    await db
      .update(draftInstances)
      .set({
        timerSeconds: duration,
        timerCountdown: duration,
        timerRunning: true,
        timerStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(draftInstances.id, draftId))
  } else {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  }

  const updatedDraft = await db.query.draftInstances.findFirst({
    where: eq(draftInstances.id, draftId),
  })

  return NextResponse.json({ draft: updatedDraft })
}
