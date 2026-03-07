import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getCurrentSeason, getSeasonById, getAllSeasons } from "@/lib/seasons"

const BASE_URL = "https://secure.sportability.com/spx/Leagues"
const MAX_BOXSCORES_PER_SYNC = 8

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim()
}

function nameToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

// Sync scores for games already in the DB (current season quick sync)
async function syncScheduleScores(leagueId: string, seasonId: string) {
  const url = `${BASE_URL}/Schedule.asp?LgID=${leagueId}`
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
    const atMatch = text.match(/(\d+)\s+at\s+.*?(\d+)/i)
    if (atMatch) {
      const awayScore = parseInt(atMatch[1])
      const homeScore = parseInt(atMatch[2])
      if (!isNaN(awayScore) && !isNaN(homeScore)) {
        updates.push({ id: gid, homeScore, awayScore, isOT })
      }
    }
  }

  // Skip games managed by scorekeeper
  const liveGames = await sql`SELECT game_id FROM game_live`
  const liveGameIds = new Set(liveGames.map((r) => r.game_id))

  let updated = 0
  for (const u of updates) {
    if (liveGameIds.has(u.id)) continue
    await sql`
      UPDATE games
      SET home_score = ${u.homeScore}, away_score = ${u.awayScore},
          status = 'final', is_overtime = ${u.isOT}
      WHERE id = ${u.id} AND season_id = ${seasonId}
        AND (home_score IS NULL OR home_score != ${u.homeScore} OR away_score != ${u.awayScore})
    `
    updated++
  }

  return { gamesChecked: gameIds.length, updatesApplied: updated }
}

// Full schedule sync: parse all games from a schedule page and create them
// Schedule pages use table rows: <td>Date</td> <td>Time</td> <td><a href="...GID=X">Away Score at Home Score</a></td>
async function syncFullSchedule(leagueId: string, seasonId: string) {
  const url = `${BASE_URL}/Schedule.asp?LgID=${leagueId}`
  const res = await fetch(url, { cache: "no-store" })
  const html = await res.text()

  // Ensure season exists in DB
  const season = getSeasonById(seasonId)
  if (!season) throw new Error(`Unknown season: ${seasonId}`)

  await sql`
    INSERT INTO seasons (id, name, league_id, is_current, season_type)
    VALUES (${season.id}, ${season.name}, ${season.leagueId}, false, ${season.seasonType})
    ON CONFLICT (id) DO UPDATE SET season_type = EXCLUDED.season_type
  `

  // Parse table rows — each <tr> with GID= is a game
  const rowPattern = /<tr[^>]*class="tablecontent"[^>]*>([\s\S]*?)<\/tr>/gi
  const rows: string[] = []
  let rowMatch
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    rows.push(rowMatch[1])
  }

  // Build existing team lookup
  const existingTeams = await sql`SELECT slug, name FROM teams`
  const teamNameToSlug: Record<string, string> = {}
  for (const t of existingTeams) {
    teamNameToSlug[t.name.toLowerCase()] = t.slug
  }

  // Skip score updates for games managed by scorekeeper
  const liveGames = await sql`SELECT game_id FROM game_live`
  const liveGameIds = new Set(liveGames.map((r) => r.game_id))

  let currentDate = ""
  let gamesCreated = 0
  let gamesFound = 0

  for (const row of rows) {
    // Must have a game link
    const gidMatch = row.match(/GID=(\d+)/)
    if (!gidMatch) continue

    const gid = gidMatch[1]
    gamesFound++

    // Extract cells
    const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi
    const cells: string[] = []
    let cellMatch
    while ((cellMatch = cellPattern.exec(row)) !== null) {
      cells.push(cellMatch[1])
    }

    // Find date from any cell that has M/D/YYYY pattern
    for (const cell of cells) {
      const dateText = stripHtml(cell).trim()
      const dateParsed = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
      if (dateParsed) {
        const [, month, day, year] = dateParsed
        currentDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
        break
      }
    }

    if (!currentDate) continue

    // Find time from the cell with a time pattern (before the game cell)
    let time = "TBD"
    for (const cell of cells) {
      const t = stripHtml(cell).replace(/&nbsp;/g, "").trim()
      if (/^\d{1,2}:\d{2}[ap]$/.test(t)) { time = t; break }
    }

    // Find the game cell — the one containing the GID link
    let gameCellHtml = ""
    for (const cell of cells) {
      if (/GID=/.test(cell)) { gameCellHtml = cell; break }
    }
    const gameText = stripHtml(gameCellHtml).trim()

    const isPlayoff = /\(Pla\)/i.test(gameText)
    const isOT = /Overtime|ShootOut/i.test(gameCellHtml)

    // Parse "Away Score at Home Score"
    const cleanText = gameText.replace(/^\(Pla\)\s*/i, "").replace(/\(Overtime\)|\(ShootOut\)|\(Shutout\)|\(If Necessary\)/gi, "").trim()

    const scoreMatch = cleanText.match(/^(.+?)\s+(\d+)\s+at\s+(.+?)\s+(\d+)$/)
    const upcomingMatch = !scoreMatch ? cleanText.match(/^(.+?)\s+at\s+(.+?)$/) : null

    let awayName: string | null = null
    let homeName: string | null = null
    let awayScore: number | null = null
    let homeScore: number | null = null
    let status = "upcoming"

    if (scoreMatch) {
      awayName = scoreMatch[1].trim()
      awayScore = parseInt(scoreMatch[2])
      homeName = scoreMatch[3].trim()
      homeScore = parseInt(scoreMatch[4])
      status = "final"
    } else if (upcomingMatch) {
      awayName = upcomingMatch[1].trim()
      homeName = upcomingMatch[2].trim()
    }

    if (!awayName || !homeName || awayName.length < 2 || homeName.length < 2) continue

    // Find location cell — look for a cell containing "Arena" or "Rink" etc.
    let location = "James Lick Arena"
    for (const cell of cells) {
      const loc = stripHtml(cell).trim()
      if (loc && /arena|rink|center|park|field/i.test(loc)) { location = loc; break }
    }

    // Look up or create teams
    let awaySlug = teamNameToSlug[awayName.toLowerCase()]
    if (!awaySlug) {
      awaySlug = nameToSlug(awayName)
      await sql`INSERT INTO teams (slug, name) VALUES (${awaySlug}, ${awayName}) ON CONFLICT (slug) DO NOTHING`
      teamNameToSlug[awayName.toLowerCase()] = awaySlug
    }

    let homeSlug = teamNameToSlug[homeName.toLowerCase()]
    if (!homeSlug) {
      homeSlug = nameToSlug(homeName)
      await sql`INSERT INTO teams (slug, name) VALUES (${homeSlug}, ${homeName}) ON CONFLICT (slug) DO NOTHING`
      teamNameToSlug[homeName.toLowerCase()] = homeSlug
    }

    // Ensure season_teams entries
    await sql`INSERT INTO season_teams (season_id, team_slug) VALUES (${seasonId}, ${awaySlug}) ON CONFLICT DO NOTHING`
    await sql`INSERT INTO season_teams (season_id, team_slug) VALUES (${seasonId}, ${homeSlug}) ON CONFLICT DO NOTHING`

    // Upsert game (don't overwrite scores for scorekeeper-managed games)
    if (liveGameIds.has(gid)) {
      await sql`
        INSERT INTO games (id, season_id, date, time, away_team, home_team, away_score, home_score, status, is_overtime, is_playoff, location, has_boxscore)
        VALUES (${gid}, ${seasonId}, ${currentDate}, ${time}, ${awaySlug}, ${homeSlug}, ${awayScore}, ${homeScore}, ${status}, ${isOT}, ${isPlayoff}, ${location}, false)
        ON CONFLICT (id) DO NOTHING
      `
    } else {
      await sql`
        INSERT INTO games (id, season_id, date, time, away_team, home_team, away_score, home_score, status, is_overtime, is_playoff, location, has_boxscore)
        VALUES (${gid}, ${seasonId}, ${currentDate}, ${time}, ${awaySlug}, ${homeSlug}, ${awayScore}, ${homeScore}, ${status}, ${isOT}, ${isPlayoff}, ${location}, false)
        ON CONFLICT (id) DO UPDATE SET
          away_score = EXCLUDED.away_score,
          home_score = EXCLUDED.home_score,
          status = EXCLUDED.status,
          is_overtime = EXCLUDED.is_overtime
      `
    }
    gamesCreated++
  }

  return { gamesFound, gamesCreated }
}

async function syncBoxscore(gameId: string, leagueId: string, seasonId: string) {
  // Skip games managed by scorekeeper
  const liveCheck = await sql`SELECT 1 FROM game_live WHERE game_id = ${gameId}`
  if (liveCheck.length > 0) return

  const url = `${BASE_URL}/Game.asp?LgID=${leagueId}&GID=${gameId}`
  const res = await fetch(url, { cache: "no-store" })
  const html = await res.text()

  let hasAnyStats = false

  // Build team name → slug lookup
  const teamRows = await sql`SELECT slug, name FROM teams`
  const teamNameToSlug: Record<string, string> = {}
  for (const t of teamRows) {
    teamNameToSlug[t.name.toLowerCase()] = t.slug
  }

  // Parse officials
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
    if (firstRowText.includes("player stats")) {
      let currentTeamSlug: string | null = null
      let statsInserted = false

      for (let i = 1; i < trs.length; i++) {
        const cells = trs[i].match(/<td[^>]*>([\s\S]*?)<\/td>/gi)
        if (!cells || cells.length < 2) continue

        const cell0Text = stripHtml(cells[0])

        if (/\bPlayers$/i.test(cell0Text)) {
          const teamMatch = cell0Text.match(/^(.+?)\s+Players$/i)
          if (teamMatch) {
            const teamName = teamMatch[1].trim().toLowerCase()
            currentTeamSlug = teamNameToSlug[teamName] || null
            // Auto-create team if not found
            if (!currentTeamSlug) {
              const slug = nameToSlug(teamMatch[1].trim())
              await sql`INSERT INTO teams (slug, name) VALUES (${slug}, ${teamMatch[1].trim()}) ON CONFLICT (slug) DO NOTHING`
              await sql`INSERT INTO season_teams (season_id, team_slug) VALUES (${seasonId}, ${slug}) ON CONFLICT DO NOTHING`
              teamNameToSlug[teamName] = slug
              currentTeamSlug = slug
            }
          }
          continue
        }

        if (!currentTeamSlug) continue
        if (cells.length < 5) continue

        const playerName = cell0Text
        if (!playerName || /total/i.test(playerName) || /^(&nbsp;|\s*)$/.test(playerName)) continue

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
          VALUES (${playerId}, ${seasonId}, ${currentTeamSlug}, false)
          ON CONFLICT (player_id, season_id, team_slug) DO NOTHING
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
        statsInserted = true
      }

      if (statsInserted) hasAnyStats = true
    }

    // GOALIE STATS TABLE
    if (firstRowText.includes("goalie stats")) {
      let currentTeamSlug: string | null = null
      let statsInserted = false
      // Detect column order from header row (older seasons have Saves before Shots)
      let savesCol = 6
      let shotsCol = 5

      for (let i = 1; i < trs.length; i++) {
        const cells = trs[i].match(/<td[^>]*>([\s\S]*?)<\/td>/gi)
        if (!cells || cells.length < 2) continue

        const cell0Text = stripHtml(cells[0])

        // Detect header row to determine column order
        if (cells.length >= 7 && /^(gp|games)$/i.test(stripHtml(cells[1]))) {
          for (let c = 0; c < cells.length; c++) {
            const hdr = stripHtml(cells[c]).toLowerCase()
            if (hdr === "saves" || hdr === "svs") savesCol = c
            if (hdr === "shots" || hdr === "sa") shotsCol = c
          }
          continue
        }

        if (/\bGoalies$/i.test(cell0Text)) {
          const teamMatch = cell0Text.match(/^(.+?)\s+Goalies$/i)
          if (teamMatch) {
            const teamName = teamMatch[1].trim().toLowerCase()
            currentTeamSlug = teamNameToSlug[teamName] || null
            if (!currentTeamSlug) {
              const slug = nameToSlug(teamMatch[1].trim())
              await sql`INSERT INTO teams (slug, name) VALUES (${slug}, ${teamMatch[1].trim()}) ON CONFLICT (slug) DO NOTHING`
              await sql`INSERT INTO season_teams (season_id, team_slug) VALUES (${seasonId}, ${slug}) ON CONFLICT DO NOTHING`
              teamNameToSlug[teamName] = slug
              currentTeamSlug = slug
            }
          }
          continue
        }

        if (!currentTeamSlug) continue
        if (cells.length < 7) continue

        const playerName = cell0Text
        if (!playerName || /total/i.test(playerName) || /^(&nbsp;|\s*)$/.test(playerName)) continue

        const minutes = parseInt(stripHtml(cells[2])) || 0
        const ga = parseInt(stripHtml(cells[3])) || 0
        const shotsAgainst = parseInt(stripHtml(cells[shotsCol])) || 0
        const saves = parseInt(stripHtml(cells[savesCol])) || 0
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
          VALUES (${playerId}, ${seasonId}, ${currentTeamSlug}, true)
          ON CONFLICT (player_id, season_id, team_slug) DO NOTHING
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
        statsInserted = true
      }

      if (statsInserted) hasAnyStats = true
    }
  }

  if (hasAnyStats) {
    await sql`UPDATE games SET has_boxscore = true WHERE id = ${gameId}`
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const seasonParam = searchParams.get("seasonId")
    const scheduleOnly = searchParams.get("scheduleOnly") === "true"
    const boxscoreLimit = parseInt(searchParams.get("boxscoreLimit") || "0") || (scheduleOnly ? 0 : 999)

    // If a specific season is requested, do a full sync for that season
    if (seasonParam) {
      const season = getSeasonById(seasonParam)
      if (!season) {
        return NextResponse.json({ ok: false, error: `Unknown season: ${seasonParam}` }, { status: 400 })
      }

      // Full schedule sync (creates games from scratch)
      const scheduleResult = await syncFullSchedule(season.leagueId, season.id)

      // Sync boxscores — skip if scheduleOnly, limited for current season
      const limit = scheduleOnly ? 0 : (season.id === getCurrentSeason().id ? MAX_BOXSCORES_PER_SYNC : boxscoreLimit)
      let boxscoresSynced = 0
      let boxscoresRemaining = 0

      if (limit > 0) {
        const gamesNeedingBoxscore = await sql`
          SELECT id FROM games
          WHERE season_id = ${season.id}
            AND status = 'final'
            AND has_boxscore = false
          ORDER BY date ASC
          LIMIT ${limit}
        `

        for (const game of gamesNeedingBoxscore) {
          try {
            await syncBoxscore(game.id, season.leagueId, season.id)
            boxscoresSynced++
          } catch (err) {
            console.error(`Failed to sync boxscore for game ${game.id}:`, err)
          }
        }
      }

      const remaining = await sql`
        SELECT count(*)::int as count FROM games
        WHERE season_id = ${season.id} AND status = 'final' AND has_boxscore = false
      `
      boxscoresRemaining = remaining[0].count

      return NextResponse.json({
        ok: true,
        season: season.id,
        schedule: scheduleResult,
        boxscoresSynced,
        boxscoresRemaining,
        timestamp: new Date().toISOString(),
      })
    }

    // Default: sync current season (quick mode — just update scores + boxscores)
    const current = getCurrentSeason()
    const scheduleResult = await syncScheduleScores(current.leagueId, current.id)

    const gamesNeedingBoxscore = await sql`
      SELECT id FROM games
      WHERE season_id = ${current.id}
        AND status = 'final'
        AND has_boxscore = false
      ORDER BY date ASC
      LIMIT ${MAX_BOXSCORES_PER_SYNC}
    `

    const boxscoreResults = await Promise.allSettled(
      gamesNeedingBoxscore.map((game: { id: string }) =>
        syncBoxscore(game.id, current.leagueId, current.id)
      )
    )
    const boxscoresSynced = boxscoreResults.filter(r => r.status === 'fulfilled').length
    boxscoreResults.filter(r => r.status === 'rejected').forEach((r, i) => {
      console.error(`Failed to sync boxscore for game ${gamesNeedingBoxscore[i].id}:`, (r as PromiseRejectedResult).reason)
    })

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
