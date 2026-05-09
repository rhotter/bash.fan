import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; draftId: string }>
}

// GET — Fetch keeper assignments for a draft
export async function GET(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { draftId } = await context.params

  const keepers = await db
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
    .where(
      and(
        eq(schema.draftPool.draftId, draftId),
        eq(schema.draftPool.isKeeper, true)
      )
    )

  return NextResponse.json({ keepers })
}

// PUT — Bulk update keeper assignments
// Body: { keepers: [{ playerId, teamSlug, round }] }
// This replaces all keeper assignments for the draft.
export async function PUT(request: NextRequest, context: RouteContext) {
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

  // Allow keeper edits in draft or published status (not live/completed)
  if (draft.status !== "draft" && draft.status !== "published") {
    return NextResponse.json(
      { error: `Cannot edit keepers in '${draft.status}' status` },
      { status: 400 }
    )
  }

  try {
    const body = await request.json()
    const { keepers } = body as {
      keepers: Array<{ playerId: number; teamSlug: string; round: number }>
    }

    if (!Array.isArray(keepers)) {
      return NextResponse.json({ error: "keepers must be an array" }, { status: 400 })
    }

    // Validate keeper count per team doesn't exceed maxKeepers
    const teamCounts = new Map<string, number>()
    for (const k of keepers) {
      teamCounts.set(k.teamSlug, (teamCounts.get(k.teamSlug) || 0) + 1)
    }
    for (const [teamSlug, count] of teamCounts) {
      if (count > draft.maxKeepers) {
        return NextResponse.json(
          { error: `Team ${teamSlug} has ${count} keepers, max is ${draft.maxKeepers}` },
          { status: 400 }
        )
      }
    }

    // Auto-repair duplicate round assignments per team:
    // If a team has multiple keepers at the same round, reassign sequential rounds.
    const teamKeepers = new Map<string, Array<{ playerId: number; round: number; index: number }>>()
    for (let i = 0; i < keepers.length; i++) {
      const k = keepers[i]
      const list = teamKeepers.get(k.teamSlug) || []
      list.push({ playerId: k.playerId, round: k.round, index: i })
      teamKeepers.set(k.teamSlug, list)
    }

    for (const [, list] of teamKeepers) {
      const rounds = list.map((k) => k.round)
      const hasDupes = new Set(rounds).size !== rounds.length
      if (hasDupes) {
        // Sort by original round (preserve intent), then reassign 1, 2, 3...
        list.sort((a, b) => a.round - b.round)
        for (let i = 0; i < list.length; i++) {
          keepers[list[i].index] = { ...keepers[list[i].index], round: i + 1 }
        }
      }
    }

    // 1. Clear all existing keeper flags on pool
    await db
      .update(schema.draftPool)
      .set({ isKeeper: false, keeperTeamSlug: null, keeperRound: null })
      .where(eq(schema.draftPool.draftId, draftId))

    // 2. Set new keeper assignments
    for (const k of keepers) {
      await db
        .update(schema.draftPool)
        .set({
          isKeeper: true,
          keeperTeamSlug: k.teamSlug,
          keeperRound: k.round,
        })
        .where(
          and(
            eq(schema.draftPool.draftId, draftId),
            eq(schema.draftPool.playerId, k.playerId)
          )
        )
    }

    await db
      .update(schema.draftInstances)
      .set({ updatedAt: new Date() })
      .where(eq(schema.draftInstances.id, draftId))

    return NextResponse.json({ ok: true, keeperCount: keepers.length })
  } catch (err) {
    console.error("Failed to update keepers:", err)
    return NextResponse.json({ error: "Failed to update keepers" }, { status: 500 })
  }
}
