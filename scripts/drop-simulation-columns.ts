import { neon } from "@neondatabase/serverless"
import "dotenv/config"

/**
 * Drop unused isSimulation / isSimulating columns from draft tables.
 * These were planned for a simulation feature that is deferred.
 * 
 * Run: export $(cat .env.local | grep -v '^#' | xargs) && npx tsx scripts/drop-simulation-columns.ts
 */
async function migrate() {
  const sql = neon(process.env.DATABASE_URL!)

  console.log("Dropping unused simulation columns from draft tables...")

  await sql`ALTER TABLE draft_instances DROP COLUMN IF EXISTS is_simulating`
  console.log("  ✅ draft_instances.is_simulating dropped")

  await sql`ALTER TABLE draft_picks DROP COLUMN IF EXISTS is_simulation`
  console.log("  ✅ draft_picks.is_simulation dropped")

  await sql`ALTER TABLE draft_trades DROP COLUMN IF EXISTS is_simulation`
  console.log("  ✅ draft_trades.is_simulation dropped")

  await sql`ALTER TABLE draft_log DROP COLUMN IF EXISTS is_simulation`
  console.log("  ✅ draft_log.is_simulation dropped")

  console.log("\n✅ Done — all simulation columns removed")
  process.exit(0)
}

migrate().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
