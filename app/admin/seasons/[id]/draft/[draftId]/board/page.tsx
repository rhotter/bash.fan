import { notFound, redirect } from "next/navigation"
import { db, schema } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { DraftBoardView } from "@/components/admin/draft-board-view"

interface BoardPageProps {
  params: Promise<{ id: string; draftId: string }>
}

export async function generateMetadata({ params }: BoardPageProps) {
  const { draftId } = await params
  const [draft] = await db
    .select({ name: schema.draftInstances.name })
    .from(schema.draftInstances)
    .where(eq(schema.draftInstances.id, draftId))
    .limit(1)
  return { title: draft ? `${draft.name} — Board` : "Draft Board" }
}

export default async function DraftBoardPage({ params }: BoardPageProps) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) redirect("/admin")

  const { id: seasonId, draftId } = await params

  // Fetch draft instance
  const [draft] = await db
    .select()
    .from(schema.draftInstances)
    .where(eq(schema.draftInstances.id, draftId))
    .limit(1)

  if (!draft || draft.seasonId !== seasonId) notFound()

  // Fetch team order with team names and franchise colors
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

  // Fetch franchise colors for each team
  const teamColors: Record<string, string | null> = {}
  for (const team of teamOrder) {
    const [st] = await db
      .select({ franchiseSlug: schema.seasonTeams.franchiseSlug })
      .from(schema.seasonTeams)
      .where(
        and(
          eq(schema.seasonTeams.seasonId, seasonId),
          eq(schema.seasonTeams.teamSlug, team.teamSlug)
        )
      )
      .limit(1)

    if (st?.franchiseSlug) {
      const [franchise] = await db
        .select({ color: schema.franchises.color })
        .from(schema.franchises)
        .where(eq(schema.franchises.slug, st.franchiseSlug))
        .limit(1)
      teamColors[team.teamSlug] = franchise?.color || null
    } else {
      teamColors[team.teamSlug] = null
    }
  }

  // Fetch pool with player names
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

  // Auto-repair duplicate keeper round assignments per team
  const keepersByTeam = new Map<string, typeof pool>()
  for (const p of pool) {
    if (p.isKeeper && p.keeperTeamSlug) {
      const list = keepersByTeam.get(p.keeperTeamSlug) || []
      list.push(p)
      keepersByTeam.set(p.keeperTeamSlug, list)
    }
  }

  let needsRepair = false
  for (const [, keepers] of keepersByTeam) {
    const rounds = keepers.map((k) => k.keeperRound)
    if (new Set(rounds).size !== rounds.length) {
      needsRepair = true
      // Sort by current round (preserve order intent), then reassign 1, 2, 3...
      keepers.sort((a, b) => (a.keeperRound || 0) - (b.keeperRound || 0))
      for (let i = 0; i < keepers.length; i++) {
        keepers[i].keeperRound = i + 1
      }
    }
  }

  // Persist repairs to DB
  if (needsRepair) {
    for (const [, keepers] of keepersByTeam) {
      for (const k of keepers) {
        await db
          .update(schema.draftPool)
          .set({ keeperRound: k.keeperRound })
          .where(
            and(
              eq(schema.draftPool.draftId, draftId),
              eq(schema.draftPool.playerId, k.playerId)
            )
          )
      }
    }
  }

  // Fetch picks if they exist
  const picks = await db
    .select({
      id: schema.draftPicks.id,
      round: schema.draftPicks.round,
      pickNumber: schema.draftPicks.pickNumber,
      teamSlug: schema.draftPicks.teamSlug,
      originalTeamSlug: schema.draftPicks.originalTeamSlug,
      playerId: schema.draftPicks.playerId,
      isKeeper: schema.draftPicks.isKeeper,


      pickedAt: schema.draftPicks.pickedAt,
    })
    .from(schema.draftPicks)
    .where(eq(schema.draftPicks.draftId, draftId))
    .orderBy(schema.draftPicks.pickNumber)

  // Resolve player names for picks that have players
  const playerIds = picks.filter((p) => p.playerId).map((p) => p.playerId!)
  const playerMap: Record<number, string> = {}
  if (playerIds.length > 0) {
    const players = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)

    for (const p of players) {
      if (playerIds.includes(p.id)) {
        playerMap[p.id] = p.name
      }
    }
  }

  // Fetch all trades (pre-draft + live/simulation) with their items
  const trades = await db
    .select()
    .from(schema.draftTrades)
    .where(eq(schema.draftTrades.draftId, draftId))

  // Fetch trade items for all trades
  const tradeItemsByTradeId: Record<string, Array<{
    fromTeamSlug: string
    toTeamSlug: string
    round: number | null
  }>> = {}
  for (const trade of trades) {
    const items = await db
      .select({
        fromTeamSlug: schema.draftTradeItems.fromTeamSlug,
        toTeamSlug: schema.draftTradeItems.toTeamSlug,
        round: schema.draftTradeItems.round,
      })
      .from(schema.draftTradeItems)
      .where(eq(schema.draftTradeItems.tradeId, trade.id))
    tradeItemsByTradeId[trade.id] = items
  }

  // Fetch season name
  const [season] = await db
    .select({ id: schema.seasons.id, name: schema.seasons.name })
    .from(schema.seasons)
    .where(eq(schema.seasons.id, seasonId))
    .limit(1)

  // Fetch captains for this season
  const captains = await db
    .select({
      playerId: schema.playerSeasons.playerId,
      teamSlug: schema.playerSeasons.teamSlug,
      playerName: schema.players.name,
    })
    .from(schema.playerSeasons)
    .innerJoin(schema.players, eq(schema.playerSeasons.playerId, schema.players.id))
    .where(
      and(
        eq(schema.playerSeasons.seasonId, seasonId),
        eq(schema.playerSeasons.isCaptain, true)
      )
    )

  // Serialize draft for client (convert Date → string)
  const serializedDraft = {
    ...draft,
    draftDate: draft.draftDate?.toISOString() || null,
    createdAt: draft.createdAt?.toISOString() || null,
    updatedAt: draft.updatedAt?.toISOString() || null,
    timerStartedAt: draft.timerStartedAt?.toISOString() || null,
  }

  return (
    <DraftBoardView
      seasonId={seasonId}
      seasonSlug={season?.id || seasonId}
      seasonName={season?.name || ""}
      draft={serializedDraft}
      teams={teamOrder.map((t) => ({
        ...t,
        color: teamColors[t.teamSlug] || null,
      }))}
      pool={pool.map((p) => ({
        ...p,
        registrationMeta: (p.registrationMeta as Record<string, unknown>) || null,
      }))}
      picks={picks.map((p) => ({
        ...p,
        playerName: p.playerId ? playerMap[p.playerId] || "Unknown" : null,
        pickedAt: p.pickedAt?.toISOString() || null,
      }))}
      trades={trades.map((t) => ({
        ...t,
        tradedAt: t.tradedAt?.toISOString() || null,
        items: tradeItemsByTradeId[t.id] || [],
      }))}
      captains={captains}
    />
  )
}
