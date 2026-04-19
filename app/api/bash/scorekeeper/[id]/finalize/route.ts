import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and, sql } from "drizzle-orm"
import type { LiveGameState, GoalEvent, PenaltyEvent, GoalieChangeEvent } from "@/lib/scorekeeper-types"
import { computePulledSeconds, clockToElapsed, parseClockString } from "@/lib/scorekeeper-types"
import { getSession } from "@/lib/admin-session"

async function validateAuth(request: Request): Promise<boolean> {
  const pin = request.headers.get("x-pin")
  if (pin && pin === process.env.SCOREKEEPER_PIN) return true
  return await getSession()
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await validateAuth(request))) {
    return NextResponse.json({ error: "Invalid PIN or session" }, { status: 401 })
  }

  const { id } = await params

  try {
    // 1. Read game_live state
    const liveRows = await db
      .select({ state: schema.gameLive.state })
      .from(schema.gameLive)
      .where(eq(schema.gameLive.gameId, id))
    if (liveRows.length === 0) {
      return NextResponse.json({ error: "No live game data found" }, { status: 404 })
    }

    const state: LiveGameState = liveRows[0].state as LiveGameState

    // 2. Get game info
    const gameRows = await db
      .select({
        id: schema.games.id,
        seasonId: schema.games.seasonId,
        homeTeam: schema.games.homeTeam,
        awayTeam: schema.games.awayTeam,
      })
      .from(schema.games)
      .where(eq(schema.games.id, id))
    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    const game = gameRows[0]
    const homeSlug = game.homeTeam
    const awaySlug = game.awayTeam

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
    const goalieIds = new Set<number>()
    if (state.homeGoalieId != null) goalieIds.add(state.homeGoalieId)
    if (state.awayGoalieId != null) goalieIds.add(state.awayGoalieId)
    // Include any goalies from mid-game substitutions
    for (const change of state.goalieChanges ?? []) {
      goalieIds.add(change.outGoalieId)
      goalieIds.add(change.inGoalieId)
    }

    // 9. Delete old player/goalie stats then insert fresh for attending players
    await db.delete(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, id))

    for (const [playerId, stats] of playerStats) {
      if (goalieIds.has(playerId)) continue // skip goalies

      const hatTricks = (goalCounts.get(playerId) || 0) >= 3 ? 1 : 0
      const gwg = playerId === gwgScorerId ? 1 : 0

      await db
        .insert(schema.playerGameStats)
        .values({
          playerId,
          gameId: id,
          goals: stats.goals,
          assists: stats.assists,
          points: stats.points,
          gwg,
          ppg: stats.ppg,
          shg: stats.shg,
          eng: stats.eng,
          hatTricks,
          pen: stats.pen,
          pim: stats.pim,
        })
        .onConflictDoUpdate({
          target: [schema.playerGameStats.playerId, schema.playerGameStats.gameId],
          set: {
            goals: stats.goals,
            assists: stats.assists,
            points: stats.points,
            gwg,
            ppg: stats.ppg,
            shg: stats.shg,
            eng: stats.eng,
            hatTricks,
            pen: stats.pen,
            pim: stats.pim,
          },
        })
    }

    // 10. Compute goalie stats
    const totalHomeShots = state.homeShots.reduce((a, b) => a + b, 0)
    const totalAwayShots = state.awayShots.reduce((a, b) => a + b, 0)

    const homeWon = homeScore > awayScore
    // Compute total game time: 3 periods of 1200s + OT periods
    // Regular season OT = 300s, Playoff OT = 1200s per period
    const gameRow = gameRows[0]
    const gameIsPlayoff = !!(await db.select({ isPlayoff: schema.games.isPlayoff }).from(schema.games).where(eq(schema.games.id, id)))[0]?.isPlayoff
    const maxPeriod = Math.max(...state.goals.map((g) => g.period), state.period ?? 3)
    const otPeriods = Math.max(0, Math.min(maxPeriod, isShootout ? maxPeriod - 1 : maxPeriod) - 3)
    const otSecsPerPeriod = gameIsPlayoff ? 1200 : 300
    const totalGameSecs = 3600 + otPeriods * otSecsPerPeriod
    const pulls = state.goaliePulls ?? []
    const goalieChanges = state.goalieChanges ?? []

    // Delete old goalie stats for this game before inserting
    await db.delete(schema.goalieGameStats).where(eq(schema.goalieGameStats.gameId, id))

    // Helper: compute per-goalie stats for a team
    function computeTeamGoalieStats(
      teamSlug: string,
      teamAttendance: number[],
      goalsAgainstEvents: GoalEvent[], // goals scored by the opposing team
      totalShots: number, // total shots by the opposing team
      isHome: boolean
    ) {
      const teamGoalies = teamAttendance.filter((pid) => goalieIds.has(pid))
      if (teamGoalies.length === 0) return []

      const teamChanges = goalieChanges.filter((c) => c.team === teamSlug)
        .sort((a, b) => clockToElapsed(a.period, parseClockString(a.clock)) - clockToElapsed(b.period, parseClockString(b.clock)))

      // If no mid-game changes, all goalies split evenly (original behavior)
      if (teamChanges.length === 0) {
        const pulledSecs = computePulledSeconds(pulls, teamSlug)
        const seconds = Math.max(0, totalGameSecs - pulledSecs)
        const ga = goalsAgainstEvents.length
        return teamGoalies.map((goalieId) => ({
          goalieId,
          seconds,
          goalsAgainst: ga,
          shotsAgainst: totalShots,
          saves: totalShots - ga,
          shutouts: ga === 0 && teamGoalies.length === 1 ? 1 : 0,
          result: isHome ? (homeWon ? "W" : "L") : (homeWon ? "L" : "W"),
        }))
      }

      // Build goalie time segments from change events
      // First goalie is the outGoalieId from the first change (they started)
      interface GoalieSegment { goalieId: number; startElapsed: number; endElapsed: number }
      const segments: GoalieSegment[] = []

      // Starting goalie
      const firstChange = teamChanges[0]
      segments.push({
        goalieId: firstChange.outGoalieId,
        startElapsed: 0,
        endElapsed: clockToElapsed(firstChange.period, parseClockString(firstChange.clock)),
      })

      // Middle segments (between changes)
      for (let i = 0; i < teamChanges.length; i++) {
        const change = teamChanges[i]
        const nextChange = teamChanges[i + 1]
        segments.push({
          goalieId: change.inGoalieId,
          startElapsed: clockToElapsed(change.period, parseClockString(change.clock)),
          endElapsed: nextChange
            ? clockToElapsed(nextChange.period, parseClockString(nextChange.clock))
            : totalGameSecs,
        })
      }

      // Merge segments for the same goalie (if a goalie comes back in)
      const goalieStatsMap = new Map<number, { totalSecs: number; goalsAgainst: number }>()
      for (const seg of segments) {
        const existing = goalieStatsMap.get(seg.goalieId) ?? { totalSecs: 0, goalsAgainst: 0 }
        existing.totalSecs += seg.endElapsed - seg.startElapsed
        goalieStatsMap.set(seg.goalieId, existing)
      }

      // Subtract pulled time per goalie segment
      for (const pull of pulls) {
        if (pull.team !== teamSlug) continue
        const pullStart = clockToElapsed(pull.period, parseClockString(pull.pulledAt))
        const pullEnd = pull.returnedAt
          ? clockToElapsed(pull.period, parseClockString(pull.returnedAt))
          : clockToElapsed(pull.period, 0)
        // Find which goalie was in net during this pull
        for (const seg of segments) {
          if (pullStart >= seg.startElapsed && pullStart < seg.endElapsed) {
            const overlap = Math.min(pullEnd, seg.endElapsed) - Math.max(pullStart, seg.startElapsed)
            const existing = goalieStatsMap.get(seg.goalieId)
            if (existing) existing.totalSecs -= overlap
            break
          }
        }
      }

      // Attribute goals against to the goalie who was in net at the time
      for (const goal of goalsAgainstEvents) {
        const goalElapsed = clockToElapsed(goal.period, parseClockString(goal.clock))
        // Find the segment containing this goal (last segment whose start <= goalElapsed)
        let assignedGoalie = segments[segments.length - 1].goalieId
        for (const seg of segments) {
          if (goalElapsed >= seg.startElapsed && goalElapsed < seg.endElapsed) {
            assignedGoalie = seg.goalieId
            break
          }
        }
        const existing = goalieStatsMap.get(assignedGoalie)
        if (existing) existing.goalsAgainst++
      }

      // Split shots proportionally by time played
      const totalTimePlayed = Array.from(goalieStatsMap.values()).reduce((sum, g) => sum + Math.max(0, g.totalSecs), 0)

      return Array.from(goalieStatsMap.entries()).map(([goalieId, stats]) => {
        const timeFraction = totalTimePlayed > 0 ? Math.max(0, stats.totalSecs) / totalTimePlayed : 0
        const sa = Math.round(totalShots * timeFraction)
        const ga = stats.goalsAgainst
        return {
          goalieId,
          seconds: Math.max(0, stats.totalSecs),
          goalsAgainst: ga,
          shotsAgainst: sa,
          saves: sa - ga,
          shutouts: ga === 0 && goalieStatsMap.size === 1 ? 1 : 0,
          result: isHome ? (homeWon ? "W" : "L") : (homeWon ? "L" : "W"),
        }
      })
    }

    const homeGoalieStats = computeTeamGoalieStats(
      homeSlug, state.homeAttendance,
      state.goals.filter((g) => g.team === awaySlug && g.period <= 4),
      totalAwayShots, true
    )
    const awayGoalieStats = computeTeamGoalieStats(
      awaySlug, state.awayAttendance,
      state.goals.filter((g) => g.team === homeSlug && g.period <= 4),
      totalHomeShots, false
    )

    for (const gs of [...homeGoalieStats, ...awayGoalieStats]) {
      await db
        .insert(schema.goalieGameStats)
        .values({
          playerId: gs.goalieId,
          gameId: id,
          seconds: gs.seconds,
          goalsAgainst: gs.goalsAgainst,
          shotsAgainst: gs.shotsAgainst,
          saves: gs.saves,
          shutouts: gs.shutouts,
          goalieAssists: 0,
          result: gs.result,
        })
        .onConflictDoUpdate({
          target: [schema.goalieGameStats.playerId, schema.goalieGameStats.gameId],
          set: {
            seconds: gs.seconds,
            goalsAgainst: gs.goalsAgainst,
            shotsAgainst: gs.shotsAgainst,
            saves: gs.saves,
            shutouts: gs.shutouts,
            result: gs.result,
          },
        })
    }

    // 11. Create game_officials rows
    await db.delete(schema.gameOfficials).where(eq(schema.gameOfficials.gameId, id))
    if (state.officials.ref1) {
      await db.insert(schema.gameOfficials).values({ gameId: id, name: state.officials.ref1, role: "ref" })
    }
    if (state.officials.ref2) {
      await db.insert(schema.gameOfficials).values({ gameId: id, name: state.officials.ref2, role: "ref" })
    }
    if (state.officials.scorekeeper) {
      await db.insert(schema.gameOfficials).values({ gameId: id, name: state.officials.scorekeeper, role: "scorekeeper" })
    }

    // 12. Set game to final
    const notes = state.notes?.trim() || null
    await db
      .update(schema.games)
      .set({
        status: "final",
        homeScore,
        awayScore,
        isOvertime,
        hasBoxscore: true,
        notes,
      })
      .where(eq(schema.games.id, id))

    return NextResponse.json({ ok: true, homeScore, awayScore, isOvertime })
  } catch (error) {
    console.error("Failed to finalize game:", error)
    return NextResponse.json({ error: "Failed to finalize game" }, { status: 500 })
  }
}
