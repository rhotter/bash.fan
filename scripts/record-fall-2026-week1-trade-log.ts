/**
 * Record Fall 2026 Week 1 Trade Log (audit-only backfill)
 *
 * Use this when the Week 1 trades were already applied directly to `player_seasons`
 * (rosters already reflect the post-trade teams) but no `season_trades` audit rows exist.
 * In that state the admin "Record Trade" flow and `scripts/apply-fall-2026-week1-trades.ts`
 * cannot record the trades, because both require players to still be on their sending team.
 *
 * What it does (idempotent, dry-run by default):
 *   1. Resolves the six traded players by name in the season and verifies each is currently
 *      rostered on their receiving team (post-trade state). Aborts otherwise.
 *   2. Audits every `player_game_stats` / `goalie_game_stats` row for those players in the season
 *      against the trade dates (Pacific): games dated before the trade date must be stamped with
 *      the sending team, games on/after the trade date with the receiving team. Mismatched or NULL
 *      rows are corrected with `--apply` (only when the expected team actually played in that game).
 *   3. Inserts `season_trades` + `season_trade_items` audit rows with the real trade dates
 *      (noon Pacific so the date renders correctly in every US timezone) WITHOUT touching rosters.
 *      Each trade is written atomically in a single-statement CTE guarded on the post-trade roster
 *      state and on no matching trade already existing for that team pair + Pacific date.
 *
 * Usage:
 *   DATABASE_URL='<target-db-url>' npx tsx scripts/record-fall-2026-week1-trade-log.ts           # dry run
 *   DATABASE_URL='<target-db-url>' npx tsx scripts/record-fall-2026-week1-trade-log.ts --apply   # write
 *   Options: --url '<db-url>' (overrides DATABASE_URL), --season '<id>' (default: bash-2026-2027)
 */

import "./env"
import { neon, type NeonQueryFunction } from "@neondatabase/serverless"

type Sql = NeonQueryFunction<false, false>

export interface Week1TradeSpec {
  label: string
  tradeDate: string // YYYY-MM-DD (Pacific)
  tradedAt: string // ISO timestamp (noon Pacific)
  notes: string
  moves: { playerName: string; fromTeamSlug: string; toTeamSlug: string }[]
}

export const WEEK1_TRADES: Week1TradeSpec[] = [
  {
    label: "Trade #1",
    tradeDate: "2026-10-12",
    tradedAt: "2026-10-12T12:00:00-07:00",
    notes: "Week 1 trade: Eddie Parsons to Seals, Logan Truman to Reign",
    moves: [
      { playerName: "Eddie Parsons", fromTeamSlug: "reign", toTeamSlug: "seals" },
      { playerName: "Logan Truman", fromTeamSlug: "seals", toTeamSlug: "reign" },
    ],
  },
  {
    label: "Trade #2",
    tradeDate: "2026-10-13",
    tradedAt: "2026-10-13T12:00:00-07:00",
    notes: "Week 1 trade: Jonny Callan & Lee Jacobs to Loons, Steph Tryphonas & Darrell Draper to Yetis",
    moves: [
      { playerName: "Jonny Callan", fromTeamSlug: "yetis", toTeamSlug: "loons" },
      { playerName: "Lee Jacobs", fromTeamSlug: "yetis", toTeamSlug: "loons" },
      { playerName: "Steph Tryphonas", fromTeamSlug: "loons", toTeamSlug: "yetis" },
      { playerName: "Darrell Draper", fromTeamSlug: "loons", toTeamSlug: "yetis" },
    ],
  },
]

function parseArgs(argv = process.argv.slice(2)) {
  let apply = false
  let url = process.env.DATABASE_URL || ""
  let season = "bash-2026-2027"
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--apply") apply = true
    else if (a === "--url" && argv[i + 1]) url = argv[++i]
    else if (a.startsWith("--url=")) url = a.slice("--url=".length)
    else if (a === "--season" && argv[i + 1]) season = argv[++i]
    else if (a.startsWith("--season=")) season = a.slice("--season=".length)
  }
  return { apply, url, season }
}

type ResolvedMove = { playerId: number; playerName: string; fromTeamSlug: string; toTeamSlug: string }

async function resolveMoves(sql: Sql, seasonId: string, spec: Week1TradeSpec): Promise<ResolvedMove[]> {
  const resolved: ResolvedMove[] = []
  for (const m of spec.moves) {
    const rows = (await sql`
      SELECT p.id, p.name, ps.team_slug
      FROM players p
      JOIN player_seasons ps ON ps.player_id = p.id AND ps.season_id = ${seasonId}
      WHERE LOWER(TRIM(p.name)) = LOWER(${m.playerName})
    `) as { id: number; name: string; team_slug: string }[]
    if (rows.length !== 1) {
      throw new Error(`${spec.label}: expected exactly 1 rostered player named '${m.playerName}' in ${seasonId}, found ${rows.length}`)
    }
    const r = rows[0]
    if (r.team_slug !== m.toTeamSlug) {
      throw new Error(
        `${spec.label}: ${m.playerName} (#${r.id}) is rostered on '${r.team_slug}', expected post-trade team '${m.toTeamSlug}'. ` +
          `If rosters are still pre-trade, use the admin Record Trade flow instead.`
      )
    }
    resolved.push({ playerId: Number(r.id), playerName: r.name, fromTeamSlug: m.fromTeamSlug, toTeamSlug: m.toTeamSlug })
  }
  return resolved
}

type AuditRow = {
  kind: "skater" | "goalie"
  player_id: number
  player_name: string
  game_id: string
  date: string
  home_team: string
  away_team: string
  team_slug: string | null
  expected: string
  fixable: boolean
}

async function auditAttribution(sql: Sql, seasonId: string, spec: Week1TradeSpec, moves: ResolvedMove[]) {
  const movesJson = JSON.stringify(moves)
  const rows = (await sql`
    WITH m AS (
      SELECT * FROM jsonb_to_recordset(${movesJson}::jsonb)
        AS m("playerId" int, "playerName" text, "fromTeamSlug" text, "toTeamSlug" text)
    ), stat_rows AS (
      SELECT 'skater' AS kind, pgs.player_id, pgs.game_id, pgs.team_slug FROM player_game_stats pgs
      UNION ALL
      SELECT 'goalie' AS kind, ggs.player_id, ggs.game_id, ggs.team_slug FROM goalie_game_stats ggs
    )
    SELECT s.kind, s.player_id, m."playerName" AS player_name, g.id AS game_id, g.date,
           g.home_team, g.away_team, s.team_slug,
           CASE WHEN g.date < ${spec.tradeDate} THEN m."fromTeamSlug" ELSE m."toTeamSlug" END AS expected
    FROM stat_rows s
    JOIN m ON m."playerId" = s.player_id
    JOIN games g ON g.id = s.game_id AND g.season_id = ${seasonId}
    ORDER BY m."playerName", g.date, g.id
  `) as Omit<AuditRow, "fixable">[]

  return rows.map((r) => ({ ...r, fixable: r.expected === r.home_team || r.expected === r.away_team }))
}

async function fixAttribution(sql: Sql, seasonId: string, spec: Week1TradeSpec, moves: ResolvedMove[]) {
  const movesJson = JSON.stringify(moves)
  const skaters = (await sql`
    WITH m AS (
      SELECT * FROM jsonb_to_recordset(${movesJson}::jsonb)
        AS m("playerId" int, "playerName" text, "fromTeamSlug" text, "toTeamSlug" text)
    ), expected AS (
      SELECT pgs.player_id, pgs.game_id,
             CASE WHEN g.date < ${spec.tradeDate} THEN m."fromTeamSlug" ELSE m."toTeamSlug" END AS team_slug,
             g.home_team, g.away_team
      FROM player_game_stats pgs
      JOIN m ON m."playerId" = pgs.player_id
      JOIN games g ON g.id = pgs.game_id AND g.season_id = ${seasonId}
    )
    UPDATE player_game_stats pgs SET team_slug = e.team_slug
    FROM expected e
    WHERE pgs.player_id = e.player_id AND pgs.game_id = e.game_id
      AND e.team_slug IN (e.home_team, e.away_team)
      AND pgs.team_slug IS DISTINCT FROM e.team_slug
    RETURNING pgs.player_id, pgs.game_id, pgs.team_slug
  `) as unknown[]
  const goalies = (await sql`
    WITH m AS (
      SELECT * FROM jsonb_to_recordset(${movesJson}::jsonb)
        AS m("playerId" int, "playerName" text, "fromTeamSlug" text, "toTeamSlug" text)
    ), expected AS (
      SELECT ggs.player_id, ggs.game_id,
             CASE WHEN g.date < ${spec.tradeDate} THEN m."fromTeamSlug" ELSE m."toTeamSlug" END AS team_slug,
             g.home_team, g.away_team
      FROM goalie_game_stats ggs
      JOIN m ON m."playerId" = ggs.player_id
      JOIN games g ON g.id = ggs.game_id AND g.season_id = ${seasonId}
    )
    UPDATE goalie_game_stats ggs SET team_slug = e.team_slug
    FROM expected e
    WHERE ggs.player_id = e.player_id AND ggs.game_id = e.game_id
      AND e.team_slug IN (e.home_team, e.away_team)
      AND ggs.team_slug IS DISTINCT FROM e.team_slug
    RETURNING ggs.player_id, ggs.game_id, ggs.team_slug
  `) as unknown[]
  return { skaters: skaters.length, goalies: goalies.length }
}

async function findExistingTrade(sql: Sql, seasonId: string, spec: Week1TradeSpec) {
  const teamSlugs = [...new Set(spec.moves.flatMap((m) => [m.fromTeamSlug, m.toTeamSlug]))].sort()
  const rows = (await sql`
    SELECT id, traded_at FROM season_trades
    WHERE season_id = ${seasonId}
      AND (SELECT array_agg(x ORDER BY x) FROM unnest(team_slugs) x) = ${teamSlugs}::text[]
      AND to_char(traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') = ${spec.tradeDate}
  `) as { id: number; traded_at: string }[]
  return rows[0] ?? null
}

async function insertTradeLog(sql: Sql, seasonId: string, spec: Week1TradeSpec, moves: ResolvedMove[]) {
  const teamSlugs = [...new Set(spec.moves.flatMap((m) => [m.fromTeamSlug, m.toTeamSlug]))]
  const sortedTeamSlugs = [...teamSlugs].sort()
  const movesJson = JSON.stringify(moves)
  const rows = (await sql`
    WITH m AS (
      SELECT * FROM jsonb_to_recordset(${movesJson}::jsonb)
        AS m("playerId" int, "playerName" text, "fromTeamSlug" text, "toTeamSlug" text)
    ), locked_season AS MATERIALIZED (
      SELECT id FROM seasons WHERE id = ${seasonId} AND status IN ('draft', 'active') FOR UPDATE
    ), post_trade_rosters AS MATERIALIZED (
      SELECT ps.player_id FROM player_seasons ps
      JOIN m ON m."playerId" = ps.player_id AND ps.team_slug = m."toTeamSlug"
      WHERE ps.season_id = ${seasonId}
      FOR UPDATE OF ps
    ), guard AS (
      SELECT s.id AS season_id FROM locked_season s
      WHERE (SELECT count(*)::int FROM post_trade_rosters) = ${moves.length}
        AND (SELECT count(*)::int FROM season_teams WHERE season_id = ${seasonId} AND team_slug = ANY(${teamSlugs}::text[])) = ${teamSlugs.length}
        AND NOT EXISTS (
          SELECT 1 FROM season_trades st
          WHERE st.season_id = ${seasonId}
            AND (SELECT array_agg(x ORDER BY x) FROM unnest(st.team_slugs) x) = ${sortedTeamSlugs}::text[]
            AND to_char(st.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') = ${spec.tradeDate}
        )
    ), inserted_trade AS (
      INSERT INTO season_trades (season_id, team_slugs, notes, traded_at, created_at)
      SELECT guard.season_id, ${teamSlugs}::text[], ${spec.notes}, ${spec.tradedAt}::timestamptz, NOW()
      FROM guard
      RETURNING id, traded_at
    ), inserted_items AS (
      INSERT INTO season_trade_items (trade_id, item_type, from_team_slug, to_team_slug, player_id)
      SELECT t.id, 'player', m."fromTeamSlug", m."toTeamSlug", m."playerId"
      FROM inserted_trade t CROSS JOIN m
      RETURNING id
    )
    SELECT t.id AS "tradeId", t.traded_at AS "tradedAt", (SELECT count(*)::int FROM inserted_items) AS "itemCount"
    FROM inserted_trade t
  `) as { tradeId: number; tradedAt: string; itemCount: number }[]
  return rows[0] ?? null
}

async function main() {
  const { apply, url, season } = parseArgs()
  if (!url) throw new Error("Missing database URL. Set DATABASE_URL or pass --url '<db-url>'.")
  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return "(unparseable url)"
    }
  })()
  console.log(`=== Record Fall 2026 Week 1 Trade Log ===`)
  console.log(`Target: ${host} | Season: ${season} | Mode: ${apply ? "APPLY (writes enabled)" : "DRY RUN (no writes)"}`)

  const sql = neon(url)

  for (const spec of WEEK1_TRADES) {
    console.log(`\n--- ${spec.label} (${spec.tradeDate}): ${spec.notes}`)
    const moves = await resolveMoves(sql, season, spec)
    for (const m of moves) {
      console.log(`  • ${m.playerName} (#${m.playerId}): ${m.fromTeamSlug} → ${m.toTeamSlug} (roster OK)`)
    }

    const audit = await auditAttribution(sql, season, spec, moves)
    const wrong = audit.filter((r) => r.team_slug !== r.expected)
    console.log(`  Game stat rows audited: ${audit.length}, needing correction: ${wrong.length}`)
    console.table(
      audit.map((r) => ({
        player: r.player_name,
        kind: r.kind,
        game: r.game_id,
        date: r.date,
        matchup: `${r.away_team} @ ${r.home_team}`,
        team_slug: r.team_slug,
        expected: r.expected,
        status: r.team_slug === r.expected ? "ok" : r.fixable ? "WILL FIX" : "ANOMALY (expected team not in game)",
      }))
    )
    if (apply && wrong.some((r) => r.fixable)) {
      const fixed = await fixAttribution(sql, season, spec, moves)
      console.log(`  ✓ Corrected ${fixed.skaters} skater row(s) and ${fixed.goalies} goalie row(s).`)
    }

    const existing = await findExistingTrade(sql, season, spec)
    if (existing) {
      console.log(`  Trade log already recorded (season_trades.id = ${existing.id}, traded_at = ${existing.traded_at}). Skipping.`)
      continue
    }
    if (!apply) {
      console.log(`  [DRY RUN] Would insert season_trades (traded_at = ${spec.tradedAt}) + ${moves.length} season_trade_items.`)
      continue
    }
    const inserted = await insertTradeLog(sql, season, spec, moves)
    if (!inserted) throw new Error(`${spec.label}: guard rejected insert (roster changed or trade already exists).`)
    console.log(`  ✓ Recorded season_trades.id = ${inserted.tradeId} (traded_at = ${inserted.tradedAt}, items = ${inserted.itemCount}).`)
  }

  console.log(`\nDone.${apply ? "" : " Re-run with --apply to write changes."}`)
}

if (process.env.NODE_ENV !== "test" && process.argv[1]?.includes("record-fall-2026-week1-trade-log")) {
  main().catch((err) => {
    console.error("Failed:", err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
