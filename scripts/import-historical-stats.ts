import "./env"
import { rawSql } from "../lib/db"
import { sql } from "drizzle-orm"


const CSV_URL =
  "https://docs.google.com/spreadsheets/d/1D7yVyYqy2AVZRchLQExYcSZoqwUum8wsN6EuK0kZKm4/export?format=csv&gid=2023972233"

// Pre-Sportability seasons we want to import
const PRE_SPORTABILITY_SEASONS = new Set([
  "1991-92",
  "1992-93",
  "1993-94",
  "1994-95",
  "1995-96",
  "1996-97",
  "1997-98",
  "1998-99",
])

// Only the first 18 columns are player stats; remaining columns are unrelated pivot tables
const COLUMN_COUNT = 18

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim())
  if (lines.length === 0) return []
  const headers = lines[0].split(",").map((h) => h.trim()).slice(0, COLUMN_COUNT)
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim()).slice(0, COLUMN_COUNT)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = values[i] ?? ""
    })
    return row
  })
}

function toSeasonId(shortSeason: string): string {
  // "1991-92" -> "1991-1992"
  const [startYear, endShort] = shortSeason.split("-")
  const startCentury = startYear.substring(0, 2)
  const endYear = parseInt(endShort) < parseInt(startYear.substring(2))
    ? `${parseInt(startCentury) + 1}${endShort}`
    : `${startCentury}${endShort}`
  return `${startYear}-${endYear}`
}

function teamSlug(teamName: string): string {
  return teamName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function parseIntSafe(val: string): number {
  const n = parseInt(val)
  return isNaN(n) ? 0 : n
}

async function importHistoricalStats() {
  // console.log("Pushing schema via drizzle-kit...")
  // execSync("npx drizzle-kit push", { stdio: "inherit" })
  // console.log("Schema applied.")

  console.log("Fetching CSV from Google Sheets...")
  const response = await fetch(CSV_URL)
  if (!response.ok) throw new Error(`Failed to fetch CSV: ${response.status}`)
  const csvText = await response.text()
  const rows = parseCSV(csvText)
  console.log(`Parsed ${rows.length} total rows`)

  // Filter to pre-Sportability seasons only
  const historicalRows = rows.filter((r) => PRE_SPORTABILITY_SEASONS.has(r.Season))
  console.log(`Found ${historicalRows.length} pre-Sportability rows`)

  // Clear old data before re-importing (handles stale rows from previous bad imports)
  const seasonIdList = [...PRE_SPORTABILITY_SEASONS].map(toSeasonId)
  await rawSql(sql`DELETE FROM player_season_stats WHERE season_id IN ${seasonIdList}`)
  console.log("Cleared old player_season_stats for pre-Sportability seasons")

  // First, insert all seasons
  const seasonIds = new Set<string>()
  for (const row of historicalRows) {
    seasonIds.add(toSeasonId(row.Season))
  }
  for (const sid of seasonIds) {
    await rawSql(sql`
      INSERT INTO seasons (id, name, league_id, is_current, season_type)
      VALUES (${sid}, ${sid}, '', false, 'fall')
      ON CONFLICT (id) DO NOTHING
    `)
  }
  console.log(`Inserted ${seasonIds.size} seasons`)

  // Collect unique teams and players
  const teamsMap = new Map<string, string>() // slug -> name
  const playersSet = new Set<string>()

  for (const row of historicalRows) {
    const rawTeam = row.Team.split("/")[0].trim() // Use first team for trades
    const slug = teamSlug(rawTeam)
    if (!teamsMap.has(slug)) {
      teamsMap.set(slug, rawTeam)
    }
    playersSet.add(row.Player.trim())
  }

  // Insert teams
  for (const [slug, name] of teamsMap) {
    await rawSql(sql`INSERT INTO teams (slug, name) VALUES (${slug}, ${name}) ON CONFLICT (slug) DO NOTHING`)
  }
  console.log(`Inserted ${teamsMap.size} teams`)

  // Insert players
  for (const name of playersSet) {
    await rawSql(sql`INSERT INTO players (name) VALUES (${name}) ON CONFLICT (name) DO NOTHING`)
  }
  console.log(`Inserted ${playersSet.size} players`)

  // Fetch player IDs
  const playerRows = await rawSql(sql`SELECT id, name FROM players`)
  const playerIdMap = new Map<string, number>()
  for (const p of playerRows) {
    playerIdMap.set(p.name, p.id)
  }

  // Insert season_teams, player_seasons, and player_season_stats
  let statsCount = 0
  for (const row of historicalRows) {
    const seasonId = toSeasonId(row.Season)
    const rawTeam = row.Team.split("/")[0].trim()
    const tSlug = teamSlug(rawTeam)
    const playerName = row.Player.trim()
    const playerId = playerIdMap.get(playerName)
    if (!playerId) {
      console.warn(`Player not found: ${playerName}`)
      continue
    }

    const isPlayoff = row.Type === "Playoffs"

    // season_teams
    await rawSql(sql`
      INSERT INTO season_teams (season_id, team_slug)
      VALUES (${seasonId}, ${tSlug})
      ON CONFLICT DO NOTHING
    `)

    // player_seasons
    await rawSql(sql`
      INSERT INTO player_seasons (player_id, season_id, team_slug, is_goalie)
      VALUES (${playerId}, ${seasonId}, ${tSlug}, false)
      ON CONFLICT (player_id, season_id, team_slug) DO NOTHING
    `)

    // player_season_stats
    const gp = parseIntSafe(row.GP)
    const goals = parseIntSafe(row.G)
    const assists = parseIntSafe(row.A)
    const points = parseIntSafe(row.Pts)
    const gwg = parseIntSafe(row.GWG)
    const ppg = parseIntSafe(row.PPG)
    const shg = parseIntSafe(row.SHG)
    const eng = parseIntSafe(row.ENG)
    const hatTricks = parseIntSafe(row.Hat)
    const pen = parseIntSafe(row.Pen)
    const pim = parseIntSafe(row.PIM)

    await rawSql(sql`
      INSERT INTO player_season_stats (player_id, season_id, team_slug, is_playoff, gp, goals, assists, points, gwg, ppg, shg, eng, hat_tricks, pen, pim)
      VALUES (${playerId}, ${seasonId}, ${tSlug}, ${isPlayoff}, ${gp}, ${goals}, ${assists}, ${points}, ${gwg}, ${ppg}, ${shg}, ${eng}, ${hatTricks}, ${pen}, ${pim})
      ON CONFLICT (player_id, season_id, team_slug, is_playoff) DO UPDATE SET
        gp = EXCLUDED.gp, goals = EXCLUDED.goals, assists = EXCLUDED.assists, points = EXCLUDED.points,
        gwg = EXCLUDED.gwg, ppg = EXCLUDED.ppg, shg = EXCLUDED.shg, eng = EXCLUDED.eng,
        hat_tricks = EXCLUDED.hat_tricks, pen = EXCLUDED.pen, pim = EXCLUDED.pim
    `)
    statsCount++
  }

  console.log(`Inserted ${statsCount} player_season_stats rows`)
  console.log("Import complete!")
}

importHistoricalStats().catch(console.error)
