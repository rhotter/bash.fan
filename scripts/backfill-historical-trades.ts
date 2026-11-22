/**
 * Phase 5: Historical Sportability Trade Backfill & Deterministic Rollback
 *
 * Backfills historical traded-player attribution (`player_game_stats.team_slug` and
 * `goalie_game_stats.team_slug`), cleans up the 4 duplicate pre-trade `player_seasons`
 * rows in `2001-2002`, and idempotently seeds historical `season_trades` +
 * `season_trade_items` from `data/historical-traded-players.json`.
 *
 * Strictly NO multi-statement DB transactions — compatible with `@neondatabase/serverless` HTTP driver.
 *
 * Modes (exactly one):
 *   --dry-run (default)        Inspect and report all planned changes without writing
 *   --snapshot [path]          Save a read-only JSON state snapshot to `.backups/`
 *   --apply                    Auto-save pre-apply snapshot to `.backups/`, then apply all passes
 *                              (no-op with no snapshot when nothing is pending)
 *   --rollback <snapshot-file> Restore the pre-apply state of every row this script touched, delete only
 *                              the historical trades it inserted, and verify historical-season checksums
 * Options:
 *   --url '<db-url>'           Override target database URL (defaults to DATABASE_URL)
 *   --confirm-host <host>      Required for --apply / --rollback; must equal the target URL's host
 *
 * Safety rules (enforced; each refusal prints the exact command to run instead):
 *   - Roll back newest-first: --rollback refuses while a newer same-host apply snapshot is still active.
 *   - --apply refuses while an unfinished `pending` apply snapshot exists (provably-landed ones auto-complete).
 *   - --apply / --rollback refuse while any `.backups/pre-historical-trades-*.json` is unreadable or malformed.
 *   - One process at a time per host: --apply / --rollback hold `.backups/.lock-<host>` (delete if stale).
 *   - Guards only see this checkout's `.backups/`; run applies for a given database from one checkout.
 *   - Rollback verification also requires every recorded `insertedTradeIds` row to be gone, so it fails if a
 *     backfilled trade was edited (e.g. its notes) since the apply.
 */

import "./env"
import fs from "node:fs"
import path from "node:path"
import { neon, type NeonQueryFunction } from "@neondatabase/serverless"

export type Sql = NeonQueryFunction<false, false>

export interface HistoricalTradeEntry {
  seasonId: string
  leagueId: number
  playerName: string
  sportabilityPlayerId: number | null
  fromTeamSlug: string
  toTeamSlug: string
  gameDates: string[]
}

/** A `HistoricalTradeEntry` bound to the target database's live `players.id` at runtime. */
export interface ResolvedHistoricalTradeEntry extends HistoricalTradeEntry {
  playerId: number
}

export function normalizePlayerNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

export function holdOutKey(seasonId: string, playerName: string, gameId: string): string {
  return `${seasonId}:${normalizePlayerNameKey(playerName)}:${gameId}`
}

export function transitionH2HKey(
  kind: "skater" | "goalie",
  seasonId: string,
  playerName: string,
  gameId: string
): string {
  return `${kind}:${seasonId}:${normalizePlayerNameKey(playerName)}:${gameId}`
}

export function duplicatePsKey(seasonId: string, playerName: string, teamSlug: string): string {
  return `${seasonId}:${normalizePlayerNameKey(playerName)}:${teamSlug}`
}

export interface StatAttributionChange {
  kind: "skater" | "goalie"
  pass: "pass1_orphan_3rd_team" | "pass2_h2h"
  seasonId: string
  playerId: number
  playerName: string
  gameId: string
  date: string
  homeTeam: string
  awayTeam: string
  previousTeamSlug: string | null
  newTeamSlug: string
  reason: string
}

export interface PlayerSeasonRowSnapshot {
  player_id: number
  season_id: string
  team_slug: string
  is_goalie: boolean
  is_captain: boolean
  is_rookie: boolean
  registration_meta: unknown
}

export interface SeasonTradeSnapshot {
  id: number
  season_id: string
  team_slugs: string[]
  notes: string | null
  traded_at: string
  created_at: string
}

export interface SeasonTradeItemSnapshot {
  id: number
  trade_id: number
  item_type: string
  from_team_slug: string
  to_team_slug: string
  player_id: number | null
  draft_pick_round: number | null
  draft_pick_original_team_slug: string | null
  draft_pick_target_season: string | null
}

export interface SeasonStatChecksum {
  season_id: string
  skater_total: number
  skater_stamped: number
  skater_null: number
  skater_hash: string
  goalie_total: number
  goalie_stamped: number
  goalie_null: number
  goalie_hash: string
}

export interface BackfillSnapshot {
  version: 1
  createdAt: string
  dbHost: string
  dbLabel: string
  totals: {
    skaterTotal: number
    skaterStamped: number
    skaterNull: number
    goalieTotal: number
    goalieStamped: number
    goalieNull: number
    playerSeasonsTotal: number
    seasonTradesTotal: number
    seasonTradeItemsTotal: number
  }
  seasonChecksums: SeasonStatChecksum[]
  skaterRowsToModify: { player_id: number; game_id: string; team_slug: string | null; target_team_slug: string }[]
  goalieRowsToModify: { player_id: number; game_id: string; team_slug: string | null; target_team_slug: string }[]
  playerSeasonsToDelete: PlayerSeasonRowSnapshot[]
  existingSeasonTrades: SeasonTradeSnapshot[]
  existingSeasonTradeItems: SeasonTradeItemSnapshot[]
  /** Seasons covered by the dataset; rollback verification is scoped to these (live seasons keep changing). */
  historicalSeasonIds?: string[]
  /** `season_trades.id`s inserted by this `--apply`; rollback deletes by predicate, then verifies these are gone. */
  insertedTradeIds?: number[]
  /** Moves the `--apply` planned to insert; used to prove a `pending` apply actually landed in full. */
  plannedTradeMoveKeys?: string[]
  /** Lifecycle of an `--apply` snapshot. Absent on `--snapshot`-mode and legacy snapshots. */
  applyStatus?: "pending" | "complete" | "rolled-back"
}

export const DEFAULT_BACKUPS_DIR = path.resolve(__dirname, "../.backups")

export interface CliArgs {
  mode: "dry-run" | "apply" | "snapshot" | "rollback"
  url: string
  snapshotPath?: string
  confirmHost?: string
}

export function parseArgs(argv = process.argv.slice(2)): CliArgs {
  let mode: CliArgs["mode"] | undefined
  let url = process.env.DATABASE_URL || ""
  let snapshotPath: string | undefined
  let confirmHost: string | undefined

  const setMode = (next: CliArgs["mode"]) => {
    if (mode && mode !== next) {
      throw new Error(`Conflicting modes: --${mode} and --${next}. Pass exactly one mode flag.`)
    }
    mode = next
  }
  const requireValue = (flag: string, value: string | undefined): string => {
    if (!value || value.startsWith("-")) {
      throw new Error(`Missing value for ${flag}`)
    }
    return value
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--apply") {
      setMode("apply")
    } else if (a === "--dry-run" || a === "-n") {
      setMode("dry-run")
    } else if (a === "--snapshot") {
      setMode("snapshot")
      if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
        snapshotPath = argv[++i]
      }
    } else if (a.startsWith("--snapshot=")) {
      setMode("snapshot")
      snapshotPath = a.slice("--snapshot=".length) || undefined
    } else if (a === "--rollback") {
      setMode("rollback")
      if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
        throw new Error("Missing snapshot file path for --rollback <snapshot-file>")
      }
      snapshotPath = argv[++i]
    } else if (a.startsWith("--rollback=")) {
      setMode("rollback")
      snapshotPath = a.slice("--rollback=".length)
      if (!snapshotPath) {
        throw new Error("Missing snapshot file path for --rollback=<snapshot-file>")
      }
    } else if (a === "--url" || a === "--db") {
      url = requireValue(a, argv[++i])
    } else if (a.startsWith("--url=") || a.startsWith("--db=")) {
      url = requireValue(a.split("=")[0], a.slice(a.indexOf("=") + 1))
    } else if (a === "--confirm-host") {
      confirmHost = requireValue(a, argv[++i])
    } else if (a.startsWith("--confirm-host=")) {
      confirmHost = requireValue("--confirm-host", a.slice("--confirm-host=".length))
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }

  return { mode: mode ?? "dry-run", url, snapshotPath, confirmHost }
}

/**
 * Returns the parsed host plus an operator-supplied label (`DB_LABEL`), if any.
 * Intentionally does NOT guess dev/prod from the hostname — writes are gated by `--confirm-host`.
 */
export function describeDbEndpoint(dbUrl: string): { host: string; label: string } {
  const label = process.env.DB_LABEL || "(no DB_LABEL set)"
  try {
    return { host: new URL(dbUrl).host, label }
  } catch {
    return { host: "unknown", label }
  }
}

/** Throws unless `--confirm-host` exactly matches the target URL host (required for --apply / --rollback). */
export function assertConfirmedHost(dbUrl: string, confirmHost: string | undefined): void {
  const { host } = describeDbEndpoint(dbUrl)
  if (!confirmHost) {
    throw new Error(`Refusing to write without --confirm-host. Re-run with: --confirm-host ${host}`)
  }
  if (confirmHost !== host) {
    throw new Error(`--confirm-host "${confirmHost}" does not match target host "${host}".`)
  }
}

export function loadHistoricalTradedPlayers(
  jsonPath = path.resolve(__dirname, "../data/historical-traded-players.json")
): HistoricalTradeEntry[] {
  const raw = fs.readFileSync(jsonPath, "utf8")
  return JSON.parse(raw) as HistoricalTradeEntry[]
}

/**
 * The 16 zero-goal transition-window head-to-head skater rows held out for manual review.
 * Keyed by `${seasonId}:${normalizePlayerNameKey(playerName)}:${gameId}` — never by environment-specific
 * `players.id`. These rows are intentionally left untouched by Pass 2.
 */
export const MANUAL_REVIEW_HOLD_OUT_KEYS = new Set<string>([
  "2002-2003:breht clark:142863", // red-leafs -> landsharks on 2003-02-02
  "2002-2003:rich weber:142856", // rink-rats -> roadrunners on 2003-01-12
  "2011-2012:david bartenwerfer:1091270", // rink-rats -> landsharks on 2011-12-17
  "2011-2012:jordan ritter:1091270", // landsharks -> rink-rats on 2011-12-17
  "2013-2014:marc lajoie:1265286", // roadrunners -> red-army on 2014-01-11
  "2013-2014:reuben smith:1265286", // red-army -> roadrunners on 2014-01-11
  "2013-2014:scott kane:1265281", // roadrunners -> seals on 2013-12-14
  "2013-2014:scott kane:1265295", // roadrunners -> seals on 2014-02-08
  "2014-2015:suraj sharma:1346440", // rink-rats -> seals on 2015-01-24
  "2015-2016:kevin law:1420511", // landsharks -> roadrunners on 2016-03-12
  "2015-2016:conrad grodd:1420511", // roadrunners -> landsharks on 2016-03-12
  "2015-2016:gregory huntington:1420504", // rink-rats -> roadrunners on 2016-02-27
  "2018-2019:eddie parsons:1549426", // haze -> kings on 2019-02-02
  "2018-2019:eddie parsons:1549403", // haze -> kings on 2019-02-03
  "2018-2019:harrison hansen:1549426", // kings -> haze on 2019-02-02
  "2021-2022:geoff moore:1624048", // reign -> rink-rats on 2022-01-22
])

/**
 * Deterministic transition-window H2H resolutions proven by box-score goal tallies,
 * shutout-assist math, goalie GA/result, or paired trade dates.
 * Keyed by `${kind}:${seasonId}:${normalizePlayerNameKey(playerName)}:${gameId}` -> `{ targetTeamSlug, reason }`.
 *
 * Includes BOTH pre-trade (`fromTeamSlug`) flips AND proven post-trade (`toTeamSlug`) games
 * so Pass 3 tightens `minTo` and never dates a `season_trades.traded_at` after a post-trade game.
 */
export const DETERMINISTIC_TRANSITION_H2H_RESOLUTIONS: Record<
  string,
  { targetTeamSlug: string; reason: string }
> = {
  // 2000-2001 proven post-trade goalie H2H (tightens minTo to 2001-01-20)
  "goalie:2000-2001:gregory huntington:18839": {
    targetTeamSlug: "land-sharks",
    reason: "2000-2001 post-trade goalie H2H (res=L in roadrunners 8-4 land-sharks on 2001-01-20)",
  },

  // 2001-2002 dual-roster & traded players
  "skater:2001-2002:alan eidinger:68421": {
    targetTeamSlug: "rink-rats",
    reason: "2001-2002 post-trade H2H + boxscore goal sum (1G for rink-rats in 3-8 win; seals already has 3G)",
  },
  "skater:2001-2002:robert tucker:68421": {
    targetTeamSlug: "seals",
    reason: "2001-2002 post-trade H2H (paired 1-for-1 Week 1 swap with Alan Eidinger on 2001-10-06)",
  },
  "skater:2001-2002:christian beausejour:68421": {
    targetTeamSlug: "rink-rats",
    reason: "2001-2002 pre-trade H2H (2001-10-06 < 2002-01-19)",
  },
  "skater:2001-2002:christian beausejour:68438": {
    targetTeamSlug: "rink-rats",
    reason: "2001-2002 pre-trade H2H + boxscore goal sum (1G for rink-rats)",
  },
  "skater:2001-2002:christian beausejour:68466": {
    targetTeamSlug: "seals",
    reason: "2001-2002 post-trade H2H + boxscore goal sum (3G for seals)",
  },
  "skater:2001-2002:kerry hew:68428": {
    targetTeamSlug: "landsharks",
    reason: "2001-2002 pre-trade H2H + boxscore goal sum (2G for landsharks)",
  },
  "skater:2001-2002:kerry hew:68473": {
    targetTeamSlug: "roadrunners",
    reason: "2001-2002 post-trade H2H (2002-03-02 >= 2002-02-02)",
  },
  "skater:2001-2002:parker colvin:68462": {
    targetTeamSlug: "landsharks",
    reason: "2001-2002 post-trade H2H + boxscore goal sum (1G for landsharks in 7-3 loss; seals already has 7G)",
  },
  "skater:2001-2002:parker colvin:68476": {
    targetTeamSlug: "landsharks",
    reason: "2001-2002 post-trade H2H (2002-03-09 >= 2002-02-02)",
  },
  "goalie:2001-2002:richard deming:68426": {
    targetTeamSlug: "landsharks",
    reason: "2001-2002 pre-trade goalie H2H (res=L, GA=6 for landsharks)",
  },
  "goalie:2001-2002:richard deming:68440": {
    targetTeamSlug: "landsharks",
    reason: "2001-2002 pre-trade goalie H2H (res=W, GA=0 for landsharks)",
  },
  "goalie:2001-2002:richard deming:68471": {
    targetTeamSlug: "rink-rats",
    reason: "2001-2002 post-trade goalie H2H (res=W, GA=4 for rink-rats)",
  },

  // 2002-2003
  "skater:2002-2003:andy heller:142857": {
    targetTeamSlug: "seals",
    reason: "Pre-trade H2H before seals<->landsharks trade window (2003-01-19)",
  },
  "skater:2002-2003:andy heller:142867": {
    targetTeamSlug: "landsharks",
    reason: "Post-trade H2H + boxscore goal sum (1G for landsharks in 3-2 loss; seals already has 3G)",
  },
  "skater:2002-2003:glenn andres:142859": {
    targetTeamSlug: "landsharks",
    reason: "Recorded 1A in 5-0 landsharks shutout win over roadrunners",
  },
  "skater:2002-2003:sherwood, daniel:142859": {
    targetTeamSlug: "landsharks",
    reason: "Paired with Glenn Andres in 2003-01-19 landsharks->roadrunners trade",
  },
  "skater:2002-2003:regan fletcher:142855": {
    targetTeamSlug: "seals",
    reason: "Played goalie for seals on 2003-01-12 after 2003-01-05 H2H",
  },

  // 2003-summer
  "skater:2003-summer:john toal:205832": {
    targetTeamSlug: "teddy-s-teamsters",
    reason: "Post-trade H2H + boxscore goal sum (3G for teddy-s-teamsters in 6-5 win on 2003-06-08)",
  },

  // 2005-2006
  "goalie:2005-2006:anthony delmonico:454020": {
    targetTeamSlug: "roadrunners",
    reason: "Allowed GA=4 in roadrunners (3) @ seals (4) on 2005-11-19",
  },
  "skater:2005-2006:paul polakis:454020": {
    targetTeamSlug: "seals",
    reason: "Paired with Anthony Delmonico in roadrunners<->seals trade after 2005-11-19",
  },
  "skater:2005-2006:pat kelley:454020": {
    targetTeamSlug: "roadrunners",
    reason: "Paired with Anthony Delmonico in roadrunners<->seals trade after 2005-11-19",
  },

  // 2009-summer
  "goalie:2009-summer:matt bowen:863534": {
    targetTeamSlug: "seiwald-s-secret-squirrels-a-new-beginning",
    reason: "Post-trade goalie H2H (GA=0, res=W in 7-0 shutout win over north-stars on 2009-06-27)",
  },

  // 2013-2014
  "skater:2013-2014:marc lajoie:1265305": {
    targetTeamSlug: "red-army",
    reason: "Post-trade H2H: recorded 1A in 4-0 red-army shutout win over roadrunners on 2014-01-18",
  },

  // 2014-2015
  "skater:2014-2015:kelly shea:1346441": {
    targetTeamSlug: "haze",
    reason: "Post-trade H2H: scored 1G in 2-0 haze shutout win over seals on 2015-01-31",
  },
  "skater:2014-2015:harvey braverman:1346441": {
    targetTeamSlug: "seals",
    reason: "Paired with Kelly Shea in haze<->seals trade completed before 2015-01-31",
  },

  // 2016-2017
  "skater:2016-2017:geoff moore:1457588": {
    targetTeamSlug: "roadrunners",
    reason: "Played for roadrunners through 2017-01-07 (2016-11-19 seals game was same-day sub)",
  },

  // 2017-2018
  "skater:2017-2018:gregory dunmore:1501401": {
    targetTeamSlug: "red-army",
    reason: "Post-trade H2H: recorded 2A in 10-0 red-army shutout win over roadrunners on 2018-01-06",
  },

  // 2018-summer
  "skater:2018-summer:jason mandell:1535654": {
    targetTeamSlug: "pho-cough",
    reason: "Boxscore goal sum: scored 1G for pho-cough (8-4 win on 2018-06-23)",
  },
  "skater:2018-summer:jason mandell:1535665": {
    targetTeamSlug: "pho-cough",
    reason: "Boxscore goal sum: scored 1G for pho-cough (4-9 loss on 2018-08-04)",
  },

  // 2018-2019
  "skater:2018-2019:luke wang:1549424": {
    targetTeamSlug: "landsharks",
    reason: "Boxscore goal sum: scored 1G for landsharks (2-1 win on 2019-02-02)",
  },
  "skater:2018-2019:luke wang:1549404": {
    targetTeamSlug: "landsharks",
    reason: "Same weekend (2019-02-03) before Evan Weston<->Luke Wang trade (2019-02-09)",
  },

  // 2021-2022
  "skater:2021-2022:wayne seto:1624023": {
    targetTeamSlug: "yetis",
    reason: "Pre-trade H2H on 2021-11-06 (proven still on yetis by 1G on 2021-12-18)",
  },
  "skater:2021-2022:wayne seto:1624044": {
    targetTeamSlug: "yetis",
    reason: "Boxscore goal sum: scored 1G for yetis (6-2 win on 2021-12-18)",
  },
  "skater:2021-2022:david ruiz:1624040": {
    targetTeamSlug: "seals",
    reason: "Played goalie for seals on 2021-12-18 after 2021-12-11 H2H",
  },
  "skater:2021-2022:william goodale:1624052": {
    targetTeamSlug: "landsharks",
    reason: "Post-trade H2H: recorded 2A in reign 1-4 landsharks (max 1A possible on reign's 1 goal)",
  },
  "skater:2021-2022:william searcy:1624052": {
    targetTeamSlug: "reign",
    reason: "Paired with William Goodale in reign<->landsharks trade before 2022-01-29",
  },
  "skater:2021-2022:chris lambert:1624052": {
    targetTeamSlug: "landsharks",
    reason: "Paired with William Goodale in reign<->landsharks trade before 2022-01-29",
  },

  // 2022-2023
  "skater:2022-2023:gregory dunmore:1643199": {
    targetTeamSlug: "landsharks",
    reason: "Post-trade H2H: scored 1G in 4-0 landsharks shutout win over no-regretzkys on 2023-02-04",
  },

  // 2023-2024 (Game 1668591 on 2024-01-20, rink-rats 2 vs reign 3: boxscore proves exactly one of
  // Hjalmarsson/MacNab played for each side, separating the pre-Jan-20 trade from MacNab's later move)
  "skater:2023-2024:oscar hjalmarsson:1668591": {
    targetTeamSlug: "reign",
    reason: "Post-trade H2H (2024-01-20): debuted non-H2H for reign on 2024-01-27; scored reign's 3rd goal",
  },
  "skater:2023-2024:andrew pratt:1668591": {
    targetTeamSlug: "reign",
    reason: "Post-trade H2H (2024-01-20): paired in pre-Jan-20 rink-rats<->reign trade (debuted non-H2H 2024-01-27)",
  },
  "skater:2023-2024:alexander cerdan:1668591": {
    targetTeamSlug: "reign",
    reason: "Post-trade H2H (2024-01-20): paired in pre-Jan-20 rink-rats<->reign trade (debuted non-H2H 2024-01-27)",
  },
  "skater:2023-2024:andrew keeler:1668591": {
    targetTeamSlug: "rink-rats",
    reason: "Post-trade H2H (2024-01-20): paired in pre-Jan-20 rink-rats<->reign trade (debuted non-H2H 2024-01-27)",
  },
  "skater:2023-2024:john toal:1668591": {
    targetTeamSlug: "rink-rats",
    reason: "Post-trade H2H (2024-01-20): paired in pre-Jan-20 rink-rats<->reign trade (debuted non-H2H 2024-01-27)",
  },
  "skater:2023-2024:nicholas macnab:1668591": {
    targetTeamSlug: "rink-rats",
    reason: "Pre-trade H2H (2024-01-20): scored rink-rats' 2nd goal; did not debut for reign until 2024-02-10",
  },
  "skater:2023-2024:kyle boehm:1668585": {
    targetTeamSlug: "seals",
    reason: "Pre-trade H2H on 2023-12-16 before Jan 2024 seals<->rink-rats trade",
  },

  // 2024-2025
  "skater:2024-2025:conor murphy:1690776": {
    targetTeamSlug: "no-regretzkys",
    reason: "Pre-trade H2H on 2024-12-14 before Jan 2025 Broglie<->Murphy trade",
  },
  "skater:2024-2025:harry macinnis:1690784": {
    targetTeamSlug: "yetis",
    reason: "Post-trade H2H: recorded 5A in reign 3-12 yetis (max 3A possible on reign's 3 goals)",
  },
  "skater:2024-2025:andrew mcgrath:1690784": {
    targetTeamSlug: "yetis",
    reason: "Paired with Harry MacInnis in reign<->yetis trade before 2025-01-25",
  },
  "skater:2024-2025:geoff moore:1690784": {
    targetTeamSlug: "reign",
    reason: "Paired with Harry MacInnis in reign<->yetis trade before 2025-01-25",
  },
  "skater:2024-2025:christopher wong:1690788": {
    targetTeamSlug: "rink-rats",
    reason: "Post-trade H2H: recorded 1A in 7-0 rink-rats shutout win over reign on 2025-02-01",
  },
}

export interface PlannedTradeRecord {
  seasonId: string
  teamSlugs: string[]
  tradeDate: string // YYYY-MM-DD (Pacific)
  tradedAt: string // ISO timestamp (noon Pacific)
  notes: string
  moves: {
    playerId: number
    playerName: string
    fromTeamSlug: string
    toTeamSlug: string
  }[]
}

interface TradedPlayerGameRow {
  kind: "skater" | "goalie"
  player_id: number
  playerName: string
  seasonId: string
  fromTeamSlug: string
  toTeamSlug: string
  game_id: string
  date: string
  home_team: string
  away_team: string
  team_slug: string | null
}

export interface BoxscoreRegression {
  gameId: string
  seasonId: string
  date: string
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  preError: number
  postError: number
  preTeamError: number
  postTeamError: number
  preExcess: number
  postExcess: number
}

export interface TradeDateContradiction {
  seasonId: string
  playerName: string
  gameId: string
  gameDate: string
  tradeDate: string
  stampedTeamSlug: string
  fromTeamSlug: string
  toTeamSlug: string
  isManualHoldOut: boolean
}

export interface BackfillPlan {
  entries: ResolvedHistoricalTradeEntry[]
  statChanges: StatAttributionChange[]
  playerSeasonsToDelete: PlayerSeasonRowSnapshot[]
  /** Only trades with at least one move not yet recorded in `season_trade_items` (notes reflect pending moves only). */
  plannedTrades: PlannedTradeRecord[]
  /** Every trade cluster derived from the dataset, before filtering out already-recorded moves. */
  allTradeClusters: PlannedTradeRecord[]
  manualReviewSkippedCount: number
  /** fromTeam-only rows left alone because they already carry a non-NULL slug (e.g. sub for a 3rd team). */
  pass1SkippedNonNull: StatAttributionChange[]
  /** fromTeam-only NULL rows dated on/after the player's first toTeam-only game (likely post-trade sub appearances). */
  pass1SkippedPostTrade: StatAttributionChange[]
  /** Non-hold-out trade-date contradictions (must be empty before --apply). */
  tradeDateContradictions: TradeDateContradiction[]
  /** Hold-out games whose pre-existing post-trade slug predates the derived cluster tradeDate (informational). */
  holdOutDateOverlaps: TradeDateContradiction[]
  /** Boxscore goal-sum regression check across all touched games (must be empty before --apply). */
  boxscoreRegressions: BoxscoreRegression[]
  /** Count of touched non-forfeit games brought to exact goal-sum parity by this plan. */
  boxscoreFixedExactCount: number
}

/**
 * The only `player_seasons` duplicates this script is allowed to delete (2001-2002 dual-roster traded players).
 * Keyed by `${seasonId}:${normalizePlayerNameKey(playerName)}:${teamSlug}` (never by environment-specific `players.id`).
 */
export const EXPECTED_DUPLICATE_PLAYER_SEASONS = new Set<string>([
  "2001-2002:richard deming:landsharks",
  "2001-2002:parker colvin:seals",
  "2001-2002:christian beausejour:rink-rats",
  "2001-2002:kerry hew:landsharks",
])

/** Max gap (days) for merging a same-team-pair move into an existing trade cluster when a bound is unknown. */
export const TRADE_CLUSTER_PROXIMITY_DAYS = 28

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000
}

function intervalGapDays(aLo: string, aHi: string, bLo: string, bHi: string): number {
  if (aHi < bLo) return daysBetween(aHi, bLo)
  if (bHi < aLo) return daysBetween(bHi, aLo)
  return 0
}

export interface ClusterInput<T> {
  item: T
  maxFrom: string | null
  minTo: string | null
}

/**
 * Clusters same-(season, team pair) moves into trade records. Two moves merge when their combined
 * [maxFrom, minTo] window is still non-empty; when any bound is unknown, the move must additionally sit
 * within `TRADE_CLUSTER_PROXIMITY_DAYS` of the cluster's fixed *seed* interval (its first move), so
 * clusters cannot chain forward week after week and unrelated Oct/Dec trades never collapse.
 */
export function clusterTradeMoves<T>(
  inputs: ClusterInput<T>[]
): { items: ClusterInput<T>[]; clusterMaxFrom: string | null; clusterMinTo: string | null }[] {
  const clusters: {
    items: ClusterInput<T>[]
    clusterMaxFrom: string | null
    clusterMinTo: string | null
    seedLo: string | null
    seedHi: string | null
  }[] = []
  for (const input of inputs) {
    const iLo = input.maxFrom ?? input.minTo
    const iHi = input.minTo ?? input.maxFrom
    let placed = false
    for (const c of clusters) {
      const nextMaxFrom =
        c.clusterMaxFrom && input.maxFrom
          ? (c.clusterMaxFrom > input.maxFrom ? c.clusterMaxFrom : input.maxFrom)
          : (c.clusterMaxFrom ?? input.maxFrom)
      const nextMinTo =
        c.clusterMinTo && input.minTo
          ? (c.clusterMinTo < input.minTo ? c.clusterMinTo : input.minTo)
          : (c.clusterMinTo ?? input.minTo)

      if (nextMaxFrom && nextMinTo && nextMaxFrom >= nextMinTo) continue

      const hasUnknownBound = !input.maxFrom || !input.minTo || !c.clusterMaxFrom || !c.clusterMinTo
      if (hasUnknownBound) {
        if (!iLo || !iHi || !c.seedLo || !c.seedHi) continue
        if (intervalGapDays(iLo, iHi, c.seedLo, c.seedHi) > TRADE_CLUSTER_PROXIMITY_DAYS) continue
      }

      c.items.push(input)
      c.clusterMaxFrom = nextMaxFrom
      c.clusterMinTo = nextMinTo
      placed = true
      break
    }
    if (!placed) {
      clusters.push({ items: [input], clusterMaxFrom: input.maxFrom, clusterMinTo: input.minTo, seedLo: iLo, seedHi: iHi })
    }
  }
  return clusters.map(({ items, clusterMaxFrom, clusterMinTo }) => ({ items, clusterMaxFrom, clusterMinTo }))
}

export function buildTradeNotes(
  moves: { playerName: string; toTeamSlug: string }[],
  teamNameBySlug: Map<string, string>
): string {
  const byDest = new Map<string, string[]>()
  for (const m of moves) {
    if (!byDest.has(m.toTeamSlug)) byDest.set(m.toTeamSlug, [])
    byDest.get(m.toTeamSlug)!.push(m.playerName)
  }
  const parts = [...byDest.entries()].map(
    ([toSlug, names]) => `${names.join(" & ")} to ${teamNameBySlug.get(toSlug) ?? toSlug}`
  )
  return `${HISTORICAL_TRADE_NOTES_PREFIX}${parts.join(", ")}`
}

export const HISTORICAL_TRADE_NOTES_PREFIX = "Historical trade: "

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function midpointDate(d1: string, d2: string): string {
  const t1 = new Date(`${d1}T12:00:00Z`).getTime()
  const t2 = new Date(`${d2}T12:00:00Z`).getTime()
  if (t2 <= t1) return addDays(d1, 1)
  const mid = new Date(Math.round((t1 + t2) / 2))
  return mid.toISOString().slice(0, 10)
}

/**
 * Resolves every `HistoricalTradeEntry` against the target database at runtime by
 * normalized `players.name` (never trusting hardcoded Dev DB `players.id` values),
 * and validates that:
 *   1. Each `playerName` resolves to exactly 1 row in `players` (0 or >1 aborts).
 *   2. Both `fromTeamSlug` and `toTeamSlug` exist in `season_teams` for `seasonId`.
 *   3. The resolved `playerId` holds a `player_seasons` row for `(seasonId, toTeamSlug)`.
 *   4. Every `(seasonId, playerId)` pair is unique across the resolved dataset.
 */
export async function resolveEntriesForDatabase(
  sql: Sql,
  rawEntries: HistoricalTradeEntry[]
): Promise<ResolvedHistoricalTradeEntry[]> {
  if (rawEntries.length === 0) return []
  const seasonIds = [...new Set(rawEntries.map((e) => e.seasonId))].sort()
  const normNames = [...new Set(rawEntries.map((e) => normalizePlayerNameKey(e.playerName)))].sort()

  const [playersRows, seasonTeamsRows, playerSeasonsRows] = await Promise.all([
    sql`
      SELECT id, name
      FROM players
      WHERE TRIM(regexp_replace(LOWER(name), '[[:space:]]+', ' ', 'g')) = ANY(${normNames}::text[])
    ` as unknown as Promise<{ id: number; name: string }[]>,
    sql`
      SELECT season_id, team_slug
      FROM season_teams
      WHERE season_id = ANY(${seasonIds}::text[])
    ` as unknown as Promise<{ season_id: string; team_slug: string }[]>,
    sql`
      SELECT player_id, season_id, team_slug
      FROM player_seasons
      WHERE season_id = ANY(${seasonIds}::text[])
    ` as unknown as Promise<{ player_id: number; season_id: string; team_slug: string }[]>,
  ])

  const playersByNorm = new Map<string, { id: number; name: string }[]>()
  for (const p of playersRows) {
    const k = normalizePlayerNameKey(String(p.name))
    if (!playersByNorm.has(k)) playersByNorm.set(k, [])
    playersByNorm.get(k)!.push({ id: Number(p.id), name: String(p.name) })
  }

  const seasonTeamSet = new Set(seasonTeamsRows.map((r) => `${r.season_id}:${r.team_slug}`))
  const playerSeasonSet = new Set(
    playerSeasonsRows.map((r) => `${r.season_id}:${Number(r.player_id)}:${r.team_slug}`)
  )

  const errors: string[] = []
  const seenKeys = new Set<string>()
  const resolved: ResolvedHistoricalTradeEntry[] = []

  for (const e of rawEntries) {
    if (e.fromTeamSlug === e.toTeamSlug) {
      errors.push(`${e.seasonId} ${e.playerName}: self-trade (${e.fromTeamSlug} -> ${e.toTeamSlug})`)
      continue
    }
    if (!seasonTeamSet.has(`${e.seasonId}:${e.fromTeamSlug}`)) {
      errors.push(`${e.seasonId} ${e.playerName}: fromTeamSlug "${e.fromTeamSlug}" missing from season_teams`)
    }
    if (!seasonTeamSet.has(`${e.seasonId}:${e.toTeamSlug}`)) {
      errors.push(`${e.seasonId} ${e.playerName}: toTeamSlug "${e.toTeamSlug}" missing from season_teams`)
    }

    const matches = playersByNorm.get(normalizePlayerNameKey(e.playerName)) ?? []
    if (matches.length !== 1) {
      errors.push(
        `${e.seasonId} "${e.playerName}": expected exactly 1 player match in target DB, found ${matches.length}` +
          (matches.length > 1 ? ` (${matches.map((m) => `#${m.id} ${m.name}`).join(", ")})` : "")
      )
      continue
    }

    const playerId = matches[0].id
    if (!playerSeasonSet.has(`${e.seasonId}:${playerId}:${e.toTeamSlug}`)) {
      errors.push(
        `${e.seasonId} "${e.playerName}" (#${playerId}): missing player_seasons row for toTeamSlug "${e.toTeamSlug}"`
      )
      continue
    }

    const pairKey = `${e.seasonId}:${playerId}`
    if (seenKeys.has(pairKey)) {
      errors.push(`${e.seasonId} "${e.playerName}" (#${playerId}): duplicate (seasonId, playerId) entry`)
      continue
    }
    seenKeys.add(pairKey)

    resolved.push({
      ...e,
      playerId,
    })
  }

  if (errors.length > 0) {
    throw new Error(
      `Failed to resolve historical trade entries against target database (${errors.length} error(s)):\n  - ` +
        errors.join("\n  - ")
    )
  }

  return resolved
}

/**
 * Evaluates box-score goal-sum parity before vs. after applying `statChanges` on all touched
 * non-forfeit games, returning any regressions (`postError > preError`) and count of games fixed
 * to exact score parity (`postError === 0 && postError < preError`).
 */
export async function auditBoxscoreRegressions(
  sql: Sql,
  statChanges: StatAttributionChange[]
): Promise<{ regressions: BoxscoreRegression[]; fixedExactCount: number }> {
  const skaterChanges = statChanges.filter((c) => c.kind === "skater")
  const touchedGameIds = [...new Set(skaterChanges.map((c) => c.gameId))]
  if (touchedGameIds.length === 0) {
    return { regressions: [], fixedExactCount: 0 }
  }

  const [gamesRows, pgsRows] = await Promise.all([
    sql`
      SELECT id, season_id, date, home_team, away_team, home_score, away_score, is_forfeit
      FROM games
      WHERE id = ANY(${touchedGameIds}::text[])
    ` as unknown as Promise<
      {
        id: string
        season_id: string
        date: string
        home_team: string
        away_team: string
        home_score: number | null
        away_score: number | null
        is_forfeit: boolean
      }[]
    >,
    sql`
      SELECT game_id, player_id, team_slug, goals
      FROM player_game_stats
      WHERE game_id = ANY(${touchedGameIds}::text[])
    ` as unknown as Promise<{ game_id: string; player_id: number; team_slug: string | null; goals: number }[]>,
  ])

  const nextSlugByKey = new Map<string, string>()
  for (const c of skaterChanges) {
    nextSlugByKey.set(`${c.playerId}:${c.gameId}`, c.newTeamSlug)
  }

  const pgsByGame = new Map<string, typeof pgsRows>()
  for (const r of pgsRows) {
    if (!pgsByGame.has(r.game_id)) pgsByGame.set(r.game_id, [])
    pgsByGame.get(r.game_id)!.push(r)
  }

  const regressions: BoxscoreRegression[] = []
  let fixedExactCount = 0

  for (const g of gamesRows) {
    if (g.is_forfeit || g.home_score == null || g.away_score == null) continue
    const rows = pgsByGame.get(g.id) ?? []
    let preH = 0,
      preA = 0,
      preOther = 0
    let postH = 0,
      postA = 0,
      postOther = 0

    for (const r of rows) {
      const preSlug = r.team_slug
      const key = `${r.player_id}:${r.game_id}`
      const postSlug = nextSlugByKey.has(key) ? nextSlugByKey.get(key)! : preSlug

      if (preSlug === g.home_team) preH += Number(r.goals)
      else if (preSlug === g.away_team) preA += Number(r.goals)
      else preOther += Number(r.goals)

      if (postSlug === g.home_team) postH += Number(r.goals)
      else if (postSlug === g.away_team) postA += Number(r.goals)
      else postOther += Number(r.goals)
    }

    const preError = Math.abs(preH - g.home_score) + Math.abs(preA - g.away_score) + preOther
    const postError = Math.abs(postH - g.home_score) + Math.abs(postA - g.away_score) + postOther
    const preTeamError = Math.abs(preH - g.home_score) + Math.abs(preA - g.away_score)
    const postTeamError = Math.abs(postH - g.home_score) + Math.abs(postA - g.away_score)
    const preExcess = Math.max(0, preH - g.home_score) + Math.max(0, preA - g.away_score)
    const postExcess = Math.max(0, postH - g.home_score) + Math.max(0, postA - g.away_score)
    // When both teams are already at or above the recorded scoreboard total (e.g. an upstream
    // Sportability mercy-capped score where total skater goals exceed home_score + away_score),
    // attributing a NULL goal to either side increases teamError/excess equally; only flag those
    // games if total error itself worsens or a goal is attributed to a 0-goal shutout team.
    const bothTeamsAlreadyFull = preH >= g.home_score && preA >= g.away_score
    const shutoutGoalAdded =
      (g.home_score === 0 && postH > preH) || (g.away_score === 0 && postA > preA)

    if (
      postError > preError ||
      shutoutGoalAdded ||
      (!bothTeamsAlreadyFull && (postTeamError > preTeamError || postExcess > preExcess))
    ) {
      regressions.push({
        gameId: g.id,
        seasonId: g.season_id,
        date: g.date,
        homeTeam: g.home_team,
        awayTeam: g.away_team,
        homeScore: g.home_score,
        awayScore: g.away_score,
        preError,
        postError,
        preTeamError,
        postTeamError,
        preExcess,
        postExcess,
      })
    } else if (postError < preError && postError === 0) {
      fixedExactCount++
    }
  }

  return { regressions, fixedExactCount }
}

/**
 * Builds the complete, deterministic backfill plan by resolving every entry against the
 * target DB's `players` table at runtime, then evaluating Pass 1 (3rd-team orphan NULL rows),
 * Pass 2 (pre-trade & resolved transition H2H rows), 2001-2002 duplicate `player_seasons` cleanup,
 * Pass 3 (`season_trades` + `season_trade_items` audit records), and pre-apply boxscore/date invariants.
 */
export async function buildBackfillPlan(
  sql: Sql,
  rawEntries: HistoricalTradeEntry[] = loadHistoricalTradedPlayers()
): Promise<BackfillPlan> {
  const entries = await resolveEntriesForDatabase(sql, rawEntries)
  const playerNameById = new Map<number, string>(entries.map((e) => [e.playerId, e.playerName]))

  // All four reads are independent — one parallel wave (AGENTS.md: no sequential await waterfalls).
  const entriesJson = JSON.stringify(entries)
  const [allTradedPlayerGames, duplicatePsCandidates, teamNamesRows, existingMoveRows] = await Promise.all([
    sql`
      WITH traded AS (
        SELECT * FROM jsonb_to_recordset(${entriesJson}::jsonb)
          AS t("seasonId" text, "playerId" int, "playerName" text, "fromTeamSlug" text, "toTeamSlug" text)
      ), combined AS (
        SELECT 'skater' AS kind, pgs.player_id, pgs.game_id, pgs.team_slug
        FROM player_game_stats pgs
        UNION ALL
        SELECT 'goalie' AS kind, ggs.player_id, ggs.game_id, ggs.team_slug
        FROM goalie_game_stats ggs
      )
      SELECT c.kind, c.player_id, t."playerName", t."seasonId", t."fromTeamSlug", t."toTeamSlug",
             g.id AS game_id, g.date, g.home_team, g.away_team, c.team_slug
      FROM traded t
      JOIN games g ON g.season_id = t."seasonId"
      JOIN combined c ON c.game_id = g.id AND c.player_id = t."playerId"
      ORDER BY t."seasonId", t."playerId", g.date, g.id, c.kind
    ` as unknown as Promise<TradedPlayerGameRow[]>,
    // Duplicate pre-trade player_seasons rows — validated against EXPECTED_DUPLICATE_PLAYER_SEASONS below.
    sql`
      WITH traded AS (
        SELECT * FROM jsonb_to_recordset(${entriesJson}::jsonb)
          AS t("seasonId" text, "playerId" int, "fromTeamSlug" text, "toTeamSlug" text)
      )
      SELECT ps.player_id, ps.season_id, ps.team_slug, ps.is_goalie, ps.is_captain, ps.is_rookie, ps.registration_meta
      FROM player_seasons ps
      JOIN traded t ON t."seasonId" = ps.season_id AND t."playerId" = ps.player_id AND t."fromTeamSlug" = ps.team_slug
      WHERE EXISTS (
        SELECT 1 FROM player_seasons ps_to
        WHERE ps_to.season_id = ps.season_id
          AND ps_to.player_id = ps.player_id
          AND ps_to.team_slug = t."toTeamSlug"
      )
      ORDER BY ps.season_id, ps.player_id, ps.team_slug
    ` as unknown as Promise<PlayerSeasonRowSnapshot[]>,
    sql`SELECT slug, name FROM teams` as unknown as Promise<{ slug: string; name: string }[]>,
    sql`
      SELECT st.season_id, sti.player_id, sti.from_team_slug, sti.to_team_slug
      FROM season_trade_items sti
      JOIN season_trades st ON st.id = sti.trade_id
      WHERE sti.item_type = 'player'
    ` as unknown as Promise<{ season_id: string; player_id: number; from_team_slug: string; to_team_slug: string }[]>,
  ])

  const byPlayerSeason = new Map<string, typeof allTradedPlayerGames>()
  for (const r of allTradedPlayerGames) {
    const k = `${r.seasonId}:${r.player_id}`
    if (!byPlayerSeason.has(k)) byPlayerSeason.set(k, [])
    byPlayerSeason.get(k)!.push(r)
  }

  const statChanges: StatAttributionChange[] = []
  const pass1SkippedNonNull: StatAttributionChange[] = []
  const pass1SkippedPostTrade: StatAttributionChange[] = []
  const playerWindows = new Map<string, { maxFromDate: string | null; minToDate: string | null }>()
  let manualReviewSkippedCount = 0

  const isGeoffMooreSubGame = (seasonId: string, playerName: string, gameId: string) =>
    seasonId === "2016-2017" && normalizePlayerNameKey(playerName) === "geoff moore" && gameId === "1457581"

  for (const entry of entries) {
    const k = `${entry.seasonId}:${entry.playerId}`
    const rows = byPlayerSeason.get(k) ?? []

    let maxFromDate: string | null = null
    let minToDate: string | null = null

    // Compute minToDate first from legitimate toTeam-only appearances (ignoring 3rd-team subs and Geoff Moore's sub game).
    for (const r of rows) {
      if (isGeoffMooreSubGame(entry.seasonId, entry.playerName, r.game_id)) continue
      const hasFrom = r.home_team === entry.fromTeamSlug || r.away_team === entry.fromTeamSlug
      const hasTo = r.home_team === entry.toTeamSlug || r.away_team === entry.toTeamSlug
      if (hasTo && !hasFrom && (r.team_slug === null || r.team_slug === entry.toTeamSlug)) {
        if (!minToDate || r.date < minToDate) minToDate = r.date
      }
    }

    // Compute maxFromDate only from legitimate pre-trade fromTeam-only rows (never from skipped 3rd-team subs or post-trade NULLs).
    for (const r of rows) {
      if (isGeoffMooreSubGame(entry.seasonId, entry.playerName, r.game_id)) continue
      const hasFrom = r.home_team === entry.fromTeamSlug || r.away_team === entry.fromTeamSlug
      const hasTo = r.home_team === entry.toTeamSlug || r.away_team === entry.toTeamSlug
      if (hasFrom && !hasTo) {
        const isLegitFrom =
          r.team_slug === entry.fromTeamSlug ||
          (r.team_slug === null && (minToDate === null || r.date < minToDate))
        if (isLegitFrom && (!maxFromDate || r.date > maxFromDate)) {
          maxFromDate = r.date
        }
      }
    }

    playerWindows.set(k, { maxFromDate, minToDate })

    for (const r of rows) {
      const hasFrom = r.home_team === entry.fromTeamSlug || r.away_team === entry.fromTeamSlug
      const hasTo = r.home_team === entry.toTeamSlug || r.away_team === entry.toTeamSlug

      // Pass 1: 3rd-team orphan game where only fromTeamSlug participated.
      // Only stamps NULL rows dated before the player's first toTeam-only game; anything else
      // (a non-NULL slug, or a post-trade appearance) is reported for manual review instead.
      if (hasFrom && !hasTo) {
        if (r.team_slug !== entry.fromTeamSlug) {
          const change: StatAttributionChange = {
            kind: r.kind,
            pass: "pass1_orphan_3rd_team",
            seasonId: entry.seasonId,
            playerId: entry.playerId,
            playerName: entry.playerName,
            gameId: r.game_id,
            date: r.date,
            homeTeam: r.home_team,
            awayTeam: r.away_team,
            previousTeamSlug: r.team_slug,
            newTeamSlug: entry.fromTeamSlug,
            reason: `3rd-team pre-trade game (${entry.fromTeamSlug} vs 3rd team)`,
          }
          if (r.team_slug !== null) {
            pass1SkippedNonNull.push(change)
          } else if (minToDate !== null && r.date >= minToDate) {
            pass1SkippedPostTrade.push(change)
          } else {
            statChanges.push(change)
          }
        }
        continue
      }

      // Pass 2: Head-to-head matchup where both fromTeamSlug and toTeamSlug participated
      if (hasFrom && hasTo) {
        const hKey = holdOutKey(entry.seasonId, entry.playerName, r.game_id)
        if (r.kind === "skater" && MANUAL_REVIEW_HOLD_OUT_KEYS.has(hKey)) {
          manualReviewSkippedCount++
          continue
        }

        const overrideKey = transitionH2HKey(r.kind, entry.seasonId, entry.playerName, r.game_id)
        const explicitOverride = DETERMINISTIC_TRANSITION_H2H_RESOLUTIONS[overrideKey]
        if (explicitOverride) {
          if (r.team_slug !== explicitOverride.targetTeamSlug) {
            statChanges.push({
              kind: r.kind,
              pass: "pass2_h2h",
              seasonId: entry.seasonId,
              playerId: entry.playerId,
              playerName: entry.playerName,
              gameId: r.game_id,
              date: r.date,
              homeTeam: r.home_team,
              awayTeam: r.away_team,
              previousTeamSlug: r.team_slug,
              newTeamSlug: explicitOverride.targetTeamSlug,
              reason: explicitOverride.reason,
            })
          }
          continue
        }

        const isStrictlyPreTrade =
          maxFromDate !== null &&
          r.date <= maxFromDate &&
          (minToDate === null || r.date < minToDate)

        if (isStrictlyPreTrade && r.team_slug !== entry.fromTeamSlug) {
          statChanges.push({
            kind: r.kind,
            pass: "pass2_h2h",
            seasonId: entry.seasonId,
            playerId: entry.playerId,
            playerName: entry.playerName,
            gameId: r.game_id,
            date: r.date,
            homeTeam: r.home_team,
            awayTeam: r.away_team,
            previousTeamSlug: r.team_slug,
            newTeamSlug: entry.fromTeamSlug,
            reason: `Pre-trade H2H (${r.date} <= maxFromDate ${maxFromDate})`,
          })
        }
      }
    }
  }

  // Duplicate pre-trade player_seasons rows — strictly limited to the 4 known 2001-2002 dual-roster players.
  const unexpectedDuplicates = duplicatePsCandidates.filter((r) => {
    const pName = playerNameById.get(Number(r.player_id)) ?? ""
    return !EXPECTED_DUPLICATE_PLAYER_SEASONS.has(duplicatePsKey(r.season_id, pName, r.team_slug))
  })
  if (unexpectedDuplicates.length > 0) {
    throw new Error(
      `Unexpected dual player_seasons rows for traded players (refusing to plan deletes):\n  - ` +
        unexpectedDuplicates
          .map((r) => `${r.season_id} ${playerNameById.get(Number(r.player_id)) ?? `#${r.player_id}`} on ${r.team_slug}`)
          .join("\n  - ")
    )
  }
  const duplicatePsRows = duplicatePsCandidates

  // Pass 3: Build historical season_trades + season_trade_items records.
  // Group entries by (seasonId, sortedTeamPair) when their transition windows overlap,
  // or keep separate trade records when windows are disjoint (e.g. Oct vs Dec trade between same two teams).
  const entriesWithDates = entries.map((e) => {
    const win = playerWindows.get(`${e.seasonId}:${e.playerId}`) ?? { maxFromDate: null, minToDate: null }
    // Tighten maxFrom / minTo from every resolved H2H game (both pre-trade and proven post-trade)
    let maxFrom = win.maxFromDate
    let minTo = win.minToDate
    const rows = byPlayerSeason.get(`${e.seasonId}:${e.playerId}`) ?? []
    for (const r of rows) {
      const hasFrom = r.home_team === e.fromTeamSlug || r.away_team === e.fromTeamSlug
      const hasTo = r.home_team === e.toTeamSlug || r.away_team === e.toTeamSlug
      if (hasFrom && hasTo) {
        const override = DETERMINISTIC_TRANSITION_H2H_RESOLUTIONS[transitionH2HKey(r.kind, e.seasonId, e.playerName, r.game_id)]
        if (override) {
          if (override.targetTeamSlug === e.fromTeamSlug && (!maxFrom || r.date > maxFrom)) {
            maxFrom = r.date
          } else if (override.targetTeamSlug === e.toTeamSlug && (!minTo || r.date < minTo)) {
            minTo = r.date
          }
        }
      }
    }
    return { item: e, maxFrom, minTo }
  })

  // Group by seasonId + sorted team pair
  const bySeasonPair = new Map<string, typeof entriesWithDates>()
  for (const x of entriesWithDates) {
    const pairKey = [x.item.fromTeamSlug, x.item.toTeamSlug].sort().join("::")
    const key = `${x.item.seasonId}::${pairKey}`
    if (!bySeasonPair.has(key)) bySeasonPair.set(key, [])
    bySeasonPair.get(key)!.push(x)
  }

  const teamNameBySlug = new Map<string, string>(teamNamesRows.map((t) => [t.slug, t.name]))
  const existingMoveKeys = new Set(
    existingMoveRows.map((r) =>
      tradeMoveKey(r.season_id, { playerId: r.player_id, fromTeamSlug: r.from_team_slug, toTeamSlug: r.to_team_slug })
    )
  )

  const allTradeClusters: PlannedTradeRecord[] = []
  const plannedTrades: PlannedTradeRecord[] = []

  for (const [, group] of bySeasonPair) {
    // Sort by maxFrom (or minTo), then playerName (not playerId) so clustering is identical across Dev & Prod.
    const sorted = [...group].sort((a, b) => {
      const da = a.maxFrom ?? a.minTo ?? "0000-00-00"
      const db = b.maxFrom ?? b.minTo ?? "0000-00-00"
      return (
        da.localeCompare(db) ||
        normalizePlayerNameKey(a.item.playerName).localeCompare(normalizePlayerNameKey(b.item.playerName))
      )
    })

    for (const c of clusterTradeMoves(sorted)) {
      const seasonId = c.items[0].item.seasonId
      let tradeDate: string
      if (c.clusterMaxFrom && c.clusterMinTo) {
        tradeDate = midpointDate(c.clusterMaxFrom, c.clusterMinTo)
      } else if (c.clusterMaxFrom) {
        tradeDate = addDays(c.clusterMaxFrom, 3)
      } else if (c.clusterMinTo) {
        tradeDate = addDays(c.clusterMinTo, -3)
      } else {
        throw new Error(`Cannot derive tradeDate for cluster in ${seasonId}`)
      }
      const tradedAt = `${tradeDate}T12:00:00-08:00`

      const moves = c.items.map((x) => ({
        playerId: x.item.playerId,
        playerName: x.item.playerName,
        fromTeamSlug: x.item.fromTeamSlug,
        toTeamSlug: x.item.toTeamSlug,
      }))
      const toRecord = (ms: typeof moves): PlannedTradeRecord => ({
        seasonId,
        teamSlugs: [...new Set(ms.flatMap((m) => [m.fromTeamSlug, m.toTeamSlug]))].sort(),
        tradeDate,
        tradedAt,
        notes: buildTradeNotes(ms, teamNameBySlug),
        moves: ms,
      })

      allTradeClusters.push(toRecord(moves))

      // Only moves not yet recorded are planned; notes/team_slugs are rebuilt from those moves alone.
      const pendingMoves = moves.filter(
        (m) => !existingMoveKeys.has(tradeMoveKey(seasonId, m))
      )
      if (pendingMoves.length > 0) plannedTrades.push(toRecord(pendingMoves))
    }
  }

  const byDateThenTeams = (a: PlannedTradeRecord, b: PlannedTradeRecord) =>
    a.seasonId.localeCompare(b.seasonId) ||
    a.tradeDate.localeCompare(b.tradeDate) ||
    a.teamSlugs.join(",").localeCompare(b.teamSlugs.join(","))
  allTradeClusters.sort(byDateThenTeams)
  plannedTrades.sort(byDateThenTeams)

  // Post-plan invariant 1: Trade date vs. post-plan stamped game dates
  const plannedSlugByKey = new Map<string, string>()
  for (const c of statChanges) {
    plannedSlugByKey.set(`${c.kind}:${c.playerId}:${c.gameId}`, c.newTeamSlug)
  }
  const tradeDateContradictions: TradeDateContradiction[] = []
  const holdOutDateOverlaps: TradeDateContradiction[] = []
  for (const trade of allTradeClusters) {
    for (const move of trade.moves) {
      const rows = byPlayerSeason.get(`${trade.seasonId}:${move.playerId}`) ?? []
      for (const r of rows) {
        if (isGeoffMooreSubGame(trade.seasonId, move.playerName, r.game_id)) continue
        const effectiveSlug = plannedSlugByKey.get(`${r.kind}:${move.playerId}:${r.game_id}`) ?? r.team_slug
        if (!effectiveSlug) continue
        const violatesFrom = effectiveSlug === move.fromTeamSlug && r.date >= trade.tradeDate
        const violatesTo = effectiveSlug === move.toTeamSlug && r.date < trade.tradeDate
        if (violatesFrom || violatesTo) {
          const isManualHoldOut =
            r.kind === "skater" && MANUAL_REVIEW_HOLD_OUT_KEYS.has(holdOutKey(trade.seasonId, move.playerName, r.game_id))
          const rec: TradeDateContradiction = {
            seasonId: trade.seasonId,
            playerName: move.playerName,
            gameId: r.game_id,
            gameDate: r.date,
            tradeDate: trade.tradeDate,
            stampedTeamSlug: effectiveSlug,
            fromTeamSlug: move.fromTeamSlug,
            toTeamSlug: move.toTeamSlug,
            isManualHoldOut,
          }
          if (isManualHoldOut) holdOutDateOverlaps.push(rec)
          else tradeDateContradictions.push(rec)
        }
      }
    }
  }

  // Post-plan invariant 2: Boxscore goal-sum regression check across all touched games
  const { regressions: boxscoreRegressions, fixedExactCount: boxscoreFixedExactCount } =
    await auditBoxscoreRegressions(sql, statChanges)

  return {
    entries,
    statChanges,
    playerSeasonsToDelete: duplicatePsRows,
    plannedTrades,
    allTradeClusters,
    manualReviewSkippedCount,
    pass1SkippedNonNull,
    pass1SkippedPostTrade,
    tradeDateContradictions,
    holdOutDateOverlaps,
    boxscoreRegressions,
    boxscoreFixedExactCount,
  }
}

/** Per-season row counts + MD5 of (player_id, game_id, team_slug) for skater and goalie stats. */
export async function computeSeasonChecksums(sql: Sql): Promise<SeasonStatChecksum[]> {
  const rows = (await sql`
    WITH sk AS (
      SELECT g.season_id,
             count(*)::int AS skater_total,
             count(*) FILTER (WHERE pgs.team_slug IS NOT NULL)::int AS skater_stamped,
             count(*) FILTER (WHERE pgs.team_slug IS NULL)::int AS skater_null,
             COALESCE(
               md5(string_agg(pgs.player_id::text || ':' || pgs.game_id || ':' || COALESCE(pgs.team_slug, 'NULL'), ',' ORDER BY pgs.player_id, pgs.game_id)),
               'empty'
             ) AS skater_hash
      FROM player_game_stats pgs
      JOIN games g ON g.id = pgs.game_id
      GROUP BY g.season_id
    ), gl AS (
      SELECT g.season_id,
             count(*)::int AS goalie_total,
             count(*) FILTER (WHERE ggs.team_slug IS NOT NULL)::int AS goalie_stamped,
             count(*) FILTER (WHERE ggs.team_slug IS NULL)::int AS goalie_null,
             COALESCE(
               md5(string_agg(ggs.player_id::text || ':' || ggs.game_id || ':' || COALESCE(ggs.team_slug, 'NULL'), ',' ORDER BY ggs.player_id, ggs.game_id)),
               'empty'
             ) AS goalie_hash
      FROM goalie_game_stats ggs
      JOIN games g ON g.id = ggs.game_id
      GROUP BY g.season_id
    )
    SELECT COALESCE(sk.season_id, gl.season_id) AS season_id,
           COALESCE(sk.skater_total, 0) AS skater_total,
           COALESCE(sk.skater_stamped, 0) AS skater_stamped,
           COALESCE(sk.skater_null, 0) AS skater_null,
           COALESCE(sk.skater_hash, 'empty') AS skater_hash,
           COALESCE(gl.goalie_total, 0) AS goalie_total,
           COALESCE(gl.goalie_stamped, 0) AS goalie_stamped,
           COALESCE(gl.goalie_null, 0) AS goalie_null,
           COALESCE(gl.goalie_hash, 'empty') AS goalie_hash
    FROM sk
    FULL OUTER JOIN gl ON sk.season_id = gl.season_id
    ORDER BY season_id
  `) as SeasonStatChecksum[]
  return rows
}

export async function computeDatabaseTotals(sql: Sql): Promise<BackfillSnapshot["totals"]> {
  const totalsRow = (await sql`
    SELECT
      (SELECT count(*)::int FROM player_game_stats) AS skater_total,
      (SELECT count(*)::int FROM player_game_stats WHERE team_slug IS NOT NULL) AS skater_stamped,
      (SELECT count(*)::int FROM player_game_stats WHERE team_slug IS NULL) AS skater_null,
      (SELECT count(*)::int FROM goalie_game_stats) AS goalie_total,
      (SELECT count(*)::int FROM goalie_game_stats WHERE team_slug IS NOT NULL) AS goalie_stamped,
      (SELECT count(*)::int FROM goalie_game_stats WHERE team_slug IS NULL) AS goalie_null,
      (SELECT count(*)::int FROM player_seasons) AS ps_total,
      (SELECT count(*)::int FROM season_trades) AS st_total,
      (SELECT count(*)::int FROM season_trade_items) AS sti_total
  `) as Record<string, number>[]

  const t = totalsRow[0]
  return {
    skaterTotal: t.skater_total,
    skaterStamped: t.skater_stamped,
    skaterNull: t.skater_null,
    goalieTotal: t.goalie_total,
    goalieStamped: t.goalie_stamped,
    goalieNull: t.goalie_null,
    playerSeasonsTotal: t.ps_total,
    seasonTradesTotal: t.st_total,
    seasonTradeItemsTotal: t.sti_total,
  }
}

export async function computeDatabaseTotalsAndChecksums(sql: Sql): Promise<{
  totals: BackfillSnapshot["totals"]
  seasonChecksums: SeasonStatChecksum[]
}> {
  const [totals, seasonChecksums] = await Promise.all([
    computeDatabaseTotals(sql),
    computeSeasonChecksums(sql),
  ])
  return { totals, seasonChecksums }
}

export async function createPreBackfillSnapshot(
  sql: Sql,
  dbUrl: string,
  plan: BackfillPlan,
  opts: { customSnapshotPath?: string; forApply?: boolean; backupsDir?: string } = {}
): Promise<{ snapshot: BackfillSnapshot; filePath: string }> {
  const { host, label } = describeDbEndpoint(dbUrl)
  const [{ totals, seasonChecksums }, existingSeasonTrades, existingSeasonTradeItems] = await Promise.all([
    computeDatabaseTotalsAndChecksums(sql),
    sql`
      SELECT id, season_id, team_slugs, notes, traded_at::text AS traded_at, created_at::text AS created_at
      FROM season_trades
      ORDER BY id
    ` as unknown as Promise<SeasonTradeSnapshot[]>,
    sql`
      SELECT id, trade_id, item_type, from_team_slug, to_team_slug, player_id,
             draft_pick_round, draft_pick_original_team_slug, draft_pick_target_season
      FROM season_trade_items
      ORDER BY id
    ` as unknown as Promise<SeasonTradeItemSnapshot[]>,
  ])

  const skaterRowsToModify = plan.statChanges
    .filter((c) => c.kind === "skater")
    .map((c) => ({
      player_id: c.playerId,
      game_id: c.gameId,
      team_slug: c.previousTeamSlug,
      target_team_slug: c.newTeamSlug,
    }))

  const goalieRowsToModify = plan.statChanges
    .filter((c) => c.kind === "goalie")
    .map((c) => ({
      player_id: c.playerId,
      game_id: c.gameId,
      team_slug: c.previousTeamSlug,
      target_team_slug: c.newTeamSlug,
    }))

  const createdAt = new Date().toISOString()
  const snapshot: BackfillSnapshot = {
    version: 1,
    createdAt,
    dbHost: host,
    dbLabel: label,
    totals,
    seasonChecksums,
    skaterRowsToModify,
    goalieRowsToModify,
    playerSeasonsToDelete: plan.playerSeasonsToDelete,
    existingSeasonTrades,
    existingSeasonTradeItems,
    historicalSeasonIds: [...new Set(plan.entries.map((e) => e.seasonId))].sort(),
    ...(opts.forApply
      ? {
          applyStatus: "pending" as const,
          plannedTradeMoveKeys: plan.plannedTrades.flatMap((t) => t.moves.map((m) => tradeMoveKey(t.seasonId, m))),
        }
      : {}),
  }

  const safeHost = host.replace(/[^a-zA-Z0-9.-]/g, "_")
  const safeTs = createdAt.replace(/[:.]/g, "-")
  const defaultPath = path.join(opts.backupsDir ?? DEFAULT_BACKUPS_DIR, `pre-historical-trades-${safeHost}-${safeTs}.json`)
  const filePath = opts.customSnapshotPath ? path.resolve(opts.customSnapshotPath) : defaultPath
  writeSnapshotAtomic(filePath, snapshot)

  return { snapshot, filePath }
}

export async function applyBackfillPlan(
  sql: Sql,
  plan: BackfillPlan,
  onTradeInserted: (tradeId: number) => void = () => {}
) {
  const skaterUpdates = plan.statChanges
    .filter((c) => c.kind === "skater")
    .map((c) => ({ playerId: c.playerId, gameId: c.gameId, teamSlug: c.newTeamSlug }))

  const goalieUpdates = plan.statChanges
    .filter((c) => c.kind === "goalie")
    .map((c) => ({ playerId: c.playerId, gameId: c.gameId, teamSlug: c.newTeamSlug }))

  let updatedSkaters = 0
  if (skaterUpdates.length > 0) {
    const res = (await sql`
      WITH u AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(skaterUpdates)}::jsonb)
          AS u("playerId" int, "gameId" text, "teamSlug" text)
      )
      UPDATE player_game_stats pgs
      SET team_slug = u."teamSlug"
      FROM u
      WHERE pgs.player_id = u."playerId"
        AND pgs.game_id = u."gameId"
        AND pgs.team_slug IS DISTINCT FROM u."teamSlug"
      RETURNING pgs.player_id
    `) as unknown[]
    updatedSkaters = res.length
  }

  let updatedGoalies = 0
  if (goalieUpdates.length > 0) {
    const res = (await sql`
      WITH u AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(goalieUpdates)}::jsonb)
          AS u("playerId" int, "gameId" text, "teamSlug" text)
      )
      UPDATE goalie_game_stats ggs
      SET team_slug = u."teamSlug"
      FROM u
      WHERE ggs.player_id = u."playerId"
        AND ggs.game_id = u."gameId"
        AND ggs.team_slug IS DISTINCT FROM u."teamSlug"
      RETURNING ggs.player_id
    `) as unknown[]
    updatedGoalies = res.length
  }

  let deletedPlayerSeasons = 0
  if (plan.playerSeasonsToDelete.length > 0) {
    const res = (await sql`
      WITH d AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(plan.playerSeasonsToDelete)}::jsonb)
          AS d("player_id" int, "season_id" text, "team_slug" text)
      )
      DELETE FROM player_seasons ps
      USING d
      WHERE ps.player_id = d.player_id
        AND ps.season_id = d.season_id
        AND ps.team_slug = d.team_slug
        AND EXISTS (
          SELECT 1 FROM player_seasons ps_other
          WHERE ps_other.player_id = ps.player_id
            AND ps_other.season_id = ps.season_id
            AND ps_other.team_slug <> ps.team_slug
        )
      RETURNING ps.player_id
    `) as unknown[]
    deletedPlayerSeasons = res.length
  }

  // Pass 3: Insert historical season_trades + season_trade_items.
  // Each insert is a single atomic CTE with a SQL-level `WHERE NOT EXISTS` idempotency guard
  // so an HTTP timeout after server commit or a concurrent checkout can never insert duplicate rows.
  let insertedTrades = 0
  let insertedTradeItems = 0
  const insertedTradeIds: number[] = []

  for (const trade of plan.plannedTrades) {
    const movesJson = JSON.stringify(trade.moves)

    const inserted = (await sql`
      WITH m AS (
        SELECT * FROM jsonb_to_recordset(${movesJson}::jsonb)
          AS m("playerId" int, "playerName" text, "fromTeamSlug" text, "toTeamSlug" text)
      ), pending_m AS (
        SELECT m.*
        FROM m
        WHERE NOT EXISTS (
          SELECT 1
          FROM season_trade_items sti
          JOIN season_trades st ON st.id = sti.trade_id
          WHERE st.season_id = ${trade.seasonId}
            AND sti.item_type = 'player'
            AND sti.player_id = m."playerId"
            AND sti.from_team_slug = m."fromTeamSlug"
            AND sti.to_team_slug = m."toTeamSlug"
        )
      ), inserted_trade AS (
        INSERT INTO season_trades (season_id, team_slugs, notes, traded_at, created_at)
        SELECT ${trade.seasonId}, ${trade.teamSlugs}::text[], ${trade.notes}, ${trade.tradedAt}::timestamptz, NOW()
        WHERE EXISTS (SELECT 1 FROM pending_m)
        RETURNING id
      ), inserted_items AS (
        INSERT INTO season_trade_items (trade_id, item_type, from_team_slug, to_team_slug, player_id)
        SELECT t.id, 'player', m."fromTeamSlug", m."toTeamSlug", m."playerId"
        FROM inserted_trade t CROSS JOIN pending_m m
        RETURNING id
      )
      SELECT t.id AS trade_id, (SELECT count(*)::int FROM inserted_items) AS item_count
      FROM inserted_trade t
    `) as { trade_id: number; item_count: number }[]

    if (inserted[0]) {
      insertedTrades++
      insertedTradeItems += inserted[0].item_count
      insertedTradeIds.push(inserted[0].trade_id)
      onTradeInserted(inserted[0].trade_id)
    }
  }

  return {
    updatedSkaters,
    updatedGoalies,
    deletedPlayerSeasons,
    insertedTrades,
    insertedTradeItems,
    insertedTradeIds,
  }
}

/** True when the plan has nothing to write (so `--apply` must not emit a misleading "pre-apply" snapshot). */
export function isPlanEmpty(plan: BackfillPlan): boolean {
  return plan.statChanges.length === 0 && plan.playerSeasonsToDelete.length === 0 && plan.plannedTrades.length === 0
}

export function readSnapshot(snapshotFilePath: string): BackfillSnapshot {
  if (!fs.existsSync(snapshotFilePath)) {
    throw new Error(`Snapshot file not found: ${snapshotFilePath}`)
  }
  const snapshot = JSON.parse(fs.readFileSync(snapshotFilePath, "utf8")) as BackfillSnapshot
  if (snapshot?.version !== 1) {
    throw new Error(`Unsupported snapshot version: ${snapshot?.version}`)
  }
  if (!isWellFormedSnapshotHeader(snapshot)) {
    throw new Error(`Malformed snapshot header in ${snapshotFilePath} (requires valid dbHost, createdAt, and applyStatus)`)
  }
  return snapshot
}

/** Atomic write (tmp file + rename) so a crash mid-write can never corrupt the only rollback file. */
export function writeSnapshotAtomic(snapshotFilePath: string, snapshot: BackfillSnapshot): void {
  fs.mkdirSync(path.dirname(snapshotFilePath), { recursive: true })
  const tmp = `${snapshotFilePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + "\n")
  fs.renameSync(tmp, snapshotFilePath)
}

export function updateSnapshot(snapshotFilePath: string, mutate: (s: BackfillSnapshot) => void): void {
  const snapshot = readSnapshot(snapshotFilePath)
  mutate(snapshot)
  writeSnapshotAtomic(snapshotFilePath, snapshot)
}

export interface SnapshotScan {
  /** Parsed `pre-historical-trades-*.json` snapshots for the requested host. */
  entries: { file: string; snapshot: BackfillSnapshot }[]
  /** Files that could not be read/parsed (host unknown) — safety guards must refuse rather than skip these. */
  unreadable: string[]
}

/** Scans `backupsDir` for this script's snapshots. Never silently skips a file it cannot read. */
export function scanApplySnapshots(host: string, backupsDir = DEFAULT_BACKUPS_DIR): SnapshotScan {
  const scan: SnapshotScan = { entries: [], unreadable: [] }
  if (!fs.existsSync(backupsDir)) return scan
  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith("pre-historical-trades-") && f.endsWith(".json"))
    .map((f) => path.join(backupsDir, f))
    .sort()
  for (const file of files) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(file, "utf8")) as BackfillSnapshot
      if (!isWellFormedSnapshotHeader(snapshot)) throw new Error("malformed snapshot header")
      if (snapshot.dbHost === host) scan.entries.push({ file, snapshot })
    } catch {
      scan.unreadable.push(file)
    }
  }
  return scan
}

const KNOWN_APPLY_STATUSES = new Set<unknown>([undefined, "pending", "complete", "rolled-back"])

/** Guards rely on these fields; anything else must be treated as unreadable, never as "inactive". */
function isWellFormedSnapshotHeader(s: Partial<BackfillSnapshot> | null): boolean {
  return (
    !!s &&
    s.version === 1 &&
    typeof s.dbHost === "string" &&
    typeof s.createdAt === "string" &&
    !Number.isNaN(Date.parse(s.createdAt)) &&
    KNOWN_APPLY_STATUSES.has(s.applyStatus)
  )
}

function unreadableSnapshotsError(unreadable: string[]): Error {
  return new Error(
    `Unreadable snapshot file(s) in .backups/ — cannot prove no unfinished apply exists. Inspect, then move aside:\n` +
      unreadable.map((f) => `    ${f}`).join("\n")
  )
}

/**
 * Refuses to roll back `snapshot` while a newer, still-active (`pending`/`complete`) apply snapshot exists for
 * the same host: the older rollback would delete the newer apply's trades without restoring its stat rows.
 */
export function assertNoNewerActiveApply(snapshotFilePath: string, snapshot: BackfillSnapshot, backupsDir = DEFAULT_BACKUPS_DIR): void {
  const scan = scanApplySnapshots(snapshot.dbHost, backupsDir)
  if (scan.unreadable.length > 0) throw unreadableSnapshotsError(scan.unreadable)
  const targetMs = Date.parse(snapshot.createdAt)
  const newer = scan.entries
    .filter(
      (e) =>
        path.resolve(e.file) !== path.resolve(snapshotFilePath) &&
        Date.parse(e.snapshot.createdAt) > targetMs &&
        (e.snapshot.applyStatus === "pending" || e.snapshot.applyStatus === "complete")
    )
    .sort((a, b) => Date.parse(b.snapshot.createdAt) - Date.parse(a.snapshot.createdAt))
  if (newer.length > 0) {
    throw new Error(
      `A newer apply on ${snapshot.dbHost} has not been rolled back. Roll back newest-first, then retry:\n` +
        newer
          .map((e) => `    npx tsx scripts/backfill-historical-trades.ts --rollback "${e.file}" --confirm-host ${snapshot.dbHost}`)
          .join("\n")
    )
  }
}

export async function rollbackFromSnapshot(
  sql: Sql,
  snapshotFilePath: string,
  expectedHost: string,
  opts: { backupsDir?: string } = {}
) {
  const resolvedPath = path.resolve(snapshotFilePath)
  const snapshot = readSnapshot(resolvedPath)
  if (snapshot.dbHost !== expectedHost) {
    throw new Error(`Snapshot was taken on "${snapshot.dbHost}" but target is "${expectedHost}". Refusing to roll back.`)
  }
  assertNoNewerActiveApply(resolvedPath, snapshot, opts.backupsDir)

  // 1. Restore deleted player_seasons rows (single statement)
  let restoredPlayerSeasons = 0
  if (snapshot.playerSeasonsToDelete.length > 0) {
    const res = (await sql`
      INSERT INTO player_seasons (player_id, season_id, team_slug, is_goalie, is_captain, is_rookie, registration_meta)
      SELECT player_id, season_id, team_slug, is_goalie, is_captain, is_rookie, registration_meta
      FROM jsonb_to_recordset(${JSON.stringify(snapshot.playerSeasonsToDelete)}::jsonb)
        AS r(player_id int, season_id text, team_slug text, is_goalie boolean, is_captain boolean, is_rookie boolean, registration_meta jsonb)
      ON CONFLICT (player_id, season_id, team_slug) DO NOTHING
      RETURNING player_id
    `) as unknown[]
    restoredPlayerSeasons = res.length
  }


  // 2. Restore modified player_game_stats.team_slug
  let restoredSkaters = 0
  if (snapshot.skaterRowsToModify.length > 0) {
    const res = (await sql`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(snapshot.skaterRowsToModify)}::jsonb)
          AS r("player_id" int, "game_id" text, "team_slug" text)
      )
      UPDATE player_game_stats pgs
      SET team_slug = r.team_slug
      FROM r
      WHERE pgs.player_id = r.player_id
        AND pgs.game_id = r.game_id
        AND pgs.team_slug IS DISTINCT FROM r.team_slug
      RETURNING pgs.player_id
    `) as unknown[]
    restoredSkaters = res.length
  }

  // 3. Restore modified goalie_game_stats.team_slug
  let restoredGoalies = 0
  if (snapshot.goalieRowsToModify.length > 0) {
    const res = (await sql`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(snapshot.goalieRowsToModify)}::jsonb)
          AS r("player_id" int, "game_id" text, "team_slug" text)
      )
      UPDATE goalie_game_stats ggs
      SET team_slug = r.team_slug
      FROM r
      WHERE ggs.player_id = r.player_id
        AND ggs.game_id = r.game_id
        AND ggs.team_slug IS DISTINCT FROM r.team_slug
      RETURNING ggs.player_id
    `) as unknown[]
    restoredGoalies = res.length
  }

  // 4. Delete the historical season_trades this backfill created (items cascade). Delete and verify share
  //    the exact same predicate (not in snapshot + "Historical trade: " prefix + historical season), so a
  //    rollback can never delete by one rule and then fail verification by another. Never touches trades
  //    that existed pre-apply, live admin trades (which never carry the prefix), or non-historical seasons.
  const keepTradeIds = snapshot.existingSeasonTrades.map((t) => t.id)
  const historicalSeasonIds =
    snapshot.historicalSeasonIds ?? [...new Set(loadHistoricalTradedPlayers().map((e) => e.seasonId))].sort()
  const notesPattern = `${HISTORICAL_TRADE_NOTES_PREFIX}%`
  const deletedTrades = (await sql`
    DELETE FROM season_trades
    WHERE NOT (id = ANY(${keepTradeIds}::int[]))
      AND notes LIKE ${notesPattern}
      AND season_id = ANY(${historicalSeasonIds}::text[])
    RETURNING id
  `) as { id: number }[]

  // 5. Verify, scoped to what this script touched + historical seasons (live seasons change via daily sync).
  const mismatches = await verifyRollback(sql, snapshot, historicalSeasonIds, keepTradeIds)
  if (mismatches.length > 0) {
    throw new Error(`Rollback verification failed:\n  - ${mismatches.join("\n  - ")}`)
  }

  // The DB is restored and verified at this point — a snapshot-file error must not turn success into failure.
  // Also mark copies of this snapshot in backupsDir (same host + createdAt), e.g. when rolling back from an
  // archived copy, so the original cannot keep blocking older rollbacks / new applies.
  let statusWriteError: string | null = null
  const sameSnapshotFiles = new Set<string>([resolvedPath])
  try {
    const targetMs = Date.parse(snapshot.createdAt)
    for (const e of scanApplySnapshots(snapshot.dbHost, opts.backupsDir).entries) {
      if (Date.parse(e.snapshot.createdAt) === targetMs) sameSnapshotFiles.add(path.resolve(e.file))
    }
  } catch (err) {
    statusWriteError = `could not scan for snapshot copies: ${err instanceof Error ? err.message : String(err)}`
  }
  for (const f of sameSnapshotFiles) {
    try {
      updateSnapshot(f, (s) => {
        s.applyStatus = "rolled-back"
      })
    } catch (err) {
      statusWriteError = `${f}: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  return {
    restoredPlayerSeasons,
    restoredSkaters,
    restoredGoalies,
    deletedTradesCount: deletedTrades.length,
    verifiedSeasonsCount: historicalSeasonIds.length,
    statusWriteError,
  }
}

export async function verifyRollback(
  sql: Sql,
  snapshot: BackfillSnapshot,
  historicalSeasonIds: string[],
  keepTradeIds: number[]
): Promise<string[]> {
  const toKeyed = (rows: { player_id: number; game_id: string; team_slug: string | null }[]) =>
    JSON.stringify(rows.map((r) => ({ player_id: r.player_id, game_id: r.game_id, team_slug: r.team_slug })))
  const notesPattern = `${HISTORICAL_TRADE_NOTES_PREFIX}%`

  const [skaterDrift, goalieDrift, psPresent, strayTrades, insertedLeft, postSeasonChecksums] = await Promise.all([
    sql`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${toKeyed(snapshot.skaterRowsToModify)}::jsonb)
          AS r("player_id" int, "game_id" text, "team_slug" text)
      )
      SELECT r.player_id, r.game_id, r.team_slug AS expected, pgs.team_slug AS actual, (pgs.player_id IS NULL) AS missing
      FROM r LEFT JOIN player_game_stats pgs ON pgs.player_id = r.player_id AND pgs.game_id = r.game_id
      WHERE pgs.player_id IS NULL OR pgs.team_slug IS DISTINCT FROM r.team_slug
    ` as unknown as Promise<{ player_id: number; game_id: string; expected: string | null; actual: string | null; missing?: boolean }[]>,
    sql`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${toKeyed(snapshot.goalieRowsToModify)}::jsonb)
          AS r("player_id" int, "game_id" text, "team_slug" text)
      )
      SELECT r.player_id, r.game_id, r.team_slug AS expected, ggs.team_slug AS actual, (ggs.player_id IS NULL) AS missing
      FROM r LEFT JOIN goalie_game_stats ggs ON ggs.player_id = r.player_id AND ggs.game_id = r.game_id
      WHERE ggs.player_id IS NULL OR ggs.team_slug IS DISTINCT FROM r.team_slug
    ` as unknown as Promise<{ player_id: number; game_id: string; expected: string | null; actual: string | null; missing?: boolean }[]>,
    sql`
      WITH d AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(snapshot.playerSeasonsToDelete)}::jsonb)
          AS d("player_id" int, "season_id" text, "team_slug" text)
      )
      SELECT count(*)::int AS n
      FROM d JOIN player_seasons ps
        ON ps.player_id = d.player_id AND ps.season_id = d.season_id AND ps.team_slug = d.team_slug
    ` as unknown as Promise<{ n: number }[]>,
    sql`
      SELECT id FROM season_trades
      WHERE NOT (id = ANY(${keepTradeIds}::int[]))
        AND notes LIKE ${notesPattern}
        AND season_id = ANY(${historicalSeasonIds}::text[])
    ` as unknown as Promise<{ id: number }[]>,
    // Independent of the delete predicate: every trade this apply recorded inserting must be gone.
    sql`
      SELECT id FROM season_trades WHERE id = ANY(${snapshot.insertedTradeIds ?? []}::int[])
    ` as unknown as Promise<{ id: number }[]>,
    computeSeasonChecksums(sql),
  ])

  const mismatches: string[] = []
  for (const d of skaterDrift) {
    mismatches.push(
      d.missing
        ? `player_game_stats ${d.player_id}:${d.game_id} missing row (expected ${d.expected})`
        : `player_game_stats ${d.player_id}:${d.game_id} expected ${d.expected}, got ${d.actual}`
    )
  }
  for (const d of goalieDrift) {
    mismatches.push(
      d.missing
        ? `goalie_game_stats ${d.player_id}:${d.game_id} missing row (expected ${d.expected})`
        : `goalie_game_stats ${d.player_id}:${d.game_id} expected ${d.expected}, got ${d.actual}`
    )
  }
  const psCount = psPresent[0]?.n ?? 0
  if (psCount !== snapshot.playerSeasonsToDelete.length) {
    mismatches.push(`player_seasons: expected ${snapshot.playerSeasonsToDelete.length} restored rows, found ${psCount}`)
  }
  if (strayTrades.length > 0) {
    mismatches.push(`Historical season_trades still present: ${strayTrades.map((t) => t.id).join(", ")}`)
  }
  if (insertedLeft.length > 0) {
    mismatches.push(`Trades inserted by this apply still present: ${insertedLeft.map((t) => t.id).join(", ")}`)
  }

  // Per-season checksum over historical seasons only, checked in both directions (missing + unexpected).
  const scope = new Set(historicalSeasonIds)
  const expBySeason = new Map(snapshot.seasonChecksums.filter((s) => scope.has(s.season_id)).map((s) => [s.season_id, s]))
  const curBySeason = new Map(postSeasonChecksums.filter((s) => scope.has(s.season_id)).map((s) => [s.season_id, s]))
  for (const seasonId of new Set([...expBySeason.keys(), ...curBySeason.keys()])) {
    const exp = expBySeason.get(seasonId)
    const cur = curBySeason.get(seasonId)
    if (!exp || !cur) {
      mismatches.push(`Season ${seasonId} ${exp ? "missing after" : "unexpected after"} rollback`)
      continue
    }
    const fields: (keyof SeasonStatChecksum)[] = [
      "skater_total", "skater_null", "skater_hash", "goalie_total", "goalie_null", "goalie_hash",
    ]
    const diffs = fields.filter((f) => exp[f] !== cur[f])
    if (diffs.length > 0) {
      mismatches.push(
        `Season ${seasonId} checksum mismatch on ${diffs.map((f) => `${f} (expected ${exp[f]}, got ${cur[f]})`).join(", ")}`
      )
    }
  }
  return mismatches
}

export function tradeMoveKey(
  seasonId: string,
  m: { playerId: number; fromTeamSlug: string; toTeamSlug: string }
): string {
  return `${seasonId}:${m.playerId}:${m.fromTeamSlug}:${m.toTeamSlug}`
}

/**
 * Proves a `pending` apply snapshot actually landed in full: every planned stat row carries its target slug,
 * every planned player_seasons delete is gone, and every planned trade move is recorded. Returns false when
 * the snapshot predates `plannedTradeMoveKeys` (cannot be proven).
 */
export async function isSnapshotFullyApplied(sql: Sql, snapshot: BackfillSnapshot): Promise<boolean> {
  if (!snapshot.plannedTradeMoveKeys) return false
  const [skaterOff, goalieOff, psLeft, moves] = await Promise.all([
    sql`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(snapshot.skaterRowsToModify)}::jsonb)
          AS r("player_id" int, "game_id" text, "target_team_slug" text)
      )
      SELECT count(*)::int AS n FROM r
      LEFT JOIN player_game_stats pgs ON pgs.player_id = r.player_id AND pgs.game_id = r.game_id
      WHERE pgs.player_id IS NULL OR pgs.team_slug IS DISTINCT FROM r.target_team_slug
    ` as unknown as Promise<{ n: number }[]>,
    sql`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(snapshot.goalieRowsToModify)}::jsonb)
          AS r("player_id" int, "game_id" text, "target_team_slug" text)
      )
      SELECT count(*)::int AS n FROM r
      LEFT JOIN goalie_game_stats ggs ON ggs.player_id = r.player_id AND ggs.game_id = r.game_id
      WHERE ggs.player_id IS NULL OR ggs.team_slug IS DISTINCT FROM r.target_team_slug
    ` as unknown as Promise<{ n: number }[]>,
    sql`
      WITH d AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(snapshot.playerSeasonsToDelete)}::jsonb)
          AS d("player_id" int, "season_id" text, "team_slug" text)
      )
      SELECT count(*)::int AS n FROM d
      JOIN player_seasons ps ON ps.player_id = d.player_id AND ps.season_id = d.season_id AND ps.team_slug = d.team_slug
    ` as unknown as Promise<{ n: number }[]>,
    sql`
      SELECT st.season_id, sti.player_id, sti.from_team_slug, sti.to_team_slug
      FROM season_trade_items sti
      JOIN season_trades st ON st.id = sti.trade_id
      WHERE sti.item_type = 'player'
    ` as unknown as Promise<{ season_id: string; player_id: number; from_team_slug: string; to_team_slug: string }[]>,
  ])
  const recorded = new Set(
    moves.map((r) => tradeMoveKey(r.season_id, { playerId: r.player_id, fromTeamSlug: r.from_team_slug, toTeamSlug: r.to_team_slug }))
  )
  return (
    (skaterOff[0]?.n ?? 0) === 0 &&
    (goalieOff[0]?.n ?? 0) === 0 &&
    (psLeft[0]?.n ?? 0) === 0 &&
    snapshot.plannedTradeMoveKeys.every((k) => recorded.has(k))
  )
}

export type ApplyOutcome =
  | { status: "nothing-to-apply"; completedPending: string[] }
  | {
      status: "applied"
      completedPending: string[]
      filePath: string
      rollbackCmd: string
      result: Awaited<ReturnType<typeof applyBackfillPlan>>
      finalizeError: string | null
    }

/**
 * `--apply` orchestration: resolve any `pending` snapshots for this host (auto-complete the ones that provably
 * landed, refuse on the rest), skip entirely when nothing is pending, otherwise snapshot → apply → finalize.
 *
 * NOTE: the pending-snapshot guard only sees this checkout's `.backups/` directory; it cannot detect an
 * unfinished apply started from another clone/machine against the same host.
 */
export async function runApply(
  sql: Sql,
  dbUrl: string,
  plan: BackfillPlan,
  opts: { backupsDir?: string; log?: (msg: string) => void } = {}
): Promise<ApplyOutcome> {
  const log = opts.log ?? (() => {})
  const { host } = describeDbEndpoint(dbUrl)
  const rollbackCmdFor = (f: string) =>
    `npx tsx scripts/backfill-historical-trades.ts --rollback "${f}" --confirm-host ${host}`

  const scan = scanApplySnapshots(host, opts.backupsDir)
  if (scan.unreadable.length > 0) throw unreadableSnapshotsError(scan.unreadable)
  const completedPending: string[] = []
  const stillPending: string[] = []
  for (const { file: f, snapshot } of scan.entries.filter((e) => e.snapshot.applyStatus === "pending")) {
    if (await isSnapshotFullyApplied(sql, snapshot)) {
      updateSnapshot(f, (s) => {
        s.applyStatus = "complete"
      })
      completedPending.push(f)
    } else {
      stillPending.push(f)
    }
  }
  if (stillPending.length > 0) {
    throw new Error(
      `A previous --apply on ${host} did not complete. Its snapshot holds the true pre-apply state; a new\n` +
        `snapshot taken now could not undo it. Roll it back first, then re-run --apply:\n` +
        stillPending.map((f) => `    ${rollbackCmdFor(f)}`).join("\n") +
        `\n(This guard only checks this checkout's .backups/ directory.)`
    )
  }

  if (plan.boxscoreRegressions.length > 0) {
    throw new Error(
      `Refusing to apply: ${plan.boxscoreRegressions.length} game(s) would regress box-score goal parity:\n  - ` +
        plan.boxscoreRegressions
          .map(
            (r) =>
              `${r.seasonId} game ${r.gameId} (${r.date}, ${r.homeTeam} ${r.homeScore}-${r.awayScore} ${r.awayTeam}): ` +
                `totalError ${r.preError}->${r.postError}, teamError ${r.preTeamError}->${r.postTeamError}, excess ${r.preExcess}->${r.postExcess}`
          )
          .join("\n  - ")
    )
  }

  if (plan.tradeDateContradictions.length > 0) {
    throw new Error(
      `Refusing to apply: ${plan.tradeDateContradictions.length} non-hold-out trade-date contradiction(s) detected:\n  - ` +
        plan.tradeDateContradictions
          .map(
            (c) =>
              `${c.seasonId} ${c.playerName} game ${c.gameId} (${c.gameDate}, stamped ${c.stampedTeamSlug}) conflicts with tradeDate ${c.tradeDate} (${c.fromTeamSlug} -> ${c.toTeamSlug})`
          )
          .join("\n  - ")
    )
  }

  if (isPlanEmpty(plan)) return { status: "nothing-to-apply", completedPending }

  log("\n[1/2] Saving automatic pre-apply snapshot...")
  const { filePath } = await createPreBackfillSnapshot(sql, dbUrl, plan, { forApply: true, backupsDir: opts.backupsDir })
  const rollbackCmd = rollbackCmdFor(filePath)
  log(`  ✓ Snapshot saved to: ${filePath}`)
  log(`    (To rollback at any time: ${rollbackCmd})`)

  log("\n[2/2] Applying historical trade backfill...")
  const insertedSoFar: number[] = []
  let result: Awaited<ReturnType<typeof applyBackfillPlan>>
  try {
    result = await applyBackfillPlan(sql, plan, (id) => insertedSoFar.push(id))
  } catch (err) {
    if (insertedSoFar.length > 0) {
      try {
        updateSnapshot(filePath, (s) => {
          s.insertedTradeIds = [...insertedSoFar]
        })
      } catch {
        // Best-effort: rollback still cleans up via notes-prefix predicate if disk write fails.
      }
    }
    throw new Error(
      `Apply failed partway (${insertedSoFar.length} trade(s) inserted: ${insertedSoFar.join(", ") || "none"}): ` +
        `${err instanceof Error ? err.message : err}\n` +
        `   This snapshot is the full pre-apply state — roll back with it before re-running --apply:\n    ${rollbackCmd}`,
      { cause: err }
    )
  }

  let finalizeError: string | null = null
  try {
    updateSnapshot(filePath, (s) => {
      s.insertedTradeIds = result.insertedTradeIds
      s.applyStatus = "complete"
    })
  } catch (err) {
    finalizeError = err instanceof Error ? err.message : String(err)
  }

  return { status: "applied", completedPending, filePath, rollbackCmd, result, finalizeError }
}


/**
 * Runs `fn` while holding an exclusive per-host lock file in `backupsDir` (created with `wx`), so two
 * `--apply` / `--rollback` processes in the same checkout cannot interleave their check-then-act guards.
 */
export async function withBackfillLock<T>(host: string, backupsDir: string, fn: () => Promise<T>): Promise<T> {
  fs.mkdirSync(backupsDir, { recursive: true })
  const lockPath = path.join(backupsDir, `.lock-${host.replace(/[^a-zA-Z0-9.-]/g, "_")}`)
  let fd: number
  try {
    fd = fs.openSync(lockPath, "wx")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      let holder = ""
      try {
        holder = fs.readFileSync(lockPath, "utf8").trim()
      } catch {
        // Previous holder may have unlinked the lock file between openSync(wx) and readFileSync.
      }
      throw new Error(
        `Another backfill process holds the lock for ${host} (${holder || "unknown holder"}).\n` +
          `If no such process is running (e.g. it was killed), delete the lock file and retry:\n    rm "${lockPath}"`,
        { cause: err }
      )
    }
    throw err
  }
  try {
    try {
      fs.writeSync(fd, `pid ${process.pid} since ${new Date().toISOString()}`)
    } finally {
      fs.closeSync(fd)
    }
    return await fn()
  } finally {
    fs.rmSync(lockPath, { force: true })
  }
}

function logBackfillPlanSummary(plan: BackfillPlan): void {
  const pass1Skaters = plan.statChanges.filter((c) => c.kind === "skater" && c.pass === "pass1_orphan_3rd_team")
  const pass1Goalies = plan.statChanges.filter((c) => c.kind === "goalie" && c.pass === "pass1_orphan_3rd_team")
  const pass2Skaters = plan.statChanges.filter((c) => c.kind === "skater" && c.pass === "pass2_h2h")
  const pass2Goalies = plan.statChanges.filter((c) => c.kind === "goalie" && c.pass === "pass2_h2h")
  const seasonCount = new Set(plan.entries.map((e) => e.seasonId)).size
  const pendingMoveCount = plan.plannedTrades.reduce((n, t) => n + t.moves.length, 0)

  console.log(`\nLoaded ${plan.entries.length} verified historical trade entries across ${seasonCount} seasons.`)
  console.log(`  • Pass 1 (3rd-team orphan NULL rows): ${pass1Skaters.length} skater rows, ${pass1Goalies.length} goalie rows`)
  console.log(`  • Pass 2 (H2H attribution updates):   ${pass2Skaters.length} skater rows, ${pass2Goalies.length} goalie rows`)
  console.log(`  • Manual-review H2H rows untouched:   ${plan.manualReviewSkippedCount} skater rows`)
  console.log(`  • 2001-2002 duplicate player_seasons: ${plan.playerSeasonsToDelete.length} pre-trade rows to remove`)
  console.log(
    `  • Pass 3 (season_trades log):         ${plan.plannedTrades.length} pending of ${plan.allTradeClusters.length} trade groups ` +
      `(${pendingMoveCount} pending of ${plan.entries.length} player moves)`
  )
  console.log(
    `  • Invariant checks:                   ${plan.boxscoreRegressions.length} boxscore regression(s) ` +
      `(${plan.boxscoreFixedExactCount} game(s) fixed to exact score parity), ` +
      `${plan.tradeDateContradictions.length} trade-date contradiction(s), ` +
      `${plan.holdOutDateOverlaps.length} manual hold-out date overlap(s)`
  )
  if (plan.boxscoreRegressions.length > 0) {
    console.log(`\n  ❌ Boxscore goal-sum regression(s) detected:`)
    for (const r of plan.boxscoreRegressions) {
      console.log(
        `    - ${r.seasonId} game ${r.gameId} (${r.date}, ${r.homeTeam} ${r.homeScore}-${r.awayScore} ${r.awayTeam}): ` +
          `totalError ${r.preError}->${r.postError}, teamError ${r.preTeamError}->${r.postTeamError}, excess ${r.preExcess}->${r.postExcess}`
      )
    }
  }
  if (plan.tradeDateContradictions.length > 0) {
    console.log(`\n  ❌ Non-hold-out trade-date contradiction(s) detected:`)
    for (const c of plan.tradeDateContradictions) {
      console.log(
        `    - ${c.seasonId} ${c.playerName} game ${c.gameId} (${c.gameDate}, stamped ${c.stampedTeamSlug}) vs tradeDate ${c.tradeDate} (${c.fromTeamSlug} -> ${c.toTeamSlug})`
      )
    }
  }
  const skipped = [...plan.pass1SkippedNonNull, ...plan.pass1SkippedPostTrade]
  if (skipped.length > 0) {
    console.log(`\n  ⚠ ${skipped.length} fromTeam-only row(s) left untouched for manual review:`)
    for (const c of plan.pass1SkippedNonNull) {
      console.log(`    - [non-NULL ${c.previousTeamSlug}] ${c.seasonId} ${c.playerName} (#${c.playerId}) game ${c.gameId} on ${c.date}`)
    }
    for (const c of plan.pass1SkippedPostTrade) {
      console.log(`    - [post-trade date] ${c.seasonId} ${c.playerName} (#${c.playerId}) game ${c.gameId} on ${c.date}`)
    }
  }
}

async function main() {
  const args = parseArgs()
  if (!args.url) {
    throw new Error("Missing database URL. Set DATABASE_URL or pass --url '<db-url>'.")
  }

  const { host, label } = describeDbEndpoint(args.url)
  const sql = neon(args.url)

  console.log("====================================================")
  console.log(`  Historical Traded Players Backfill (${args.mode.toUpperCase()})`)
  console.log(`  Target: ${label}`)
  console.log(`  Host:   ${host}`)
  console.log("====================================================")

  if (args.mode === "apply" || args.mode === "rollback") {
    assertConfirmedHost(args.url, args.confirmHost)
  }

  if (args.mode === "rollback") {
    console.log(`\nRestoring database state from snapshot: ${args.snapshotPath}`)
    const res = await withBackfillLock(host, DEFAULT_BACKUPS_DIR, () => rollbackFromSnapshot(sql, args.snapshotPath!, host))
    console.log(`  ✓ Restored ${res.restoredSkaters} skater stat row(s)`)
    console.log(`  ✓ Restored ${res.restoredGoalies} goalie stat row(s)`)
    console.log(`  ✓ Restored ${res.restoredPlayerSeasons} player_seasons row(s)`)
    console.log(`  ✓ Removed ${res.deletedTradesCount} backfilled season_trades row(s) (and cascading items)`)
    console.log(`  ✓ Verified touched rows + checksums across ${res.verifiedSeasonsCount} historical seasons`)
    if (res.statusWriteError) {
      console.warn(
        `  ⚠ DB rollback verified, but the snapshot status could not be updated (${res.statusWriteError}).\n` +
          `    Re-run this exact --rollback command once the file is writable (it is idempotent); until then\n` +
          `    older rollbacks and new applies for this host will refuse.`
      )
    }
    console.log("\n====================================================")
    console.log("  ✓ ROLLBACK COMPLETE & VERIFIED")
    console.log("====================================================")
    return
  }

  if (args.mode === "snapshot" || args.mode === "dry-run") {
    const plan = await buildBackfillPlan(sql)
    logBackfillPlanSummary(plan)

    if (args.mode === "snapshot") {
      const { filePath, snapshot } = await createPreBackfillSnapshot(sql, args.url, plan, { customSnapshotPath: args.snapshotPath })
      console.log(`\n✓ Saved pre-backfill snapshot to: ${filePath}`)
      console.log(
        `  Captured ${snapshot.skaterRowsToModify.length} skater rows, ${snapshot.goalieRowsToModify.length} goalie rows, ` +
          `${snapshot.playerSeasonsToDelete.length} player_seasons rows, and ${snapshot.seasonChecksums.length} season checksums.`
      )
      return
    }

    if (plan.boxscoreRegressions.length > 0 || plan.tradeDateContradictions.length > 0) {
      throw new Error(
        `Dry run failed invariant gate: ${plan.boxscoreRegressions.length} boxscore regression(s) and ` +
          `${plan.tradeDateContradictions.length} trade-date contradiction(s). Fix before applying.`
      )
    }
    console.log("\n====================================================")
    console.log("  ✓ DRY RUN COMPLETE — 0 mutations executed, all invariants passed.")
    console.log(`    Run with --apply --confirm-host ${host} to save a snapshot and execute.`)
    console.log("====================================================")
    return
  }

  // mode === "apply"
  // Build, log, and execute the plan once under the host lock so concurrent runs never interleave or drift.
  const outcome = await withBackfillLock(host, DEFAULT_BACKUPS_DIR, async () => {
    const plan = await buildBackfillPlan(sql)
    logBackfillPlanSummary(plan)
    return runApply(sql, args.url, plan, { log: (m) => console.log(m) })
  })
  for (const f of outcome.completedPending) {
    console.log(`\n✓ Marked previously-unfinalized snapshot complete (its apply had fully landed): ${f}`)
  }
  if (outcome.status === "nothing-to-apply") {
    console.log("\n✓ Nothing to apply — backfill is already fully applied. No snapshot written, 0 mutations.")
    return
  }
  const { result, rollbackCmd } = outcome
  if (outcome.finalizeError) {
    // Every DB write already succeeded — do not report the apply itself as failed.
    console.warn(
      `  ⚠ Apply succeeded but the snapshot could not be finalized (${outcome.finalizeError}); it is still "pending".\n` +
        `    The next --apply will detect the apply fully landed and mark it complete automatically.\n` +
        `    Inserted trade IDs: ${result.insertedTradeIds.join(", ") || "none"}\n` +
        `    Rollback command: ${rollbackCmd}`
    )
  }
  console.log(`  ✓ Updated ${result.updatedSkaters} player_game_stats row(s)`)
  console.log(`  ✓ Updated ${result.updatedGoalies} goalie_game_stats row(s)`)
  console.log(`  ✓ Removed ${result.deletedPlayerSeasons} duplicate pre-trade player_seasons row(s)`)
  console.log(`  ✓ Inserted ${result.insertedTrades} season_trades row(s) and ${result.insertedTradeItems} season_trade_items row(s)`)

  const totals = await computeDatabaseTotals(sql)
  console.log(
    `\nPost-Backfill DB Totals:\n` +
      `  • player_game_stats : ${totals.skaterStamped}/${totals.skaterTotal} stamped (${totals.skaterNull} NULL)\n` +
      `  • goalie_game_stats : ${totals.goalieStamped}/${totals.goalieTotal} stamped (${totals.goalieNull} NULL)\n` +
      `  • season_trades     : ${totals.seasonTradesTotal} trades (${totals.seasonTradeItemsTotal} items)`
  )

  console.log("\n====================================================")
  console.log("  ✓ HISTORICAL TRADE BACKFILL COMPLETE")
  console.log("====================================================")
}

if (process.env.NODE_ENV !== "test" && process.argv[1]?.includes("backfill-historical-trades")) {
  main().catch((err) => {
    console.error("\n❌ Historical trade backfill failed:", err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
