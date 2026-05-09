import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; draftId: string }>
}

/**
 * POST — Sync draft teams & player pool from the season.
 *
 * Populates (or refreshes) the draft_team_order and draft_pool tables
 * from the current season_teams and player_seasons rows. Designed for
 * the case where a draft was announced (published) before teams/roster
 * were configured.
 *
 * Also auto-calculates rounds if the draft currently has 0 rounds.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId, draftId } = await context.params

  // Validate draft exists and is in a pre-live state
  const [draft] = await db
    .select()
    .from(schema.draftInstances)
    .where(eq(schema.draftInstances.id, draftId))
    .limit(1)

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  }

  if (draft.status !== "draft" && draft.status !== "published") {
    return NextResponse.json(
      { error: "Can only sync teams/pool for drafts in draft or published status" },
      { status: 400 }
    )
  }

  try {
    // ── Clear pre-draft trades ──────────────────────────────────────────
    // Remove existing pre-draft trades so the wizard can save fresh ones.
    // This prevents trade accumulation across multiple configure runs.
    const existingTrades = await db
      .select({ id: schema.draftTrades.id })
      .from(schema.draftTrades)
      .where(eq(schema.draftTrades.draftId, draftId))

    for (const t of existingTrades) {
      await db.delete(schema.draftTradeItems).where(eq(schema.draftTradeItems.tradeId, t.id))
    }
    await db.delete(schema.draftTrades).where(eq(schema.draftTrades.draftId, draftId))

    // ── Sync Teams ──────────────────────────────────────────────────────
    // Clear existing team order and re-populate from season teams
    await db.delete(schema.draftTeamOrder).where(eq(schema.draftTeamOrder.draftId, draftId))

    const seasonTeams = await db
      .select({ teamSlug: schema.seasonTeams.teamSlug })
      .from(schema.seasonTeams)
      .where(eq(schema.seasonTeams.seasonId, seasonId))

    const validTeams = seasonTeams.filter(
      (t) => t.teamSlug !== "tbd" && !t.teamSlug.startsWith("seed-")
    )

    if (validTeams.length > 0) {
      await db.insert(schema.draftTeamOrder).values(
        validTeams.map((t, i) => ({
          draftId,
          teamSlug: t.teamSlug,
          position: i + 1,
        }))
      )
    }

    // ── Sync Player Pool ────────────────────────────────────────────────
    // Clear existing pool and re-populate from season roster, carrying
    // registration metadata (skill, position, age, etc.) for player cards.
    await db.delete(schema.draftPool).where(eq(schema.draftPool.draftId, draftId))

    const seasonPlayers = await db
      .select({
        playerId: schema.playerSeasons.playerId,
        isGoalie: schema.playerSeasons.isGoalie,
        isRookie: schema.playerSeasons.isRookie,
        isCaptain: schema.playerSeasons.isCaptain,
        registrationMeta: schema.playerSeasons.registrationMeta,
      })
      .from(schema.playerSeasons)
      .where(eq(schema.playerSeasons.seasonId, seasonId))

    // Deduplicate by playerId (a player could appear on multiple teams)
    const playerMap = new Map<number, typeof seasonPlayers[number]>()
    for (const p of seasonPlayers) {
      if (!playerMap.has(p.playerId)) {
        playerMap.set(p.playerId, p)
      }
    }
    const uniquePlayers = Array.from(playerMap.values())

    if (uniquePlayers.length > 0) {
      await db.insert(schema.draftPool).values(
        uniquePlayers.map((p) => {
          // If the roster import stored full registrationMeta, use it directly.
          // Otherwise, compose a minimal one from the boolean flags.
          const meta = p.registrationMeta as Record<string, unknown> | null
          const registrationMeta = meta ?? {
            positions: p.isGoalie ? "G" : null,
            isRookie: p.isRookie,
            isCaptain: p.isCaptain,
          }

          return {
            draftId,
            playerId: p.playerId,
            registrationMeta,
          }
        })
      )
    }

    // ── Auto-calculate rounds if currently 0 ────────────────────────────
    let rounds = draft.rounds
    if (rounds === 0 && validTeams.length > 0 && uniquePlayers.length > 0) {
      rounds = Math.ceil(uniquePlayers.length / validTeams.length)
      await db
        .update(schema.draftInstances)
        .set({ rounds, updatedAt: new Date() })
        .where(eq(schema.draftInstances.id, draftId))
    }

    return NextResponse.json({
      ok: true,
      teamCount: validTeams.length,
      poolCount: uniquePlayers.length,
      rounds,
    })
  } catch (err) {
    console.error("Failed to sync draft from season:", err)
    return NextResponse.json({ error: "Failed to sync draft" }, { status: 500 })
  }
}
