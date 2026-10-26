import { config } from "dotenv"
import { readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"
config({ path: ".env.local", quiet: true })
const target = process.argv[2]
if (target !== "dev" && target !== "prod") throw new Error("Specify dev or prod explicitly")
const url = process.env[`DATABASE_URL_${target.toUpperCase()}`] ?? (target === "dev" ? process.env.DATABASE_URL : undefined)
if (!url) throw new Error(`Missing ${target} database URL`)
console.log(`Applying operator security migration to ${target}: ${new URL(url).hostname}`)
const migration = readFileSync(new URL("./operator-security-schema.sql", import.meta.url), "utf8")
// Dollar-quoted function bodies contain semicolons; keep each body intact.
const statements: string[] = []
let buffer = "", inBody = false
for (let i = 0; i < migration.length; i++) {
  if (migration.slice(i, i + 2) === "$$") { inBody = !inBody; buffer += "$$"; i++; continue }
  buffer += migration[i]
  if (migration[i] === ";" && !inBody) { statements.push(buffer); buffer = "" }
}
const client = neon(url.replace("-pooler.", "."))
client.transaction(statements.filter(s => s.trim()).map(s => client.query(s))).then(() => {
  console.log("Operator security schema installed")
}).catch(() => { console.error("Migration failed; no schema changes committed"); process.exitCode = 1 })
