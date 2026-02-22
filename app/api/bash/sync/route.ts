import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

const BASE_URL = "https://secure.sportability.com/spx/Leagues"
const LEAGUE_ID = "50562"
const SEASON_ID = "2025-2026"
const MAX_BOXSCORES_PER_SYNC = 3

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim()
}

async function syncSchedule() {
  const url = `${BASE_URL}/Schedule.asp?LgID=${LEAGUE_ID}`
  const res = await fetch(url, { cache: "no-store" })
  const html = await res.text()

  const gamePattern = /GID=(\d+)/g
  const gameIds: string[] = []
  let match
  while ((match = gamePattern.exec(html)) !== null) {
    if (!gameIds.includes(match[1])) gameIds.push(match[1])
  }

  const updates: { id: string; homeScore: number; awayScore: number; isOT: boolean }[] = []
  const rows = html.split(/(?=GID=\d+)/)

  for (const row of rows) {
    const gidMatch = row.match(/GID=(\d+)/)
    if (!gidMatch) continue
    const gid = gidMatch[1]
    const text = stripHtml(row)
    const isOT = /\(OT\)/i.test(text)
    const atMatch = text.match(/(\d+)\s+@\s+.*?(\d+)/)
    if (atMatch) {
      const awayScore = parseInt(atMatch[1])
      const homeScore = parseInt(atMatch[2])
      if (!isNaN(awayScore) && !isNaN(homeScore)) {
        updates.push({ id: gid, homeScore, awayScore, isOT })
      }
    }
  }

  let updated = 0
  for (const u of updates) {
    await sql`
      UPDATE games
      SET home_score = ${u.homeScore}, away_score = ${u.awayScore},
          status = 'final', is_overtime = ${u.isOT}
      WHERE id = ${u.id} AND season_id = ${SEASON_ID}
        AND (home_score IS NULL OR home_score != ${u.homeScore} OR away_score != ${u.awayScore})
    `
    updated++
  }

  return { gamesChecked: gameIds.length, updatesApplied: updated }
}

async function syncBoxscore(gameId: string) {
  const url = `${BASE_URL}/Game.asp?LgID=${LEAGUE_ID}&GID=${gameId}`
  const res = await fetch(url, { cache: "no-store" })
  const html = await res.text()

  // Build team name → slug lookup
  const teamRows = await sql`SELECT slug, name FROM teams`
  const teamNameToSlug: Record<string, string> = {}
  for (const t of teamRows) {
    teamNameToSlug[t.name.toLowerCase()] = t.slug
  }

  // Parse officials: "Ref 1: Name", "Ref 2: Name", "Scorekeeper: Name"
  const refPattern = /Ref\s*\d*\s*:\s*([^<\n]+)/gi
  let refMatch
  const refs: string[] = []
  while ((refMatch = refPattern.exec(html)) !== null) {
    const name = stripHtml(refMatch[1]).trim()
    if (name && name.length > 1 && name.length < 50) refs.push(name)
  }

  const skPattern = /Scorekeeper\s*:\s*([^<\n]+)/gi
  let skMatch
  const scorekeepers: string[] = []
  while ((skMatch = skPattern.exec(html)) !== null) {
    const name = stripHtml(skMatch[1]).trim()
    if (name && name.length > 1 && name.length < 50) scorekeepers.push(name)
  }

  await sql`DELETE FROM game_officials WHERE game_id = ${gameId}`
  for (const ref of refs) {
    await sql`INSERT INTO game_officials (game_id, name, role) VALUES (${gameId}, ${ref}, 'ref')`
  }
  for (const sk of scorekeepers) {
    await sql`INSERT INTO game_officials (game_id, name, role) VALUES (${gameId}, ${sk}, 'scorekeeper')`
  }

  // Find all tables
  const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi
  const tables: string[] = []
  let tableMatch
  while ((tableMatch = tablePattern.exec(html)) !== null) {
    tables.push(tableMatch[0])
  }

  for (const tableHtml of tables) {
    const trs: string[] = []
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let trMatch
    while ((trMatch = rowPattern.exec(tableHtml)) !== null) {
      trs.push(trMatch[1])
    }
    if (trs.length < 2) continue

    const firstRowText = stripHtml(trs[0]).toLowerCase()

    // PLAYER STATS TABLE
    // Both teams are in ONE table, separated by team header rows where
    // cell[0] is "{TeamName} Players" and cell[1] is "GP", etc.
    if (firstRowText.includes("player stats")) {
      let currentTeamSlug: string | null = null

      for (let i = 1; i < trs.length; i++) {
        const cells = trs[i].match(/<td[^>]*>([\s\S]*?)<\/td>/gi)
        if (!cells || cells.length < 2) continue

        const cell0Text = stripHtml(cells[0])

        // Check if this is a team header row: cell[0] = "{TeamName} Players"
        if (/\bPlayers$/i.test(cell0Text)) {
          const teamMatch = cell0Text.match(/^(.+?)\s+Players$/i)
          if (teamMatch) {
            const teamName = teamMatch[1].trim().toLowerCase()
            currentTeamSlug = teamNameToSlug[teamName] || null
          }
          continue
        }

        if (!currentTeamSlug) continue
        if (cells.length < 5) continue

        const playerName = cell0Text
        if (!playerName || /total/i.test(playerName) || /^(&nbsp;|\s*)$/.test(playerName)) continue

        // Columns: [0]Player, [1]GP, [2]G, [3]A, [4]Pts, [5]PtsPG, [6]GWG, [7]PPG, [8]SHG, [9]ENG, [10]Hat, [11]PMkr, [12]Star, [13]Pen, [14]PIM
        const goals = parseInt(stripHtml(cells[2])) || 0
        const assists = parseInt(stripHtml(cells[3])) || 0
        const points = parseInt(stripHtml(cells[4])) || 0
        const gwg = cells.length > 6 ? parseInt(stripHtml(cells[6])) || 0 : 0
        const ppg = cells.length > 7 ? parseInt(stripHtml(cells[7])) || 0 : 0
        const shg = cells.length > 8 ? parseInt(stripHtml(cells[8])) || 0 : 0
        const eng = cells.length > 9 ? parseInt(stripHtml(cells[9])) || 0 : 0
        const hatRaw = cells.length > 10 ? stripHtml(cells[10]) : ""
        const hat = hatRaw === "Hat" ? 1 : parseInt(hatRaw) || 0
        const pen = cells.length > 13 ? parseInt(stripHtml(cells[13])) || 0 : 0
        const pim = cells.length > 14 ? parseInt(stripHtml(cells[14])) || 0 : 0

        const playerRows = await sql`
          INSERT INTO players (name) VALUES (${playerName})
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `
        const playerId = playerRows[0].id

        await sql`
          INSERT INTO player_seasons (player_id, season_id, team_slug, is_goalie)
          VALUES (${playerId}, ${SEASON_ID}, ${currentTeamSlug}, false)
          ON CONFLICT (player_id, season_id) DO NOTHING
        `

        await sql`
          INSERT INTO player_game_stats (player_id, game_id, goals, assists, points, gwg, ppg, shg, eng, hat_tricks, pen, pim)
          VALUES (${playerId}, ${gameId}, ${goals}, ${assists}, ${points}, ${gwg}, ${ppg}, ${shg}, ${eng}, ${hat}, ${pen}, ${pim})
          ON CONFLICT (player_id, game_id) DO UPDATE SET
            goals = EXCLUDED.goals, assists = EXCLUDED.assists, points = EXCLUDED.points,
            gwg = EXCLUDED.gwg, ppg = EXCLUDED.ppg, shg = EXCLUDED.shg,
            eng = EXCLUDED.eng, hat_tricks = EXCLUDED.hat_tricks,
            pen = EXCLUDED.pen, pim = EXCLUDED.pim
        `
      }
    }

    // GOALIE STATS TABLE
    // Both teams in ONE table, separated by rows where cell[0] = "{TeamName} Goalies"
    if (firstRowText.includes("goalie stats")) {
      let currentTeamSlug: string | null = null

      for (let i = 1; i < trs.length; i++) {
        const cells = trs[i].match(/<td[^>]*>([\s\S]*?)<\/td>/gi)
        if (!cells || cells.length < 2) continue

        const cell0Text = stripHtml(cells[0])

        // Check if this is a team header row: cell[0] = "{TeamName} Goalies"
        if (/\bGoalies$/i.test(cell0Text)) {
          const teamMatch = cell0Text.match(/^(.+?)\s+Goalies$/i)
          if (teamMatch) {
            const teamName = teamMatch[1].trim().toLowerCase()
            currentTeamSlug = teamNameToSlug[teamName] || null
          }
          continue
        }

        if (!currentTeamSlug) continue
        if (cells.length < 7) continue

        const playerName = cell0Text
        if (!playerName || /total/i.test(playerName) || /^(&nbsp;|\s*)$/.test(playerName)) continue

        // Columns: [0]Player, [1]GP, [2]Min, [3]GA, [4]GAA, [5]Shots, [6]Saves, [7]Sv%, [8]SO, [9]A, [10]Star, [11]Pen, [12]PIM, [13]Result
        const minutes = parseInt(stripHtml(cells[2])) || 0
        const ga = parseInt(stripHtml(cells[3])) || 0
        const shotsAgainst = parseInt(stripHtml(cells[5])) || 0
        const saves = parseInt(stripHtml(cells[6])) || 0
        const shutouts = cells.length > 8 ? parseInt(stripHtml(cells[8])) || 0 : 0
        const goalieAssists = cells.length > 9 ? parseInt(stripHtml(cells[9])) || 0 : 0
        const resultCell = cells.length > 13 ? stripHtml(cells[13]) : stripHtml(cells[cells.length - 1])
        const result = resultCell === "W" || resultCell === "L" ? resultCell : null

        const playerRows = await sql`
          INSERT INTO players (name) VALUES (${playerName})
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `
        const playerId = playerRows[0].id

        await sql`
          INSERT INTO player_seasons (player_id, season_id, team_slug, is_goalie)
          VALUES (${playerId}, ${SEASON_ID}, ${currentTeamSlug}, true)
          ON CONFLICT (player_id, season_id) DO UPDATE SET is_goalie = true
        `

        await sql`
          INSERT INTO goalie_game_stats (player_id, game_id, minutes, goals_against, shots_against, saves, shutouts, goalie_assists, result)
          VALUES (${playerId}, ${gameId}, ${minutes}, ${ga}, ${shotsAgainst}, ${saves}, ${shutouts}, ${goalieAssists}, ${result})
          ON CONFLICT (player_id, game_id) DO UPDATE SET
            minutes = EXCLUDED.minutes, goals_against = EXCLUDED.goals_against,
            shots_against = EXCLUDED.shots_against, saves = EXCLUDED.saves,
            shutouts = EXCLUDED.shutouts, goalie_assists = EXCLUDED.goalie_assists,
            result = EXCLUDED.result
        `
      }
    }
  }

  await sql`UPDATE games SET has_boxscore = true WHERE id = ${gameId}`
}

export async function GET() {
  try {
    const scheduleResult = await syncSchedule()

    const gamesNeedingBoxscore = await sql`
      SELECT id FROM games
      WHERE season_id = ${SEASON_ID}
        AND status = 'final'
        AND has_boxscore = false
      ORDER BY date ASC
      LIMIT ${MAX_BOXSCORES_PER_SYNC}
    `

    let boxscoresSynced = 0
    for (const game of gamesNeedingBoxscore) {
      try {
        await syncBoxscore(game.id)
        boxscoresSynced++
      } catch (err) {
        console.error(`Failed to sync boxscore for game ${game.id}:`, err)
      }
    }

    await sql`
      INSERT INTO sync_metadata (key, value)
      VALUES ('last_sync', ${new Date().toISOString()})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `

    return NextResponse.json({
      ok: true,
      schedule: scheduleResult,
      boxscoresSynced,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Sync failed:", error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
