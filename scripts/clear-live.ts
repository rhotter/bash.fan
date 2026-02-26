import { neon } from "@neondatabase/serverless"

async function main() {
  const sql = neon(process.env.DATABASE_URL as string)
  const gameId = process.argv[2]
  if (!gameId) { console.error("Usage: npx tsx scripts/clear-live.ts <game_id>"); process.exit(1) }
  await sql`DELETE FROM game_live WHERE game_id = ${gameId}`
  console.log(`Cleared game_live for game ${gameId}`)
}
main()
