import { db } from "@/lib/db"
import { draftPicks, draftInstances, players, draftLog } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { getSession } from "@/lib/admin-session"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; draftId: string; pickId: string }> }
) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: _seasonId, draftId, pickId } = await params
  const { teamSlug, playerId } = await req.json()

  // Verify draft is active
  const draft = await db.query.draftInstances.findFirst({
    where: eq(draftInstances.id, draftId)
  })

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  }

  if (draft.status !== "live" && draft.status !== "completed") {
    return NextResponse.json(
      { error: `Cannot edit picks in '${draft.status}' status` },
      { status: 400 }
    )
  }

  const pick = await db.query.draftPicks.findFirst({
    where: eq(draftPicks.id, pickId)
  })

  if (!pick) {
    return NextResponse.json({ error: "Pick not found" }, { status: 404 })
  }

  // Build update payload
  const updatePayload: Partial<typeof draftPicks.$inferInsert> = {}
  
  if (teamSlug !== undefined) {
    updatePayload.teamSlug = teamSlug
  }
  
  if (playerId !== undefined) {
    updatePayload.playerId = playerId
    updatePayload.pickedAt = playerId === null ? null : new Date()
  }

  if (Object.keys(updatePayload).length > 0) {
    await db.update(draftPicks)
      .set(updatePayload)
      .where(eq(draftPicks.id, pickId))

    await db.insert(draftLog).values({
      draftId,
      action: "edit_pick",
      detail: { pickId, changes: updatePayload },

    })
  }

  // Fetch updated picks
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

  return NextResponse.json({ picks: allPicks })
}
