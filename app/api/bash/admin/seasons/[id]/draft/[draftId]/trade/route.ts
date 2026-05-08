import { db } from "@/lib/db"
import { draftPicks, draftInstances, players, draftTrades, draftTradeItems, draftLog } from "@/lib/db/schema"
import { eq, inArray } from "drizzle-orm"
import { NextResponse } from "next/server"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; draftId: string }> }
) {
  const { id: _seasonId, draftId } = await params
  const body = await req.json()
  const { type } = body

  // ── Pre-draft trade creation (from admin dashboard) ───────────────────────
  if (type === "pre_draft_pick_swap") {
    const { teamASlug, teamARound, teamAOriginalOwner, teamBSlug, teamBRound, teamBOriginalOwner } = body

    if (!teamASlug || !teamBSlug || !teamARound || !teamBRound) {
      return NextResponse.json({ error: "All trade fields are required" }, { status: 400 })
    }

    if (teamASlug === teamBSlug) {
      return NextResponse.json({ error: "Cannot trade between the same team" }, { status: 400 })
    }

    const draft = await db.query.draftInstances.findFirst({
      where: eq(draftInstances.id, draftId)
    })

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 })
    }

    if (draft.status !== "draft") {
      return NextResponse.json(
        { error: "Pre-draft trades can only be added while draft is in draft status" },
        { status: 400 }
      )
    }

    try {
      const origOwnerA = teamAOriginalOwner || teamASlug
      const origOwnerB = teamBOriginalOwner || teamBSlug
      const viaA = origOwnerA !== teamASlug ? ` (via ${origOwnerA})` : ""
      const viaB = origOwnerB !== teamBSlug ? ` (via ${origOwnerB})` : ""

      const tradeId = `trade-${crypto.randomUUID()}`
      const [trade] = await db.insert(draftTrades).values({
        id: tradeId,
        draftId,
        teamASlug,
        teamBSlug,
        tradeType: "pre_draft_pick_swap",
        description: `Pre-draft: ${teamASlug} Rd ${teamARound}${viaA} ↔ ${teamBSlug} Rd ${teamBRound}${viaB}`,
        isSimulation: false,
      }).returning()

      await db.insert(draftTradeItems).values([
        {
          tradeId,
          fromTeamSlug: origOwnerA,
          toTeamSlug: teamBSlug,
          round: parseInt(String(teamARound), 10),
        },
        {
          tradeId,
          fromTeamSlug: origOwnerB,
          toTeamSlug: teamASlug,
          round: parseInt(String(teamBRound), 10),
        },
      ])

      return NextResponse.json({ trade }, { status: 201 })
    } catch (err) {
      console.error("Failed to create pre-draft trade:", err)
      return NextResponse.json({ error: "Failed to create trade" }, { status: 500 })
    }
  }

  // ── Live pick swap (existing behavior) ────────────────────────────────────
  const { pickIds } = body

  if (type !== "pick_swap" || !pickIds || pickIds.length !== 2) {
    return NextResponse.json({ error: "Invalid trade payload" }, { status: 400 })
  }

  // Verify draft is active
  const draft = await db.query.draftInstances.findFirst({
    where: eq(draftInstances.id, draftId)
  })

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  }

  // Get the two picks
  const picksToSwap = await db.query.draftPicks.findMany({
    where: inArray(draftPicks.id, pickIds)
  })

  if (picksToSwap.length !== 2) {
    return NextResponse.json({ error: "Picks not found" }, { status: 404 })
  }

  const [pick1, pick2] = picksToSwap

  if (pick1.isKeeper || pick2.isKeeper) {
    return NextResponse.json({ error: "Cannot trade keeper picks" }, { status: 400 })
  }

  const team1 = pick1.teamSlug
  const team2 = pick2.teamSlug

  if (team1 === team2) {
    return NextResponse.json({ error: "Cannot trade picks from the same team" }, { status: 400 })
  }

  try {
    // Update pick 1
    await db.update(draftPicks)
      .set({ teamSlug: team2 })
      .where(eq(draftPicks.id, pick1.id))

    // Update pick 2
    await db.update(draftPicks)
      .set({ teamSlug: team1 })
      .where(eq(draftPicks.id, pick2.id))

    // Record trade
    const [trade] = await db.insert(draftTrades).values({
      id: `trade_${Date.now()}`,
      draftId,
      teamASlug: team1,
      teamBSlug: team2,
      tradeType: "pick_swap",
      description: `${team1} trades R${pick1.round}P${pick1.pickNumber} to ${team2} for R${pick2.round}P${pick2.pickNumber}`,
      isSimulation: false
    }).returning()

    await db.insert(draftTradeItems).values([
      {
        tradeId: trade.id,
        fromTeamSlug: team1,
        toTeamSlug: team2,
        pickId: pick1.id,
        round: pick1.round,
        position: pick1.pickNumber
      },
      {
        tradeId: trade.id,
        fromTeamSlug: team2,
        toTeamSlug: team1,
        pickId: pick2.id,
        round: pick2.round,
        position: pick2.pickNumber
      }
    ])

    await db.insert(draftLog).values({
      draftId,
      action: "trade",
      detail: { tradeId: trade.id, type: "pick_swap" },
      isSimulation: false
    })
  } catch (err) {
    console.error("Trade failed:", err)
    return NextResponse.json({ error: "Failed to execute trade" }, { status: 500 })
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

