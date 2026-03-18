import "./env"
import { rawSql } from "../lib/db"
import { sql } from "drizzle-orm"

async function addTestGame() {
  const id = "test-game-001"
  const seasonId = "2025-2026"
  const date = "2026-03-21"
  const time = "6:00a"
  const homeTeam = "seals"
  const awayTeam = "reign"

  await rawSql(sql`
    INSERT INTO games (id, season_id, date, time, home_team, away_team, status, location)
    VALUES (${id}, ${seasonId}, ${date}, ${time}, ${homeTeam}, ${awayTeam}, 'upcoming', 'James Lick Arena')
    ON CONFLICT (id) DO UPDATE SET
      date = EXCLUDED.date,
      time = EXCLUDED.time,
      home_team = EXCLUDED.home_team,
      away_team = EXCLUDED.away_team,
      status = 'upcoming',
      home_score = NULL,
      away_score = NULL,
      has_boxscore = false
  `)

  // Clean up any existing live state so it can be re-started
  await rawSql(sql`DELETE FROM game_live WHERE game_id = ${id}`)

  console.log(`✅ Test game added: ${awayTeam} @ ${homeTeam} on ${date} at ${time}`)
  console.log(`   Game ID: ${id}`)
  console.log(`   Visit /scorekeeper to use it`)
}

addTestGame().catch(console.error)
