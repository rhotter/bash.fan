import { db } from "@/lib/db"
import { draftPicks, draftInstances, draftPool, draftLog, players } from "@/lib/db/schema"
import { eq, and, isNull, notInArray, sql } from "drizzle-orm"
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

  const { id: _seasonId, draftId } = await params
  const { pickId, playerId } = await req.json()

  if (!pickId || !playerId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  // Verify draft is live
  const draft = await db.query.draftInstances.findFirst({
    where: eq(draftInstances.id, draftId)
  })

  if (!draft || draft.status !== "live") {
    return NextResponse.json({ error: "Draft is not active" }, { status: 400 })
  }

  // Check if player is already drafted
  const existingPick = await db.query.draftPicks.findFirst({
    where: and(
      eq(draftPicks.draftId, draftId),
      eq(draftPicks.playerId, playerId)
    )
  })

  if (existingPick) {
    return NextResponse.json({ error: "Player has already been drafted" }, { status: 400 })
  }

  // Update pick
  const updateRes = await db.update(draftPicks)
    .set({
      playerId,
      pickedAt: new Date()
    })
    .where(
      and(
        eq(draftPicks.id, pickId),
        eq(draftPicks.draftId, draftId),
        isNull(draftPicks.playerId) // Only allow updating if it hasn't been picked yet
      )
    )
    .returning()

  if (updateRes.length === 0) {
    return NextResponse.json({ error: "Pick is already made or does not exist" }, { status: 400 })
  }

  // ── Auto-complete check ─────────────────────────────────────────────────
  // Count pool players who haven't been drafted yet.
  // IMPORTANT: filter out NULL playerIds from empty pick slots — SQL's
  // NOT IN returns UNKNOWN when NULLs are in the subquery, which would
  // cause the count to always be 0 and auto-complete immediately.
  const draftedPlayerIds = db
    .select({ playerId: draftPicks.playerId })
    .from(draftPicks)
    .where(
      and(
        eq(draftPicks.draftId, draftId),
        sql`${draftPicks.playerId} IS NOT NULL`
      )
    )

  const [remainingCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(draftPool)
    .where(
      and(
        eq(draftPool.draftId, draftId),
        notInArray(draftPool.playerId, draftedPlayerIds)
      )
    )

  const allPlayersDrafted = Number(remainingCount.count) === 0

  if (allPlayersDrafted) {
    // Auto-complete: stop timer and transition to completed
    const completedPick = updateRes[0]
    await db.update(draftInstances)
      .set({
        status: "completed",
        currentRound: completedPick.round,
        currentPick: completedPick.pickNumber,
        timerRunning: false,
        timerStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(draftInstances.id, draftId))

    // Log completion
    await db.insert(draftLog).values({
      draftId,
      action: "complete",
      detail: { trigger: "auto", reason: "All pool players drafted" },
    })
  } else {
    // Reset the timer for the next pick
    await db.update(draftInstances)
      .set({
        timerStartedAt: new Date(),
        timerCountdown: draft.timerSeconds,
        timerRunning: true
      })
      .where(eq(draftInstances.id, draftId))
  }

  // Fetch updated picks to send back
  const allPicks = await db
    .select({
      id: draftPicks.id,
      round: draftPicks.round,
      pickNumber: draftPicks.pickNumber,
      teamSlug: draftPicks.teamSlug,
      originalTeamSlug: draftPicks.originalTeamSlug,
      playerId: draftPicks.playerId,
      playerName: players.name,
      isKeeper: draftPicks.isKeeper,

      pickedAt: draftPicks.pickedAt,
    })
    .from(draftPicks)
    .leftJoin(players, eq(draftPicks.playerId, players.id))
    .where(eq(draftPicks.draftId, draftId))
    .orderBy(draftPicks.pickNumber)

  // Fetch the updated draft instance to get the new timer state
  const updatedDraft = await db.query.draftInstances.findFirst({
    where: eq(draftInstances.id, draftId)
  })

  return NextResponse.json({ picks: allPicks, draft: updatedDraft })
}
