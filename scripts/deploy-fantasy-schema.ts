import "./env"
import { neon } from "@neondatabase/serverless"
import { readFileSync } from "node:fs"

/**
 * Creates the Fantasy tables. Safe to re-run: it only creates what is missing and never alters an existing
 * table, so a later column or constraint change needs its own ALTER script.
 *
 *   npx tsx scripts/deploy-fantasy-schema.ts --url '<url>' --dry-run
 *   npx tsx scripts/deploy-fantasy-schema.ts --url '<url>'
 *
 * `-n` is short for `--dry-run`.
 *
 * Run this before deploying the code: player merges update fantasy_lineups.
 * The statements run as one transaction, so a failure leaves the schema untouched. The SQL file is split on
 * semicolons, so it must not contain them inside strings, comments or DO blocks (see scripts/fantasy-schema.sql).
 */
const TABLES = ["fantasy_seasons", "fantasy_managers", "fantasy_lineups", "fantasy_predictions"]

function parseArgs() {
  const args = process.argv.slice(2)
  const urlFlag = args.indexOf("--url")
  return {
    dbUrl: (urlFlag >= 0 ? args[urlFlag + 1] : process.env.PROD_URL) ?? "",
    dryRun: args.includes("--dry-run") || args.includes("-n"),
  }
}

async function main() {
  const { dbUrl, dryRun } = parseArgs()
  if (!dbUrl) throw new Error("Missing database URL. Pass --url '<url>' or set PROD_URL. DATABASE_URL is deliberately not used, so this can't hit the wrong database.")

  let host: string
  try {
    host = new URL(dbUrl).host
  } catch {
    throw new Error("The database URL isn't a valid URL.")
  }
  const sql = neon(dbUrl)
  console.log(`Target host: ${host}${dryRun ? " [DRY RUN]" : ""}`)

  const existing = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY(${TABLES})
  `) as { table_name: string }[]
  const found = new Set(existing.map((row) => row.table_name))
  for (const table of TABLES) console.log(`  ${table}: ${found.has(table) ? "exists" : "will be created"}`)
  if (dryRun) {
    console.log("Dry run complete. Nothing changed.")
    return
  }

  const script = readFileSync("scripts/fantasy-schema.sql", "utf8").replace(/^--.*$/gm, "")
  const statements = script.split(";").map((s) => s.trim()).filter(Boolean)
  try {
    await sql.transaction(statements.map((statement) => sql.query(statement)))
  } catch (err) {
    console.error("A statement failed, so none were applied. The statements were:\n" + statements.join(";\n\n"))
    throw err
  }
  console.log(`Applied ${statements.length} statements.`)
}

main().catch((err) => {
  console.error("Fantasy schema deploy failed:", err)
  process.exit(1)
})
