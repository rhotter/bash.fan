import "./env"
import { rawSql } from "../lib/db"
import { sql } from "drizzle-orm"

async function backfill() {
  console.log("Backfilling season status and settings...")

  // Set all seasons to completed by default
  await rawSql(sql`
    UPDATE seasons
    SET
      status = 'completed',
      standings_method = COALESCE(standings_method, 'pts-pbla'),
      game_length = COALESCE(game_length, 60)
    WHERE status IS NULL OR status = 'active'
  `)
  console.log("All seasons set to status=completed")

  // Set current season to active
  await rawSql(sql`
    UPDATE seasons
    SET status = 'active'
    WHERE is_current = true
  `)
  console.log("Current season set to status=active")

  // Set default locations based on season type
  await rawSql(sql`
    UPDATE seasons
    SET default_location = 'James Lick Arena'
    WHERE season_type = 'fall' AND default_location IS NULL
  `)
  await rawSql(sql`
    UPDATE seasons
    SET default_location = 'Dolores Park Multi-purpose Court'
    WHERE season_type = 'summer' AND default_location IS NULL
  `)
  console.log("Default locations set by season type")

  console.log("Backfill complete!")
}

backfill().catch(console.error)
