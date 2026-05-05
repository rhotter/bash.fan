import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; draftId: string }>
}

// GET — Draft detail
export async function GET(_request: NextRequest, context: RouteContext) {
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

  // Fetch team order
  const teamOrder = await db
    .select({
      teamSlug: schema.draftTeamOrder.teamSlug,
      position: schema.draftTeamOrder.position,
      teamName: schema.teams.name,
    })
    .from(schema.draftTeamOrder)
    .innerJoin(schema.teams, eq(schema.draftTeamOrder.teamSlug, schema.teams.slug))
    .where(eq(schema.draftTeamOrder.draftId, draftId))
    .orderBy(schema.draftTeamOrder.position)

  // Fetch pool summary
  const pool = await db
    .select({
      playerId: schema.draftPool.playerId,
      playerName: schema.players.name,
      isKeeper: schema.draftPool.isKeeper,
      keeperTeamSlug: schema.draftPool.keeperTeamSlug,
      keeperRound: schema.draftPool.keeperRound,
      registrationMeta: schema.draftPool.registrationMeta,
    })
    .from(schema.draftPool)
    .innerJoin(schema.players, eq(schema.draftPool.playerId, schema.players.id))
    .where(eq(schema.draftPool.draftId, draftId))

  return NextResponse.json({
    ...draft,
    teams: teamOrder,
    pool,
    teamCount: teamOrder.length,
    poolCount: pool.length,
    keeperCount: pool.filter((p) => p.isKeeper).length,
  })
}

// PUT — Update draft settings
export async function PUT(request: NextRequest, context: RouteContext) {
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

  if (existing.status !== "draft") {
    return NextResponse.json(
      { error: "Can only edit drafts in 'draft' status" },
      { status: 400 }
    )
  }

  try {
    const body = await request.json()
    const {
      name, draftType, rounds, timerSeconds, maxKeepers,
      draftDate, location, teams,
    } = body

    // Update draft instance fields
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (name !== undefined) updates.name = name
    if (draftType !== undefined) updates.draftType = draftType
    if (rounds !== undefined) updates.rounds = rounds
    if (timerSeconds !== undefined) updates.timerSeconds = timerSeconds
    if (maxKeepers !== undefined) updates.maxKeepers = maxKeepers
    if (draftDate !== undefined) updates.draftDate = draftDate ? new Date(draftDate) : null
    if (location !== undefined) updates.location = location

    await db
      .update(schema.draftInstances)
      .set(updates)
      .where(eq(schema.draftInstances.id, draftId))

    // Update team order if provided
    if (teams && Array.isArray(teams)) {
      await db.delete(schema.draftTeamOrder).where(eq(schema.draftTeamOrder.draftId, draftId))
      if (teams.length > 0) {
        await db.insert(schema.draftTeamOrder).values(
          teams.map((t: { teamSlug: string; position: number }) => ({
            draftId,
            teamSlug: t.teamSlug,
            position: t.position,
          }))
        )
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to update draft:", err)
    return NextResponse.json({ error: "Failed to update draft" }, { status: 500 })
  }
}

// DELETE — Delete draft instance (cascade handles children)
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

  if (existing.status !== "draft") {
    return NextResponse.json(
      { error: "Can only delete drafts in 'draft' status" },
      { status: 400 }
    )
  }

  try {
    await db.delete(schema.draftInstances).where(eq(schema.draftInstances.id, draftId))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to delete draft:", err)
    return NextResponse.json({ error: "Failed to delete draft" }, { status: 500 })
  }
}
