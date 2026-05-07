import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; draftId: string }>
}

// GET — Export draft config as JSON backup
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

  // Fetch all related data
  const teamOrder = await db
    .select()
    .from(schema.draftTeamOrder)
    .where(eq(schema.draftTeamOrder.draftId, draftId))
    .orderBy(schema.draftTeamOrder.position)

  const pool = await db
    .select({
      playerId: schema.draftPool.playerId,
      isKeeper: schema.draftPool.isKeeper,
      keeperTeamSlug: schema.draftPool.keeperTeamSlug,
      keeperRound: schema.draftPool.keeperRound,
      registrationMeta: schema.draftPool.registrationMeta,
    })
    .from(schema.draftPool)
    .where(eq(schema.draftPool.draftId, draftId))

  const trades = await db
    .select()
    .from(schema.draftTrades)
    .where(eq(schema.draftTrades.draftId, draftId))

  const tradeItems = []
  for (const trade of trades) {
    const items = await db
      .select()
      .from(schema.draftTradeItems)
      .where(eq(schema.draftTradeItems.tradeId, trade.id))
    tradeItems.push(...items.map((item) => ({ ...item, tradeId: trade.id })))
  }

  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    draft: {
      name: draft.name,
      seasonType: draft.seasonType,
      draftType: draft.draftType,
      rounds: draft.rounds,
      timerSeconds: draft.timerSeconds,
      maxKeepers: draft.maxKeepers,
      draftDate: draft.draftDate,
      location: draft.location,
    },
    teamOrder: teamOrder.map((t) => ({
      teamSlug: t.teamSlug,
      position: t.position,
    })),
    pool: pool.map((p) => ({
      playerId: p.playerId,
      isKeeper: p.isKeeper,
      keeperTeamSlug: p.keeperTeamSlug,
      keeperRound: p.keeperRound,
      registrationMeta: p.registrationMeta,
    })),
    trades: trades
      .filter((t) => !t.isSimulation)
      .map((t) => ({
        id: t.id,
        teamASlug: t.teamASlug,
        teamBSlug: t.teamBSlug,
        tradeType: t.tradeType,
        description: t.description,
      })),
    tradeItems: tradeItems
      .filter((item) => trades.some((t) => !t.isSimulation && t.id === item.tradeId))
      .map((item) => ({
        tradeId: item.tradeId,
        fromTeamSlug: item.fromTeamSlug,
        toTeamSlug: item.toTeamSlug,
        round: item.round,
        position: item.position,
      })),
  }

  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="draft-backup-${draftId}.json"`,
    },
  })
}

// POST — Restore draft config from JSON backup
export async function POST(request: NextRequest, context: RouteContext) {
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
      { error: "Can only restore config in 'draft' status" },
      { status: 400 }
    )
  }

  try {
    const backup = await request.json()

    if (!backup.version || !backup.draft) {
      return NextResponse.json({ error: "Invalid backup format" }, { status: 400 })
    }

    // Update draft settings
    await db
      .update(schema.draftInstances)
      .set({
        name: backup.draft.name || draft.name,
        draftType: backup.draft.draftType || draft.draftType,
        rounds: backup.draft.rounds || draft.rounds,
        timerSeconds: backup.draft.timerSeconds ?? draft.timerSeconds,
        maxKeepers: backup.draft.maxKeepers ?? draft.maxKeepers,
        draftDate: backup.draft.draftDate ? new Date(backup.draft.draftDate) : draft.draftDate,
        location: backup.draft.location ?? draft.location,
        updatedAt: new Date(),
      })
      .where(eq(schema.draftInstances.id, draftId))

    // Restore team order
    if (Array.isArray(backup.teamOrder) && backup.teamOrder.length > 0) {
      await db.delete(schema.draftTeamOrder).where(eq(schema.draftTeamOrder.draftId, draftId))
      await db.insert(schema.draftTeamOrder).values(
        backup.teamOrder.map((t: { teamSlug: string; position: number }) => ({
          draftId,
          teamSlug: t.teamSlug,
          position: t.position,
        }))
      )
    }

    // Restore pool (only keeper flags — don't add/remove players)
    if (Array.isArray(backup.pool)) {
      // Reset all keeper flags first
      await db
        .update(schema.draftPool)
        .set({ isKeeper: false, keeperTeamSlug: null, keeperRound: null })
        .where(eq(schema.draftPool.draftId, draftId))

      // Re-apply keeper assignments
      for (const p of backup.pool) {
        if (p.isKeeper && p.keeperTeamSlug && p.keeperRound) {
          await db
            .update(schema.draftPool)
            .set({
              isKeeper: true,
              keeperTeamSlug: p.keeperTeamSlug,
              keeperRound: p.keeperRound,
            })
            .where(
              and(
                eq(schema.draftPool.draftId, draftId),
                eq(schema.draftPool.playerId, p.playerId)
              )
            )
        }
      }
    }

    // Restore trades
    if (Array.isArray(backup.trades) && backup.trades.length > 0) {
      // Clear existing non-simulation trades
      const existingTrades = await db
        .select({ id: schema.draftTrades.id })
        .from(schema.draftTrades)
        .where(eq(schema.draftTrades.draftId, draftId))

      for (const t of existingTrades) {
        await db.delete(schema.draftTradeItems).where(eq(schema.draftTradeItems.tradeId, t.id))
      }
      await db.delete(schema.draftTrades).where(eq(schema.draftTrades.draftId, draftId))

      // Insert restored trades
      for (const trade of backup.trades) {
        const tradeId = `trade-${crypto.randomUUID()}`
        await db.insert(schema.draftTrades).values({
          id: tradeId,
          draftId,
          teamASlug: trade.teamASlug,
          teamBSlug: trade.teamBSlug,
          tradeType: trade.tradeType,
          description: trade.description,
        })

        // Insert trade items for this trade
        const items = (backup.tradeItems || []).filter(
          (item: { tradeId: string }) => item.tradeId === trade.id
        )
        for (const item of items) {
          await db.insert(schema.draftTradeItems).values({
            tradeId,
            fromTeamSlug: item.fromTeamSlug,
            toTeamSlug: item.toTeamSlug,
            round: item.round,
            position: item.position,
          })
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to restore draft:", err)
    return NextResponse.json({ error: "Failed to restore draft config" }, { status: 500 })
  }
}
