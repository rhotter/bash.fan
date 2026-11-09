import { NextRequest, NextResponse } from "next/server"
import { db, schema, rawSql } from "@/lib/db"
import { eq, and, sql } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { revalidateTag } from "next/cache"
import { normalizeTimeForStorage } from "@/lib/format-time"
import { syncForfeitRosterStats } from "@/lib/forfeit-sync"
import type { LiveGameState, RosterPlayer } from "@/lib/scorekeeper-types"

interface RouteContext {
  params: Promise<{ id: string; gameId: string }>
}

function hasMeaningfulLiveState(
  rawState: Record<string, unknown> | undefined
): boolean {
  if (!rawState || typeof rawState !== "object" || Object.keys(rawState).length === 0) {
    return false
  }
  const hasStructure =
    Array.isArray(rawState.goals) ||
    Array.isArray(rawState.homeAttendance) ||
    Array.isArray(rawState.awayAttendance) ||
    Array.isArray(rawState.homeShots) ||
    Array.isArray(rawState.awayShots) ||
    Array.isArray(rawState.penalties)
  if (!hasStructure) return false

  return Boolean(
    Number(rawState.period ?? 0) >= 1 ||
    (Array.isArray(rawState.goals) && rawState.goals.length > 0) ||
    (Array.isArray(rawState.penalties) && rawState.penalties.length > 0) ||
    (Array.isArray(rawState.homeAttendance) && rawState.homeAttendance.length > 0) ||
    (Array.isArray(rawState.awayAttendance) && rawState.awayAttendance.length > 0) ||
    rawState.homeGoalieId != null ||
    rawState.awayGoalieId != null ||
    (rawState.shootout && typeof rawState.shootout === "object") ||
    (Array.isArray(rawState.homeShots) && rawState.homeShots.some((s) => Number(s) > 0)) ||
    (Array.isArray(rawState.awayShots) && rawState.awayShots.some((s) => Number(s) > 0))
  )
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId, gameId } = await context.params

  try {
    const [gameRows, liveRows] = await Promise.all([
      rawSql(sql`
        SELECT g.*,
          COALESCE(ht.name, g.home_team) as home_team_name,
          COALESCE(awt.name, g.away_team) as away_team_name
        FROM games g
        LEFT JOIN teams ht ON g.home_team = ht.slug
        LEFT JOIN teams awt ON g.away_team = awt.slug
        WHERE g.id = ${gameId} AND g.season_id = ${seasonId}
      `),
      rawSql(sql`
        SELECT state, updated_at FROM game_live WHERE game_id = ${gameId}
      `),
    ])

    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    const game = gameRows[0]
    const rawState = liveRows[0]?.state as Record<string, unknown> | undefined
    const hasLiveScorekeeperData = hasMeaningfulLiveState(rawState)

    if (!hasLiveScorekeeperData) {
      return NextResponse.json({
        hasLiveScorekeeperData: false,
        liveState: null,
        homeRoster: [],
        awayRoster: [],
        playerNames: {},
        savedGoalies: [],
      })
    }

    // Fetch rosters (sync with app/admin/games/[id]/edit/page.tsx for traded player support)
    const isAdhocGame = game.game_type === "exhibition" || game.game_type === "tryout"
    async function getRoster(teamSlug: string, teamSide: "home" | "away"): Promise<RosterPlayer[]> {
      if (isAdhocGame) {
        const rows = await rawSql(sql`
          SELECT p.id, p.name
          FROM adhoc_game_rosters agr
          JOIN players p ON agr.player_id = p.id
          WHERE agr.game_id = ${gameId} AND agr.team_side = ${teamSide}
          ORDER BY p.name ASC
        `)
        return rows.map((r) => ({ id: r.id, name: r.name }))
      }
      const rows = await rawSql(sql`
        SELECT p.id, p.name
        FROM (
          SELECT ps.player_id
          FROM player_seasons ps
          WHERE ps.season_id = ${seasonId}
            AND ps.team_slug = ${teamSlug}
            AND NOT EXISTS (
              SELECT 1 FROM player_game_stats pgs
              WHERE pgs.game_id = ${gameId}
                AND pgs.player_id = ps.player_id
                AND pgs.team_slug IS NOT NULL
                AND pgs.team_slug <> ${teamSlug}
            )
            AND NOT EXISTS (
              SELECT 1 FROM goalie_game_stats ggs
              WHERE ggs.game_id = ${gameId}
                AND ggs.player_id = ps.player_id
                AND ggs.team_slug IS NOT NULL
                AND ggs.team_slug <> ${teamSlug}
            )
          UNION
          SELECT pgs.player_id
          FROM player_game_stats pgs
          WHERE pgs.game_id = ${gameId} AND pgs.team_slug = ${teamSlug}
          UNION
          SELECT ggs.player_id
          FROM goalie_game_stats ggs
          WHERE ggs.game_id = ${gameId} AND ggs.team_slug = ${teamSlug}
          UNION
          SELECT agr.player_id
          FROM adhoc_game_rosters agr
          WHERE agr.game_id = ${gameId} AND agr.team_side = ${teamSide}
        ) r
        JOIN players p ON p.id = r.player_id
        ORDER BY p.name ASC
      `)
      return rows.map((r) => ({ id: r.id, name: r.name }))
    }

    const [homeRoster, awayRoster, goalieRows] = await Promise.all([
      getRoster(game.home_team, "home"),
      getRoster(game.away_team, "away"),
      rawSql(sql`
        SELECT ggs.player_id as id, p.name, ggs.team_slug as team
        FROM goalie_game_stats ggs
        JOIN players p ON ggs.player_id = p.id
        WHERE ggs.game_id = ${gameId}
      `),
    ])

    // Collect player names referenced in state, rosters, and saved goalies
    const playerNames: Record<number, string> = {}
    for (const p of [...homeRoster, ...awayRoster]) {
      playerNames[p.id] = p.name
    }
    for (const r of goalieRows) {
      playerNames[r.id] = r.name
    }

    const state = rawState as unknown as LiveGameState
    const referencedIds = new Set<number>()
    for (const pid of state.homeAttendance ?? []) referencedIds.add(pid)
    for (const pid of state.awayAttendance ?? []) referencedIds.add(pid)
    for (const g of state.goals ?? []) {
      referencedIds.add(g.scorerId)
      if (g.assist1Id) referencedIds.add(g.assist1Id)
      if (g.assist2Id) referencedIds.add(g.assist2Id)
    }
    for (const p of state.penalties ?? []) referencedIds.add(p.playerId)
    if (state.homeGoalieId) referencedIds.add(state.homeGoalieId)
    if (state.awayGoalieId) referencedIds.add(state.awayGoalieId)
    for (const s of state.shootout?.homeAttempts ?? []) referencedIds.add(s.playerId)
    for (const s of state.shootout?.awayAttempts ?? []) referencedIds.add(s.playerId)
    for (const star of state.threeStars ?? []) { if (star > 0) referencedIds.add(star) }
    for (const gc of state.goalieChanges ?? []) {
      if (gc.outGoalieId) referencedIds.add(gc.outGoalieId)
      if (gc.inGoalieId) referencedIds.add(gc.inGoalieId)
    }
    if (state.goalieShotsAgainst) {
      for (const key of Object.keys(state.goalieShotsAgainst)) {
        const id = Number(key)
        if (Number.isInteger(id) && id > 0) referencedIds.add(id)
      }
    }

    const missingIds = [...referencedIds].filter((id) => typeof id === "number" && Number.isInteger(id) && id > 0 && !playerNames[id])
    if (missingIds.length > 0) {
      const pRows = await rawSql(sql`SELECT id, name FROM players WHERE id IN ${missingIds}`)
      for (const r of pRows) {
        playerNames[r.id] = r.name
      }
    }

    const savedGoalies = goalieRows.map((r) => ({
      id: r.id,
      name: r.name,
      team: r.team === game.home_team ? game.home_team_name : (r.team === game.away_team ? game.away_team_name : (r.team || "Goalie")),
    }))

    return NextResponse.json({
      hasLiveScorekeeperData: true,
      liveState: state,
      homeRoster,
      awayRoster,
      playerNames,
      savedGoalies,
    })
  } catch (error) {
    console.error("Failed to fetch game editor data:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId, gameId } = await context.params

  try {
    const body = await request.json()
    
    // Map gameType to isPlayoff correctly if provided
    let isPlayoff = undefined;
    if (body.gameType !== undefined) {
      isPlayoff = body.gameType === "playoff" || body.gameType === "championship"
    }

    // Allowlist editable fields to prevent mass-assignment
    const updateData: Record<string, unknown> = {}
    if (body.date !== undefined) updateData.date = body.date
    if (body.time !== undefined) updateData.time = normalizeTimeForStorage(body.time)
    if (body.homeTeam !== undefined) updateData.homeTeam = body.homeTeam
    if (body.awayTeam !== undefined) updateData.awayTeam = body.awayTeam
    if (body.homeScore !== undefined) updateData.homeScore = body.homeScore
    if (body.awayScore !== undefined) updateData.awayScore = body.awayScore
    if (body.status !== undefined) updateData.status = body.status
    if (body.isOvertime !== undefined) updateData.isOvertime = body.isOvertime
    if (body.isForfeit !== undefined) updateData.isForfeit = body.isForfeit
    if (body.location !== undefined) updateData.location = body.location
    if (body.hasBoxscore !== undefined) updateData.hasBoxscore = body.hasBoxscore
    if (body.gameType !== undefined) updateData.gameType = body.gameType
    if (body.hasShootout !== undefined) updateData.hasShootout = body.hasShootout
    if (body.title !== undefined) updateData.title = body.title === "" ? null : body.title
    if (body.notes !== undefined) updateData.notes = body.notes === "" ? null : body.notes
    if (body.homeNotes !== undefined) updateData.homeNotes = body.homeNotes === "" ? null : body.homeNotes
    if (body.awayNotes !== undefined) updateData.awayNotes = body.awayNotes === "" ? null : body.awayNotes
    if (body.homePlaceholder !== undefined) updateData.homePlaceholder = body.homePlaceholder
    if (body.awayPlaceholder !== undefined) updateData.awayPlaceholder = body.awayPlaceholder
    if (isPlayoff !== undefined) updateData.isPlayoff = isPlayoff

    // 1. Fetch existing game row before updating so we only run forfeit roster sync
    // when forfeit-relevant fields actually change.
    const [existingGame] = await db.select()
      .from(schema.games)
      .where(and(
        eq(schema.games.id, gameId),
        eq(schema.games.seasonId, seasonId)
      ))
      .limit(1)

    if (!existingGame) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    // If game has live scorekeeper data and is NOT a forfeit, derive score/OT/SO
    // directly from game_live state to prevent overwriting live scorekeeper data or concurrent edits.
    const isForfeitGame = Boolean(updateData.isForfeit ?? existingGame.isForfeit)
    if (!isForfeitGame) {
      const liveRows = await rawSql(sql`SELECT state FROM game_live WHERE game_id = ${gameId}`)
      const rawLive = liveRows[0]?.state as Record<string, unknown> | undefined
      const hasLiveStats = hasMeaningfulLiveState(rawLive)
      if (hasLiveStats) {
        const liveState = rawLive as unknown as LiveGameState
        const targetHomeTeam = (updateData.homeTeam as string) || existingGame.homeTeam
        const targetAwayTeam = (updateData.awayTeam as string) || existingGame.awayTeam
        const previousHomeTeam = existingGame.homeTeam
        const previousAwayTeam = existingGame.awayTeam
        const isPlayoffGame = isPlayoff ?? existingGame.isPlayoff

        let homeScore = 0
        let awayScore = 0
        for (const g of liveState.goals ?? []) {
          if (isPlayoffGame || g.period <= 4) {
            if (g.team === "home") homeScore++
            else if (g.team === "away") awayScore++
            else if (g.team === targetHomeTeam && g.team !== targetAwayTeam) homeScore++
            else if (g.team === targetAwayTeam && g.team !== targetHomeTeam) awayScore++
            else if (previousHomeTeam && g.team === previousHomeTeam && g.team !== targetAwayTeam) homeScore++
            else if (previousAwayTeam && g.team === previousAwayTeam && g.team !== targetHomeTeam) awayScore++
          }
        }
        let hasShootout = Boolean(liveState.hasShootout)
        if (liveState.shootout) {
          const isSwapped = Boolean(
            previousHomeTeam &&
            previousAwayTeam &&
            targetHomeTeam === previousAwayTeam &&
            targetAwayTeam === previousHomeTeam
          )
          const rawHomeSOGoals = liveState.shootout.homeAttempts?.filter((a) => a.scored).length ?? 0
          const rawAwaySOGoals = liveState.shootout.awayAttempts?.filter((a) => a.scored).length ?? 0
          const homeSOGoals = isSwapped ? rawAwaySOGoals : rawHomeSOGoals
          const awaySOGoals = isSwapped ? rawHomeSOGoals : rawAwaySOGoals

          if ((liveState.shootout.homeAttempts?.length ?? 0) > 0 || (liveState.shootout.awayAttempts?.length ?? 0) > 0) {
            hasShootout = true
          }
          if (homeSOGoals > awaySOGoals) homeScore++
          else if (awaySOGoals > homeSOGoals) awayScore++
        }
        const isOvertime = Boolean(liveState.isOvertime || liveState.period >= 4 || liveState.goals?.some((g) => g.period >= 4) || hasShootout)

        const isPreGameZeroGoals =
          (liveState.goals?.length ?? 0) === 0 &&
          !hasShootout &&
          Number(liveState.period ?? 0) === 0
        const hasRealExistingScore =
          !existingGame.isForfeit &&
          (existingGame.homeScore !== null || existingGame.awayScore !== null)

        if (
          ((liveState.goals?.length ?? 0) === 0 && !hasShootout && hasRealExistingScore) ||
          isPreGameZeroGoals
        ) {
          const fallbackHome = existingGame.isForfeit ? null : existingGame.homeScore
          const fallbackAway = existingGame.isForfeit ? null : existingGame.awayScore
          updateData.homeScore = updateData.homeScore !== undefined ? updateData.homeScore : fallbackHome
          updateData.awayScore = updateData.awayScore !== undefined ? updateData.awayScore : fallbackAway
          updateData.isOvertime = updateData.isOvertime !== undefined ? updateData.isOvertime : existingGame.isOvertime
          updateData.hasShootout = updateData.hasShootout !== undefined ? updateData.hasShootout : existingGame.hasShootout
        } else {
          updateData.homeScore = homeScore
          updateData.awayScore = awayScore
          updateData.isOvertime = isOvertime
          updateData.hasShootout = hasShootout
        }
      }
    }

    await db.update(schema.games)
      .set(updateData)
      .where(and(
        eq(schema.games.id, gameId),
        eq(schema.games.seasonId, seasonId)
      ))

    const forfeitStateChanged =
      !existingGame ||
      (updateData.isForfeit !== undefined && Boolean(updateData.isForfeit) !== Boolean(existingGame.isForfeit)) ||
      (Boolean(updateData.isForfeit ?? existingGame.isForfeit) && (
        (updateData.status !== undefined && updateData.status !== existingGame.status) ||
        (updateData.homeScore !== undefined && updateData.homeScore !== existingGame.homeScore) ||
        (updateData.awayScore !== undefined && updateData.awayScore !== existingGame.awayScore) ||
        (updateData.homeTeam !== undefined && updateData.homeTeam !== existingGame.homeTeam) ||
        (updateData.awayTeam !== undefined && updateData.awayTeam !== existingGame.awayTeam) ||
        (updateData.date !== undefined && updateData.date !== existingGame.date) ||
        (updateData.hasBoxscore !== undefined && Boolean(updateData.hasBoxscore) !== Boolean(existingGame.hasBoxscore)) ||
        (updateData.gameType !== undefined && updateData.gameType !== existingGame.gameType)
      ))

    if (forfeitStateChanged) {
      await syncForfeitRosterStats(gameId)
    }

    // 2. Series-aware auto-advancement logic
    // If the game is a playoff game, it is now "final", and has a seriesId, we need to check if the series is clinched.
    if (body.status === "final") {
      const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1)
      
      if (game && game.gameType === "playoff" && game.seriesId && game.nextGameId && game.nextGameSlot) {
        // Fetch all games in this series
        const seriesGames = await db.select()
          .from(schema.games)
          .where(and(
            eq(schema.games.seasonId, seasonId),
            eq(schema.games.seriesId, game.seriesId)
          ))

        // Derive the intended series length from the max game number, not row count
        // This is more robust if an admin manually deletes a game from the series
        const maxGameNum = Math.max(...seriesGames.map(sg => sg.seriesGameNumber ?? 1))
        const seriesLength = maxGameNum
        const winsNeededToClinch = Math.ceil(seriesLength / 2)

        const winCounts: Record<string, number> = {}
        for (const sg of seriesGames) {
          if (sg.status === "final") {
            // Determine winner of this game (including single-team forfeits)
            const homeScore = sg.homeScore || 0
            const awayScore = sg.awayScore || 0
            
            let winnerSlug: string | null = null
            if (homeScore > awayScore) {
              winnerSlug = sg.homeTeam
            } else if (awayScore > homeScore) {
              winnerSlug = sg.awayTeam
            }
            // Ignore ties / double forfeits

            if (winnerSlug) {
              winCounts[winnerSlug] = (winCounts[winnerSlug] || 0) + 1
            }
          }
        }

        // Check if any team has reached the required wins
        let clinchedWinner: string | null = null
        for (const [teamSlug, wins] of Object.entries(winCounts)) {
          if (wins >= winsNeededToClinch) {
            clinchedWinner = teamSlug
            break
          }
        }

        // If someone clinched the series, advance them to the next game
        if (clinchedWinner) {
          const updateSlot = game.nextGameSlot === "home" ? { homeTeam: clinchedWinner } : { awayTeam: clinchedWinner }
          
          await db.update(schema.games)
            .set(updateSlot)
            .where(eq(schema.games.id, game.nextGameId))
        }
      }
    }

    // @ts-expect-error - Next.js canary changed revalidateTag signature // TODO: Remove after Next.js stabilizes
    revalidateTag("seasons")
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to update game:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId, gameId } = await context.params
  const url = new URL(request.url)
  const force = url.searchParams.get("force") === "true"

  try {
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1)

    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    // Protection for final games with boxscores
    if (game.status === "final" && game.hasBoxscore && !force) {
      return NextResponse.json(
        { error: "Cannot delete a final game with boxscore data unless forced" },
        { status: 400 }
      )
    }

    // Must delete child records first since no cascade is defined
    await db.delete(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, gameId))
    await db.delete(schema.goalieGameStats).where(eq(schema.goalieGameStats.gameId, gameId))
    await db.delete(schema.gameOfficials).where(eq(schema.gameOfficials.gameId, gameId))
    await db.delete(schema.gameLive).where(eq(schema.gameLive.gameId, gameId))

    // Null out any nextGameId references pointing to this game
    await db.update(schema.games)
      .set({ nextGameId: null, nextGameSlot: null })
      .where(eq(schema.games.nextGameId, gameId))

    // Delete the game itself
    await db.delete(schema.games).where(and(
      eq(schema.games.id, gameId),
      eq(schema.games.seasonId, seasonId)
    ))

    // @ts-expect-error - Next.js canary changed revalidateTag signature // TODO: Remove after Next.js stabilizes
    revalidateTag("seasons")
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete game:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
