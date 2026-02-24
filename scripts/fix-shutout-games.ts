/**
 * Fix shutout game parsing bug.
 *
 * The schedule parser was missing (Shutout) from its cleanup regex, causing
 * scores to be embedded in team names (e.g. "rink-rats-3" @ "landsharks-0-shutout").
 * This script:
 *   1. Deletes the broken game records and their related data
 *   2. Deletes bogus team entries created by the bug
 *   3. Re-syncs schedules + boxscores for all affected seasons
 *
 * Usage: DATABASE_URL=... npx tsx scripts/fix-shutout-games.ts [--base-url URL]
 *   --base-url: URL of running app (default: http://localhost:3000)
 */

import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

const BASE_URL = process.argv.includes("--base-url")
  ? process.argv[process.argv.indexOf("--base-url") + 1]
  : "http://localhost:3000"

async function cleanup() {
  // Find all bogus teams (scores embedded in team names)
  const bogusTeams = await sql`
    SELECT slug FROM teams
    WHERE slug ~ '-\d+(-shutout)?$' OR slug LIKE '%-shutout'
  `
  const bogusSlugs = bogusTeams.map((t) => t.slug)
  console.log(`Found ${bogusSlugs.length} bogus team entries`)

  if (bogusSlugs.length === 0) {
    console.log("No broken data to clean up!")
    return []
  }

  // Find all broken games referencing bogus teams
  const brokenGames = await sql`
    SELECT id, season_id FROM games
    WHERE away_team = ANY(${bogusSlugs}) OR home_team = ANY(${bogusSlugs})
  `
  const brokenGameIds = brokenGames.map((g) => g.id)
  const affectedSeasons = [...new Set(brokenGames.map((g) => g.season_id))]
  console.log(`Found ${brokenGameIds.length} broken games across ${affectedSeasons.length} seasons`)

  // Delete in FK order
  if (brokenGameIds.length > 0) {
    const delOfficials = await sql`DELETE FROM game_officials WHERE game_id = ANY(${brokenGameIds})`
    console.log(`  Deleted game_officials for broken games`)
    const delPGS = await sql`DELETE FROM player_game_stats WHERE game_id = ANY(${brokenGameIds})`
    console.log(`  Deleted player_game_stats for broken games`)
    const delGGS = await sql`DELETE FROM goalie_game_stats WHERE game_id = ANY(${brokenGameIds})`
    console.log(`  Deleted goalie_game_stats for broken games`)
    await sql`DELETE FROM games WHERE id = ANY(${brokenGameIds})`
    console.log(`  Deleted ${brokenGameIds.length} broken games`)
  }

  // Delete bogus season_teams
  await sql`DELETE FROM season_teams WHERE team_slug = ANY(${bogusSlugs})`
  console.log(`  Deleted season_teams for bogus teams`)

  // Delete bogus player_seasons
  await sql`DELETE FROM player_seasons WHERE team_slug = ANY(${bogusSlugs})`
  console.log(`  Deleted player_seasons for bogus teams`)

  // Delete bogus teams
  await sql`DELETE FROM teams WHERE slug = ANY(${bogusSlugs})`
  console.log(`  Deleted ${bogusSlugs.length} bogus teams`)

  return affectedSeasons
}

async function resyncSeasons(seasons: string[]) {
  console.log(`\nRe-syncing ${seasons.length} affected seasons...`)
  console.log(`Using base URL: ${BASE_URL}`)

  for (const seasonId of seasons) {
    process.stdout.write(`  Syncing ${seasonId} (schedule)...`)
    try {
      const schedRes = await fetch(
        `${BASE_URL}/api/bash/sync?seasonId=${seasonId}&scheduleOnly=true`,
        { method: "GET" }
      )
      const schedData = await schedRes.json()
      if (!schedData.ok) throw new Error(schedData.error)
      console.log(` ${schedData.schedule.gamesCreated} games`)
    } catch (err) {
      console.log(` FAILED: ${err}`)
      continue
    }

    // Sync boxscores in batches until none remain
    let remaining = 999
    let totalBoxscores = 0
    while (remaining > 0) {
      process.stdout.write(`  Syncing ${seasonId} (boxscores, ${remaining} remaining)...`)
      try {
        const boxRes = await fetch(
          `${BASE_URL}/api/bash/sync?seasonId=${seasonId}&boxscoreLimit=50`,
          { method: "GET" }
        )
        const boxData = await boxRes.json()
        if (!boxData.ok) throw new Error(boxData.error)
        totalBoxscores += boxData.boxscoresSynced
        remaining = boxData.boxscoresRemaining
        console.log(` +${boxData.boxscoresSynced} boxscores (${remaining} remaining)`)
        if (boxData.boxscoresSynced === 0) break
      } catch (err) {
        console.log(` FAILED: ${err}`)
        break
      }
    }
    console.log(`  ${seasonId}: ${totalBoxscores} boxscores synced total`)
  }
}

async function main() {
  console.log("=== Fix Shutout Game Parsing Bug ===\n")

  console.log("Step 1: Cleaning up broken data...")
  const affectedSeasons = await cleanup()

  if (affectedSeasons.length === 0) {
    console.log("\nDone! No re-sync needed.")
    return
  }

  console.log("\nStep 2: Re-syncing affected seasons...")
  await resyncSeasons(affectedSeasons.sort())

  console.log("\n=== Done! ===")
}

main().catch(console.error)
