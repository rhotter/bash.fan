import "./env"
import { rawSql } from "../lib/db"
import { sql } from "drizzle-orm"
import { playerSlug } from "../lib/player-slug"

async function check() {
  const players = await rawSql(sql`SELECT id, name FROM players`)

  // Find any players where slug is empty
  const problematic = players.filter((p) => {
    const s = playerSlug(p.name)
    return !s || s === ""
  })
  console.log("Problematic slugs:", problematic.length)
  for (const p of problematic) {
    console.log(`  id=${p.id} name="${p.name}" slug="${playerSlug(p.name)}"`)
  }

  // Find duplicate slugs
  const slugMap = new Map<string, typeof players>()
  for (const p of players) {
    const s = playerSlug(p.name)
    if (!slugMap.has(s)) slugMap.set(s, [])
    slugMap.get(s)!.push(p)
  }
  const dupes = [...slugMap.entries()].filter(([, v]) => v.length > 1)
  console.log("\nDuplicate slugs:", dupes.length)
  for (const [s, ps] of dupes) {
    console.log(`  slug="${s}":`)
    for (const p of ps) console.log(`    id=${p.id} name="${p.name}"`)
  }
}

check()
