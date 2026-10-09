import { NextResponse } from "next/server"
import { db, schema, rawSql } from "@/lib/db"
import { and, eq, inArray, sql } from "drizzle-orm"
import { isDeepStrictEqual } from "node:util"
import { randomUUID } from "node:crypto"
import type { LiveGameState, GoalEvent } from "@/lib/scorekeeper-types"
import { computePulledSeconds, clockToElapsed, parseClockString } from "@/lib/scorekeeper-types"
import { getSession } from "@/lib/admin-session"
import { validateShotArray, validateGoalieShotAllocation } from "@/lib/goalie-shot-validation"

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
  let acceptedState: LiveGameState | null = null
  let claimAttempted = false

  // Only the owner of this exact running snapshot may release its claim.
  // There is deliberately no timeout or lease stealing: an interrupted process
  // can leave a running claim that requires administrator review.
  async function replaceClaimedState(nextState: LiveGameState) {
    const savedRows = await rawSql(sql`
      UPDATE game_live l SET state = ${JSON.stringify(nextState)}::jsonb, updated_at = NOW()
      WHERE l.game_id = ${id} AND l.state = ${JSON.stringify(acceptedState)}::jsonb
        AND l.state->'finalizationPending'->>'attemptId' = ${acceptedState!.finalizationPending!.attemptId}
        AND l.state->'finalizationPending'->>'phase' = 'running'
      RETURNING l.state
    `)
    return savedRows[0]?.state as LiveGameState | undefined
  }

  async function failedFinalization(error: string, status: number, details?: string) {
    if (!acceptedState) {
      return NextResponse.json({ error, ...(details ? { details } : {}),
        ...(claimAttempted ? { reloadRequired: true } : {}),
      }, { status })
    }
    try {
      const failedState = await replaceClaimedState({
        ...acceptedState,
        updatedAt: Date.now(),
        finalizationPending: { attemptId: acceptedState.finalizationPending!.attemptId, phase: "failed" },
      })
      if (failedState) {
        return NextResponse.json({ error, ...(details ? { details } : {}), stateSaved: true, state: failedState }, { status })
      }
    } catch (markError) {
      console.error("Could not mark finalization failed:", markError)
    }
    // A failed/ambiguous CAS may mean that the snapshot changed or that an
    // earlier request committed despite its response being lost. Do not expose
    // a fabricated retryable state or release a different attempt's claim.
    return NextResponse.json({
      error: "Finalization status could not be confirmed; reload before retrying. If it remains blocked, administrator review is required",
      reloadRequired: true,
    }, { status: 500 })
  }

  try {
    const bodyText = await request.text()
    let proposed: { state: LiveGameState; expectedState: LiveGameState } | null = null
    if (bodyText.trim()) {
      try {
        const body = JSON.parse(bodyText)
        if (!body || typeof body !== "object" || !body.state || typeof body.state !== "object" || Array.isArray(body.state) ||
          !body.expectedState || typeof body.expectedState !== "object" || Array.isArray(body.expectedState)) {
          return NextResponse.json({ error: "Proposed edits require state and expectedState snapshots" }, { status: 400 })
        }
        proposed = body
      } catch {
        return NextResponse.json({ error: "Invalid finalization request JSON" }, { status: 400 })
      }
    }

    // 1. Read game_live state
    const liveRows = await db
      .select({ state: schema.gameLive.state })
      .from(schema.gameLive)
      .where(eq(schema.gameLive.gameId, id))
    if (liveRows.length === 0) {
      return NextResponse.json({ error: "No live game data found" }, { status: 404 })
    }

    type AuditedState = LiveGameState & { shotCorrections?: unknown }
    const storedState = liveRows[0].state as AuditedState
    const pendingFinalization = storedState?.finalizationPending
    const retryingFailedFinalization = pendingFinalization?.phase === "failed" &&
      typeof pendingFinalization.attemptId === "string" && pendingFinalization.attemptId.length > 0
    if (pendingFinalization && !retryingFailedFinalization) {
      return NextResponse.json({ error: "Finalization is already in progress; reload before retrying. If it remains blocked, administrator review is required" }, { status: 409 })
    }
    if (proposed && !isDeepStrictEqual(proposed.expectedState, storedState)) {
      return NextResponse.json({ error: "Live scoring changed before finalization; reload and try again" }, { status: 409 })
    }
    const state: AuditedState = proposed ? { ...proposed.state, updatedAt: Date.now() } : { ...storedState }
    // Never trust a client-supplied claim, including a forged failed marker.
    // Retry provenance comes exclusively from the stored server-owned marker.
    delete state.finalizationPending
    if (proposed) {
      // The audit belongs to the server, even when an editor sends an older,
      // omitted, or modified copy of it in the proposed snapshot.
      if (Object.hasOwn(storedState, "shotCorrections")) state.shotCorrections = storedState.shotCorrections
      else delete state.shotCorrections
    }
    const expectedUpdatedAt = request.headers.get("x-state-updated-at")
    if (!proposed && expectedUpdatedAt !== null && expectedUpdatedAt !== String(state?.updatedAt)) {
      return NextResponse.json({ error: "Live scoring changed before finalization; reload and try again" }, { status: 409 })
    }

    // 2. Get game info
    const gameRows = await db
      .select({
        id: schema.games.id,
        seasonId: schema.games.seasonId,
        homeTeam: schema.games.homeTeam,
        awayTeam: schema.games.awayTeam,
        isPlayoff: schema.games.isPlayoff,
        isForfeit: schema.games.isForfeit,
        status: schema.games.status,
        hasBoxscore: schema.games.hasBoxscore,
        homeScore: schema.games.homeScore,
        awayScore: schema.games.awayScore,
        gameLength: schema.seasons.gameLength,
      })
      .from(schema.games)
      .leftJoin(schema.seasons, eq(schema.games.seasonId, schema.seasons.id))
      .where(eq(schema.games.id, id))
    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    const game = gameRows[0]
    // Rule 208.3: a forfeit has no individual stats. Preserve the official
    // schedule result and retained scoring history, even on re-finalization.
    if (game.isForfeit) {
      return NextResponse.json({ error: "Forfeited games cannot be finalized from live scoring" }, { status: 409 })
    }

    const homeSlug = game.homeTeam
    const awaySlug = game.awayTeam

    if (proposed) {
      if (game.status !== "final") {
        return NextResponse.json({ error: "Proposed state edits are only supported for completed games" }, { status: 409 })
      }
      if (!storedState || !Array.isArray(storedState.goals) || !Array.isArray(storedState.penalties) ||
        !Array.isArray(storedState.homeAttendance) || !Array.isArray(storedState.awayAttendance) ||
        !storedState.homeAttendance.length || !storedState.awayAttendance.length ||
        !Number.isInteger(storedState.period) || storedState.period < 1 ||
        storedState.homeGoalieId == null || storedState.awayGoalieId == null ||
        !storedState.homeAttendance.includes(storedState.homeGoalieId) || !storedState.awayAttendance.includes(storedState.awayGoalieId)) {
        return NextResponse.json({ error: "The original live history is incomplete; only shot-only corrections can be saved safely" }, { status: 409 })
      }
      if (!retryingFailedFinalization && !storedState.goals.some((goal) => goal.period <= 4)) {
        const homeSO = storedState.shootout?.homeAttempts.filter((attempt) => attempt.scored).length ?? 0
        const awaySO = storedState.shootout?.awayAttempts.filter((attempt) => attempt.scored).length ?? 0
        if ((game.homeScore ?? 0) !== Number(homeSO > awaySO) || (game.awayScore ?? 0) !== Number(awaySO > homeSO)) {
          return NextResponse.json({ error: "The original live goal history does not match the official result; only shot-only corrections can be saved safely" }, { status: 409 })
        }
      }
    }

    const hasOfficialResult = game.status === "final" || game.hasBoxscore
    const incompleteStatus = hasOfficialResult ? 409 : 400
    const incompleteError = "Live scoring is incomplete; restore attendance, goalie assignments, and goal history before finalizing"
    const isPlayerId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0
    if (!state || !Array.isArray(state.goals) || !Array.isArray(state.penalties) ||
      !Array.isArray(state.homeAttendance) || !Array.isArray(state.awayAttendance) ||
      state.homeAttendance.length === 0 || state.awayAttendance.length === 0 ||
      !isPlayerId(state.homeGoalieId) || !isPlayerId(state.awayGoalieId) ||
      !state.homeAttendance.includes(state.homeGoalieId) || !state.awayAttendance.includes(state.awayGoalieId) ||
      !Number.isInteger(state.period) || state.period < 1 || state.period > 5) {
      return NextResponse.json({ error: incompleteError }, { status: incompleteStatus })
    }
    const attendance = [...state.homeAttendance, ...state.awayAttendance]
    if (!attendance.every(isPlayerId) || new Set(attendance).size !== attendance.length) {
      return NextResponse.json({ error: "Attendance must contain distinct player IDs assigned to only one team" }, { status: incompleteStatus })
    }
    for (const [shots, label] of [[state.homeShots, "Home shots"], [state.awayShots, "Away shots"]] as const) {
      const error = validateShotArray(shots, label)
      if (error) return NextResponse.json({ error }, { status: 400 })
    }
    if (state.goals.some((goal) => !goal || ![homeSlug, awaySlug].includes(goal.team) ||
      !Number.isInteger(goal.period) || goal.period < 1 || goal.period > 5 ||
      typeof goal.clock !== "string" || !isPlayerId(goal.scorerId) || !Array.isArray(goal.flags))) {
      return NextResponse.json({ error: "Goal history contains an invalid event" }, { status: 400 })
    }
    if (state.goals.some((goal) => {
      const teamAttendance = goal.team === homeSlug ? state.homeAttendance : state.awayAttendance
      return [goal.scorerId, goal.assist1Id, goal.assist2Id].some((playerId) => playerId != null && !teamAttendance.includes(playerId))
    })) {
      return NextResponse.json({ error: incompleteError }, { status: incompleteStatus })
    }
    if (!Array.isArray(state.goalieChanges ?? []) || !Array.isArray(state.goaliePulls ?? []) ||
      (state.goalieChanges ?? []).some((change) => !change || ![homeSlug, awaySlug].includes(change.team) ||
        !isPlayerId(change.outGoalieId) || !isPlayerId(change.inGoalieId) ||
        typeof change.clock !== "string" || !Number.isInteger(change.period) || change.period < 1 || change.period > 4 ||
        !(change.team === homeSlug ? state.homeAttendance : state.awayAttendance).includes(change.outGoalieId) ||
        !(change.team === homeSlug ? state.homeAttendance : state.awayAttendance).includes(change.inGoalieId))) {
      return NextResponse.json({ error: "Goalie substitution history is incomplete or invalid" }, { status: incompleteStatus })
    }

    if (!state.officials || [state.officials.ref1, state.officials.ref2, state.officials.scorekeeper].some((name) => typeof name !== "string") ||
      (state.notes != null && typeof state.notes !== "string") ||
      state.penalties.some((penalty) => !penalty || !isPlayerId(penalty.playerId) || ![homeSlug, awaySlug].includes(penalty.team) ||
        !Number.isSafeInteger(penalty.minutes) || penalty.minutes < 0) ||
      (state.goaliePulls ?? []).some((pull) => !pull || ![homeSlug, awaySlug].includes(pull.team) ||
        !Number.isInteger(pull.period) || pull.period < 1 || pull.period > 4 || typeof pull.pulledAt !== "string" ||
        (pull.returnedAt != null && typeof pull.returnedAt !== "string")) ||
      (state.shootout != null && (!Array.isArray(state.shootout.homeAttempts) || !Array.isArray(state.shootout.awayAttempts) ||
        [...state.shootout.homeAttempts, ...state.shootout.awayAttempts].some((attempt) => !attempt || !isPlayerId(attempt.playerId) || typeof attempt.scored !== "boolean")))) {
      return NextResponse.json({ error: "Live scoring contains invalid officials, penalties, goalie pulls, or shootout data" }, { status: 400 })
    }

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
    const isShootout = !!state.shootout
    if (isShootout) {
      const homeSOGoals = state.shootout!.homeAttempts.filter((a) => a.scored).length
      const awaySOGoals = state.shootout!.awayAttempts.filter((a) => a.scored).length
      if (homeSOGoals > awaySOGoals) homeScore++
      else if (awaySOGoals > homeSOGoals) awayScore++
    }

    // A result imported without its live events is not a blank scoresheet.
    // Reject the known destructive reset case, while allowing complete-looking
    // nonempty histories to correct goal events (and therefore the score).
    if (!proposed && !retryingFailedFinalization && hasOfficialResult && !state.goals.some((goal) => goal.period <= 4) &&
      (homeScore !== (game.homeScore ?? 0) || awayScore !== (game.awayScore ?? 0))) {
      return NextResponse.json({ error: "Live goal history does not match the official result; restore it before re-finalizing" }, { status: 409 })
    }

    // 4. Determine is_overtime (any goals in period >= 4, or shootout occurred)
    const isOvertime = state.goals.some((g) => g.period >= 4) || isShootout

    // Identify every goalie, including both sides of mid-game substitutions.
    const goalieIds = new Set<number>()
    if (state.homeGoalieId != null) goalieIds.add(state.homeGoalieId)
    if (state.awayGoalieId != null) goalieIds.add(state.awayGoalieId)
    // Include any goalies from mid-game substitutions
    for (const change of state.goalieChanges ?? []) {
      goalieIds.add(change.outGoalieId)
      goalieIds.add(change.inGoalieId)
    }

    const goalieAssists = new Map<number, number>()

    // A player can switch between runner and goalie during a game. Classify
    // each assist using the goalie who was assigned at that event's clock.
    function goalieAtGoal(goal: GoalEvent): number | null {
      const changes = (state.goalieChanges ?? [])
        .filter((change) => change.team === goal.team)
        .sort((a, b) => a.period - b.period || parseClockString(b.clock) - parseClockString(a.clock))
      let goalieId = changes[0]?.outGoalieId
        ?? (goal.team === homeSlug ? state.homeGoalieId : state.awayGoalieId)
      for (const change of changes) {
        if (change.period > goal.period ||
          (change.period === goal.period && parseClockString(change.clock) < parseClockString(goal.clock))) break
        goalieId = change.inGoalieId
      }
      return goalieId
    }

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

      const assistingGoalieId = goalieAtGoal(goal)
      for (const assistId of [goal.assist1Id, goal.assist2Id]) {
        if (assistId == null) continue
        if (assistId === assistingGoalieId) {
          goalieAssists.set(assistId, (goalieAssists.get(assistId) ?? 0) + 1)
        } else {
          const assister = getOrCreate(assistId)
          assister.assists++
          assister.points++
        }
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

    // 8. Compute goalie stats before writing either player or goalie rows
    const totalHomeShots = state.homeShots.reduce((a, b) => a + b, 0)
    const totalAwayShots = state.awayShots.reduce((a, b) => a + b, 0)

    const homeWon = homeScore > awayScore
    // Compute total game time: 3 regulation periods + OT periods
    const gameIsPlayoff = !!game.isPlayoff
    const seasonGameLength = game.gameLength || 60
    const regulationGameSecs = seasonGameLength * 60
    const regulationPeriodSecs = regulationGameSecs / 3

    const maxPeriod = Math.max(...state.goals.map((g) => g.period), state.period ?? 3)
    const otPeriods = Math.max(0, Math.min(maxPeriod, isShootout ? maxPeriod - 1 : maxPeriod) - 3)
    const otSecsPerPeriod = gameIsPlayoff ? regulationPeriodSecs : 300

    // Compute actual OT elapsed seconds
    let actualOtSeconds = 0
    if (otPeriods > 0) {
      if (isShootout) {
        // If ended in shootout, full OT period was played
        actualOtSeconds = otPeriods * otSecsPerPeriod
      } else {
        // Did a sudden death goal happen in the last OT period?
        const otGoals = state.goals.filter((g) => g.period >= 4)
        if (otGoals.length > 0) {
          // Sort OT goals chronologically
          otGoals.sort((a, b) => clockToElapsed(a.period, parseClockString(a.clock), regulationPeriodSecs, otSecsPerPeriod) - clockToElapsed(b.period, parseClockString(b.clock), regulationPeriodSecs, otSecsPerPeriod))
          const winningGoal = otGoals[0]
          // Elapsed seconds in the winning OT period:
          const winningOtPeriod = winningGoal.period
          const elapsedInWinningOt = otSecsPerPeriod - parseClockString(winningGoal.clock)
          // Add prior OT periods (if any) + elapsed in winning period
          actualOtSeconds = (winningOtPeriod - 4) * otSecsPerPeriod + elapsedInWinningOt
        } else {
          // No OT goals, ended in a tie but no shootout
          actualOtSeconds = otPeriods * otSecsPerPeriod
        }
      }
    }

    const totalGameSecs = regulationGameSecs + actualOtSeconds
    const pulls = state.goaliePulls ?? []
    const goalieChanges = state.goalieChanges ?? []

    for (const [team, currentGoalie] of [[homeSlug, state.homeGoalieId], [awaySlug, state.awayGoalieId]] as const) {
      const changes = goalieChanges.filter((change) => change.team === team)
        .sort((a, b) => clockToElapsed(a.period, parseClockString(a.clock), regulationPeriodSecs, otSecsPerPeriod) - clockToElapsed(b.period, parseClockString(b.clock), regulationPeriodSecs, otSecsPerPeriod))
      if (changes.some((change, index) => {
        const elapsed = clockToElapsed(change.period, parseClockString(change.clock), regulationPeriodSecs, otSecsPerPeriod)
        return elapsed < 0 || elapsed > totalGameSecs || change.outGoalieId === change.inGoalieId ||
          (index > 0 && changes[index - 1].inGoalieId !== change.outGoalieId)
      }) || (changes.length > 0 && changes[changes.length - 1].inGoalieId !== currentGoalie)) {
        return NextResponse.json({ error: "Goalie substitution history must consistently identify who was in net" }, { status: incompleteStatus })
      }
    }

    // Helper: compute per-goalie stats for a team
    function computeTeamGoalieStats(
      teamSlug: string,
      teamAttendance: number[],
      goalsAgainstEvents: GoalEvent[], // goals scored by the opposing team
      totalShots: number, // total shots by the opposing team
      isHome: boolean
    ) {
      const teamChanges = goalieChanges.filter((c) => c.team === teamSlug)
        .sort((a, b) => clockToElapsed(a.period, parseClockString(a.clock), regulationPeriodSecs, otSecsPerPeriod) - clockToElapsed(b.period, parseClockString(b.clock), regulationPeriodSecs, otSecsPerPeriod))

      const teamGoalieIds = new Set<number>([isHome ? state.homeGoalieId! : state.awayGoalieId!])
      for (const change of teamChanges) {
        teamGoalieIds.add(change.outGoalieId)
        teamGoalieIds.add(change.inGoalieId)
      }
      const teamGoalies = teamAttendance.filter((pid) => teamGoalieIds.has(pid))

      // With no substitution history, a single assigned goalie faced all
      // non-empty-net shots. Validation below rejects ambiguous allocations.
      if (teamChanges.length === 0) {
        const pulledSecs = computePulledSeconds(pulls, teamSlug, regulationPeriodSecs, otSecsPerPeriod)
        const seconds = Math.max(0, totalGameSecs - pulledSecs)
        const ga = goalsAgainstEvents.length
        return teamGoalies.map((goalieId) => ({
          goalieId,
          seconds,
          goalsAgainst: ga,
          shotsAgainst: state.goalieShotsAgainst?.[String(goalieId)] ?? totalShots,
          saves: (state.goalieShotsAgainst?.[String(goalieId)] ?? totalShots) - ga,
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
        endElapsed: clockToElapsed(firstChange.period, parseClockString(firstChange.clock), regulationPeriodSecs, otSecsPerPeriod),
      })

      // Middle segments (between changes)
      for (let i = 0; i < teamChanges.length; i++) {
        const change = teamChanges[i]
        const nextChange = teamChanges[i + 1]
        segments.push({
          goalieId: change.inGoalieId,
          startElapsed: clockToElapsed(change.period, parseClockString(change.clock), regulationPeriodSecs, otSecsPerPeriod),
          endElapsed: nextChange
            ? clockToElapsed(nextChange.period, parseClockString(nextChange.clock), regulationPeriodSecs, otSecsPerPeriod)
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
        const pullStart = clockToElapsed(pull.period, parseClockString(pull.pulledAt), regulationPeriodSecs, otSecsPerPeriod)
        const pullEnd = pull.returnedAt
          ? clockToElapsed(pull.period, parseClockString(pull.returnedAt), regulationPeriodSecs, otSecsPerPeriod)
          : clockToElapsed(pull.period, 0, regulationPeriodSecs, otSecsPerPeriod)
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
        const goalElapsed = clockToElapsed(goal.period, parseClockString(goal.clock), regulationPeriodSecs, otSecsPerPeriod)
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

      // Time played cannot establish which goalie faced a shot. Multiple
      // goalies require an explicit, complete allocation, validated below.
      return Array.from(goalieStatsMap.entries()).map(([goalieId, stats]) => {
        const sa = state.goalieShotsAgainst?.[String(goalieId)] ?? totalShots
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

    // Team SOG includes ENGs, but an empty-net goal is neither a shot faced
    // nor a save by a goalie. Never manufacture extra saves from ENG shots.
    const homeEmptyNetGoals = state.goals.filter((g) => g.team === homeSlug && g.period <= 4 && g.flags.includes("ENG")).length
    const awayEmptyNetGoals = state.goals.filter((g) => g.team === awaySlug && g.period <= 4 && g.flags.includes("ENG")).length

    const homeGoalieStats = computeTeamGoalieStats(
      homeSlug, state.homeAttendance,
      state.goals.filter((g) => g.team === awaySlug && g.period <= 4 && !g.flags.includes("ENG")),
      totalAwayShots - awayEmptyNetGoals, true
    )
    const awayGoalieStats = computeTeamGoalieStats(
      awaySlug, state.awayAttendance,
      state.goals.filter((g) => g.team === homeSlug && g.period <= 4 && !g.flags.includes("ENG")),
      totalHomeShots - homeEmptyNetGoals, false
    )

    // Validate the entire proposed result before ANY database mutation. The
    // HTTP database driver has no transactions, so even placeholder players
    // and deletes must wait until both teams' goalie statistics are valid.
    for (const [goalies, totalShots, team] of [
      [homeGoalieStats, totalAwayShots - awayEmptyNetGoals, "Home"],
      [awayGoalieStats, totalHomeShots - homeEmptyNetGoals, "Away"],
    ] as const) {
      const error = validateGoalieShotAllocation(state.goalieShotsAgainst, goalies, totalShots, team)
      if (error) return NextResponse.json({ error }, { status: 400 })
      if (goalies.some((goalie) => !Number.isSafeInteger(goalie.seconds) || goalie.seconds < 0 || goalie.seconds > 2_147_483_647)) {
        return NextResponse.json({ error: `${team} goalie time is invalid` }, { status: 400 })
      }
      if (goalies.some((goalie) => !Number.isSafeInteger(goalie.saves) || goalie.saves < 0)) {
        return NextResponse.json({ error: `${team} goalie saves cannot be negative` }, { status: 400 })
      }
    }
    if (state.goalieShotsAgainst && Object.keys(state.goalieShotsAgainst).some((id) => !goalieIds.has(Number(id)))) {
      return NextResponse.json({ error: "Shot allocations contain an unassigned goalie" }, { status: 400 })
    }

    if ([...playerStats.values()].some((stats) => !Number.isSafeInteger(stats.pim) || stats.pim < 0 || stats.pim > 2_147_483_647)) {
      return NextResponse.json({ error: "Player penalty totals are invalid" }, { status: 400 })
    }

    // Look up which players are subs in this game (from adhoc_game_rosters).
    // Subs still get pgs/ggs rows so they appear on the game's box score,
    // but the is_sub flag is denormalized onto those rows so season-stats
    // aggregations can filter them out.
    const adhocRows = await db
      .select({ playerId: schema.adhocGameRosters.playerId, isSub: schema.adhocGameRosters.isSub })
      .from(schema.adhocGameRosters)
      .where(eq(schema.adhocGameRosters.gameId, id))
    const subIds = new Set<number>(adhocRows.filter((r) => r.isSub).map((r) => r.playerId))

    // 9. Ensure all referenced players exist (merges can delete players while live game state still references them)
    const allPlayerIds = [...playerStats.keys(), ...goalieIds]
    let missingIds: number[] = []
    if (allPlayerIds.length > 0) {
      const existingPlayers = await db
        .select({ id: schema.players.id })
        .from(schema.players)
        .where(inArray(schema.players.id, allPlayerIds))
      const existingIds = new Set(existingPlayers.map((p) => p.id))
      missingIds = allPlayerIds.filter((pid) => !existingIds.has(pid))
    }

    // Every validated finalization, including the scorekeeper's bodyless POST,
    // must claim the exact snapshot before any statistics or placeholder writes.
    // The claim prevents overlapping rebuilds and shot-only corrections, but
    // does not make the following sequential writes atomic.
    const runningState: LiveGameState = {
      ...state,
      updatedAt: Date.now(),
      finalizationPending: { attemptId: randomUUID(), phase: "running" },
    }
    claimAttempted = true
    const savedRows = await rawSql(sql`
      WITH eligible_game AS MATERIALIZED (
        SELECT id FROM games
        WHERE id = ${id} AND status = ${game.status} AND NOT is_forfeit
          AND home_team = ${homeSlug} AND away_team = ${awaySlug}
          AND season_id = ${game.seasonId}
          AND home_score IS NOT DISTINCT FROM ${game.homeScore}::integer
          AND away_score IS NOT DISTINCT FROM ${game.awayScore}::integer
        FOR UPDATE
      )
      UPDATE game_live l SET state = (${JSON.stringify(runningState)}::jsonb - 'shotCorrections') ||
        CASE WHEN l.state ? 'shotCorrections'
          THEN jsonb_build_object('shotCorrections', l.state->'shotCorrections') ELSE '{}'::jsonb END,
        updated_at = NOW()
      WHERE l.game_id IN (SELECT id FROM eligible_game) AND l.state = ${JSON.stringify(storedState)}::jsonb
      RETURNING l.state
    `)
    if (!savedRows.length) {
      return NextResponse.json({ error: "Game changed while saving; reload before finalizing" }, { status: 409 })
    }
    acceptedState = savedRows[0].state as LiveGameState

    for (const missingId of missingIds) {
      await db
        .insert(schema.players)
        .values({ id: missingId, name: `Unknown Player #${missingId}` })
        .onConflictDoNothing()
      console.warn(`[finalize] Created missing player record for ID ${missingId}`)
    }

    // 10. Delete old player/goalie stats then insert fresh for attending players
    await db.delete(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, id))

    for (const [playerId, stats] of playerStats) {
      const isGoalie = goalieIds.has(playerId)
      const isSub = subIds.has(playerId)
      const hasSkaterStats = stats.goals > 0 || stats.assists > 0 || stats.pen > 0 || stats.pim > 0

      // Goalie assists belong only in goalie_game_stats. Subs are displayed
      // there via adhoc_game_rosters too, so they need no phantom runner row.
      if (isGoalie && !hasSkaterStats) continue

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
          isSub,
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
            isSub,
          },
        })
    }

    await db.delete(schema.goalieGameStats).where(eq(schema.goalieGameStats.gameId, id))

    for (const gs of [...homeGoalieStats, ...awayGoalieStats]) {
      const isSub = subIds.has(gs.goalieId)
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
          goalieAssists: goalieAssists.get(gs.goalieId) ?? 0,
          result: gs.result,
          isSub,
        })
        .onConflictDoUpdate({
          target: [schema.goalieGameStats.playerId, schema.goalieGameStats.gameId],
          set: {
            seconds: gs.seconds,
            goalsAgainst: gs.goalsAgainst,
            shotsAgainst: gs.shotsAgainst,
            saves: gs.saves,
            shutouts: gs.shutouts,
            goalieAssists: goalieAssists.get(gs.goalieId) ?? 0,
            result: gs.result,
            isSub,
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
    const finalizedGames = await db
      .update(schema.games)
      .set({
        status: "final",
        homeScore,
        awayScore,
        isOvertime,
        hasBoxscore: true,
        notes,
      })
      // An admin may mark the game forfeited while stats are being written.
      // Never replace that official result with the live scoring total.
      .where(and(eq(schema.games.id, id), eq(schema.games.isForfeit, false)))
      .returning({ id: schema.games.id })

    if (finalizedGames.length === 0) {
      return await failedFinalization("Game was removed or marked forfeited during finalization", 409)
    }

    const completedState = { ...acceptedState, updatedAt: Date.now() }
    delete completedState.finalizationPending
    const cleanState = await replaceClaimedState(completedState)
    if (!cleanState) throw new Error("The completed finalization claim could not be cleared")

    return NextResponse.json({ ok: true, homeScore, awayScore, isOvertime, state: cleanState })
  } catch (error) {
    console.error("Failed to finalize game:", error)
    return await failedFinalization("Failed to finalize game", 500, error instanceof Error ? error.message : String(error))
  }
}
