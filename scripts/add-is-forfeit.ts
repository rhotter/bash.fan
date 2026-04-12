import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

async function main() {
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'games'
  ` as { column_name: string }[]
  const names = cols.map((c) => c.column_name)

  if (names.includes("is_forfeit")) {
    console.log("games.is_forfeit already exists.")
    return
  }

  console.log("Adding games.is_forfeit column…")
  await sql`ALTER TABLE games ADD COLUMN is_forfeit boolean NOT NULL DEFAULT false`
  console.log("Done. Run a full schedule sync to populate the flag from Sportability.")
}

main().catch((e) => { console.error(e); process.exit(1) })
