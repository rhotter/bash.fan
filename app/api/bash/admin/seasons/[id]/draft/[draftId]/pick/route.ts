import { db } from "@/lib/db"
import { draftPicks, draftInstances, players } from "@/lib/db/schema"
import { eq, and, isNull } from "drizzle-orm"
import { NextResponse } from "next/server"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; draftId: string }> }
) {
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

  // Reset the timer for the next pick
  await db.update(draftInstances)
    .set({
      timerStartedAt: new Date(),
      timerCountdown: draft.timerSeconds,
      timerRunning: true
    })
    .where(eq(draftInstances.id, draftId))

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
      isSimulation: draftPicks.isSimulation,
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
