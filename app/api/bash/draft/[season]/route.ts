import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import { eq, and, inArray } from "drizzle-orm"
import { NextResponse } from "next/server"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season: seasonSlug } = await params

  // Resolve season slug (e.g. "2026-2027") to a season ID
  const seasonRow = await db.query.seasons.findFirst({
    where: eq(schema.seasons.id, seasonSlug),
  })

  if (!seasonRow) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 })
  }

  // Find the draft instance for this season
  const draft = await db.query.draftInstances.findFirst({
    where: eq(schema.draftInstances.seasonId, seasonRow.id),
  })

  if (!draft) {
    return NextResponse.json({ error: "No draft found for this season" }, { status: 404 })
  }

  // 404 guard: draft status must not be "draft" (admin-only)
  if (draft.status === "draft") {
    return NextResponse.json({ error: "Draft is not yet public" }, { status: 404 })
  }

  // Fetch teams with draft order
  const teamOrder = await db
    .select({
      teamSlug: schema.draftTeamOrder.teamSlug,
      teamName: schema.teams.name,
      position: schema.draftTeamOrder.position,
    })
    .from(schema.draftTeamOrder)
    .innerJoin(schema.teams, eq(schema.draftTeamOrder.teamSlug, schema.teams.slug))
    .where(eq(schema.draftTeamOrder.draftId, draft.id))
    .orderBy(schema.draftTeamOrder.position)

  // Fetch team colors — season_teams.color takes priority over franchise color
  const seasonTeams = await db
    .select({
      teamSlug: schema.seasonTeams.teamSlug,
      color: schema.seasonTeams.color,
      franchiseSlug: schema.seasonTeams.franchiseSlug,
    })
    .from(schema.seasonTeams)
    .where(eq(schema.seasonTeams.seasonId, seasonRow.id))

  const franchiseSlugs = [...new Set(
    seasonTeams
      .map((st) => st.franchiseSlug)
      .filter((s): s is string => s !== null)
  )]

  const teamColors: Record<string, string> = {}
  if (franchiseSlugs.length > 0) {
    const franchises = await db.query.franchises.findMany({
      where: inArray(schema.franchises.slug, franchiseSlugs),
    })
    const franchiseColorMap: Record<string, string> = {}
    for (const f of franchises) {
      if (f.color) franchiseColorMap[f.slug] = f.color
    }
    for (const st of seasonTeams) {
      if (st.color) {
        teamColors[st.teamSlug] = st.color
      } else if (st.franchiseSlug && franchiseColorMap[st.franchiseSlug]) {
        teamColors[st.teamSlug] = franchiseColorMap[st.franchiseSlug]
      }
    }
  } else {
    // No franchises at all — just use direct team colors
    for (const st of seasonTeams) {
      if (st.color) teamColors[st.teamSlug] = st.color
    }
  }

  // Fetch picks with player names
  const picks = await db
    .select({
      id: schema.draftPicks.id,
      round: schema.draftPicks.round,
      pickNumber: schema.draftPicks.pickNumber,
      teamSlug: schema.draftPicks.teamSlug,
      originalTeamSlug: schema.draftPicks.originalTeamSlug,
      playerId: schema.draftPicks.playerId,
      playerName: schema.players.name,
      isKeeper: schema.draftPicks.isKeeper,
      pickedAt: schema.draftPicks.pickedAt,
    })
    .from(schema.draftPicks)
    .leftJoin(schema.players, eq(schema.draftPicks.playerId, schema.players.id))
    .where(eq(schema.draftPicks.draftId, draft.id))
    .orderBy(schema.draftPicks.pickNumber)

  // Fetch pool for available players list
  const pool = await db
    .select({
      playerId: schema.draftPool.playerId,
      playerName: schema.players.name,
      registrationMeta: schema.draftPool.registrationMeta,
    })
    .from(schema.draftPool)
    .innerJoin(schema.players, eq(schema.draftPool.playerId, schema.players.id))
    .where(eq(schema.draftPool.draftId, draft.id))

  // Fetch trades
  const trades = await db.query.draftTrades.findMany({
    where: eq(schema.draftTrades.draftId, draft.id),
  })

  // Fetch captains for this season
  const captainRows = await db
    .select({ playerId: schema.playerSeasons.playerId })
    .from(schema.playerSeasons)
    .where(
      and(
        eq(schema.playerSeasons.seasonId, seasonRow.id),
        eq(schema.playerSeasons.isCaptain, true)
      )
    )
  const captainPlayerIds = captainRows.map((c) => c.playerId)

  return NextResponse.json(
    {
      draft: {
        id: draft.id,
        name: draft.name,
        status: draft.status,
        rounds: draft.rounds,
        draftDate: draft.draftDate?.toISOString() || null,
        location: draft.location,
        timerSeconds: draft.timerSeconds,
        timerCountdown: draft.timerCountdown,
        timerRunning: draft.timerRunning,
        timerStartedAt: draft.timerStartedAt?.toISOString() || null,
        updatedAt: draft.updatedAt?.toISOString() || null,
      },
      season: {
        id: seasonRow.id,
        name: seasonRow.name,
        slug: seasonRow.id,
      },
      teams: teamOrder.map((t) => ({
        ...t,
        color: teamColors[t.teamSlug] || null,
      })),
      picks: picks.map((p) => ({
        ...p,
        playerName: p.playerId ? p.playerName || "Unknown" : null,
        pickedAt: p.pickedAt?.toISOString() || null,
      })),
      pool: pool.map((p) => ({
        playerId: p.playerId,
        playerName: p.playerName,
        registrationMeta: p.registrationMeta || null,
      })),
      trades: trades.map((t) => ({
        id: t.id,
        teamASlug: t.teamASlug,
        teamBSlug: t.teamBSlug,
        description: t.description,
        tradedAt: t.tradedAt?.toISOString() || null,
      })),
      captainPlayerIds,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3, stale-while-revalidate=5",
      },
    }
  )
}
