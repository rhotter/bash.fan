/**
 * Backfill franchise_slug on season_teams rows by matching team names/slugs
 * to known franchise colors.
 *
 * BASH teams are color-coded: "Red Army", "Blue Bandits", "Gray Wolves", etc.
 * This script matches teams to franchises by checking if the team slug or name
 * starts with the franchise color.
 *
 * Usage:
 *   export $(cat .env.local | grep -v '^#' | xargs) && npx tsx scripts/backfill-franchise-slugs.ts
 *
 * Add --dry-run to preview without writing:
 *   export $(cat .env.local | grep -v '^#' | xargs) && npx tsx scripts/backfill-franchise-slugs.ts --dry-run
 */

import { db, schema } from "../lib/db"
import { eq, and, isNull } from "drizzle-orm"

const isDryRun = process.argv.includes("--dry-run")

async function main() {
  console.log(`Backfilling franchise_slug on season_teams...${isDryRun ? " (DRY RUN)" : ""}`)
  console.log()

  // 1. Load all franchises
  const franchises = await db.select().from(schema.franchises)
  if (franchises.length === 0) {
    console.error("No franchises found. Run seed-franchises.ts first.")
    process.exit(1)
  }
  console.log(`Found ${franchises.length} franchises: ${franchises.map(f => f.slug).join(", ")}`)

  // 2. Load all season_teams rows with NULL franchise_slug, joined to teams for the name
  const rows = await db
    .select({
      seasonId: schema.seasonTeams.seasonId,
      teamSlug: schema.seasonTeams.teamSlug,
      teamName: schema.teams.name,
      franchiseSlug: schema.seasonTeams.franchiseSlug,
    })
    .from(schema.seasonTeams)
    .innerJoin(schema.teams, eq(schema.seasonTeams.teamSlug, schema.teams.slug))
    .where(isNull(schema.seasonTeams.franchiseSlug))

  console.log(`Found ${rows.length} season_teams rows with no franchise assignment`)
  console.log()

  // 3. Try to match each row to a franchise
  let matched = 0
  let unmatched = 0
  const unmatchedTeams = new Set<string>()

  for (const row of rows) {
    const slugLower = row.teamSlug.toLowerCase()
    const nameLower = row.teamName.toLowerCase()

    let matchedFranchise: string | null = null

    for (const f of franchises) {
      const fSlug = f.slug.toLowerCase()
      // Match: team slug starts with franchise slug, OR team name starts with franchise name
      if (slugLower.startsWith(fSlug) || nameLower.startsWith(fSlug)) {
        matchedFranchise = f.slug
        break
      }
    }

    if (matchedFranchise) {
      matched++
      console.log(`  ✓ ${row.seasonId} / ${row.teamSlug} (${row.teamName}) → ${matchedFranchise}`)

      if (!isDryRun) {
        await db
          .update(schema.seasonTeams)
          .set({ franchiseSlug: matchedFranchise })
          .where(
            and(
              eq(schema.seasonTeams.seasonId, row.seasonId),
              eq(schema.seasonTeams.teamSlug, row.teamSlug)
            )
          )
      }
    } else {
      unmatched++
      unmatchedTeams.add(`${row.teamSlug} (${row.teamName})`)
    }
  }

  console.log()
  console.log(`Results: ${matched} matched, ${unmatched} unmatched`)

  if (unmatchedTeams.size > 0) {
    console.log()
    console.log("Unmatched teams (assign manually via admin):")
    for (const t of unmatchedTeams) {
      console.log(`  ✗ ${t}`)
    }
  }

  if (isDryRun) {
    console.log()
    console.log("Dry run complete — no changes written. Remove --dry-run to apply.")
  }

  process.exit(0)
}

main().catch((err) => {
  console.error("Failed to backfill:", err)
  process.exit(1)
})
