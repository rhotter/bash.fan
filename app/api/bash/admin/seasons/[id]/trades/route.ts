import { NextRequest, NextResponse } from "next/server"
import { db, schema, rawSql } from "@/lib/db"
import { eq, and, inArray, desc, sql } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { validateTradeInput } from "@/lib/trade-helpers"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  const trades = await db
    .select({
      id: schema.seasonTrades.id,
      seasonId: schema.seasonTrades.seasonId,
      teamSlugs: schema.seasonTrades.teamSlugs,
      notes: schema.seasonTrades.notes,
      tradedAt: schema.seasonTrades.tradedAt,
      createdAt: schema.seasonTrades.createdAt,
    })
    .from(schema.seasonTrades)
    .where(eq(schema.seasonTrades.seasonId, seasonId))
    .orderBy(desc(schema.seasonTrades.tradedAt), desc(schema.seasonTrades.id))

  if (trades.length === 0) {
    return NextResponse.json({ trades: [] })
  }

  const tradeIds = trades.map((t) => t.id)
  const items = await db
    .select({
      id: schema.seasonTradeItems.id,
      tradeId: schema.seasonTradeItems.tradeId,
      itemType: schema.seasonTradeItems.itemType,
      fromTeamSlug: schema.seasonTradeItems.fromTeamSlug,
      toTeamSlug: schema.seasonTradeItems.toTeamSlug,
      playerId: schema.seasonTradeItems.playerId,
      playerName: schema.players.name,
      draftPickRound: schema.seasonTradeItems.draftPickRound,
      draftPickOriginalTeamSlug: schema.seasonTradeItems.draftPickOriginalTeamSlug,
      draftPickTargetSeason: schema.seasonTradeItems.draftPickTargetSeason,
    })
    .from(schema.seasonTradeItems)
    .leftJoin(schema.players, eq(schema.seasonTradeItems.playerId, schema.players.id))
    .where(inArray(schema.seasonTradeItems.tradeId, tradeIds))

  const itemsByTradeId = new Map<number, typeof items>()
  for (const item of items) {
    const list = itemsByTradeId.get(item.tradeId) || []
    list.push(item)
    itemsByTradeId.set(item.tradeId, list)
  }

  const tradesWithItems = trades.map((trade) => ({
    ...trade,
    teamASlug: trade.teamSlugs?.[0] ?? "",
    teamBSlug: trade.teamSlugs?.[1] ?? "",
    items: itemsByTradeId.get(trade.id) || [],
  }))

  return NextResponse.json({ trades: tradesWithItems })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const validation = validateTradeInput(body)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const { teamSlugs, playerMoves, draftPicks, notes } = validation.data

  // Verify season exists and is in active or draft status
  const [season] = await db
    .select({ id: schema.seasons.id, status: schema.seasons.status })
    .from(schema.seasons)
    .where(eq(schema.seasons.id, seasonId))
    .limit(1)

  if (!season) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 })
  }

  if (season.status === "completed") {
    return NextResponse.json({ error: "Cannot record trades for completed season" }, { status: 400 })
  }

  if (season.status !== "draft" && season.status !== "active") {
    return NextResponse.json({ error: "Season must be in draft or active status to record trades" }, { status: 400 })
  }

  // Precondition check 1: All participating teams must belong to season_teams
  const seasonTeamsRows = await db
    .select({ teamSlug: schema.seasonTeams.teamSlug })
    .from(schema.seasonTeams)
    .where(
      and(
        eq(schema.seasonTeams.seasonId, seasonId),
        inArray(schema.seasonTeams.teamSlug, teamSlugs)
      )
    )

  if (seasonTeamsRows.length < teamSlugs.length) {
    return NextResponse.json(
      {
        error:
          teamSlugs.length === 2
            ? "Trade precondition failed: both teams must belong to this season"
            : "Trade precondition failed: all participating teams must belong to this season",
      },
      { status: 400 }
    )
  }

  // Precondition check 2: All traded players must currently belong to their respective fromTeamSlug
  const allTradedPlayerIds = playerMoves.map((m) => m.playerId)
  if (allTradedPlayerIds.length > 0) {
    const rosterRows = await db
      .select({
        playerId: schema.playerSeasons.playerId,
        teamSlug: schema.playerSeasons.teamSlug,
      })
      .from(schema.playerSeasons)
      .where(
        and(
          eq(schema.playerSeasons.seasonId, seasonId),
          inArray(schema.playerSeasons.playerId, allTradedPlayerIds)
        )
      )

    const rosterMap = new Map(rosterRows.map((r) => [r.playerId, r.teamSlug]))

    for (const move of playerMoves) {
      const currentTeam = rosterMap.get(move.playerId)
      if (currentTeam !== move.fromTeamSlug) {
        return NextResponse.json(
          { error: `Trade precondition failed: Player ${move.playerId} is not on ${move.fromTeamSlug}` },
          { status: 409 }
        )
      }
    }
  }

  // Build trade items for insertion
  const tradeItems = [
    ...playerMoves.map((m) => ({
      itemType: "player",
      fromTeamSlug: m.fromTeamSlug,
      toTeamSlug: m.toTeamSlug,
      playerId: m.playerId,
      draftPickRound: null,
      draftPickOriginalTeamSlug: null,
      draftPickTargetSeason: null,
    })),
    ...draftPicks.map((p) => ({
      itemType: "draft_pick",
      fromTeamSlug: p.fromTeamSlug,
      toTeamSlug: p.toTeamSlug,
      playerId: null,
      draftPickRound: p.draftPickRound,
      draftPickOriginalTeamSlug: p.draftPickOriginalTeamSlug,
      draftPickTargetSeason: p.draftPickTargetSeason,
    })),
  ]

  const expectedPlayerCount = playerMoves.length
  const tradeNotes = notes ?? null
  const teamSlugsSqlList = sql.join(teamSlugs.map((slug) => sql`${slug}`), sql`, `)
  const origTeamSlugs = Array.from(new Set(draftPicks.map((p) => p.draftPickOriginalTeamSlug)))
  const origTeamsGuardSql =
    origTeamSlugs.length > 0
      ? sql`AND (SELECT count(*)::int FROM teams WHERE slug IN (${sql.join(origTeamSlugs.map((s) => sql`${s}`), sql`, `)})) = ${origTeamSlugs.length}`
      : sql``

  // Execute atomic trade in single-statement data-modifying CTE via rawSql
  const tradeQuery = sql`
    WITH locked_season AS MATERIALIZED (
      SELECT id, status FROM seasons
      WHERE id = ${seasonId} AND status IN ('draft', 'active')
      FOR UPDATE
    ),
    trade_player_moves AS (
      SELECT m."playerId", m."fromTeamSlug", m."toTeamSlug"
      FROM jsonb_to_recordset(${JSON.stringify(playerMoves)}::jsonb) AS m(
        "playerId" integer,
        "fromTeamSlug" text,
        "toTeamSlug" text
      )
    ),
    locked_rosters AS MATERIALIZED (
      SELECT ps.player_id, ps.season_id, ps.team_slug, m."toTeamSlug" AS to_team_slug
      FROM player_seasons ps
      JOIN trade_player_moves m
        ON ps.player_id = m."playerId" AND ps.team_slug = m."fromTeamSlug"
      WHERE ps.season_id = ${seasonId}
      FOR UPDATE OF ps
    ),
    guard AS (
      SELECT s.id AS season_id FROM locked_season s
      WHERE (SELECT count(*)::int FROM season_teams WHERE season_id = ${seasonId} AND team_slug IN (${teamSlugsSqlList})) = ${teamSlugs.length}
        AND (SELECT count(*)::int FROM locked_rosters) = ${expectedPlayerCount}
        ${origTeamsGuardSql}
    ),
    updated_rosters AS (
      UPDATE player_seasons ps
      SET team_slug = lr.to_team_slug
      FROM guard, locked_rosters lr
      WHERE ps.season_id = guard.season_id AND ps.player_id = lr.player_id AND ps.team_slug = lr.team_slug
      RETURNING ps.player_id, ps.team_slug
    ),
    inserted_trade AS (
      INSERT INTO season_trades (season_id, team_slugs, notes, traded_at, created_at)
      SELECT guard.season_id, ARRAY[${teamSlugsSqlList}]::text[], ${tradeNotes}, NOW(), NOW()
      FROM guard
      WHERE (SELECT count(*)::int FROM updated_rosters) = ${expectedPlayerCount}
      RETURNING id, traded_at
    ),
    inserted_items AS (
      INSERT INTO season_trade_items (trade_id, item_type, from_team_slug, to_team_slug, player_id, draft_pick_round, draft_pick_original_team_slug, draft_pick_target_season)
      SELECT t.id, item."itemType", item."fromTeamSlug", item."toTeamSlug", item."playerId", item."draftPickRound", item."draftPickOriginalTeamSlug", item."draftPickTargetSeason"
      FROM inserted_trade t
      CROSS JOIN jsonb_to_recordset(${JSON.stringify(tradeItems)}::jsonb) AS item(
        "itemType" text, "fromTeamSlug" text, "toTeamSlug" text, "playerId" integer,
        "draftPickRound" integer, "draftPickOriginalTeamSlug" text, "draftPickTargetSeason" text
      )
      RETURNING id
    )
    SELECT t.id AS "tradeId", t.traded_at AS "tradedAt" FROM inserted_trade t;
  `

  let rows: unknown[]
  try {
    rows = await rawSql(tradeQuery)
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    if (code === "23503") {
      return NextResponse.json(
        { error: "Trade execution failed: invalid team or player reference" },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: "Failed to execute trade" }, { status: 500 })
  }
  const result = rows?.[0] as { tradeId: number; tradedAt: string } | undefined

  if (!result) {
    return NextResponse.json(
      { error: "Trade execution failed: preconditions not met or concurrent modification" },
      { status: 409 }
    )
  }

  return NextResponse.json(
    { success: true, tradeId: result.tradeId, tradedAt: result.tradedAt },
    { status: 201 }
  )
}
