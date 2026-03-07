import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import type { LiveGameState, GoalEvent, PenaltyEvent } from "@/lib/scorekeeper-types"

function validatePin(request: Request): boolean {
  const pin = request.headers.get("x-pin")
  return !!pin && pin === process.env.SCOREKEEPER_PIN
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validatePin(request)) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 })
  }

  const { id } = await params

  try {
    // 1. Read game_live state
    const liveRows = await sql`
      SELECT state FROM game_live WHERE game_id = ${id}
    `
    if (liveRows.length === 0) {
      return NextResponse.json({ error: "No live game data found" }, { status: 404 })
    }

    const state: LiveGameState = liveRows[0].state

    // 2. Get game info
    const gameRows = await sql`
      SELECT id, season_id, home_team, away_team FROM games WHERE id = ${id}
    `
    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    const game = gameRows[0]
    const homeSlug = game.home_team
    const awaySlug = game.away_team

    // 3. Compute scores from goals (excluding period 5 shootout)
    let homeScore = 0
    let awayScore = 0
    for (const goal of state.goals) {
      if (goal.period <= 4) {
        if (goal.team === homeSlug) homeScore++
        else if (goal.team === awaySlug) awayScore++
      }
    }

    // If shootout decided it, add 1 to the shootout winner
    const isShootout = state.shootout !== null
    if (isShootout) {
      const homeSOGoals = state.shootout!.homeAttempts.filter((a) => a.scored).length
      const awaySOGoals = state.shootout!.awayAttempts.filter((a) => a.scored).length
      if (homeSOGoals > awaySOGoals) homeScore++
      else if (awaySOGoals > homeSOGoals) awayScore++
    }

    // 4. Determine is_overtime (any goals in period >= 4, or shootout occurred)
    const isOvertime = state.goals.some((g) => g.period >= 4) || isShootout

    // 5. Build player stats from events
    const playerStats = new Map<number, {
      goals: number; assists: number; points: number
      ppg: number; shg: number; eng: number; pen: number; pim: number
    }>()

    function getOrCreate(playerId: number) {
      if (!playerStats.has(playerId)) {
        playerStats.set(playerId, { goals: 0, assists: 0, points: 0, ppg: 0, shg: 0, eng: 0, pen: 0, pim: 0 })
      }
      return playerStats.get(playerId)!
    }

    // Initialize all attending players with zero stats
    for (const pid of [...state.homeAttendance, ...state.awayAttendance]) {
      getOrCreate(pid)
    }

    // Count goals & assists (exclude shootout goals in period 5)
    for (const goal of state.goals) {
      if (goal.period >= 5) continue // shootout - don't count in stats

      const scorer = getOrCreate(goal.scorerId)
      scorer.goals++
      scorer.points++
      if (goal.flags.includes("PPG")) scorer.ppg++
      if (goal.flags.includes("SHG")) scorer.shg++
      if (goal.flags.includes("ENG")) scorer.eng++

      if (goal.assist1Id) {
        const a1 = getOrCreate(goal.assist1Id)
        a1.assists++
        a1.points++
      }
      if (goal.assist2Id) {
        const a2 = getOrCreate(goal.assist2Id)
        a2.assists++
        a2.points++
      }
    }

    // Count penalties
    for (const pen of state.penalties) {
      const p = getOrCreate(pen.playerId)
      p.pen++
      p.pim += pen.minutes
    }

    // 6. Determine GWG (game-winning goal)
    let gwgScorerId: number | null = null
    if (homeScore !== awayScore) {
      const winningTeam = homeScore > awayScore ? homeSlug : awaySlug
      const losingScore = Math.min(homeScore, awayScore)
      // GWG is the goal that gave the winning team a lead they never relinquished
      // Simplified: the (losingScore + 1)th goal by the winning team
      let count = 0
      for (const goal of state.goals) {
        if (goal.team === winningTeam && goal.period <= 4) {
          count++
          if (count === losingScore + 1) {
            gwgScorerId = goal.scorerId
            break
          }
        }
      }
    }

    // 7. Determine hat tricks
    const goalCounts = new Map<number, number>()
    for (const goal of state.goals) {
      if (goal.period >= 5) continue
      goalCounts.set(goal.scorerId, (goalCounts.get(goal.scorerId) || 0) + 1)
    }

    // 8. Figure out which players are goalies
    // Use scorekeeper overrides if set, otherwise fall back to player_seasons
    const goalieIds = new Set<number>()
    const overrides = state.goalieOverrides ?? {}
    const allAttending = [...state.homeAttendance, ...state.awayAttendance]
    const hasOverrides = allAttending.some((pid) => overrides[pid] === true)

    if (hasOverrides) {
      for (const pid of allAttending) {
        if (overrides[pid]) goalieIds.add(pid)
      }
    } else {
      const goalieRows = await sql`
        SELECT player_id FROM player_seasons
        WHERE season_id = ${game.season_id} AND is_goalie = true
      `
      for (const r of goalieRows) goalieIds.add(r.player_id)
    }

    // 9. Upsert player_game_stats for attending skaters
    for (const [playerId, stats] of playerStats) {
      if (goalieIds.has(playerId)) continue // skip goalies

      const hatTricks = (goalCounts.get(playerId) || 0) >= 3 ? 1 : 0
      const gwg = playerId === gwgScorerId ? 1 : 0

      await sql`
        INSERT INTO player_game_stats (player_id, game_id, goals, assists, points, gwg, ppg, shg, eng, hat_tricks, pen, pim)
        VALUES (${playerId}, ${id}, ${stats.goals}, ${stats.assists}, ${stats.points}, ${gwg}, ${stats.ppg}, ${stats.shg}, ${stats.eng}, ${hatTricks}, ${stats.pen}, ${stats.pim})
        ON CONFLICT (player_id, game_id) DO UPDATE SET
          goals = ${stats.goals}, assists = ${stats.assists}, points = ${stats.points},
          gwg = ${gwg}, ppg = ${stats.ppg}, shg = ${stats.shg}, eng = ${stats.eng},
          hat_tricks = ${hatTricks}, pen = ${stats.pen}, pim = ${stats.pim}
      `
    }

    // 10. Compute goalie stats
    const totalHomeShots = state.homeShots.reduce((a, b) => a + b, 0)
    const totalAwayShots = state.awayShots.reduce((a, b) => a + b, 0)

    const homeGoalsAgainst = state.goals.filter((g) => g.team === awaySlug && g.period <= 4).length
    const awayGoalsAgainst = state.goals.filter((g) => g.team === homeSlug && g.period <= 4).length

    // Home goalies face away shots
    const homeGoalies = state.homeAttendance.filter((pid) => goalieIds.has(pid))
    const awayGoalies = state.awayAttendance.filter((pid) => goalieIds.has(pid))

    const homeWon = homeScore > awayScore

    for (const goalieId of homeGoalies) {
      const sa = totalAwayShots
      const ga = homeGoalsAgainst
      const sv = sa - ga
      const so = ga === 0 ? 1 : 0
      const result = homeWon ? "W" : "L"

      await sql`
        INSERT INTO goalie_game_stats (player_id, game_id, minutes, goals_against, shots_against, saves, shutouts, goalie_assists, result)
        VALUES (${goalieId}, ${id}, 60, ${ga}, ${sa}, ${sv}, ${so}, 0, ${result})
        ON CONFLICT (player_id, game_id) DO UPDATE SET
          minutes = 60, goals_against = ${ga}, shots_against = ${sa}, saves = ${sv},
          shutouts = ${so}, result = ${result}
      `
    }

    for (const goalieId of awayGoalies) {
      const sa = totalHomeShots
      const ga = awayGoalsAgainst
      const sv = sa - ga
      const so = ga === 0 ? 1 : 0
      const result = homeWon ? "L" : "W"

      await sql`
        INSERT INTO goalie_game_stats (player_id, game_id, minutes, goals_against, shots_against, saves, shutouts, goalie_assists, result)
        VALUES (${goalieId}, ${id}, 60, ${ga}, ${sa}, ${sv}, ${so}, 0, ${result})
        ON CONFLICT (player_id, game_id) DO UPDATE SET
          minutes = 60, goals_against = ${ga}, shots_against = ${sa}, saves = ${sv},
          shutouts = ${so}, result = ${result}
      `
    }

    // 11. Create game_officials rows
    await sql`DELETE FROM game_officials WHERE game_id = ${id}`
    if (state.officials.ref1) {
      await sql`INSERT INTO game_officials (game_id, name, role) VALUES (${id}, ${state.officials.ref1}, 'ref')`
    }
    if (state.officials.ref2) {
      await sql`INSERT INTO game_officials (game_id, name, role) VALUES (${id}, ${state.officials.ref2}, 'ref')`
    }
    if (state.officials.scorekeeper) {
      await sql`INSERT INTO game_officials (game_id, name, role) VALUES (${id}, ${state.officials.scorekeeper}, 'scorekeeper')`
    }

    // 12. Set game to final
    const notes = state.notes?.trim() || null
    await sql`
      UPDATE games SET
        status = 'final',
        home_score = ${homeScore},
        away_score = ${awayScore},
        is_overtime = ${isOvertime},
        has_boxscore = true,
        notes = ${notes}
      WHERE id = ${id}
    `

    return NextResponse.json({ ok: true, homeScore, awayScore, isOvertime })
  } catch (error) {
    console.error("Failed to finalize game:", error)
    return NextResponse.json({ error: "Failed to finalize game" }, { status: 500 })
  }
}
