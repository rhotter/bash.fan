import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

async function migrate() {
  await sql`ALTER TABLE season_teams ADD COLUMN IF NOT EXISTS color text`
  console.log("✅ Added color column to season_teams")
}

migrate().catch(console.error)
