import { config } from "dotenv"
import { readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"
config({ path: ".env.local", quiet: true })

async function main() {
  const target = process.argv[2] ?? "dev"
  if (!["dev", "prod"].includes(target)) throw new Error("Use dev or prod")
  const url = target === "prod" ? process.env.PROD_URL ?? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL_DEV
  if (!url) throw new Error(`Explicit ${target} database URL is required`)
  const production = process.env.PROD_URL ?? process.env.DATABASE_URL_PROD
  if (target === "dev" && production && new URL(url).hostname.replace("-pooler", "") === new URL(production).hostname.replace("-pooler", "")) {
    throw new Error("Dev and production endpoints match")
  }
  const connection = neon(url)
  const statements = readFileSync(new URL("./scorekeeper-timing-schema.sql", import.meta.url), "utf8").split(";").map(s => s.trim()).filter(Boolean)
  for (const statement of statements) await connection.query(statement)
  console.log(`Scorekeeper timing table ready (${target}); existing inline history migrated`)
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Timing schema setup failed"); process.exitCode = 1 })
