import "./env"
import { neon } from "@neondatabase/serverless"

interface ColumnInfo {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
}

interface ScriptOptions {
  dbUrl: string
  dryRun: boolean
}

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2)
  let dbUrl = process.env.PROD_URL || process.env.DATABASE_URL || ""
  let dryRun = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--url" || arg === "--db" || arg === "--prod" || arg === "--to") {
      if (args[i + 1]) dbUrl = args[++i]
    } else if (arg === "--dry-run" || arg === "-n") {
      dryRun = true
    }
  }
  return { dbUrl, dryRun }
}

function describeDbEndpoint(dbUrl: string): { host: string; label: string } {
  try {
    const parsed = new URL(dbUrl)
    const host = parsed.host
    if (process.env.DB_LABEL) {
      return { host, label: process.env.DB_LABEL }
    }
    if (host.includes("ep-frosty-shadow")) {
      return { host, label: "Website Live Production DB (ep-frosty-shadow)" }
    }
    if (host.includes("ep-winter-bird")) {
      return { host, label: "Dev DB (ep-winter-bird / bash_ranger)" }
    }
    return { host, label: "Custom DB" }
  } catch {
    return { host: "unknown", label: process.env.DB_LABEL ?? "Unknown DB" }
  }
}

/**
 * Standalone, idempotent migration and backfill script for traded-player support:
 * 1. Adds nullable team_slug column + index to player_game_stats and goalie_game_stats
 * 2. Creates season_trades and season_trade_items tables + indexes
 * 3. Backfills team_slug on historical player_game_stats and goalie_game_stats rows
 *
 * Strictly NO db.transaction() — executes sequentially via direct neon HTTP connection.
 */
async function main() {
  const { dbUrl, dryRun } = parseArgs()
  if (!dbUrl) {
    throw new Error(
      "Missing database connection URL. Provide via --url '<url>', PROD_URL='<url>', or DATABASE_URL in .env.local."
    )
  }

  const { host, label } = describeDbEndpoint(dbUrl)
  console.log("====================================================")
  console.log(`  Deploying Traded Player Schema & Backfill ${dryRun ? "[DRY RUN — READ ONLY]" : ""}`)
  console.log(`  Target: ${label}`)
  console.log(`  Host:   ${host}`)
  console.log("====================================================")

  const sql = neon(dbUrl)

  if (dryRun) {
    console.log("\n[DRY RUN] Inspecting target database status (read-only)...")
    const meta = (await sql`
      SELECT current_database() as db_name, current_user as user_name
    `) as { db_name: string; user_name: string }[]
    console.log(`  • Connected Database : ${meta[0]?.db_name}`)
    console.log(`  • Connected Role     : ${meta[0]?.user_name}`)

    const pgsColCheck = (await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'player_game_stats' AND column_name = 'team_slug'
      ) as exists
    `) as { exists: boolean }[]
    const ggsColCheck = (await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'goalie_game_stats' AND column_name = 'team_slug'
      ) as exists
    `) as { exists: boolean }[]
    const tradesTableCheck = (await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'season_trades'
      ) as exists
    `) as { exists: boolean }[]
    const tradeItemsTableCheck = (await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'season_trade_items'
      ) as exists
    `) as { exists: boolean }[]

    console.log(
      `  • Column 'player_game_stats.team_slug' : ${pgsColCheck[0]?.exists ? "ALREADY EXISTS" : "NOT FOUND (will be added)"}`
    )
    console.log(
      `  • Column 'goalie_game_stats.team_slug' : ${ggsColCheck[0]?.exists ? "ALREADY EXISTS" : "NOT FOUND (will be added)"}`
    )
    console.log(
      `  • Table  'season_trades'               : ${tradesTableCheck[0]?.exists ? "ALREADY EXISTS" : "NOT FOUND (will be created)"}`
    )
    console.log(
      `  • Table  'season_trade_items'          : ${tradeItemsTableCheck[0]?.exists ? "ALREADY EXISTS" : "NOT FOUND (will be created)"}`
    )

    const counts = (await sql`
      SELECT
        (SELECT count(*)::int FROM player_game_stats) AS pgs_total,
        (SELECT count(*)::int FROM goalie_game_stats) AS ggs_total
    `) as { pgs_total: number; ggs_total: number }[]
    console.log(
      `  • Existing Stat Rows : ${counts[0]?.pgs_total ?? 0} player_game_stats, ${counts[0]?.ggs_total ?? 0} goalie_game_stats`
    )

    console.log("\n[DRY RUN] Execution Plan:")
    console.log("  1. ALTER TABLE player_game_stats ADD COLUMN IF NOT EXISTS team_slug text REFERENCES teams(slug)")
    console.log("  2. ALTER TABLE goalie_game_stats ADD COLUMN IF NOT EXISTS team_slug text REFERENCES teams(slug)")
    console.log("  3. CREATE INDEX IF NOT EXISTS idx_player_game_stats_team & idx_goalie_game_stats_team")
    console.log("  4. CREATE TABLE IF NOT EXISTS season_trades & season_trade_items + indexes")
    console.log("  5. Backfill team_slug where NULL via Priority 1 (game_live), Priority 2 (adhoc_game_rosters), Priority 3 (player_seasons)")

    console.log("\n====================================================")
    console.log("  ✓ DRY RUN COMPLETE — 0 mutations executed.")
    console.log("    Database was inspected in read-only mode.")
    console.log("====================================================")
    return
  }

  console.log("\n[1/5] Adding 'team_slug' column and index to player_game_stats and goalie_game_stats...")
  await sql`
    ALTER TABLE player_game_stats
    ADD COLUMN IF NOT EXISTS team_slug text REFERENCES teams(slug)
  `
  await sql`
    ALTER TABLE goalie_game_stats
    ADD COLUMN IF NOT EXISTS team_slug text REFERENCES teams(slug)
  `
  await sql`
    CREATE INDEX IF NOT EXISTS idx_player_game_stats_team
    ON player_game_stats (team_slug)
  `
  await sql`
    CREATE INDEX IF NOT EXISTS idx_goalie_game_stats_team
    ON goalie_game_stats (team_slug)
  `
  console.log("  ✓ Columns and indexes on player_game_stats & goalie_game_stats verified")

  console.log("\n[2/5] Creating table 'season_trades' and index if not exists...")
  await sql`
    CREATE TABLE IF NOT EXISTS season_trades (
      id serial PRIMARY KEY,
      season_id text NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      team_slugs text[] NOT NULL,
      notes text,
      traded_at timestamp with time zone NOT NULL DEFAULT now(),
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'season_trades' AND column_name = 'team_slugs'
      ) THEN
        ALTER TABLE season_trades ADD COLUMN team_slugs text[];
        UPDATE season_trades SET team_slugs = ARRAY[team_a_slug, team_b_slug] WHERE team_slugs IS NULL;
        ALTER TABLE season_trades ALTER COLUMN team_slugs SET NOT NULL;
        ALTER TABLE season_trades DROP COLUMN IF EXISTS team_a_slug, DROP COLUMN IF EXISTS team_b_slug;
      END IF;
    END $$;
  `
  await sql`
    CREATE INDEX IF NOT EXISTS idx_season_trades_season
    ON season_trades (season_id)
  `
  console.log("  ✓ Table 'season_trades' and index verified")

  console.log("\n[3/5] Creating table 'season_trade_items' and indexes if not exists...")
  await sql`
    CREATE TABLE IF NOT EXISTS season_trade_items (
      id serial PRIMARY KEY,
      trade_id integer NOT NULL REFERENCES season_trades(id) ON DELETE CASCADE,
      item_type text NOT NULL,
      from_team_slug text NOT NULL REFERENCES teams(slug),
      to_team_slug text NOT NULL REFERENCES teams(slug),
      player_id integer REFERENCES players(id),
      draft_pick_round integer,
      draft_pick_original_team_slug text REFERENCES teams(slug),
      draft_pick_target_season text
    )
  `
  await sql`
    CREATE INDEX IF NOT EXISTS idx_season_trade_items_trade
    ON season_trade_items (trade_id)
  `
  await sql`
    CREATE INDEX IF NOT EXISTS idx_season_trade_items_player
    ON season_trade_items (player_id)
  `
  console.log("  ✓ Table 'season_trade_items' and indexes verified")

  console.log("\n[4/5] Backfilling 'team_slug' on player_game_stats and goalie_game_stats...")

  // Priority 1: game_live.state homeAttendance / awayAttendance (unambiguous XOR)
  await sql`
    UPDATE player_game_stats pgs
    SET team_slug = CASE
      WHEN COALESCE(
        jsonb_typeof(gl.state->'homeAttendance') = 'array'
        AND gl.state->'homeAttendance' @> to_jsonb(pgs.player_id),
        false
      )
      AND NOT COALESCE(
        jsonb_typeof(gl.state->'awayAttendance') = 'array'
        AND gl.state->'awayAttendance' @> to_jsonb(pgs.player_id),
        false
      )
        THEN g.home_team
      WHEN COALESCE(
        jsonb_typeof(gl.state->'awayAttendance') = 'array'
        AND gl.state->'awayAttendance' @> to_jsonb(pgs.player_id),
        false
      )
      AND NOT COALESCE(
        jsonb_typeof(gl.state->'homeAttendance') = 'array'
        AND gl.state->'homeAttendance' @> to_jsonb(pgs.player_id),
        false
      )
        THEN g.away_team
      ELSE NULL
    END
    FROM games g
    JOIN game_live gl ON gl.game_id = g.id
    WHERE pgs.game_id = g.id
      AND pgs.team_slug IS NULL
      AND (
        COALESCE(
          jsonb_typeof(gl.state->'homeAttendance') = 'array'
          AND gl.state->'homeAttendance' @> to_jsonb(pgs.player_id),
          false
        ) <> COALESCE(
          jsonb_typeof(gl.state->'awayAttendance') = 'array'
          AND gl.state->'awayAttendance' @> to_jsonb(pgs.player_id),
          false
        )
      )
  `

  await sql`
    UPDATE goalie_game_stats ggs
    SET team_slug = CASE
      WHEN COALESCE(
        jsonb_typeof(gl.state->'homeAttendance') = 'array'
        AND gl.state->'homeAttendance' @> to_jsonb(ggs.player_id),
        false
      )
      AND NOT COALESCE(
        jsonb_typeof(gl.state->'awayAttendance') = 'array'
        AND gl.state->'awayAttendance' @> to_jsonb(ggs.player_id),
        false
      )
        THEN g.home_team
      WHEN COALESCE(
        jsonb_typeof(gl.state->'awayAttendance') = 'array'
        AND gl.state->'awayAttendance' @> to_jsonb(ggs.player_id),
        false
      )
      AND NOT COALESCE(
        jsonb_typeof(gl.state->'homeAttendance') = 'array'
        AND gl.state->'homeAttendance' @> to_jsonb(ggs.player_id),
        false
      )
        THEN g.away_team
      ELSE NULL
    END
    FROM games g
    JOIN game_live gl ON gl.game_id = g.id
    WHERE ggs.game_id = g.id
      AND ggs.team_slug IS NULL
      AND (
        COALESCE(
          jsonb_typeof(gl.state->'homeAttendance') = 'array'
          AND gl.state->'homeAttendance' @> to_jsonb(ggs.player_id),
          false
        ) <> COALESCE(
          jsonb_typeof(gl.state->'awayAttendance') = 'array'
          AND gl.state->'awayAttendance' @> to_jsonb(ggs.player_id),
          false
        )
      )
  `

  // Priority 2: adhoc_game_rosters.team_side (unambiguous single side per game/player)
  await sql`
    WITH unambiguous_adhoc AS (
      SELECT game_id, player_id, MIN(team_side) AS team_side
      FROM adhoc_game_rosters
      WHERE team_side IN ('home', 'away')
      GROUP BY game_id, player_id
      HAVING COUNT(DISTINCT team_side) = 1
    )
    UPDATE player_game_stats pgs
    SET team_slug = CASE
      WHEN ua.team_side = 'home' THEN g.home_team
      ELSE g.away_team
    END
    FROM games g
    JOIN unambiguous_adhoc ua ON ua.game_id = g.id
    WHERE pgs.game_id = g.id
      AND pgs.player_id = ua.player_id
      AND pgs.team_slug IS NULL
  `

  await sql`
    WITH unambiguous_adhoc AS (
      SELECT game_id, player_id, MIN(team_side) AS team_side
      FROM adhoc_game_rosters
      WHERE team_side IN ('home', 'away')
      GROUP BY game_id, player_id
      HAVING COUNT(DISTINCT team_side) = 1
    )
    UPDATE goalie_game_stats ggs
    SET team_slug = CASE
      WHEN ua.team_side = 'home' THEN g.home_team
      ELSE g.away_team
    END
    FROM games g
    JOIN unambiguous_adhoc ua ON ua.game_id = g.id
    WHERE ggs.game_id = g.id
      AND ggs.player_id = ua.player_id
      AND ggs.team_slug IS NULL
  `

  // Priority 3: player_seasons.team_slug matching games.home_team or games.away_team (unambiguous, non-exhibition/tryout, non-traded)
  await sql`
    UPDATE player_game_stats pgs
    SET team_slug = sub.team_slug
    FROM (
      SELECT pgs_inner.player_id, pgs_inner.game_id, MIN(ps.team_slug) AS team_slug
      FROM player_game_stats pgs_inner
      JOIN games g ON g.id = pgs_inner.game_id
      JOIN player_seasons ps ON ps.player_id = pgs_inner.player_id
        AND ps.season_id = g.season_id
        AND ps.team_slug IN (g.home_team, g.away_team)
      WHERE pgs_inner.team_slug IS NULL
        AND g.game_type NOT IN ('exhibition', 'tryout')
        AND NOT EXISTS (
          SELECT 1
          FROM season_trade_items sti
          JOIN season_trades st ON st.id = sti.trade_id
          WHERE st.season_id = g.season_id
            AND sti.item_type = 'player'
            AND sti.player_id = pgs_inner.player_id
        )
      GROUP BY pgs_inner.player_id, pgs_inner.game_id
      HAVING COUNT(DISTINCT ps.team_slug) = 1
    ) sub
    WHERE pgs.player_id = sub.player_id
      AND pgs.game_id = sub.game_id
      AND pgs.team_slug IS NULL
  `

  await sql`
    UPDATE goalie_game_stats ggs
    SET team_slug = sub.team_slug
    FROM (
      SELECT ggs_inner.player_id, ggs_inner.game_id, MIN(ps.team_slug) AS team_slug
      FROM goalie_game_stats ggs_inner
      JOIN games g ON g.id = ggs_inner.game_id
      JOIN player_seasons ps ON ps.player_id = ggs_inner.player_id
        AND ps.season_id = g.season_id
        AND ps.team_slug IN (g.home_team, g.away_team)
      WHERE ggs_inner.team_slug IS NULL
        AND g.game_type NOT IN ('exhibition', 'tryout')
        AND NOT EXISTS (
          SELECT 1
          FROM season_trade_items sti
          JOIN season_trades st ON st.id = sti.trade_id
          WHERE st.season_id = g.season_id
            AND sti.item_type = 'player'
            AND sti.player_id = ggs_inner.player_id
        )
      GROUP BY ggs_inner.player_id, ggs_inner.game_id
      HAVING COUNT(DISTINCT ps.team_slug) = 1
    ) sub
    WHERE ggs.player_id = sub.player_id
      AND ggs.game_id = sub.game_id
      AND ggs.team_slug IS NULL
  `

  console.log("  ✓ Historical team_slug backfill complete")

  console.log("\n[5/5] Verifying schema and backfill coverage...")
  const pgsCols = (await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'player_game_stats' AND column_name = 'team_slug'
  `) as ColumnInfo[]
  const ggsCols = (await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'goalie_game_stats' AND column_name = 'team_slug'
  `) as ColumnInfo[]
  const tradesCols = (await sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'season_trades'
  `) as { column_name: string }[]
  const tradeItemsCols = (await sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'season_trade_items'
  `) as { column_name: string }[]

  if (pgsCols.length === 0 || ggsCols.length === 0) {
    throw new Error("Schema verification failed: team_slug missing from player_game_stats or goalie_game_stats")
  }
  if (tradesCols.length < 7 || tradeItemsCols.length < 9) {
    throw new Error("Schema verification failed: season_trades or season_trade_items columns incomplete")
  }

  const statsSummary = (await sql`
    SELECT
      (SELECT count(*)::int FROM player_game_stats) AS pgs_total,
      (SELECT count(*)::int FROM player_game_stats WHERE team_slug IS NOT NULL) AS pgs_stamped,
      (SELECT count(*)::int FROM player_game_stats WHERE team_slug IS NULL) AS pgs_null,
      (SELECT count(*)::int FROM goalie_game_stats) AS ggs_total,
      (SELECT count(*)::int FROM goalie_game_stats WHERE team_slug IS NOT NULL) AS ggs_stamped,
      (SELECT count(*)::int FROM goalie_game_stats WHERE team_slug IS NULL) AS ggs_null
  `) as {
    pgs_total: number
    pgs_stamped: number
    pgs_null: number
    ggs_total: number
    ggs_stamped: number
    ggs_null: number
  }[]

  const s = statsSummary[0]
  console.log(
    `  • player_game_stats : ${s.pgs_stamped}/${s.pgs_total} stamped (${s.pgs_null} null remaining — e.g. historical non-roster subs)`
  )
  console.log(
    `  • goalie_game_stats : ${s.ggs_stamped}/${s.ggs_total} stamped (${s.ggs_null} null remaining — e.g. historical non-roster subs)`
  )

  console.log("\n====================================================")
  console.log("  ✓ Traded Player Schema & Backfill completed successfully!")
  console.log("====================================================")
}

main().catch((err) => {
  console.error("\n❌ Migration failed with error:", err)
  process.exit(1)
})
