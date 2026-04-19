import { NextResponse } from "next/server"
import { db, schema, rawSql } from "@/lib/db"
import { sql, eq, and, count } from "drizzle-orm"
import { getCurrentSeason, getSeasonById } from "@/lib/seasons"
import { mergeDuplicatePlayers } from "@/lib/merge-duplicates"

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
  const regularHtml = await res.text()

  // Also fetch playoff schedule scores
  const playoffUrl = `${BASE_URL}/Schedule.asp?GT=P&LgID=${leagueId}`
  const playoffRes = await fetch(playoffUrl, { cache: "no-store" })
  const playoffHtml = await playoffRes.text()

  const html = regularHtml + playoffHtml

  const gamePattern = /GID=(\d+)/g
  const gameIds: string[] = []
  let match
  while ((match = gamePattern.exec(html)) !== null) {
    if (!gameIds.includes(match[1])) gameIds.push(match[1])
  }

  const updates: { id: string; homeScore: number; awayScore: number; isOT: boolean; isForfeit: boolean }[] = []
  const rows = html.split(/(?=GID=\d+)/)

  for (const row of rows) {
    const gidMatch = row.match(/GID=(\d+)/)
    if (!gidMatch) continue
    const gid = gidMatch[1]
    const text = stripHtml(row)
    const isOT = /\(OT\)/i.test(text)
    const isForfeit = /\((?:Dbl\s+)?Forfeit\)/i.test(text)
    const atMatch = text.match(/(\d+)\s*(?:\([^)]*\))?\s+at\s+.*?(\d+)\s*(?:\([^)]*\))?\s*$/i)
    if (atMatch) {
      const awayScore = parseInt(atMatch[1])
      const homeScore = parseInt(atMatch[2])
      if (!isNaN(awayScore) && !isNaN(homeScore)) {
        updates.push({ id: gid, homeScore, awayScore, isOT, isForfeit })
      }
    }
  }

  // Skip games managed by scorekeeper
  const liveGames = await db.select({ gameId: schema.gameLive.gameId }).from(schema.gameLive)
  const liveGameIds = new Set(liveGames.map((r) => r.gameId))

  let updated = 0
  for (const u of updates) {
    if (liveGameIds.has(u.id)) continue
    await rawSql(sql`
      UPDATE games
      SET home_score = ${u.homeScore}, away_score = ${u.awayScore},
          status = 'final', is_overtime = ${u.isOT}, is_forfeit = ${u.isForfeit}
      WHERE id = ${u.id} AND season_id = ${seasonId}
        AND (home_score IS NULL OR home_score != ${u.homeScore} OR away_score != ${u.awayScore}
             OR is_overtime != ${u.isOT} OR is_forfeit != ${u.isForfeit})
    `)
    updated++
  }

  return { gamesChecked: gameIds.length, updatesApplied: updated }
}

// Full schedule sync: parse all games from a schedule page and create them
// Schedule pages use table rows: <td>Date</td> <td>Time</td> <td><a href="...GID=X">Away Score at Home Score</a></td>
async function syncFullSchedule(leagueId: string, seasonId: string) {
  const url = `${BASE_URL}/Schedule.asp?LgID=${leagueId}`
  const res = await fetch(url, { cache: "no-store" })
  const regularHtml = await res.text()

  // Also fetch playoff schedule
  const playoffUrl = `${BASE_URL}/Schedule.asp?GT=P&LgID=${leagueId}`
  const playoffRes = await fetch(playoffUrl, { cache: "no-store" })
  const playoffHtml = await playoffRes.text()

  const html = regularHtml + playoffHtml

  // Verify season exists in DB (seasons are now managed via admin, not pushed from static config)
  const season = await getSeasonById(seasonId)
  if (!season) throw new Error(`Unknown season: ${seasonId}`)

  // Parse table rows — each <tr> with GID= is a game
  const rowPattern = /<tr[^>]*class="tablecontent"[^>]*>([\s\S]*?)<\/tr>/gi
  const rows: string[] = []
  let rowMatch
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    rows.push(rowMatch[1])
  }

  // Build existing team lookup
  const existingTeams = await db.select({ slug: schema.teams.slug, name: schema.teams.name }).from(schema.teams)
  const teamNameToSlug: Record<string, string> = {}
  for (const t of existingTeams) {
    teamNameToSlug[t.name.toLowerCase()] = t.slug
  }

  // Skip score updates for games managed by scorekeeper
  const liveGames = await db.select({ gameId: schema.gameLive.gameId }).from(schema.gameLive)
  const liveGameIds = new Set(liveGames.map((r) => r.gameId))

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
    const isForfeit = /\((?:Dbl\s+)?Forfeit\)/i.test(gameText)

    // Parse "Away Score at Home Score"
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

    // Find location cell — skip the game cell (which may contain team names like "Rink Rats")
    let location = "James Lick Arena"
    for (const cell of cells) {
      if (cell === gameCellHtml) continue
      const loc = stripHtml(cell).trim()
      if (loc && /arena|rink|center|park|field/i.test(loc)) { location = loc; break }
    }

    // Look up or create teams
    let awaySlug = teamNameToSlug[awayName.toLowerCase()]
    if (!awaySlug) {
      awaySlug = nameToSlug(awayName)
      await db.insert(schema.teams).values({ slug: awaySlug, name: awayName }).onConflictDoNothing()
      teamNameToSlug[awayName.toLowerCase()] = awaySlug
    }

    let homeSlug = teamNameToSlug[homeName.toLowerCase()]
    if (!homeSlug) {
      homeSlug = nameToSlug(homeName)
      await db.insert(schema.teams).values({ slug: homeSlug, name: homeName }).onConflictDoNothing()
      teamNameToSlug[homeName.toLowerCase()] = homeSlug
    }

    // Ensure season_teams entries
    await db.insert(schema.seasonTeams).values({ seasonId, teamSlug: awaySlug }).onConflictDoNothing()
    await db.insert(schema.seasonTeams).values({ seasonId, teamSlug: homeSlug }).onConflictDoNothing()

    // Upsert game (don't overwrite scores for scorekeeper-managed games)
    if (liveGameIds.has(gid)) {
      await db
        .insert(schema.games)
        .values({
          id: gid,
          seasonId,
          date: currentDate,
          time,
          awayTeam: awaySlug,
          homeTeam: homeSlug,
          awayScore,
          homeScore,
          status,
          isOvertime: isOT,
          isPlayoff,
          isForfeit,
          location,
          hasBoxscore: false,
        })
        .onConflictDoUpdate({
          target: schema.games.id,
          set: {
            date: sql`EXCLUDED.date`,
            time: sql`EXCLUDED.time`,
            location: sql`EXCLUDED.location`,
            isPlayoff: sql`EXCLUDED.is_playoff`,
            isForfeit: sql`EXCLUDED.is_forfeit`,
          },
        })
    } else {
      await db
        .insert(schema.games)
        .values({
          id: gid,
          seasonId,
          date: currentDate,
          time,
          awayTeam: awaySlug,
          homeTeam: homeSlug,
          awayScore,
          homeScore,
          status,
          isOvertime: isOT,
          isPlayoff,
          isForfeit,
          location,
          hasBoxscore: false,
        })
        .onConflictDoUpdate({
          target: schema.games.id,
          set: {
            date: sql`EXCLUDED.date`,
            time: sql`EXCLUDED.time`,
            awayTeam: sql`EXCLUDED.away_team`,
            homeTeam: sql`EXCLUDED.home_team`,
            awayScore: sql`EXCLUDED.away_score`,
            homeScore: sql`EXCLUDED.home_score`,
            status: sql`EXCLUDED.status`,
            isOvertime: sql`EXCLUDED.is_overtime`,
            isPlayoff: sql`EXCLUDED.is_playoff`,
            isForfeit: sql`EXCLUDED.is_forfeit`,
            location: sql`EXCLUDED.location`,
          },
        })
    }
    gamesCreated++
  }

  return { gamesFound, gamesCreated }
}

async function syncBoxscore(gameId: string, leagueId: string, seasonId: string) {
  // Skip games managed by scorekeeper
  const liveCheck = await db.select({ gameId: schema.gameLive.gameId }).from(schema.gameLive).where(eq(schema.gameLive.gameId, gameId))
  if (liveCheck.length > 0) return

  const url = `${BASE_URL}/Game.asp?LgID=${leagueId}&GID=${gameId}`
  const res = await fetch(url, { cache: "no-store" })
  const html = await res.text()

  let hasAnyStats = false

  // Build team name → slug lookup
  const teamRows = await db.select({ slug: schema.teams.slug, name: schema.teams.name }).from(schema.teams)
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

  await db.delete(schema.gameOfficials).where(eq(schema.gameOfficials.gameId, gameId))
  for (const ref of refs) {
    await db.insert(schema.gameOfficials).values({ gameId, name: ref, role: "ref" })
  }
  for (const sk of scorekeepers) {
    await db.insert(schema.gameOfficials).values({ gameId, name: sk, role: "scorekeeper" })
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
              await db.insert(schema.teams).values({ slug, name: teamMatch[1].trim() }).onConflictDoNothing()
              await db.insert(schema.seasonTeams).values({ seasonId, teamSlug: slug }).onConflictDoNothing()
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

        const playerRows = await db
          .insert(schema.players)
          .values({ name: playerName })
          .onConflictDoUpdate({
            target: schema.players.name,
            set: { name: sql`EXCLUDED.name` },
          })
          .returning({ id: schema.players.id })
        const playerId = playerRows[0].id

        await db
          .insert(schema.playerSeasons)
          .values({ playerId, seasonId, teamSlug: currentTeamSlug })
          .onConflictDoNothing()

        await db
          .insert(schema.playerGameStats)
          .values({ playerId, gameId, goals, assists, points, gwg, ppg, shg, eng, hatTricks: hat, pen, pim })
          .onConflictDoUpdate({
            target: [schema.playerGameStats.playerId, schema.playerGameStats.gameId],
            set: {
              goals: sql`EXCLUDED.goals`,
              assists: sql`EXCLUDED.assists`,
              points: sql`EXCLUDED.points`,
              gwg: sql`EXCLUDED.gwg`,
              ppg: sql`EXCLUDED.ppg`,
              shg: sql`EXCLUDED.shg`,
              eng: sql`EXCLUDED.eng`,
              hatTricks: sql`EXCLUDED.hat_tricks`,
              pen: sql`EXCLUDED.pen`,
              pim: sql`EXCLUDED.pim`,
            },
          })
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
        // Note: team name ("Reign Goalies") and column headers (GP, Min, ...) are in the same row
        if (cells.length >= 7 && /^(gp|games)$/i.test(stripHtml(cells[1]))) {
          // Extract team name from this combined header row
          if (/\bGoalies$/i.test(cell0Text)) {
            const teamMatch = cell0Text.match(/^(.+?)\s+Goalies$/i)
            if (teamMatch) {
              const teamName = teamMatch[1].trim().toLowerCase()
              currentTeamSlug = teamNameToSlug[teamName] || null
              if (!currentTeamSlug) {
                const slug = nameToSlug(teamMatch[1].trim())
                await db.insert(schema.teams).values({ slug, name: teamMatch[1].trim() }).onConflictDoNothing()
                await db.insert(schema.seasonTeams).values({ seasonId, teamSlug: slug }).onConflictDoNothing()
                teamNameToSlug[teamName] = slug
                currentTeamSlug = slug
              }
            }
          }
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
              await db.insert(schema.teams).values({ slug, name: teamMatch[1].trim() }).onConflictDoNothing()
              await db.insert(schema.seasonTeams).values({ seasonId, teamSlug: slug }).onConflictDoNothing()
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
        const shotsAgainst = parseInt(stripHtml(cells[shotsCol])) || 0
        const saves = parseInt(stripHtml(cells[savesCol])) || 0
        const shutouts = cells.length > 8 ? parseInt(stripHtml(cells[8])) || 0 : 0
        const goalieAssists = cells.length > 9 ? parseInt(stripHtml(cells[9])) || 0 : 0
        const resultCell = cells.length > 13 ? stripHtml(cells[13]) : stripHtml(cells[cells.length - 1])
        const result = resultCell === "W" || resultCell === "L" ? resultCell : null

        const playerRows = await db
          .insert(schema.players)
          .values({ name: playerName })
          .onConflictDoUpdate({
            target: schema.players.name,
            set: { name: sql`EXCLUDED.name` },
          })
          .returning({ id: schema.players.id })
        const playerId = playerRows[0].id

        await db
          .insert(schema.playerSeasons)
          .values({ playerId, seasonId, teamSlug: currentTeamSlug })
          .onConflictDoNothing()

        await db
          .insert(schema.goalieGameStats)
          .values({ playerId, gameId, seconds, goalsAgainst: ga, shotsAgainst, saves, shutouts, goalieAssists, result })
          .onConflictDoUpdate({
            target: [schema.goalieGameStats.playerId, schema.goalieGameStats.gameId],
            set: {
              seconds: sql`EXCLUDED.seconds`,
              goalsAgainst: sql`EXCLUDED.goals_against`,
              shotsAgainst: sql`EXCLUDED.shots_against`,
              saves: sql`EXCLUDED.saves`,
              shutouts: sql`EXCLUDED.shutouts`,
              goalieAssists: sql`EXCLUDED.goalie_assists`,
              result: sql`EXCLUDED.result`,
            },
          })
        // Clean up stale player_game_stats if goalie was previously synced as a skater
        await db.delete(schema.playerGameStats).where(
          and(eq(schema.playerGameStats.playerId, playerId), eq(schema.playerGameStats.gameId, gameId))
        )
        statsInserted = true
      }

      if (statsInserted) hasAnyStats = true
    }
  }

  if (hasAnyStats) {
    // Only mark boxscore complete if goalie stats exist for both teams
    const game = (await rawSql(sql`SELECT home_team, away_team FROM games WHERE id = ${gameId}`))[0]
    const goalieCheck = await rawSql(sql`
      SELECT ps.team_slug
      FROM goalie_game_stats ggs
      JOIN player_seasons ps ON ggs.player_id = ps.player_id AND ps.season_id = ${seasonId}
      WHERE ggs.game_id = ${gameId}
        AND ps.team_slug IN (${game.home_team}, ${game.away_team})
      GROUP BY ps.team_slug
    `)
    const teamsWithGoalies = new Set(goalieCheck.map((r) => r.team_slug))
    const hasAllGoalies = teamsWithGoalies.has(game.home_team) && teamsWithGoalies.has(game.away_team)
    await db.update(schema.games).set({ hasBoxscore: hasAllGoalies }).where(eq(schema.games.id, gameId))
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
      const season = await getSeasonById(seasonParam)
      if (!season) {
        return NextResponse.json({ ok: false, error: `Unknown season: ${seasonParam}` }, { status: 400 })
      }

      // Full schedule sync (creates games from scratch)
      const scheduleResult = await syncFullSchedule(season.leagueId, season.id)

      // Sync boxscores — skip if scheduleOnly, limited for current season
      const currentSeason = await getCurrentSeason()
      const limit = scheduleOnly ? 0 : (season.id === currentSeason.id ? MAX_BOXSCORES_PER_SYNC : boxscoreLimit)
      let boxscoresSynced = 0
      let boxscoresRemaining = 0

      if (limit > 0) {
        const gamesNeedingBoxscore = await rawSql(sql`
          SELECT id FROM games
          WHERE season_id = ${season.id}
            AND status = 'final'
            AND has_boxscore = false
          ORDER BY date ASC
          LIMIT ${limit}
        `)

        for (const game of gamesNeedingBoxscore) {
          try {
            await syncBoxscore(game.id, season.leagueId, season.id)
            boxscoresSynced++
          } catch (err) {
            console.error(`Failed to sync boxscore for game ${game.id}:`, err)
          }
        }
      }

      const remaining = await db
        .select({ count: count() })
        .from(schema.games)
        .where(
          and(
            eq(schema.games.seasonId, season.id),
            eq(schema.games.status, "final"),
            eq(schema.games.hasBoxscore, false)
          )
        )
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
    const current = await getCurrentSeason()
    const scheduleResult = await syncScheduleScores(current.leagueId, current.id)

    const gamesNeedingBoxscore = await rawSql(sql`
      SELECT id FROM games
      WHERE season_id = ${current.id}
        AND status = 'final'
        AND has_boxscore = false
      ORDER BY date ASC
      LIMIT ${MAX_BOXSCORES_PER_SYNC}
    `)

    const boxscoreResults = await Promise.allSettled(
      gamesNeedingBoxscore.map((game) =>
        syncBoxscore(game.id, current.leagueId, current.id)
      )
    )
    const boxscoresSynced = boxscoreResults.filter(r => r.status === 'fulfilled').length
    boxscoreResults.filter(r => r.status === 'rejected').forEach((r, i) => {
      console.error(`Failed to sync boxscore for game ${gamesNeedingBoxscore[i].id}:`, (r as PromiseRejectedResult).reason)
    })

    // Merge duplicate players (case differences, nicknames, etc.)
    const mergeResult = await mergeDuplicatePlayers()

    await db
      .insert(schema.syncMetadata)
      .values({ key: "last_sync", value: new Date().toISOString() })
      .onConflictDoUpdate({
        target: schema.syncMetadata.key,
        set: { value: sql`EXCLUDED.value` },
      })

    return NextResponse.json({
      ok: true,
      schedule: scheduleResult,
      boxscoresSynced,
      playersMerged: mergeResult.merged,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Sync failed:", error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
