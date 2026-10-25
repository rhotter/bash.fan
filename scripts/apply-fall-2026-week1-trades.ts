/**
 * Apply Fall 2026 Week 1 Trades
 *
 * Idempotent CLI script to record the two Week 1 trades from Fall 2026:
 * - Trade #1: Eddie Parsons (#315) on Reign ↔ Logan Truman (#102) on Seals (2026-10-12)
 * - Trade #2: Jonny Callan (#3640) & Lee Jacobs (#50003) on Yetis ↔ Steph Tryphonas (#61) & Darrell Draper (#49983) on Loons (2026-10-13)
 *
 * Usage:
 *   npx tsx scripts/apply-fall-2026-week1-trades.ts [options]
 *   npx tsx scripts/apply-fall-2026-week1-trades.ts --dry-run
 *   npx tsx scripts/apply-fall-2026-week1-trades.ts --url '<target-db-url>'
 *   npx tsx scripts/apply-fall-2026-week1-trades.ts --season '2026-2027'
 */

import "./env"
import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { sql, type SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import * as schema from "../lib/db/schema"

export interface DraftPickItem {
  itemType: "draft_pick"
  fromTeamSlug: string
  toTeamSlug: string
  playerId: null
  draftPickRound: number
  draftPickOriginalTeamSlug: string
  draftPickTargetSeason: string
}

export interface TradeDefinition {
  teamSlugs?: string[]
  teamASlug: string
  teamBSlug: string
  teamAPlayerIds: number[]
  teamBPlayerIds: number[]
  tradedAt: string
  notes: string
  draftPicks?: DraftPickItem[]
}

export const FALL_2026_WEEK1_TRADE_1: TradeDefinition = {
  teamSlugs: ["reign", "seals"],
  teamASlug: "reign",
  teamBSlug: "seals",
  teamAPlayerIds: [315],
  teamBPlayerIds: [102],
  tradedAt: "2026-10-12T00:00:00Z",
  notes: "Week 1 trade: Eddie Parsons to Seals, Logan Truman to Reign",
  draftPicks: [],
}

export const FALL_2026_WEEK1_TRADE_2: TradeDefinition = {
  teamSlugs: ["yetis", "loons"],
  teamASlug: "yetis",
  teamBSlug: "loons",
  teamAPlayerIds: [3640, 50003],
  teamBPlayerIds: [61, 49983],
  tradedAt: "2026-10-13T00:00:00Z",
  notes: "Week 1 trade: Jonny Callan & Lee Jacobs to Loons, Steph Tryphonas & Darrell Draper to Yetis",
  draftPicks: [],
}

export interface ScriptOptions {
  dryRun: boolean
  url: string
  season?: string
}

export function parseArgs(argv: string[] = process.argv.slice(2)): ScriptOptions {
  let dryRun = false
  let url = process.env.DATABASE_URL || process.env.DEV_URL || ""
  let season: string | undefined = undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--dry-run" || arg === "-n") {
      dryRun = true
    } else if (arg === "--url" || arg === "--db") {
      if (argv[i + 1]) url = argv[++i]
    } else if (arg.startsWith("--url=")) {
      url = arg.split("=")[1]
    } else if (arg === "--season" || arg === "-s") {
      if (argv[i + 1]) season = argv[++i]
    } else if (arg.startsWith("--season=")) {
      season = arg.split("=")[1]
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Apply Fall 2026 Week 1 Trades

Usage:
  npx tsx scripts/apply-fall-2026-week1-trades.ts [options]

Options:
  --dry-run, -n       Simulate without modifying the database
  --url <db-url>      Target database connection string (default: DATABASE_URL or DEV_URL)
  --season <id>       Season ID override (default: auto-detect bash-2026-2027 or 2026-2027)
  --help, -h          Show this help message
      `)
      return { dryRun, url, season: undefined }
    }
  }

  return { dryRun, url, season }
}

export async function verifyDarrellDraperPreFlight(
  queryFn: (sql: string, params?: unknown[]) => Promise<any[]>
): Promise<{ passed: boolean; teamSlug: string | null; found: boolean }> {
  const rows = await queryFn(
    `SELECT pgs.team_slug
     FROM player_game_stats pgs
     LEFT JOIN players p ON pgs.player_id = p.id
     WHERE pgs.game_id = 'g130' AND (pgs.player_id = 49983 OR p.name ILIKE '%Darrell Draper%')
     LIMIT 1;`
  )

  if (!rows || rows.length === 0) {
    return { passed: true, teamSlug: null, found: false }
  }

  const stat = rows[0]
  const teamSlug = stat.team_slug ?? null
  if (teamSlug !== "loons") {
    throw new Error(
      `Pre-flight safety check failed: Darrell Draper's stat row in g130 has team_slug '${teamSlug ?? "NULL"}', expected 'loons'. Run scripts/deploy-trades-schema.ts first.`
    )
  }

  return { passed: true, teamSlug, found: true }
}

export async function resolveSeasonId(
  queryFn: (sql: string, params?: unknown[]) => Promise<any[]>,
  seasonOverride?: string
): Promise<string> {
  if (seasonOverride) {
    return seasonOverride
  }

  const rows = await queryFn(
    `SELECT id FROM seasons WHERE id IN ('bash-2026-2027', '2026-2027') ORDER BY CASE WHEN id = 'bash-2026-2027' THEN 1 ELSE 2 END LIMIT 1;`
  )

  if (rows && rows.length > 0 && rows[0]?.id) {
    return rows[0].id
  }

  return "bash-2026-2027"
}

export interface TradeStatus {
  trade1Applied: boolean
  trade2Applied: boolean
  allApplied: boolean
  trade1Reason?: string
  trade2Reason?: string
  resolvedPlayerIds?: Week1PlayerIds
}

export interface Week1PlayerIds {
  eddieParsons: number
  loganTruman: number
  jonnyCallan: number
  leeJacobs: number
  stephTryphonas: number
  darrellDraper: number
}

export const DEFAULT_WEEK1_PLAYER_IDS: Week1PlayerIds = {
  eddieParsons: 315,
  loganTruman: 102,
  jonnyCallan: 3640,
  leeJacobs: 50003,
  stephTryphonas: 61,
  darrellDraper: 49983,
}

export async function resolveWeek1PlayerIds(
  queryFn: (sql: string, params?: unknown[]) => Promise<any[]>,
  seasonId: string
): Promise<{ ids: Week1PlayerIds; rosterMap: Map<number, string> }> {
  const rosters = await queryFn(
    `SELECT ps.player_id, ps.team_slug, p.name AS player_name
     FROM player_seasons ps
     LEFT JOIN players p ON p.id = ps.player_id
     WHERE ps.season_id = $1
       AND (
         ps.player_id IN (315, 102, 3640, 50003, 61, 49983)
         OR LOWER(p.name) IN ('eddie parsons', 'logan truman', 'jonny callan', 'lee jacobs', 'steph tryphonas', 'darrell draper')
       );`,
    [seasonId]
  )

  const ids: Week1PlayerIds = { ...DEFAULT_WEEK1_PLAYER_IDS }
  const rosterMap = new Map<number, string>()

  for (const r of rosters ?? []) {
    const pid = Number(r.player_id)
    rosterMap.set(pid, r.team_slug)
    const nameLower = typeof r.player_name === "string" ? r.player_name.trim().toLowerCase() : ""
    if (nameLower === "eddie parsons") ids.eddieParsons = pid
    else if (nameLower === "logan truman") ids.loganTruman = pid
    else if (nameLower === "jonny callan") ids.jonnyCallan = pid
    else if (nameLower === "lee jacobs") ids.leeJacobs = pid
    else if (nameLower === "steph tryphonas") ids.stephTryphonas = pid
    else if (nameLower === "darrell draper") ids.darrellDraper = pid
  }

  return { ids, rosterMap }
}

export async function checkTradeStatus(
  queryFn: (sql: string, params?: unknown[]) => Promise<any[]>,
  seasonId: string
): Promise<TradeStatus> {
  // 1. Check season_trades for the specific Week 1 trades
  const trades = await queryFn(
    `SELECT id, notes, team_slugs FROM season_trades WHERE season_id = $1;`,
    [seasonId]
  )

  let trade1InTrades = false
  let trade2InTrades = false

  for (const t of trades ?? []) {
    const notes = t.notes ?? ""
    if (notes.includes("Eddie Parsons") && notes.includes("Logan Truman")) {
      trade1InTrades = true
    }
    if (notes.includes("Jonny Callan") && notes.includes("Darrell Draper")) {
      trade2InTrades = true
    }
  }

  // 2. Check player_seasons for post-trade assignments (resolving IDs by name when available)
  const { ids, rosterMap } = await resolveWeek1PlayerIds(queryFn, seasonId)

  // Trade 1 post-trade: Eddie Parsons on seals, Logan Truman on reign
  const trade1InRosters =
    rosterMap.get(ids.eddieParsons) === "seals" && rosterMap.get(ids.loganTruman) === "reign"

  // Trade 2 post-trade: Callan & Jacobs on loons, Tryphonas & Draper on yetis
  const trade2InRosters =
    rosterMap.get(ids.jonnyCallan) === "loons" &&
    rosterMap.get(ids.leeJacobs) === "loons" &&
    rosterMap.get(ids.stephTryphonas) === "yetis" &&
    rosterMap.get(ids.darrellDraper) === "yetis"

  const trade1Applied = trade1InTrades || trade1InRosters
  const trade2Applied = trade2InTrades || trade2InRosters

  return {
    trade1Applied,
    trade2Applied,
    allApplied: trade1Applied && trade2Applied,
    trade1Reason: trade1InTrades ? "in_season_trades" : trade1InRosters ? "in_player_seasons" : undefined,
    trade2Reason: trade2InTrades ? "in_season_trades" : trade2InRosters ? "in_player_seasons" : undefined,
    resolvedPlayerIds: ids,
  }
}

export function buildTradeCte(seasonId: string, trade: TradeDefinition): SQL {
  const { teamASlug, teamBSlug, teamAPlayerIds, teamBPlayerIds, notes, tradedAt, draftPicks = [] } = trade

  const tradeItems = [
    ...teamAPlayerIds.map((pid) => ({
      itemType: "player",
      fromTeamSlug: teamASlug,
      toTeamSlug: teamBSlug,
      playerId: pid,
      draftPickRound: null,
      draftPickOriginalTeamSlug: null,
      draftPickTargetSeason: null,
    })),
    ...teamBPlayerIds.map((pid) => ({
      itemType: "player",
      fromTeamSlug: teamBSlug,
      toTeamSlug: teamASlug,
      playerId: pid,
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

  const expectedPlayerCount = teamAPlayerIds.length + teamBPlayerIds.length
  const tradeNotes = notes ?? null

  const teamAIdsCondition = teamAPlayerIds.length > 0
    ? sql`(ps.player_id IN (${sql.join(teamAPlayerIds.map((id) => sql`${id}`), sql`, `)}) AND ps.team_slug = ${teamASlug})`
    : sql`false`

  const teamBIdsCondition = teamBPlayerIds.length > 0
    ? sql`(ps.player_id IN (${sql.join(teamBPlayerIds.map((id) => sql`${id}`), sql`, `)}) AND ps.team_slug = ${teamBSlug})`
    : sql`false`

  const tradedAtSql = tradedAt ? sql`${tradedAt}::timestamptz` : sql`NOW()`

  return sql`
    WITH locked_season AS MATERIALIZED (
      SELECT id, status FROM seasons
      WHERE id = ${seasonId} AND status IN ('draft', 'active')
      FOR UPDATE
    ),
    locked_rosters AS MATERIALIZED (
      SELECT ps.player_id, ps.season_id, ps.team_slug
      FROM player_seasons ps
      WHERE ps.season_id = ${seasonId}
        AND (${teamAIdsCondition} OR ${teamBIdsCondition})
      FOR UPDATE
    ),
    guard AS (
      SELECT s.id AS season_id FROM locked_season s
      WHERE (SELECT count(*)::int FROM season_teams WHERE season_id = ${seasonId} AND team_slug IN (${teamASlug}, ${teamBSlug})) = 2
        AND (SELECT count(*)::int FROM locked_rosters) = ${expectedPlayerCount}
    ),
    updated_rosters AS (
      UPDATE player_seasons ps
      SET team_slug = CASE WHEN ps.team_slug = ${teamASlug} THEN ${teamBSlug} ELSE ${teamASlug} END
      FROM guard, locked_rosters lr
      WHERE ps.season_id = guard.season_id AND ps.player_id = lr.player_id AND ps.team_slug = lr.team_slug
      RETURNING ps.player_id, ps.team_slug
    ),
    inserted_trade AS (
      INSERT INTO season_trades (season_id, team_slugs, notes, traded_at, created_at)
      SELECT guard.season_id, ARRAY[${teamASlug}, ${teamBSlug}]::text[], ${tradeNotes}, ${tradedAtSql}, NOW()
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
}

export function compileTradeCte(seasonId: string, trade: TradeDefinition): { sql: string; params: unknown[] } {
  const dialect = new PgDialect()
  return dialect.sqlToQuery(buildTradeCte(seasonId, trade))
}

export interface ExecuteWeek1TradesOptions {
  url?: string
  dryRun?: boolean
  season?: string
  queryFn?: (sql: string, params?: unknown[]) => Promise<any[]>
  rawSqlFn?: (query: SQL) => Promise<any[]>
}

export interface ExecuteWeek1TradesResult {
  seasonId: string
  alreadyComplete: boolean
  preFlightCheck: { passed: boolean; teamSlug: string | null }
  statusBefore: TradeStatus
  trade1Executed: boolean
  trade2Executed: boolean
  dryRun: boolean
}

export async function executeWeek1Trades(
  options: ExecuteWeek1TradesOptions = {}
): Promise<ExecuteWeek1TradesResult> {
  let qFn = options.queryFn
  let rSqlFn = options.rawSqlFn

  if (!qFn || !rSqlFn) {
    if (!options.url) {
      throw new Error(
        "Missing database connection URL. Provide via --url '<url>' or set DATABASE_URL/DEV_URL."
      )
    }
    const connection = neon(options.url)
    const db = drizzle(connection, { schema })
    if (!qFn) {
      qFn = async (sqlText: string, params?: unknown[]) => {
        return (await connection.query(sqlText, (params as any[]) ?? [])) as any[]
      }
    }
    if (!rSqlFn) {
      rSqlFn = async (query: SQL) => {
        const result = (await db.execute(query)) as any
        return result.rows ?? []
      }
    }
  }

  // 1. Pre-flight Darrell Draper safety check
  const preFlight = await verifyDarrellDraperPreFlight(qFn)

  // 2. Resolve season ID
  const seasonId = await resolveSeasonId(qFn, options.season)

  // 3. Check idempotency status
  const statusBefore = await checkTradeStatus(qFn, seasonId)

  if (statusBefore.allApplied) {
    console.log(
      `Both Week 1 trades have already been applied to season ${seasonId}. No mutations needed.`
    )
    return {
      seasonId,
      alreadyComplete: true,
      preFlightCheck: preFlight,
      statusBefore,
      trade1Executed: false,
      trade2Executed: false,
      dryRun: !!options.dryRun,
    }
  }

  const ids = statusBefore.resolvedPlayerIds ?? DEFAULT_WEEK1_PLAYER_IDS
  const trade1Def: TradeDefinition = {
    ...FALL_2026_WEEK1_TRADE_1,
    teamAPlayerIds: [ids.eddieParsons],
    teamBPlayerIds: [ids.loganTruman],
  }
  const trade2Def: TradeDefinition = {
    ...FALL_2026_WEEK1_TRADE_2,
    teamAPlayerIds: [ids.jonnyCallan, ids.leeJacobs],
    teamBPlayerIds: [ids.stephTryphonas, ids.darrellDraper],
  }

  let trade1Executed = false
  let trade2Executed = false

  // 4. Trade #1
  if (statusBefore.trade1Applied) {
    console.log(`Trade #1 already applied (${statusBefore.trade1Reason}), skipping.`)
  } else if (options.dryRun) {
    console.log(`[DRY RUN] Would execute Trade #1: ${trade1Def.notes}`)
  } else {
    console.log(`Executing Trade #1: ${trade1Def.notes}`)
    const res1 = await rSqlFn(buildTradeCte(seasonId, trade1Def))
    if (!res1 || res1.length === 0) {
      throw new Error(
        `Trade #1 execution failed: preconditions not met or concurrent modification.`
      )
    }
    trade1Executed = true
    console.log(`✓ Trade #1 successfully executed (tradeId: ${res1[0]?.tradeId}).`)
  }

  // 5. Trade #2
  if (statusBefore.trade2Applied) {
    console.log(`Trade #2 already applied (${statusBefore.trade2Reason}), skipping.`)
  } else if (options.dryRun) {
    console.log(`[DRY RUN] Would execute Trade #2: ${trade2Def.notes}`)
  } else {
    console.log(`Executing Trade #2: ${trade2Def.notes}`)
    const res2 = await rSqlFn(buildTradeCte(seasonId, trade2Def))
    if (!res2 || res2.length === 0) {
      throw new Error(
        `Trade #2 execution failed: preconditions not met or concurrent modification.`
      )
    }
    trade2Executed = true
    console.log(`✓ Trade #2 successfully executed (tradeId: ${res2[0]?.tradeId}).`)
  }

  return {
    seasonId,
    alreadyComplete: false,
    preFlightCheck: preFlight,
    statusBefore,
    trade1Executed,
    trade2Executed,
    dryRun: !!options.dryRun,
  }
}

async function main() {
  const options = parseArgs()
  console.log("=== BASH: Apply Fall 2026 Week 1 Trades ===")
  if (options.dryRun) {
    console.log("[DRY RUN MODE — NO DATABASE WRITES]")
  }
  const result = await executeWeek1Trades(options)
  if (result.alreadyComplete) {
    console.log("✓ All Fall 2026 Week 1 trades already applied.")
  } else {
    console.log("✓ Fall 2026 Week 1 trade execution finished.")
  }
}

if (
  process.env.NODE_ENV !== "test" &&
  (process.argv[1]?.includes("apply-fall-2026-week1-trades") ||
    (typeof require !== "undefined" && require.main === module))
) {
  main().catch((err) => {
    console.error("Execution failed:", err)
    process.exit(1)
  })
}
