import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and, sql } from "drizzle-orm"
import type { LiveGameState, GoalEvent, PenaltyEvent } from "@/lib/scorekeeper-types"
import { computePulledSeconds } from "@/lib/scorekeeper-types"

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
      const goalieRows = await db
        .select({ playerId: schema.playerSeasons.playerId })
        .from(schema.playerSeasons)
        .where(
          and(
            eq(schema.playerSeasons.seasonId, game.seasonId),
            eq(schema.playerSeasons.isGoalie, true)
          )
        )
      for (const r of goalieRows) goalieIds.add(r.playerId)
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

    const homeGoalsAgainst = state.goals.filter((g) => g.team === awaySlug && g.period <= 4).length
    const awayGoalsAgainst = state.goals.filter((g) => g.team === homeSlug && g.period <= 4).length

    // Home goalies face away shots
    const homeGoalies = state.homeAttendance.filter((pid) => goalieIds.has(pid))
    const awayGoalies = state.awayAttendance.filter((pid) => goalieIds.has(pid))

    const homeWon = homeScore > awayScore

    // Compute goalie minutes: regulation (60) + OT (5 if played) minus pulled time
    const totalGameSecs = isOvertime ? 3900 : 3600
    const pulls = state.goaliePulls ?? []
    const homePulledSecs = computePulledSeconds(pulls, homeSlug)
    const awayPulledSecs = computePulledSeconds(pulls, awaySlug)
    const homeGoalieMinutes = Math.max(0, Math.round((totalGameSecs - homePulledSecs) / 60))
    const awayGoalieMinutes = Math.max(0, Math.round((totalGameSecs - awayPulledSecs) / 60))

    // Delete old goalie stats for this game before inserting (prevents duplicates
    // when scorekeeper finalizes with different goalies than sync imported)
    await db.delete(schema.goalieGameStats).where(eq(schema.goalieGameStats.gameId, id))

    for (const goalieId of homeGoalies) {
      const sa = totalAwayShots
      const ga = homeGoalsAgainst
      const sv = sa - ga
      const so = ga === 0 ? 1 : 0
      const result = homeWon ? "W" : "L"

      await db
        .insert(schema.goalieGameStats)
        .values({
          playerId: goalieId,
          gameId: id,
          minutes: homeGoalieMinutes,
          goalsAgainst: ga,
          shotsAgainst: sa,
          saves: sv,
          shutouts: so,
          goalieAssists: 0,
          result,
        })
        .onConflictDoUpdate({
          target: [schema.goalieGameStats.playerId, schema.goalieGameStats.gameId],
          set: {
            minutes: homeGoalieMinutes,
            goalsAgainst: ga,
            shotsAgainst: sa,
            saves: sv,
            shutouts: so,
            result,
          },
        })
    }

    for (const goalieId of awayGoalies) {
      const sa = totalHomeShots
      const ga = awayGoalsAgainst
      const sv = sa - ga
      const so = ga === 0 ? 1 : 0
      const result = homeWon ? "L" : "W"

      await db
        .insert(schema.goalieGameStats)
        .values({
          playerId: goalieId,
          gameId: id,
          minutes: awayGoalieMinutes,
          goalsAgainst: ga,
          shotsAgainst: sa,
          saves: sv,
          shutouts: so,
          goalieAssists: 0,
          result,
        })
        .onConflictDoUpdate({
          target: [schema.goalieGameStats.playerId, schema.goalieGameStats.gameId],
          set: {
            minutes: awayGoalieMinutes,
            goalsAgainst: ga,
            shotsAgainst: sa,
            saves: sv,
            shutouts: so,
            result,
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
