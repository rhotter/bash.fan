import { neon } from "@neondatabase/serverless"
import "dotenv/config"

async function migrate() {
  const sql = neon(process.env.DATABASE_URL!)

  console.log("Adding registration_meta column to draft_pool...")
  await sql`ALTER TABLE draft_pool ADD COLUMN IF NOT EXISTS registration_meta jsonb`
  console.log("✅ Done — registration_meta column added to draft_pool")

  process.exit(0)
}

migrate().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
