import { db } from "@/lib/db"
import { draftPicks, draftInstances, players } from "@/lib/db/schema"
import { eq, and, isNotNull, desc } from "drizzle-orm"
import { NextResponse } from "next/server"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; draftId: string }> }
) {
  const { id: _seasonId, draftId } = await params

  // Verify draft is live
  const draft = await db.query.draftInstances.findFirst({
    where: eq(draftInstances.id, draftId)
  })

  if (!draft || draft.status !== "live") {
    return NextResponse.json({ error: "Draft is not active" }, { status: 400 })
  }

  // Find the most recently made pick that is NOT a keeper
  const lastPick = await db.query.draftPicks.findFirst({
    where: and(
      eq(draftPicks.draftId, draftId),
      isNotNull(draftPicks.playerId),
      eq(draftPicks.isKeeper, false)
    ),
    orderBy: [desc(draftPicks.pickNumber)]
  })

  if (!lastPick) {
    return NextResponse.json({ error: "No picks to undo" }, { status: 400 })
  }

  // Undo the pick
  await db.update(draftPicks)
    .set({
      playerId: null,
      pickedAt: null
    })
    .where(eq(draftPicks.id, lastPick.id))

  // Reset the timer
  await db.update(draftInstances)
    .set({
      timerStartedAt: new Date(),
      timerCountdown: draft.timerSeconds,
      timerRunning: false // Optionally pause the timer on undo? Let's keep it running or start it. Actually pause might be safer, but let's just match start for now.
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
