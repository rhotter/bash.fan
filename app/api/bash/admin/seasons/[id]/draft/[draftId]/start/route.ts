import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { resolvePreDraftTrades, type PreDraftTradeInput } from "@/lib/draft-trade-resolver"
import { generatePickSlots } from "@/lib/draft-helpers"

interface RouteContext {
  params: Promise<{ id: string; draftId: string }>
}

// POST — Start draft (published → live)
// Pre-generates all pick slots, applies trade ownership, fills keeper picks
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

  if (draft.status !== "published") {
    return NextResponse.json(
      { error: `Cannot start draft from '${draft.status}' status. Must be 'published'.` },
      { status: 400 }
    )
  }

  try {
    // 1. Fetch team order
    const teamOrder = await db
      .select({ teamSlug: schema.draftTeamOrder.teamSlug })
      .from(schema.draftTeamOrder)
      .where(eq(schema.draftTeamOrder.draftId, draftId))
      .orderBy(schema.draftTeamOrder.position)

    if (teamOrder.length < 2) {
      return NextResponse.json(
        { error: "At least 2 teams are required to start a draft" },
        { status: 400 }
      )
    }

    const teamSlugs = teamOrder.map((t) => t.teamSlug)

    // 2. Fetch pre-draft trades and resolve ownership
    const trades = await db
      .select()
      .from(schema.draftTrades)
      .where(
        and(
          eq(schema.draftTrades.draftId, draftId),
          eq(schema.draftTrades.isSimulation, false)
        )
      )

    // Rebuild trade inputs from stored trade items
    // Each trade has exactly 2 items: the two sides of the swap
    const tradeInputs: PreDraftTradeInput[] = []
    for (const trade of trades) {
      const items = await db
        .select()
        .from(schema.draftTradeItems)
        .where(eq(schema.draftTradeItems.tradeId, trade.id))

      if (items.length === 2) {
        // Item 0: side A (from original owner → to team B)
        // Item 1: side B (from original owner → to team A)
        tradeInputs.push({
          teamASlug: trade.teamASlug,
          teamARound: items[0].round!,
          teamAOriginalOwner: items[0].fromTeamSlug,
          teamBSlug: trade.teamBSlug,
          teamBRound: items[1].round!,
          teamBOriginalOwner: items[1].fromTeamSlug,
        })
      }
    }

    // Resolve the final ownership map
    const ownershipMap = resolvePreDraftTrades(teamSlugs, draft.rounds, tradeInputs)

    // 3. Generate all pick slots
    const pickSlots = generatePickSlots(
      teamSlugs,
      draft.rounds,
      draft.draftType as "snake" | "linear",
      ownershipMap
    )

    // 4. Fetch keepers from pool
    const keepers = await db
      .select()
      .from(schema.draftPool)
      .where(
        and(
          eq(schema.draftPool.draftId, draftId),
          eq(schema.draftPool.isKeeper, true)
        )
      )

    // Build a lookup: teamSlug+round → keeper playerId
    const keeperMap = new Map<string, number>()
    for (const k of keepers) {
      if (k.keeperTeamSlug && k.keeperRound) {
        keeperMap.set(`${k.keeperTeamSlug}::${k.keeperRound}`, k.playerId)
      }
    }

    // 5. Clear any existing picks (shouldn't be any, but safety)
    await db
      .delete(schema.draftPicks)
      .where(eq(schema.draftPicks.draftId, draftId))

    // 6. Insert all pick slots, filling keeper picks
    const pickRows = pickSlots.map((slot) => {
      const keeperKey = `${slot.teamSlug}::${slot.round}`
      const keeperPlayerId = keeperMap.get(keeperKey) || null

      return {
        id: `pick-${crypto.randomUUID()}`,
        draftId,
        round: slot.round,
        pickNumber: slot.pickNumber,
        teamSlug: slot.teamSlug,
        originalTeamSlug: slot.originalTeamSlug,
        playerId: keeperPlayerId,
        pickedAt: keeperPlayerId ? new Date() : null,
        isKeeper: !!keeperPlayerId,
        isSimulation: false,
      }
    })

    // Insert in batches of 50 to avoid query size limits
    const BATCH_SIZE = 50
    for (let i = 0; i < pickRows.length; i += BATCH_SIZE) {
      const batch = pickRows.slice(i, i + BATCH_SIZE)
      await db.insert(schema.draftPicks).values(batch)
    }

    // 7. Find the first empty pick (non-keeper) for the starting position
    const firstEmptyPick = pickRows.find((p) => !p.playerId)

    // 8. Transition to live
    await db
      .update(schema.draftInstances)
      .set({
        status: "live",
        currentRound: firstEmptyPick?.round || 1,
        currentPick: firstEmptyPick?.pickNumber || 1,
        timerCountdown: draft.timerSeconds,
        timerRunning: false,
        timerStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.draftInstances.id, draftId))

    // 9. Log the start event
    await db.insert(schema.draftLog).values({
      draftId,
      action: "start",
      detail: {
        totalPicks: pickRows.length,
        keeperPicks: keepers.length,
        teams: teamSlugs.length,
        rounds: draft.rounds,
      },
    })

    return NextResponse.json({
      ok: true,
      status: "live",
      totalPicks: pickRows.length,
      keeperPicks: keepers.length,
      firstPick: firstEmptyPick?.pickNumber || 1,
    })
  } catch (err) {
    console.error("Failed to start draft:", err)
    return NextResponse.json({ error: "Failed to start draft" }, { status: 500 })
  }
}
