import { sql } from "drizzle-orm"
import type { LiveGameState } from "./scorekeeper-types"
import { validateGoalieShotAllocation, validateShotArray } from "./goalie-shot-validation"

export interface SavedGoalieShots {
  playerId: number
  goalsAgainst: number
  shotsAgainst: number
  saves: number
  seconds: number
  sides: string[]
}

export interface FinalShotContext {
  status: string
  seasonId: string
  gameLength: number | null
  isOvertime: boolean
  isForfeit: boolean
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  state: LiveGameState
  goalies: SavedGoalieShots[]
}

export interface ShotCorrection {
  homeShots: number[]
  awayShots: number[]
  goalieShotsAgainst?: Record<string, number>
}

export function planFinalShotCorrection(context: FinalShotContext, correction: ShotCorrection) {
  if (context.state.finalizationPending) {
    throw new Error("This game's finalization is pending. Complete or retry that save before correcting shots.")
  }
  if (context.status !== "final" || context.isForfeit) {
    throw new Error("Only completed, non-forfeited games can have goalie shots corrected")
  }
  for (const [label, shots] of [["Home shots", correction.homeShots], ["Away shots", correction.awayShots]] as const) {
    const error = validateShotArray(shots, label)
    if (error) throw new Error(error)
  }
  const allocation = correction.goalieShotsAgainst
  if (allocation !== undefined && (allocation === null || typeof allocation !== "object" || Array.isArray(allocation) ||
      Object.entries(allocation).some(([id, count]) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) ||
        !Number.isSafeInteger(count) || count < 0 || count > 2_147_483_647))) {
    throw new Error("Goalie shot allocations must map player IDs to nonnegative integer shots")
  }
  if (context.goalies.some((g) => g.sides.length !== 1 || !["home", "away"].includes(g.sides[0]))) {
    throw new Error("Cannot identify every saved goalie's team unambiguously; review the game roster first")
  }
  const unknownIds = Object.keys(correction.goalieShotsAgainst ?? {}).filter((id) =>
    !context.goalies.some((g) => String(g.playerId) === id))
  if (unknownIds.length) throw new Error("Shot allocation contains a goalie without a saved game record")

  const updates: { playerId: number; shotsAgainst: number; saves: number }[] = []
  for (const side of ["home", "away"] as const) {
    const opponentShots = side === "home" ? correction.awayShots : correction.homeShots
    const previousShots = side === "home" ? context.state.awayShots : context.state.homeShots
    const goalies = context.goalies.filter((g) => g.sides.includes(side))
    const changed = JSON.stringify(opponentShots) !== JSON.stringify(previousShots) || goalies.some((g) =>
      (correction.goalieShotsAgainst?.[g.playerId] !== undefined && correction.goalieShotsAgainst[g.playerId] !== g.shotsAgainst) ||
      (correction.goalieShotsAgainst !== undefined && context.state.goalieShotsAgainst?.[g.playerId] !== undefined &&
        correction.goalieShotsAgainst[g.playerId] === undefined))
    const explicit = goalies.some((g) => correction.goalieShotsAgainst?.[g.playerId] !== undefined)
    if (!changed && !explicit) continue
    if (!goalies.length || goalies.some((g) => g.sides.length !== 1)) {
      throw new Error(`Cannot identify the ${side} team's saved goalies unambiguously; review its game roster first`)
    }
    const team = side === "home" ? context.homeTeam : context.awayTeam
    const opponent = side === "home" ? context.awayTeam : context.homeTeam
    const officialGoals = side === "home" ? context.awayScore : context.homeScore
    const shootout = context.state.shootout
    const homeSO = shootout?.homeAttempts.filter((a) => a.scored).length ?? 0
    const awaySO = shootout?.awayAttempts.filter((a) => a.scored).length ?? 0
    const shootoutGoal = side === "home" ? Number(awaySO > homeSO) : Number(homeSO > awaySO)
    const goals = context.state.goals.filter((g) => g.team === opponent && g.period <= 4)
    const emptyNetGoals = goals.filter((g) => g.flags.includes("ENG")).length
    const savedGA = goalies.reduce((sum, g) => sum + g.goalsAgainst, 0)
    // With an incomplete old event history, the official score and saved GA
    // must account for every goal. Never guess which missing goals were ENG/SO.
    if (officialGoals == null || officialGoals - shootoutGoal !== savedGA + emptyNetGoals) {
      throw new Error(`The ${side} team's saved goals against do not match the official score; review the scoring record before correcting shots`)
    }
    const hasChanges = (context.state.goalieChanges ?? []).some((c) => c.team === team)
    const hasPulls = (context.state.goaliePulls ?? []).some((p) => p.team === team)
    const assignedId = side === "home" ? context.state.homeGoalieId : context.state.awayGoalieId
    const regulationSeconds = (context.gameLength ?? 0) * 60
    const opposingGoalies = context.goalies.filter((g) => !g.sides.includes(side))
    const opposingSeconds = opposingGoalies.reduce((sum, g) => sum + g.seconds, 0)
    const fullGameTime = Number.isSafeInteger(regulationSeconds) && regulationSeconds > 0 &&
      goalies.length === 1 && goalies[0].seconds >= regulationSeconds &&
      (context.isOvertime || goalies[0].seconds === regulationSeconds) &&
      opposingGoalies.length > 0 && opposingSeconds === goalies[0].seconds
    if (!explicit && (goalies.length !== 1 || hasChanges || hasPulls || !fullGameTime ||
      (assignedId != null && assignedId !== goalies[0].playerId))) {
      throw new Error(`Enter explicit shots against for every ${side} goalie; team totals cannot establish the split`)
    }
    const total = opponentShots.reduce((sum, n) => sum + n, 0) - emptyNetGoals
    const error = validateGoalieShotAllocation(correction.goalieShotsAgainst,
      goalies.map((g) => ({ goalieId: g.playerId, goalsAgainst: g.goalsAgainst })), total, side)
    if (error) throw new Error(error)
    for (const goalie of goalies) {
      const shotsAgainst = correction.goalieShotsAgainst?.[goalie.playerId] ?? total
      updates.push({ playerId: goalie.playerId, shotsAgainst, saves: shotsAgainst - goalie.goalsAgainst })
    }
  }
  return updates
}

/** One statement: all shot rows and live totals succeed together or neither does.
 * Lock and compare the complete read snapshots, including goalie rows, so two
 * editors cannot combine one editor's totals with the other's saved statistics.
 * This uses a data-modifying CTE, not unsupported neon-http transactions.
 */
export function finalShotUpdateSql(id: string, context: FinalShotContext, correction: ShotCorrection,
  updates: ReturnType<typeof planFinalShotCorrection>, correctedAt: number) {
  const goalieSnapshot = context.goalies
  const allocation = { ...(correction.goalieShotsAgainst ?? context.state.goalieShotsAgainst) }
  for (const update of updates) {
    if (allocation[update.playerId] !== undefined) allocation[update.playerId] = update.shotsAgainst
  }
  const patch = { ...correction, goalieShotsAgainst: allocation, updatedAt: correctedAt }
  return sql`
    WITH locked_game AS MATERIALIZED (
      SELECT g.id, g.season_id, g.status, g.is_forfeit, g.home_team, g.away_team, g.home_score, g.away_score,
        g.is_overtime, s.game_length
      FROM games g LEFT JOIN seasons s ON s.id = g.season_id WHERE g.id = ${id} FOR UPDATE OF g
    ), locked_live AS MATERIALIZED (
      SELECT game_id, state FROM game_live
      WHERE game_id IN (SELECT id FROM locked_game) FOR UPDATE
    ), locked_goalies AS MATERIALIZED (
      SELECT s.player_id, s.goals_against, s.shots_against, s.saves, s.seconds,
        COALESCE((SELECT jsonb_agg(DISTINCT r.team_side) FROM adhoc_game_rosters r
          WHERE r.game_id = g.id AND r.player_id = s.player_id),
          (SELECT jsonb_agg(DISTINCT CASE WHEN ps.team_slug = g.home_team THEN 'home' ELSE 'away' END)
            FROM player_seasons ps WHERE ps.player_id = s.player_id AND ps.season_id = g.season_id
              AND ps.team_slug IN (g.home_team, g.away_team)), '[]'::jsonb) AS sides
      FROM goalie_game_stats s JOIN locked_game g ON g.id = s.game_id
      WHERE s.game_id IN (SELECT game_id FROM locked_live) ORDER BY s.player_id FOR UPDATE OF s
    ), guard AS (
      SELECT l.game_id FROM locked_live l JOIN locked_game g ON g.id = l.game_id
      WHERE g.status = 'final' AND NOT g.is_forfeit AND NOT (l.state ? 'finalizationPending')
        AND g.season_id = ${context.seasonId}
        AND g.is_overtime = ${context.isOvertime}
        AND g.game_length IS NOT DISTINCT FROM ${context.gameLength}::integer
        AND g.home_team = ${context.homeTeam} AND g.away_team = ${context.awayTeam}
        AND g.home_score IS NOT DISTINCT FROM ${context.homeScore}::integer
        AND g.away_score IS NOT DISTINCT FROM ${context.awayScore}::integer
        AND l.state = ${JSON.stringify(context.state)}::jsonb
        AND COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'playerId', player_id, 'goalsAgainst', goals_against, 'shotsAgainst', shots_against,
          'saves', saves, 'seconds', seconds, 'sides', sides) ORDER BY player_id) FROM locked_goalies), '[]'::jsonb)
          = ${JSON.stringify([...goalieSnapshot].sort((a, b) => a.playerId - b.playerId))}::jsonb
    ), updated_live AS (
      UPDATE game_live l SET state = l.state || ${JSON.stringify(patch)}::jsonb || jsonb_build_object(
        'shotCorrections', COALESCE(l.state->'shotCorrections', '[]'::jsonb) ||
          jsonb_build_array(jsonb_build_object('correctedAt', ${correctedAt}::bigint,
            'previousHomeShots', l.state->'homeShots', 'previousAwayShots', l.state->'awayShots',
            'previousGoalies', ${JSON.stringify(goalieSnapshot)}::jsonb,
            'homeShots', ${JSON.stringify(correction.homeShots)}::jsonb,
            'awayShots', ${JSON.stringify(correction.awayShots)}::jsonb,
            'goalies', ${JSON.stringify(updates)}::jsonb))), updated_at = NOW()
      FROM guard WHERE l.game_id = guard.game_id RETURNING l.game_id, l.state
    ), updated_goalies AS (
      UPDATE goalie_game_stats g SET shots_against = u."shotsAgainst", saves = u.saves
      FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
        AS u("playerId" integer, "shotsAgainst" integer, saves integer), updated_live l
      WHERE g.game_id = l.game_id AND g.player_id = u."playerId" RETURNING g.player_id
    )
    SELECT game_id, state, (SELECT count(*) FROM updated_goalies) AS "updatedGoalies" FROM updated_live
  `
}
