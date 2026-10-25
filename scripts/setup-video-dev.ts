import { config } from "dotenv"
import { readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"
config({ path: ".env.local", quiet: true })

async function main() {
  const url = process.env.DATABASE_URL_DEV
  if (!url) throw new Error("DATABASE_URL_DEV is required; this script never falls back to production")
  if (process.env.DATABASE_URL_PROD && new URL(url).hostname === new URL(process.env.DATABASE_URL_PROD).hostname) throw new Error("Dev and production endpoints match")
  const connection = neon(url)
  const statements = readFileSync(new URL("./video-schema.sql", import.meta.url), "utf8").split(";").map(s => s.trim()).filter(Boolean)
  for (const statement of statements) await connection.query(statement)
  console.log("Video tables ready in DATABASE_URL_DEV")
}
main().catch(() => { console.error("Video schema setup failed; check the dev connection."); process.exitCode = 1 })
