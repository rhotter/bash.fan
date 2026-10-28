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

export async function DELETE(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params
  const url = new URL(request.url)
  const queryTradeId = url.searchParams.get("tradeId")
  let targetTradeId = queryTradeId ? Number(queryTradeId) : null

  if (!targetTradeId) {
    try {
      const body = (await request.json()) as { tradeId?: number }
      if (body?.tradeId) targetTradeId = Number(body.tradeId)
    } catch {
      // Optional JSON body when query param is omitted
    }
  }

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
    return NextResponse.json({ error: "Cannot undo trades for completed season" }, { status: 400 })
  }

  if (season.status !== "draft" && season.status !== "active") {
    return NextResponse.json({ error: "Season must be in draft or active status to undo trades" }, { status: 400 })
  }

  // Find the most recent trade in this season
  const [latestTrade] = await db
    .select({
      id: schema.seasonTrades.id,
      tradedAt: schema.seasonTrades.tradedAt,
    })
    .from(schema.seasonTrades)
    .where(eq(schema.seasonTrades.seasonId, seasonId))
    .orderBy(desc(schema.seasonTrades.tradedAt), desc(schema.seasonTrades.id))
    .limit(1)

  if (!latestTrade) {
    return NextResponse.json({ error: "No trades found for this season" }, { status: 404 })
  }

  if (targetTradeId !== null && (!Number.isInteger(targetTradeId) || targetTradeId !== latestTrade.id)) {
    return NextResponse.json(
      { error: "Only the most recent trade in this season can be undone" },
      { status: 409 }
    )
  }

  const resolvedTradeId = latestTrade.id

  // Check player items in this trade for clear, actionable error messages before executing the atomic CTE
  const playerItems = await db
    .select({
      playerId: schema.seasonTradeItems.playerId,
      playerName: schema.players.name,
      fromTeamSlug: schema.seasonTradeItems.fromTeamSlug,
      toTeamSlug: schema.seasonTradeItems.toTeamSlug,
    })
    .from(schema.seasonTradeItems)
    .leftJoin(schema.players, eq(schema.seasonTradeItems.playerId, schema.players.id))
    .where(
      and(
        eq(schema.seasonTradeItems.tradeId, resolvedTradeId),
        eq(schema.seasonTradeItems.itemType, "player")
      )
    )

  const tradedPlayerIds = playerItems
    .map((item) => item.playerId)
    .filter((id): id is number => id !== null)

  if (tradedPlayerIds.length > 0) {
    const rosterRows = await db
      .select({
        playerId: schema.playerSeasons.playerId,
        teamSlug: schema.playerSeasons.teamSlug,
      })
      .from(schema.playerSeasons)
      .where(
        and(
          eq(schema.playerSeasons.seasonId, seasonId),
          inArray(schema.playerSeasons.playerId, tradedPlayerIds)
        )
      )

    const rosterMap = new Map(rosterRows.map((r) => [r.playerId, r.teamSlug]))
    for (const item of playerItems) {
      if (item.playerId === null) continue
      const currentTeam = rosterMap.get(item.playerId)
      if (currentTeam !== item.toTeamSlug) {
        const displayName = item.playerName || `Player ${item.playerId}`
        return NextResponse.json(
          {
            error: `Cannot undo trade: ${displayName} is no longer assigned to ${item.toTeamSlug}`,
          },
          { status: 409 }
        )
      }
    }

    // Check if any traded player has recorded game stats for their new team since the trade
    const postTradeGameRows = await rawSql(sql`
      WITH target_trade AS (
        SELECT id, season_id, traded_at
        FROM season_trades
        WHERE id = ${resolvedTradeId} AND season_id = ${seasonId}
      ),
      traded_players AS (
        SELECT
          sti.player_id,
          COALESCE(p.name, 'Player ' || sti.player_id::text) AS player_name,
          sti.to_team_slug,
          COALESCE(t.name, sti.to_team_slug) AS to_team_name,
          EXISTS (
            SELECT 1
            FROM season_trade_items prior_sti
            JOIN season_trades prior_st ON prior_st.id = prior_sti.trade_id
            WHERE prior_st.season_id = ${seasonId}
              AND prior_st.id <> ${resolvedTradeId}
              AND prior_sti.item_type = 'player'
              AND prior_sti.player_id = sti.player_id
              AND prior_sti.from_team_slug = sti.to_team_slug
          ) AS had_prior_stint_on_to_team
        FROM season_trade_items sti
        LEFT JOIN players p ON p.id = sti.player_id
        LEFT JOIN teams t ON t.slug = sti.to_team_slug
        WHERE sti.trade_id = ${resolvedTradeId}
          AND sti.item_type = 'player'
          AND sti.player_id IS NOT NULL
      )
      SELECT tp.player_id AS "playerId", tp.player_name AS "playerName", tp.to_team_name AS "toTeamName"
      FROM traded_players tp
      CROSS JOIN target_trade tt
      WHERE EXISTS (
        SELECT 1
        FROM player_game_stats pgs
        JOIN games g ON g.id = pgs.game_id
        WHERE g.season_id = ${seasonId}
          AND pgs.player_id = tp.player_id
          AND pgs.team_slug = tp.to_team_slug
          AND NOT (
            g.is_forfeit
            AND g.date < to_char(tt.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
          )
          AND (
            NOT tp.had_prior_stint_on_to_team
            OR g.date >= to_char(tt.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
          )
      )
      OR EXISTS (
        SELECT 1
        FROM goalie_game_stats ggs
        JOIN games g ON g.id = ggs.game_id
        WHERE g.season_id = ${seasonId}
          AND ggs.player_id = tp.player_id
          AND ggs.team_slug = tp.to_team_slug
          AND NOT (
            g.is_forfeit
            AND g.date < to_char(tt.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
          )
          AND (
            NOT tp.had_prior_stint_on_to_team
            OR g.date >= to_char(tt.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
          )
      )
      OR EXISTS (
        SELECT 1
        FROM game_live gl
        JOIN games g ON g.id = gl.game_id
        WHERE g.season_id = ${seasonId}
          AND g.status <> 'final'
          AND (
            NOT tp.had_prior_stint_on_to_team
            OR g.date >= to_char(tt.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
          )
          AND (
            (
              g.home_team = tp.to_team_slug
              AND (
                CASE
                  WHEN jsonb_typeof(gl.state->'homeAttendance'->(tp.player_id::text)) = 'boolean'
                  THEN (gl.state->'homeAttendance'->>(tp.player_id::text))::boolean
                  ELSE false
                END
                OR (gl.state->>'homeGoalie') = (tp.player_id::text)
              )
            )
            OR (
              g.away_team = tp.to_team_slug
              AND (
                CASE
                  WHEN jsonb_typeof(gl.state->'awayAttendance'->(tp.player_id::text)) = 'boolean'
                  THEN (gl.state->'awayAttendance'->>(tp.player_id::text))::boolean
                  ELSE false
                END
                OR (gl.state->>'awayGoalie') = (tp.player_id::text)
              )
            )
          )
      )
      OR EXISTS (
        SELECT 1
        FROM adhoc_game_rosters agr
        JOIN games g ON g.id = agr.game_id
        WHERE g.season_id = ${seasonId}
          AND g.status <> 'final'
          AND agr.player_id = tp.player_id
          AND (
            NOT tp.had_prior_stint_on_to_team
            OR g.date >= to_char(tt.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
          )
          AND (
            (agr.team_side = 'home' AND g.home_team = tp.to_team_slug)
            OR (agr.team_side = 'away' AND g.away_team = tp.to_team_slug)
          )
      )
      LIMIT 1;
    `)

    const playedRow = postTradeGameRows?.[0] as
      | { playerId: number; playerName: string; toTeamName: string }
      | undefined
    if (playedRow) {
      return NextResponse.json(
        {
          error: `Cannot undo trade because ${playedRow.playerName} has already played a game for ${playedRow.toTeamName}. Record a new trade instead.`,
        },
        { status: 409 }
      )
    }
  }

  // Execute atomic undo in single-statement data-modifying CTE via rawSql
  const undoQuery = sql`
    WITH locked_season AS MATERIALIZED (
      SELECT id FROM seasons
      WHERE id = ${seasonId} AND status IN ('draft', 'active')
      FOR UPDATE
    ),
    latest_trade AS MATERIALIZED (
      SELECT id, season_id, traded_at
      FROM season_trades
      WHERE season_id = ${seasonId}
      ORDER BY traded_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
    ),
    player_items AS MATERIALIZED (
      SELECT
        sti.player_id,
        sti.from_team_slug,
        sti.to_team_slug,
        EXISTS (
          SELECT 1
          FROM season_trade_items prior_sti
          JOIN season_trades prior_st ON prior_st.id = prior_sti.trade_id
          WHERE prior_st.season_id = ${seasonId}
            AND prior_st.id <> ${resolvedTradeId}
            AND prior_sti.item_type = 'player'
            AND prior_sti.player_id = sti.player_id
            AND prior_sti.from_team_slug = sti.to_team_slug
        ) AS had_prior_stint_on_to_team
      FROM season_trade_items sti
      JOIN latest_trade lt ON lt.id = sti.trade_id
      WHERE lt.id = ${resolvedTradeId}
        AND sti.item_type = 'player'
        AND sti.player_id IS NOT NULL
    ),
    pick_items AS MATERIALIZED (
      SELECT
        sti.id,
        sti.from_team_slug,
        sti.to_team_slug,
        sti.draft_pick_round,
        COALESCE(sti.draft_pick_original_team_slug, sti.from_team_slug) AS orig_owner,
        'Prior season trade: ' || sti.from_team_slug || ' Rd ' || sti.draft_pick_round::text ||
          CASE
            WHEN COALESCE(sti.draft_pick_original_team_slug, sti.from_team_slug) <> sti.from_team_slug
            THEN ' (via ' || sti.draft_pick_original_team_slug || ')'
            ELSE ''
          END || ' → ' || sti.to_team_slug AS expected_description
      FROM season_trade_items sti
      JOIN latest_trade lt ON lt.id = sti.trade_id
      WHERE lt.id = ${resolvedTradeId}
        AND sti.item_type = 'draft_pick'
        AND sti.draft_pick_round IS NOT NULL
    ),
    locked_rosters AS MATERIALIZED (
      SELECT ps.player_id, ps.season_id, ps.team_slug, pi.from_team_slug
      FROM player_seasons ps
      JOIN player_items pi
        ON ps.player_id = pi.player_id AND ps.team_slug = pi.to_team_slug
      WHERE ps.season_id = ${seasonId}
      FOR UPDATE OF ps
    ),
    post_trade_games AS (
      SELECT pi.player_id
      FROM player_items pi
      CROSS JOIN latest_trade lt
      WHERE EXISTS (
        SELECT 1
        FROM player_game_stats pgs
        JOIN games g ON g.id = pgs.game_id
        WHERE g.season_id = ${seasonId}
          AND pgs.player_id = pi.player_id
          AND pgs.team_slug = pi.to_team_slug
          AND NOT (
            g.is_forfeit
            AND g.date < to_char(lt.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
          )
          AND (
            NOT pi.had_prior_stint_on_to_team
            OR g.date >= to_char(lt.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
          )
      )
      OR EXISTS (
        SELECT 1
        FROM goalie_game_stats ggs
        JOIN games g ON g.id = ggs.game_id
        WHERE g.season_id = ${seasonId}
          AND ggs.player_id = pi.player_id
          AND ggs.team_slug = pi.to_team_slug
          AND NOT (
            g.is_forfeit
            AND g.date < to_char(lt.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
          )
          AND (
            NOT pi.had_prior_stint_on_to_team
            OR g.date >= to_char(lt.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
          )
      )
      OR EXISTS (
        SELECT 1
        FROM game_live gl
        JOIN games g ON g.id = gl.game_id
        WHERE g.season_id = ${seasonId}
          AND g.status <> 'final'
          AND (
            NOT pi.had_prior_stint_on_to_team
            OR g.date >= to_char(lt.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
          )
          AND (
            (
              g.home_team = pi.to_team_slug
              AND (
                CASE
                  WHEN jsonb_typeof(gl.state->'homeAttendance'->(pi.player_id::text)) = 'boolean'
                  THEN (gl.state->'homeAttendance'->>(pi.player_id::text))::boolean
                  ELSE false
                END
                OR (gl.state->>'homeGoalie') = (pi.player_id::text)
              )
            )
            OR (
              g.away_team = pi.to_team_slug
              AND (
                CASE
                  WHEN jsonb_typeof(gl.state->'awayAttendance'->(pi.player_id::text)) = 'boolean'
                  THEN (gl.state->'awayAttendance'->>(pi.player_id::text))::boolean
                  ELSE false
                END
                OR (gl.state->>'awayGoalie') = (pi.player_id::text)
              )
            )
          )
      )
      OR EXISTS (
        SELECT 1
        FROM adhoc_game_rosters agr
        JOIN games g ON g.id = agr.game_id
        WHERE g.season_id = ${seasonId}
          AND g.status <> 'final'
          AND agr.player_id = pi.player_id
          AND (
            NOT pi.had_prior_stint_on_to_team
            OR g.date >= to_char(lt.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
          )
          AND (
            (agr.team_side = 'home' AND g.home_team = pi.to_team_slug)
            OR (agr.team_side = 'away' AND g.away_team = pi.to_team_slug)
          )
      )
    ),
    guard AS (
      SELECT s.id AS season_id, lt.id AS trade_id
      FROM locked_season s
      JOIN latest_trade lt ON lt.season_id = s.id
      WHERE lt.id = ${resolvedTradeId}
        AND (SELECT count(*)::int FROM locked_rosters) = (SELECT count(*)::int FROM player_items)
        AND (SELECT count(*)::int FROM post_trade_games) = 0
    ),
    seeded_draft_trades AS MATERIALIZED (
      SELECT ranked.id
      FROM (
        SELECT
          dt.id,
          dt.description,
          ROW_NUMBER() OVER (
            PARTITION BY dt.draft_id, dt.description
            ORDER BY dt.traded_at DESC, dt.id DESC
          ) AS rn
        FROM draft_trades dt
        JOIN draft_instances di ON di.id = dt.draft_id
        WHERE di.status IN ('draft', 'published')
          AND dt.trade_type = 'pre_draft_pick_swap'
          AND dt.description IN (SELECT expected_description FROM pick_items)
      ) ranked
      WHERE ranked.rn <= (
        SELECT count(*)::int
        FROM pick_items pi
        WHERE pi.expected_description = ranked.description
      )
    ),
    deleted_draft_trade_items AS (
      DELETE FROM draft_trade_items dti
      USING guard, seeded_draft_trades sdt
      WHERE dti.trade_id = sdt.id
      RETURNING dti.id
    ),
    deleted_draft_trades AS (
      DELETE FROM draft_trades dt
      USING guard, seeded_draft_trades sdt
      WHERE dt.id = sdt.id
      RETURNING dt.id
    ),
    reverted_rosters AS (
      UPDATE player_seasons ps
      SET team_slug = lr.from_team_slug
      FROM guard, locked_rosters lr
      WHERE ps.season_id = guard.season_id
        AND ps.player_id = lr.player_id
        AND ps.team_slug = lr.team_slug
      RETURNING ps.player_id, ps.team_slug
    ),
    deleted_trade AS (
      DELETE FROM season_trades st
      USING guard
      WHERE st.id = guard.trade_id
        AND (SELECT count(*)::int FROM reverted_rosters) = (SELECT count(*)::int FROM player_items)
      RETURNING st.id
    )
    SELECT id AS "undoneTradeId" FROM deleted_trade;
  `

  let rows: unknown[]
  try {
    rows = await rawSql(undoQuery)
  } catch {
    return NextResponse.json({ error: "Failed to undo trade" }, { status: 500 })
  }

  const result = rows?.[0] as { undoneTradeId: number } | undefined
  if (!result) {
    return NextResponse.json(
      { error: "Trade undo failed: preconditions not met or concurrent modification" },
      { status: 409 }
    )
  }

  return NextResponse.json({
    success: true,
    undoneTradeId: result.undoneTradeId,
    revertedPlayers: playerItems
      .filter((item): item is typeof item & { playerId: number } => item.playerId !== null)
      .map((item) => ({
        playerId: item.playerId,
        fromTeamSlug: item.toTeamSlug,
        toTeamSlug: item.fromTeamSlug,
      })),
  })
}
