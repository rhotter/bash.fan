import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; draftId: string }>
}

// POST — Reset simulation (clear all isSimulation=true rows)
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
      { error: "Simulation reset is only available in 'draft' status" },
      { status: 400 }
    )
  }

  try {
    // Clear simulation log entries
    await db
      .delete(schema.draftLog)
      .where(
        and(
          eq(schema.draftLog.draftId, draftId),
          eq(schema.draftLog.isSimulation, true)
        )
      )

    // Clear simulation picks
    await db
      .delete(schema.draftPicks)
      .where(
        and(
          eq(schema.draftPicks.draftId, draftId),
          eq(schema.draftPicks.isSimulation, true)
        )
      )

    // Clear simulation trades (trade items cascade from trades)
    await db
      .delete(schema.draftTrades)
      .where(
        and(
          eq(schema.draftTrades.draftId, draftId),
          eq(schema.draftTrades.isSimulation, true)
        )
      )

    // Reset simulation flag and current position
    await db
      .update(schema.draftInstances)
      .set({
        isSimulating: false,
        currentRound: null,
        currentPick: null,
        timerCountdown: null,
        timerRunning: false,
        timerStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.draftInstances.id, draftId))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to reset simulation:", err)
    return NextResponse.json({ error: "Failed to reset simulation" }, { status: 500 })
  }
}
