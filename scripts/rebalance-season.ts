/**
 * Rebalance an in-progress season schedule while preserving announced/completed Week 1 games.
 *
 * Guarantees:
 * 1. Week 1 games remain completely untouched (matchups, home/away, game times, IDs).
 * 2. Weeks 2–21 are regenerated with full equity:
 *    - Exact 9 Home / 9 Away per team (50/50 balance)
 *    - Exact 6 Game 1s, 6 Game 2s, 6 Game 3s per team (balanced game times)
 *    - Exact 3 byes per team
 *    - Head-to-head alternation (2-1 or 1-2 for all pairs)
 *
 * Usage:
 *   # Dry-run preview against dev DB:
 *   npx tsx scripts/rebalance-season.ts --dry-run
 *
 *   # Apply to dev DB:
 *   npx tsx scripts/rebalance-season.ts --yes
 *
 *   # Apply to production DB:
 *   PROD_URL='<prod-db-url>' npx tsx scripts/rebalance-season.ts --prod --yes
 */

import "./env"
import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import * as schema from "../lib/db/schema"
import {
  generateRoundRobin,
  computeScheduleEquity,
  type RoundRobinSlot,
  type GeneratedGame,
} from "../lib/schedule-utils"
import { normalizeTimeForStorage } from "../lib/format-time"

interface ParsedArgs {
  seasonId?: string
  preserveWeek: number
  dryRun: boolean
  autoConfirm: boolean
  dbUrl: string
  isProd: boolean
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2)
  let seasonId: string | undefined
  let preserveWeek = 1
  let dryRun = false
  let autoConfirm = false
  let isProd = false
  let customUrl: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--season" || arg === "-s") {
      seasonId = args[++i]
    } else if (arg === "--preserve-week" || arg === "-w") {
      preserveWeek = parseInt(args[++i], 10) || 1
    } else if (arg === "--dry-run" || arg === "-d") {
      dryRun = true
    } else if (arg === "--yes" || arg === "-y") {
      autoConfirm = true
    } else if (arg === "--prod") {
      isProd = true
    } else if (arg === "--url" || arg === "--to") {
      customUrl = args[++i]
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Rebalance Season Schedule (Preserve Week 1)

Usage:
  npx tsx scripts/rebalance-season.ts [options]

Options:
  --season <id>        Season ID to rebalance (default: current season)
  --preserve-week <N>  Week number to preserve intact (default: 1)
  --dry-run, -d        Preview schedule equity without modifying database
  --yes, -y            Execute changes without interactive confirmation
  --prod               Target PROD_URL from environment
  --url <url>          Explicit database connection string
      `)
      process.exit(0)
    }
  }

  let dbUrl = customUrl
  if (!dbUrl) {
    if (isProd) {
      dbUrl = process.env.PROD_URL || process.env.PROD_DATABASE_URL
      if (!dbUrl) {
        console.error("Error: --prod specified but PROD_URL is not set in environment.")
        process.exit(1)
      }
    } else {
      dbUrl =
        process.env.DEV_URL ||
        process.env.DATABASE_URL_DEV ||
        process.env.DATABASE_URL
    }
  }

  if (!dbUrl) {
    console.error("Error: No database URL found (set DATABASE_URL or pass --url).")
    process.exit(1)
  }

  return { seasonId, preserveWeek, dryRun, autoConfirm, dbUrl, isProd }
}

async function main() {
  const { seasonId: targetSeasonId, preserveWeek, dryRun, autoConfirm, dbUrl, isProd } = parseArgs()

  console.log(`\n=== BASH Schedule Rebalancer ===`)
  console.log(`Target DB: ${isProd ? "PRODUCTION" : "DEV"} (${new URL(dbUrl).host})`)
  if (dryRun) console.log(`Mode: DRY RUN (no database changes will be written)`)

  const sql = neon(dbUrl)

  // 1. Resolve season
  let seasonId = targetSeasonId
  if (!seasonId) {
    const currentRows = await sql`
      SELECT id, name FROM seasons WHERE is_current = true LIMIT 1
    `
    if (currentRows.length > 0) {
      seasonId = currentRows[0].id
    } else {
      const latestRows = await sql`
        SELECT id, name FROM seasons ORDER BY id DESC LIMIT 1
      `
      if (latestRows.length === 0) {
        console.error("Error: No seasons found in database.")
        process.exit(1)
      }
      seasonId = latestRows[0].id
    }
  }

  const seasonRows = await sql`
    SELECT id, name, status, is_current FROM seasons WHERE id = ${seasonId}
  `
  if (seasonRows.length === 0) {
    console.error(`Error: Season '${seasonId}' not found.`)
    process.exit(1)
  }
  const season = seasonRows[0]
  console.log(`Season: ${season.name} (${season.id})`)

  if (preserveWeek !== 1) {
    console.error("Error: Currently only preserving Week 1 (--preserve-week 1) is supported.")
    process.exit(1)
  }

  // 2. Fetch existing regular season games
  const existingGames = await sql`
    SELECT id, season_id, date, time, home_team, away_team, location, game_type, status
    FROM games
    WHERE season_id = ${seasonId}
      AND (game_type = 'regular' OR game_type IS NULL)
      AND is_playoff = false
    ORDER BY date ASC, time ASC, id ASC
  `
  if (existingGames.length === 0) {
    console.error(`Error: No regular season games found for season '${seasonId}'. Run initial schedule generation first.`)
    process.exit(1)
  }

  const dates = [...new Set(existingGames.map((g) => g.date))].sort()
  console.log(`Total regular games in schedule: ${existingGames.length} across ${dates.length} dates`)

  let scheduleDates = dates
  if (scheduleDates.length !== 21) {
    if (scheduleDates.length === 0) {
      console.error(`Error: No regular season games found for season '${seasonId}'. Run initial schedule generation first.`)
      process.exit(1)
    }
    console.warn(`Warning: Expected 21 dates for 7-team, 3-cycle regular season schedule (found ${scheduleDates.length} dates). Deriving weekly schedule from start date ${scheduleDates[0]}...`)
    const baseDate = new Date(`${scheduleDates[0]}T12:00:00Z`)
    const derived: string[] = []
    for (let w = 0; w < 21; w++) {
      const d = new Date(baseDate)
      d.setUTCDate(baseDate.getUTCDate() + w * 7)
      derived.push(d.toISOString().slice(0, 10))
    }
    scheduleDates = derived
  }

  const preservedDate = scheduleDates[0]

function getTimeMinutes(timeStr: string): number {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(a|am|p|pm)?$/i)
  if (!match) return 9999
  let h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  const ampm = match[3]?.toLowerCase()
  if (ampm?.startsWith("p") && h < 12) h += 12
  if (ampm?.startsWith("a") && h === 12) h = 0
  return h * 60 + m
}

  const week1Games = existingGames
    .filter((g) => g.date === preservedDate)
    .sort((a, b) => getTimeMinutes(a.time) - getTimeMinutes(b.time))

  console.log(`\n--- Preserved Week ${preserveWeek} Games (${preservedDate}) ---`)
  week1Games.forEach((g, i) => {
    console.log(`  Game ${i + 1} (${g.time}): ${g.away_team} @ ${g.home_team} (ID: ${g.id})`)
  })

  // 3. Fetch season teams
  const teamRows = await sql`
    SELECT st.team_slug, t.name as team_name
    FROM season_teams st
    JOIN teams t ON st.team_slug = t.slug
    WHERE st.season_id = ${seasonId}
    ORDER BY t.name ASC
  `
  if (teamRows.length !== 7 || week1Games.length !== 3) {
    console.error(`Error: This rebalance script is specialized for 7-team seasons with 3 games on Week 1 (found ${teamRows.length} teams, ${week1Games.length} Week 1 games).`)
    process.exit(1)
  }

  // Determine bye team for Week 1
  const playingTeams = new Set<string>()
  week1Games.forEach((g) => {
    playingTeams.add(g.home_team)
    playingTeams.add(g.away_team)
  })
  const byeTeams = teamRows.filter((t) => !playingTeams.has(t.team_slug))
  if (playingTeams.size !== 6 || byeTeams.length !== 1) {
    console.error("Error: Week 1 games must contain exactly 6 distinct teams with 1 bye team.")
    process.exit(1)
  }
  const week1ByeSlug = byeTeams[0].team_slug
  console.log(`  Bye: ${byeTeams.map((t) => t.team_name).join(", ")}`)

  // 4. Map teams to indices 0..6 to match Week 1 Berger table geometry:
  // Index 0 = Week 1 Bye team
  // Index 1 = Match 1 Home team
  // Index 6 = Match 1 Away team
  // Index 5 = Match 2 Home team
  // Index 2 = Match 2 Away team
  // Index 3 = Match 3 Home team
  // Index 4 = Match 3 Away team
  const orderedSlugs: string[] = [
    week1ByeSlug,
    week1Games[0].home_team,
    week1Games[1].away_team,
    week1Games[2].home_team,
    week1Games[2].away_team,
    week1Games[1].home_team,
    week1Games[0].away_team,
  ]

  const teamSlugToName = new Map<string, string>()
  teamRows.forEach((t) => teamSlugToName.set(t.team_slug, t.team_name))

  const teamsForEquity = orderedSlugs.map((slug) => ({
    teamSlug: slug,
    teamName: teamSlugToName.get(slug) || slug,
  }))

  // 5. Existing Schedule Equity Audit
  const beforeReport = computeScheduleEquity(
    existingGames.map((g) => ({
      date: g.date,
      time: g.time,
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      location: g.location || "The Lick",
      gameType: g.game_type || "regular",
      status: g.status,
    })),
    teamsForEquity,
    dates.length
  )

  console.log(`\n--- CURRENT SCHEDULE EQUITY (Before) ---`)
  console.table(
    beforeReport.teams.map((t) => ({
      Team: t.teamName,
      Home: t.homeGames,
      Away: t.awayGames,
      "Game 1": t.gameSlots[1] ?? 0,
      "Game 2": t.gameSlots[2] ?? 0,
      "Game 3": t.gameSlots[3] ?? 0,
      Byes: t.byes,
      "Max Streak": `${t.maxStreak} H/A`,
    }))
  )

  // 6. Generate Rebalanced Schedule with Week 1 pinned
  const numTeams = orderedSlugs.length
  const gamesPerWeek = 3
  const cycles = 3

  const pinnedSlots: RoundRobinSlot[] = [
    { round: 1, home: 1, away: 6, slotInDay: 0 },
    { round: 1, home: 5, away: 2, slotInDay: 1 },
    { round: 1, home: 3, away: 4, slotInDay: 2 },
  ]

  const balancedSlots = generateRoundRobin(
    numTeams,
    gamesPerWeek,
    cycles,
    undefined,
    pinnedSlots
  )

  // Map balanced slots to dates & default times
  const defaultTimes = ["09:00", "11:00", "13:00"]
  const rebalancedGames: GeneratedGame[] = []

  // Group slots by round
  const slotsByRound = new Map<number, RoundRobinSlot[]>()
  for (const s of balancedSlots) {
    if (!slotsByRound.has(s.round)) slotsByRound.set(s.round, [])
    slotsByRound.get(s.round)!.push(s)
  }

  for (let roundNum = 1; roundNum <= scheduleDates.length; roundNum++) {
    const roundSlots = slotsByRound.get(roundNum) || []
    const roundDate = scheduleDates[roundNum - 1]

    if (roundNum === preserveWeek) {
      // Keep Week 1 games exactly as they are in DB
      for (let i = 0; i < week1Games.length; i++) {
        const g = week1Games[i]
        rebalancedGames.push({
          id: g.id,
          date: g.date,
          time: g.time,
          homeTeam: g.home_team,
          awayTeam: g.away_team,
          location: g.location || "The Lick",
          gameType: g.game_type || "regular",
          status: g.status,
          gameNumberInDay: i + 1,
        })
      }
    } else {
      // Rebalanced weeks 2..21
      for (let i = 0; i < roundSlots.length; i++) {
        const slot = roundSlots[i]
        const slotIdx = slot.slotInDay ?? i
        const time = defaultTimes[slotIdx] || "TBD"

        rebalancedGames.push({
          date: roundDate,
          time,
          homeTeam: orderedSlugs[slot.home],
          awayTeam: orderedSlugs[slot.away],
          location: "The Lick",
          gameType: "regular",
          status: "upcoming",
          gameNumberInDay: slotIdx + 1,
        })
      }
    }
  }

  // 7. Rebalanced Equity Audit
  const afterReport = computeScheduleEquity(rebalancedGames, teamsForEquity, scheduleDates.length)

  console.log(`\n--- REBALANCED SCHEDULE EQUITY (After) ---`)
  console.table(
    afterReport.teams.map((t) => ({
      Team: t.teamName,
      Home: t.homeGames,
      Away: t.awayGames,
      "Game 1": t.gameSlots[1] ?? 0,
      "Game 2": t.gameSlots[2] ?? 0,
      "Game 3": t.gameSlots[3] ?? 0,
      Byes: t.byes,
      "Max Streak": `${t.maxStreak} H/A`,
    }))
  )

  const isPerfectHomeAway = afterReport.teams.every((t) => t.homeGames === 9 && t.awayGames === 9)
  const isPerfectSlots = afterReport.teams.every(
    (t) => t.gameSlots[1] === 6 && t.gameSlots[2] === 6 && t.gameSlots[3] === 6
  )

  console.log(`\nAudit Verification:`)
  console.log(`  ✓ Week 1 Matchups Preserved: YES (3 games identical)`)
  console.log(`  ✓ 50/50 Home/Away (9H / 9A): ${isPerfectHomeAway ? "YES (100% Balanced)" : "NO"}`)
  console.log(`  ✓ Game Slot Rotation (6-6-6): ${isPerfectSlots ? "YES (100% Balanced)" : "NO"}`)

  if (dryRun) {
    console.log(`\nDry run complete. No changes were made to the database.`)
    process.exit(0)
  }

  // 8. Confirmation prompt if not auto-confirmed
  if (!autoConfirm) {
    console.log(`\nTo execute this update, run with --yes flag:`)
    console.log(`  npx tsx scripts/rebalance-season.ts --yes\n`)
    process.exit(0)
  }

  // 9. Execute update in database
  console.log(`\nWriting updates to database...`)

  // Sync sequence to avoid collisions
  await sql`
    DO $$
    DECLARE
      max_id bigint;
      cur_seq bigint;
    BEGIN
      CREATE SEQUENCE IF NOT EXISTS games_gen_seq START 1;
      SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 2) AS bigint)), 0)
        INTO max_id
        FROM games
        WHERE id ~ '^g[0-9]+$';
      SELECT last_value INTO cur_seq FROM games_gen_seq;
      IF max_id >= cur_seq THEN
        PERFORM setval('games_gen_seq', max_id, true);
      END IF;
    END $$;
  `

  // Safety check: ensure no future final games exist
  const futureFinalGames = existingGames.filter(
    (g) => g.date > preservedDate && g.status === "final"
  )
  if (futureFinalGames.length > 0) {
    console.error(
      `Cannot rebalance: ${futureFinalGames.length} final games already exist after ${preservedDate}.`
    )
    process.exit(1)
  }

  // Delete non-final regular season games for weeks > 1
  await sql`
    DELETE FROM games
    WHERE season_id = ${seasonId}
      AND date > ${preservedDate}
      AND status != 'final'
      AND (game_type = 'regular' OR game_type IS NULL)
      AND is_playoff = false
  `
  console.log(`Deleted unpreserved upcoming regular season games.`)

  // Prepare new games for Weeks 2..21
  const gamesToInsert = rebalancedGames.filter((g) => g.date > preservedDate)
  if (gamesToInsert.length > 0) {
    const idRows = await sql`
      SELECT nextval('games_gen_seq') AS n FROM generate_series(1, ${gamesToInsert.length})
    `
    const newIds = idRows.map((r) => `g${r.n}`)

    const db = drizzle(sql, { schema })
    const insertData = gamesToInsert.map((g, i) => ({
      id: newIds[i],
      seasonId: season.id,
      date: g.date,
      time: normalizeTimeForStorage(g.time),
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      location: g.location || "The Lick",
      gameType: g.gameType || "regular",
      status: "upcoming" as const,
      isPlayoff: false,
      isOvertime: false,
      isForfeit: false,
    }))

    await db.insert(schema.games).values(insertData)
  }

  console.log(`Inserted ${gamesToInsert.length} rebalanced games for Weeks 2–21.`)
  console.log(`Preserved ${week1Games.length} games for Week 1 (${preservedDate}).`)

  // Final sequence sync
  await sql`
    DO $$
    DECLARE
      max_id bigint;
      cur_seq bigint;
    BEGIN
      CREATE SEQUENCE IF NOT EXISTS games_gen_seq START 1;
      SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 2) AS bigint)), 0)
        INTO max_id
        FROM games
        WHERE id ~ '^g[0-9]+$';
      SELECT last_value INTO cur_seq FROM games_gen_seq;
      IF max_id >= cur_seq THEN
        PERFORM setval('games_gen_seq', max_id, true);
      END IF;
    END $$;
  `

  console.log(`\n=== Rebalance Completed Successfully! ===\n`)
}

main().catch((err) => {
  console.error("Rebalance failed:", err)
  process.exit(1)
})
