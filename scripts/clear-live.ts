import "./env"
import { rawSql } from "../lib/db"
import { sql } from "drizzle-orm"

async function main() {
  const gameId = process.argv[2]
  if (!gameId) { console.error("Usage: npx tsx scripts/clear-live.ts <game_id>"); process.exit(1) }
  await rawSql(sql`DELETE FROM game_live WHERE game_id = ${gameId}`)
  console.log(`Cleared game_live for game ${gameId}`)
}
main()
