/**
 * Seed the 6 core BASH franchises into the database.
 * Safe to run multiple times — uses ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   export $(cat .env.local | grep -v '^#' | xargs) && npx tsx scripts/seed-franchises.ts
 */

import { db, schema } from "../lib/db"

const FRANCHISES = [
  { slug: "red",   name: "Red",   color: "#dc2626" },
  { slug: "blue",  name: "Blue",  color: "#2563eb" },
  { slug: "gray",  name: "Gray",  color: "#6b7280" },
  { slug: "green", name: "Green", color: "#16a34a" },
  { slug: "white", name: "White", color: "#e5e7eb" },
  { slug: "black", name: "Black", color: "#1f2937" },
] as const

async function main() {
  console.log("Seeding franchises...")

  for (const f of FRANCHISES) {
    await db
      .insert(schema.franchises)
      .values(f)
      .onConflictDoNothing({ target: schema.franchises.slug })

    console.log(`  ✓ ${f.slug} (${f.name}) — ${f.color}`)
  }

  console.log(`\nDone. ${FRANCHISES.length} franchises seeded.`)
  process.exit(0)
}

main().catch((err) => {
  console.error("Failed to seed franchises:", err)
  process.exit(1)
})
