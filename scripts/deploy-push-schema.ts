import "./env"
import { neon } from "@neondatabase/serverless"
import { readFileSync } from "node:fs"

async function main() {
 const target = process.argv.includes("--prod") ? "prod" : "dev"
 const url = process.env[`DATABASE_URL_${target.toUpperCase()}`]
 if (!url) throw new Error(`DATABASE_URL_${target.toUpperCase()} is required; no implicit fallback`)
 console.log(`Applying additive game-alert migration to ${target}: ${new URL(url).hostname}`)
 const query = neon(url)
 // Split only at top-level semicolons; PL/pgSQL function bodies remain intact.
 const source = readFileSync("lib/push/schema.sql", "utf8").replace(/^\s*--.*$/gm, "")
 let quoted = false, start = 0
 for (let i = 0; i < source.length; i++) {
  if (source.slice(i,i+2) === "$$") { quoted = !quoted; i++; continue }
  if (source[i] === ";" && !quoted) {
   const statement = source.slice(start,i+1).trim()
   if (statement) await query.query(statement)
   start = i+1
  }
 }
 console.log("Game alert tables and trigger installed.")
}
main().catch(error => { console.error(error.message); process.exitCode=1 })
