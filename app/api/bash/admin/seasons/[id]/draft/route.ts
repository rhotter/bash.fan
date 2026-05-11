import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string }>
}

// GET — List drafts for a season
export async function GET(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  const drafts = await db
    .select()
    .from(schema.draftInstances)
    .where(eq(schema.draftInstances.seasonId, seasonId))

  // Enrich each draft with team count, pool count, and trades
  const enriched = await Promise.all(
    drafts.map(async (draft) => {
      const teamOrder = await db
        .select({ teamSlug: schema.draftTeamOrder.teamSlug, position: schema.draftTeamOrder.position })
        .from(schema.draftTeamOrder)
        .where(eq(schema.draftTeamOrder.draftId, draft.id))
        .orderBy(schema.draftTeamOrder.position)

      const pool = await db
        .select({ playerId: schema.draftPool.playerId, isKeeper: schema.draftPool.isKeeper })
        .from(schema.draftPool)
        .where(eq(schema.draftPool.draftId, draft.id))

      const trades = await db
        .select({
          id: schema.draftTrades.id,
          teamASlug: schema.draftTrades.teamASlug,
          teamBSlug: schema.draftTrades.teamBSlug,
          tradeType: schema.draftTrades.tradeType,
          description: schema.draftTrades.description,
          tradedAt: schema.draftTrades.tradedAt,
        })
        .from(schema.draftTrades)
        .where(eq(schema.draftTrades.draftId, draft.id))
        .orderBy(schema.draftTrades.tradedAt)

      return {
        ...draft,
        teamCount: teamOrder.length,
        poolCount: pool.length,
        keeperCount: pool.filter((p) => p.isKeeper).length,
        teams: teamOrder,
        tradeCount: trades.length,
        trades: trades.map((t) => ({
          ...t,
          tradedAt: t.tradedAt?.toISOString() || null,
        })),
      }
    })
  )

  return NextResponse.json({ drafts: enriched })
}

// POST — Create a draft instance
export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  // Validate season exists
  const [season] = await db
    .select()
    .from(schema.seasons)
    .where(eq(schema.seasons.id, seasonId))
    .limit(1)

  if (!season) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 })
  }

  try {
    const body = await request.json()
    const {
      name,
      draftType = "snake",
      rounds = 14,
      timerSeconds = 120,
      maxKeepers = 8,
      draftDate,
      location,
      teams, // [{ teamSlug, position }]
      captains, // [{ teamSlug, playerId, playerName }] — optional
      preDraftTrades, // [{ teamASlug, teamARound, teamBSlug, teamBRound }] — optional
    } = body

    if (!name) {
      return NextResponse.json({ error: "Draft name is required" }, { status: 400 })
    }

    const draftId = `draft-${crypto.randomUUID()}`

    // Create draft instance with seasonType snapshot
    const [draft] = await db
      .insert(schema.draftInstances)
      .values({
        id: draftId,
        seasonId,
        seasonType: season.seasonType,
        name,
        draftType,
        rounds,
        timerSeconds,
        maxKeepers,
        draftDate: draftDate ? new Date(draftDate) : null,
        location: location || null,
      })
      .returning()

    // Create team order — use provided teams or fall back to season teams
    let teamRows: { teamSlug: string; position: number }[]

    if (teams && teams.length > 0) {
      teamRows = teams.map((t: { teamSlug: string; position: number }) => ({
        teamSlug: t.teamSlug,
        position: t.position,
      }))
    } else {
      // Auto-populate from season_teams (exclude placeholders)
      const seasonTeams = await db
        .select({ teamSlug: schema.seasonTeams.teamSlug })
        .from(schema.seasonTeams)
        .where(eq(schema.seasonTeams.seasonId, seasonId))

      teamRows = seasonTeams
        .filter((t) => t.teamSlug !== "tbd" && !t.teamSlug.startsWith("seed-"))
        .map((t, i) => ({ teamSlug: t.teamSlug, position: i + 1 }))
    }

    if (teamRows.length > 0) {
      await db.insert(schema.draftTeamOrder).values(
        teamRows.map((t) => ({
          draftId,
          teamSlug: t.teamSlug,
          position: t.position,
        }))
      )
    }

    // Auto-populate draft pool from season roster (player_seasons for this season)
    const seasonPlayers = await db
      .select({ playerId: schema.playerSeasons.playerId })
      .from(schema.playerSeasons)
      .where(eq(schema.playerSeasons.seasonId, seasonId))

    const uniquePlayerIds = [...new Set(seasonPlayers.map((p) => p.playerId))]

    if (uniquePlayerIds.length > 0) {
      await db.insert(schema.draftPool).values(
        uniquePlayerIds.map((playerId) => ({
          draftId,
          playerId,
        }))
      )
    }

    // ── Captain assignments ─────────────────────────────────────────────────
    // Mark captains as keepers in the draft pool and set isCaptain on player_seasons.
    // Captains become mandatory keepers for their team.
    
    // First, clear all existing captains for this season to ensure a clean sync
    await db
      .update(schema.playerSeasons)
      .set({ isCaptain: false })
      .where(eq(schema.playerSeasons.seasonId, seasonId))

    if (Array.isArray(captains) && captains.length > 0) {
      for (const cap of captains) {
        const { teamSlug: capTeamSlug, playerId: capPlayerId } = cap as { teamSlug: string; playerId: number }
        // We do not eagerly set the draftPool keeperRound here anymore.
        // The DraftBoardView `autoPopulate` useEffect will handle it safely
        // to assign sequential rounds (R1, R2, etc.) for multiple captains.
        
        // Set isCaptain and assign team on the player_seasons row
        await db
          .update(schema.playerSeasons)
          .set({ isCaptain: true, teamSlug: capTeamSlug })
          .where(
            and(
              eq(schema.playerSeasons.seasonId, seasonId),
              eq(schema.playerSeasons.playerId, capPlayerId)
            )
          )
      }
    }

    // ── Pre-draft trades ────────────────────────────────────────────────────
    // Store pick swaps agreed upon before draft day. Each trade references picks
    // by their ORIGINAL slot owner (not current owner), enabling the sequential
    // resolution engine to correctly handle chain trades where a pick acquired
    // in one trade is subsequently traded again.
    if (Array.isArray(preDraftTrades) && preDraftTrades.length > 0) {
      for (const trade of preDraftTrades) {
        const {
          teamASlug, teamARound, teamAOriginalOwner,
          teamBSlug, teamBRound, teamBOriginalOwner,
        } = trade as {
          teamASlug: string; teamARound: number; teamAOriginalOwner?: string
          teamBSlug: string; teamBRound: number; teamBOriginalOwner?: string
        }
        // Default originalOwner to the trading team if not specified (simple swap)
        const origOwnerA = teamAOriginalOwner || teamASlug
        const origOwnerB = teamBOriginalOwner || teamBSlug
        const viaA = origOwnerA !== teamASlug ? ` (via ${origOwnerA})` : ""
        const viaB = origOwnerB !== teamBSlug ? ` (via ${origOwnerB})` : ""

        const tradeId = `trade-${crypto.randomUUID()}`
        await db.insert(schema.draftTrades).values({
          id: tradeId,
          draftId,
          teamASlug,
          teamBSlug,
          tradeType: "pre_draft_pick_swap",
          description: `Pre-draft: ${teamASlug} Rd ${teamARound}${viaA} ↔ ${teamBSlug} Rd ${teamBRound}${viaB}`,
        })
        // Item 1: Original pick slot (origOwnerA, round) → goes to teamBSlug
        await db.insert(schema.draftTradeItems).values({
          tradeId,
          fromTeamSlug: origOwnerA,  // original slot owner
          toTeamSlug: teamBSlug,
          round: teamARound,
        })
        // Item 2: Original pick slot (origOwnerB, round) → goes to teamASlug
        await db.insert(schema.draftTradeItems).values({
          tradeId,
          fromTeamSlug: origOwnerB,  // original slot owner
          toTeamSlug: teamASlug,
          round: teamBRound,
        })
      }
    }

    const poolCount = uniquePlayerIds.length
    const suggestedRounds = teamRows.length > 0
      ? Math.ceil(poolCount / teamRows.length)
      : rounds

    return NextResponse.json({
      draft,
      teamCount: teamRows.length,
      poolCount,
      suggestedRounds,
    }, { status: 201 })
  } catch (err) {
    console.error("Failed to create draft:", err)
    return NextResponse.json({ error: "Failed to create draft" }, { status: 500 })
  }
}
