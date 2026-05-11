/**
 * Sync a specific season's schedule + boxscores directly from Sportability.
 * Usage: npx tsx scripts/sync-season.ts <seasonId>
 * Example: npx tsx scripts/sync-season.ts 2024-2025
 */
import "./env"
import { rawSql } from "../lib/db"
import { sql } from "drizzle-orm"

const BASE_URL = "https://secure.sportability.com/spx/Leagues"

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim()
}

function nameToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

async function syncFullSchedule(leagueId: string, seasonId: string) {
  const url = `${BASE_URL}/Schedule.asp?LgID=${leagueId}`
  const res = await fetch(url, { cache: "no-store" })
  const regularHtml = await res.text()

  const playoffUrl = `${BASE_URL}/Schedule.asp?GT=P&LgID=${leagueId}`
  const playoffRes = await fetch(playoffUrl, { cache: "no-store" })
  const playoffHtml = await playoffRes.text()

  const html = regularHtml + playoffHtml

  const existingTeams = await rawSql(sql`SELECT slug, name FROM teams`)
  const teamNameToSlug: Record<string, string> = {}
  for (const t of existingTeams) {
    teamNameToSlug[t.name.toLowerCase()] = t.slug
  }

  const rowPattern = /<tr[^>]*class="tablecontent"[^>]*>([\s\S]*?)<\/tr>/gi
  const rows: string[] = []
  let rowMatch
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    rows.push(rowMatch[1])
  }

  let currentDate = ""
  let gamesCreated = 0

  for (const row of rows) {
    const gidMatch = row.match(/GID=(\d+)/)
    if (!gidMatch) continue

    const gid = gidMatch[1]
    const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi
    const cells: string[] = []
    let cellMatch
    while ((cellMatch = cellPattern.exec(row)) !== null) {
      cells.push(cellMatch[1])
    }

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

    let time = "TBD"
    for (const cell of cells) {
      const t = stripHtml(cell).replace(/&nbsp;/g, "").trim()
      if (/^\d{1,2}:\d{2}[ap]$/.test(t)) { time = t; break }
    }

    let gameCellHtml = ""
    for (const cell of cells) {
      if (/GID=/.test(cell)) { gameCellHtml = cell; break }
    }
    const gameText = stripHtml(gameCellHtml).trim()
    const isPlayoff = /\(Pla\)/i.test(gameText)
    const isOT = /Overtime|ShootOut/i.test(gameCellHtml)
    const isForfeit = /\((?:Dbl\s+)?Forfeit\)/i.test(gameText)

    const cleanText = gameText.replace(/^\(Pla\)\s*/i, "").replace(/\s*\((?:Overtime|ShootOut|Shutout|If Necessary|Dbl Forfeit|Forfeit|Canceled|Cancelled)\)/gi, "").trim()
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

    let location = "The Lick"
    for (const cell of cells) {
      if (cell === gameCellHtml) continue
      const loc = stripHtml(cell).trim()
      if (loc && /arena|rink|center|park|field/i.test(loc)) { location = loc; break }
    }

    let awaySlug = teamNameToSlug[awayName.toLowerCase()]
    if (!awaySlug) {
      awaySlug = nameToSlug(awayName)
      await rawSql(sql`INSERT INTO teams (slug, name) VALUES (${awaySlug}, ${awayName}) ON CONFLICT (slug) DO NOTHING`)
      teamNameToSlug[awayName.toLowerCase()] = awaySlug
    }
    let homeSlug = teamNameToSlug[homeName.toLowerCase()]
    if (!homeSlug) {
      homeSlug = nameToSlug(homeName)
      await rawSql(sql`INSERT INTO teams (slug, name) VALUES (${homeSlug}, ${homeName}) ON CONFLICT (slug) DO NOTHING`)
      teamNameToSlug[homeName.toLowerCase()] = homeSlug
    }

    await rawSql(sql`INSERT INTO season_teams (season_id, team_slug) VALUES (${seasonId}, ${awaySlug}) ON CONFLICT DO NOTHING`)
    await rawSql(sql`INSERT INTO season_teams (season_id, team_slug) VALUES (${seasonId}, ${homeSlug}) ON CONFLICT DO NOTHING`)

    await rawSql(sql`
      INSERT INTO games (id, season_id, date, time, away_team, home_team, away_score, home_score, status, is_overtime, is_playoff, is_forfeit, location, has_boxscore)
      VALUES (${gid}, ${seasonId}, ${currentDate}, ${time}, ${awaySlug}, ${homeSlug}, ${awayScore}, ${homeScore}, ${status}, ${isOT}, ${isPlayoff}, ${isForfeit}, ${location}, false)
      ON CONFLICT (id) DO UPDATE SET
        away_score = EXCLUDED.away_score, home_score = EXCLUDED.home_score,
        status = EXCLUDED.status, is_overtime = EXCLUDED.is_overtime, is_playoff = EXCLUDED.is_playoff,
        is_forfeit = EXCLUDED.is_forfeit
    `)
    gamesCreated++
  }

  return gamesCreated
}

async function syncBoxscore(gameId: string, leagueId: string, seasonId: string) {
  const url = `${BASE_URL}/Game.asp?LgID=${leagueId}&GID=${gameId}`
  const res = await fetch(url, { cache: "no-store" })
  const html = await res.text()

  let hasAnyStats = false
  const teamRows = await rawSql(sql`SELECT slug, name FROM teams`)
  const teamNameToSlug: Record<string, string> = {}
  for (const t of teamRows) {
    teamNameToSlug[t.name.toLowerCase()] = t.slug
  }

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
            if (!currentTeamSlug) {
              const slug = nameToSlug(teamMatch[1].trim())
              await rawSql(sql`INSERT INTO teams (slug, name) VALUES (${slug}, ${teamMatch[1].trim()}) ON CONFLICT (slug) DO NOTHING`)
              await rawSql(sql`INSERT INTO season_teams (season_id, team_slug) VALUES (${seasonId}, ${slug}) ON CONFLICT DO NOTHING`)
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

        const playerRows = await rawSql(sql`
          INSERT INTO players (name) VALUES (${playerName})
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `)
        const playerId = playerRows[0].id
        await rawSql(sql`INSERT INTO player_seasons (player_id, season_id, team_slug, is_goalie) VALUES (${playerId}, ${seasonId}, ${currentTeamSlug}, false) ON CONFLICT (player_id, season_id, team_slug) DO NOTHING`)
        await rawSql(sql`
          INSERT INTO player_game_stats (player_id, game_id, goals, assists, points, gwg, ppg, shg, eng, hat_tricks, pen, pim)
          VALUES (${playerId}, ${gameId}, ${goals}, ${assists}, ${points}, ${gwg}, ${ppg}, ${shg}, ${eng}, ${hat}, ${pen}, ${pim})
          ON CONFLICT (player_id, game_id) DO UPDATE SET
            goals = EXCLUDED.goals, assists = EXCLUDED.assists, points = EXCLUDED.points,
            gwg = EXCLUDED.gwg, ppg = EXCLUDED.ppg, shg = EXCLUDED.shg,
            eng = EXCLUDED.eng, hat_tricks = EXCLUDED.hat_tricks, pen = EXCLUDED.pen, pim = EXCLUDED.pim
        `)
        statsInserted = true
      }
      if (statsInserted) hasAnyStats = true
    }

    if (firstRowText.includes("goalie stats")) {
      let currentTeamSlug: string | null = null
      let statsInserted = false

      for (let i = 1; i < trs.length; i++) {
        const cells = trs[i].match(/<td[^>]*>([\s\S]*?)<\/td>/gi)
        if (!cells || cells.length < 2) continue
        const cell0Text = stripHtml(cells[0])
        if (/\bGoalies$/i.test(cell0Text)) {
          const teamMatch = cell0Text.match(/^(.+?)\s+Goalies$/i)
          if (teamMatch) {
            const teamName = teamMatch[1].trim().toLowerCase()
            currentTeamSlug = teamNameToSlug[teamName] || null
            if (!currentTeamSlug) {
              const slug = nameToSlug(teamMatch[1].trim())
              await rawSql(sql`INSERT INTO teams (slug, name) VALUES (${slug}, ${teamMatch[1].trim()}) ON CONFLICT (slug) DO NOTHING`)
              await rawSql(sql`INSERT INTO season_teams (season_id, team_slug) VALUES (${seasonId}, ${slug}) ON CONFLICT DO NOTHING`)
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

        const seconds = (parseInt(stripHtml(cells[2])) || 0) * 60
        const ga = parseInt(stripHtml(cells[3])) || 0
        const shotsAgainst = parseInt(stripHtml(cells[5])) || 0
        const saves = parseInt(stripHtml(cells[6])) || 0
        const shutouts = cells.length > 8 ? parseInt(stripHtml(cells[8])) || 0 : 0
        const goalieAssists = cells.length > 9 ? parseInt(stripHtml(cells[9])) || 0 : 0
        const resultCell = cells.length > 13 ? stripHtml(cells[13]) : stripHtml(cells[cells.length - 1])
        const result = resultCell === "W" || resultCell === "L" ? resultCell : null

        const playerRows = await rawSql(sql`
          INSERT INTO players (name) VALUES (${playerName})
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `)
        const playerId = playerRows[0].id
        await rawSql(sql`INSERT INTO player_seasons (player_id, season_id, team_slug, is_goalie) VALUES (${playerId}, ${seasonId}, ${currentTeamSlug}, true) ON CONFLICT (player_id, season_id, team_slug) DO NOTHING`)
        await rawSql(sql`
          INSERT INTO goalie_game_stats (player_id, game_id, seconds, goals_against, shots_against, saves, shutouts, goalie_assists, result)
          VALUES (${playerId}, ${gameId}, ${seconds}, ${ga}, ${shotsAgainst}, ${saves}, ${shutouts}, ${goalieAssists}, ${result})
          ON CONFLICT (player_id, game_id) DO UPDATE SET
            seconds = EXCLUDED.seconds, goals_against = EXCLUDED.goals_against,
            shots_against = EXCLUDED.shots_against, saves = EXCLUDED.saves,
            shutouts = EXCLUDED.shutouts, goalie_assists = EXCLUDED.goalie_assists, result = EXCLUDED.result
        `)
        statsInserted = true
      }
      if (statsInserted) hasAnyStats = true
    }
  }

  if (hasAnyStats) {
    await rawSql(sql`UPDATE games SET has_boxscore = true WHERE id = ${gameId}`)
  }
}

// Concurrency pool
const CONCURRENCY = 10
async function runPool<T>(items: T[], fn: (item: T) => Promise<void>) {
  let i = 0, running = 0, done = 0, failed = 0
  return new Promise<{ done: number; failed: number }>((resolve) => {
    function next() {
      while (running < CONCURRENCY && i < items.length) {
        const item = items[i++]
        running++
        fn(item)
          .then(() => { done++ })
          .catch((err) => { failed++; console.error(`  Error:`, (err as Error).message) })
          .finally(() => {
            running--
            if ((done + failed) % 10 === 0) process.stdout.write(`  ${done + failed}/${items.length}\n`)
            if (done + failed === items.length) resolve({ done, failed })
            else next()
          })
      }
    }
    next()
  })
}

// ─── Main ───────────────────────────────────────────────────────────────────
const SEASONS = [
  { id: "1997-1998-playoffs", leagueId: "47943" },
  { id: "1999-summer", leagueId: "5" },
  { id: "1999-2000", leagueId: "14" },
  { id: "2000-summer", leagueId: "229" },
  { id: "2000-2001", leagueId: "503" },
  { id: "2001-summer", leagueId: "1189" },
  { id: "2001-2002", leagueId: "1265" },
  { id: "2002-summer", leagueId: "1900" },
  { id: "2002-2003", leagueId: "1901" },
  { id: "2003-summer", leagueId: "4058" },
  { id: "2003-2004", leagueId: "4059" },
  { id: "2004-summer", leagueId: "6487" },
  { id: "2004-2005", leagueId: "6486" },
  { id: "2005-summer", leagueId: "8949" },
  { id: "2005-2006", leagueId: "9865" },
  { id: "2006-summer", leagueId: "11884" },
  { id: "2006-2007", leagueId: "12855" },
  { id: "2007-summer", leagueId: "15097" },
  { id: "2007-2008", leagueId: "15982" },
  { id: "2008-summer", leagueId: "18149" },
  { id: "2008-2009", leagueId: "18903" },
  { id: "2009-summer", leagueId: "21199" },
  { id: "2009-2010", leagueId: "22285" },
  { id: "2010-summer", leagueId: "24698" },
  { id: "2010-2011", leagueId: "25762" },
  { id: "2011-summer", leagueId: "28742" },
  { id: "2011-2012", leagueId: "29373" },
  { id: "2012-summer", leagueId: "31937" },
  { id: "2012-2013", leagueId: "32866" },
  { id: "2013-summer", leagueId: "35021" },
  { id: "2013-2014", leagueId: "35746" },
  { id: "2014-summer", leagueId: "37780" },
  { id: "2014-2015", leagueId: "38418" },
  { id: "2015-summer", leagueId: "40218" },
  { id: "2015-2016", leagueId: "41205" },
  { id: "2016-summer", leagueId: "42385" },
  { id: "2016-2017", leagueId: "42830" },
  { id: "2017-summer", leagueId: "44083" },
  { id: "2017-2018", leagueId: "44570" },
  { id: "2018-summer", leagueId: "45663" },
  { id: "2018-2019", leagueId: "46192" },
  { id: "2019-summer", leagueId: "47083" },
  { id: "2019-2020", leagueId: "47353" },
  { id: "2021-summer", leagueId: "48503" },
  { id: "2021-2022", leagueId: "48607" },
  { id: "2022-summer", leagueId: "48952" },
  { id: "2022-2023", leagueId: "49109" },
  { id: "2023-summer", leagueId: "49433" },
  { id: "2023-2024", leagueId: "49644" },
  { id: "2024-summer", leagueId: "49903" },
  { id: "2024-2025", leagueId: "50076" },
  { id: "2025-2026", leagueId: "50562" },
]

const SEASON_LEAGUE_MAP: Record<string, string> = {}
for (const s of SEASONS) {
  SEASON_LEAGUE_MAP[s.id] = s.leagueId
}

async function main() {
  const seasonId = process.argv[2]
  if (!seasonId || (seasonId !== "all" && !SEASON_LEAGUE_MAP[seasonId])) {
    console.error(`Usage: npx tsx scripts/sync-season.ts <seasonId|all>`)
    console.error(`Available: ${Object.keys(SEASON_LEAGUE_MAP).join(", ")}`)
    process.exit(1)
  }

  const seasonsToSync = seasonId === "all" ? Object.keys(SEASON_LEAGUE_MAP) : [seasonId]

  for (const sid of seasonsToSync) {
    const leagueId = SEASON_LEAGUE_MAP[sid]
    console.log(`Syncing ${sid} (leagueId=${leagueId})...`)

    await rawSql(sql`
      INSERT INTO seasons (id, name, league_id, is_current, season_type)
      VALUES (${sid}, ${sid}, ${leagueId}, false, 'fall')
      ON CONFLICT DO NOTHING
    `)

    // Step 1: Sync schedule
    const gamesCreated = await syncFullSchedule(leagueId, sid)
    console.log(`Schedule synced: ${gamesCreated} games`)

    // Step 2: Sync boxscores
    const games = await rawSql(sql`
      SELECT id FROM games
      WHERE season_id = ${sid} AND status = 'final' AND has_boxscore = false
      ORDER BY date ASC
    `)
    console.log(`Boxscores to sync: ${games.length}`)

    if (games.length > 0) {
      const result = await runPool(games, (game) => syncBoxscore(game.id, leagueId, sid))
      console.log(`Done: ${result.done} synced, ${result.failed} failed`)
    }

    console.log(`\n✅ ${sid} sync complete!`)
  }
}

main().catch(console.error)
