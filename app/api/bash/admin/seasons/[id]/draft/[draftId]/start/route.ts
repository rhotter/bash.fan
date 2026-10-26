import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and, asc, inArray } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { resolvePreDraftTrades, type PreDraftTradeInput, type SinglePickTransferInput } from "@/lib/draft-trade-resolver"
import { generatePickSlots } from "@/lib/draft-helpers"
import { syncDraftBanner } from "@/lib/draft-banner-sync"
import { getTargetFallSeasonCandidates } from "@/lib/trade-helpers"

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

  const { id, draftId } = await context.params

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

    // 2. Reconcile prior-season Fall pick trades & fetch pre-draft trades to resolve ownership
    const [season] = await db
      .select({ seasonType: schema.seasons.seasonType })
      .from(schema.seasons)
      .where(eq(schema.seasons.id, id))
      .limit(1)

    let trades = await db
      .select()
      .from(schema.draftTrades)
      .where(eq(schema.draftTrades.draftId, draftId))
      .orderBy(asc(schema.draftTrades.tradedAt), asc(schema.draftTrades.id))

    let allItems =
      trades.length > 0
        ? await db
            .select()
            .from(schema.draftTradeItems)
            .where(
              inArray(
                schema.draftTradeItems.tradeId,
                trades.map((t) => t.id)
              )
            )
            .orderBy(asc(schema.draftTradeItems.id))
        : []

    if (season?.seasonType === "fall") {
      const targetCandidates = getTargetFallSeasonCandidates(id, season.seasonType)
      if (targetCandidates.length > 0) {
        const priorPickItems = await db
          .select({
            tradeId: schema.seasonTradeItems.tradeId,
            fromTeamSlug: schema.seasonTradeItems.fromTeamSlug,
            toTeamSlug: schema.seasonTradeItems.toTeamSlug,
            round: schema.seasonTradeItems.draftPickRound,
            originalTeamSlug: schema.seasonTradeItems.draftPickOriginalTeamSlug,
            tradedAt: schema.seasonTrades.tradedAt,
          })
          .from(schema.seasonTradeItems)
          .innerJoin(
            schema.seasonTrades,
            eq(schema.seasonTradeItems.tradeId, schema.seasonTrades.id)
          )
          .where(
            and(
              eq(schema.seasonTradeItems.itemType, "draft_pick"),
              inArray(schema.seasonTradeItems.draftPickTargetSeason, targetCandidates)
            )
          )
          .orderBy(
            asc(schema.seasonTrades.tradedAt),
            asc(schema.seasonTrades.id),
            asc(schema.seasonTradeItems.id)
          )

        // Replace any previously seeded 1-item "Prior season trade:" entries so picks
        // traded or undone after draft creation/sync are always reflected when starting.
        const seededPriorTrades = trades.filter((t) =>
          t.description?.startsWith("Prior season trade:")
        )
        for (const st of seededPriorTrades) {
          await db.delete(schema.draftTradeItems).where(eq(schema.draftTradeItems.tradeId, st.id))
          await db.delete(schema.draftTrades).where(eq(schema.draftTrades.id, st.id))
        }

        const refreshedPriorTrades: typeof trades = []
        const refreshedPriorItems: typeof allItems = []

        for (const item of priorPickItems) {
          if (!item.round) continue
          const origOwner = item.originalTeamSlug || item.fromTeamSlug
          const via = origOwner !== item.fromTeamSlug ? ` (via ${origOwner})` : ""
          const draftTradeId = `trade-${crypto.randomUUID()}`
          const description = `Prior season trade: ${item.fromTeamSlug} Rd ${item.round}${via} → ${item.toTeamSlug}`

          await db.insert(schema.draftTrades).values({
            id: draftTradeId,
            draftId,
            teamASlug: item.fromTeamSlug,
            teamBSlug: item.toTeamSlug,
            tradeType: "pre_draft_pick_swap",
            description,
          })

          await db.insert(schema.draftTradeItems).values({
            tradeId: draftTradeId,
            fromTeamSlug: origOwner,
            toTeamSlug: item.toTeamSlug,
            round: item.round,
          })

          refreshedPriorTrades.push({
            id: draftTradeId,
            draftId,
            teamASlug: item.fromTeamSlug,
            teamBSlug: item.toTeamSlug,
            tradeType: "pre_draft_pick_swap",
            description,
            tradedAt: new Date(item.tradedAt),
          })
          refreshedPriorItems.push({
            id: 0,
            tradeId: draftTradeId,
            fromTeamSlug: origOwner,
            toTeamSlug: item.toTeamSlug,
            pickId: null,
            round: item.round,
            position: null,
            playerId: null,
          })
        }

        const remainingTrades = trades.filter(
          (t) => !t.description?.startsWith("Prior season trade:")
        )
        const remainingTradeIds = new Set(remainingTrades.map((t) => t.id))
        trades = [...refreshedPriorTrades, ...remainingTrades]
        allItems = [
          ...refreshedPriorItems,
          ...allItems.filter((item) => remainingTradeIds.has(item.tradeId)),
        ]
      }
    }

    const itemsByTradeId = new Map<string, typeof allItems>()
    for (const item of allItems) {
      const list = itemsByTradeId.get(item.tradeId) || []
      list.push(item)
      itemsByTradeId.set(item.tradeId, list)
    }

    // Rebuild trade inputs from stored trade items
    // Supports both 2-item pick swaps and 1-item prior-season pick transfers
    const tradeInputs: PreDraftTradeInput[] = []
    const singleTransfers: SinglePickTransferInput[] = []
    for (const trade of trades) {
      const items = itemsByTradeId.get(trade.id) || []

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
      } else if (items.length === 1 && items[0].round) {
        singleTransfers.push({
          originalTeamSlug: items[0].fromTeamSlug,
          round: items[0].round,
          toTeamSlug: items[0].toTeamSlug,
        })
      }
    }

    // Resolve the final ownership map (1-item prior-season transfers applied before 2-item pre-draft swaps)
    const ownershipMap = resolvePreDraftTrades(teamSlugs, draft.rounds, tradeInputs, singleTransfers)

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
    // Track assigned keeper players to prevent duplicates when traded slots
    // cause the same team to own two slots in the same round.
    const assignedKeeperPlayerIds = new Set<number>()
    const pickRows = pickSlots.map((slot) => {
      const keeperKey = `${slot.teamSlug}::${slot.round}`
      let keeperPlayerId = keeperMap.get(keeperKey) || null

      // Prevent the same player from being assigned to multiple slots
      if (keeperPlayerId && assignedKeeperPlayerIds.has(keeperPlayerId)) {
        keeperPlayerId = null
      }
      if (keeperPlayerId) {
        assignedKeeperPlayerIds.add(keeperPlayerId)
      }

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

    // 10. Activate live draft banner
    try {
      await syncDraftBanner({
        draftId,
        seasonId: id,
        event: "start",
      })
    } catch (bannerErr) {
      console.error("Failed to sync live draft banner on start:", bannerErr)
    }

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
