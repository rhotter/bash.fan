import type { FantasyConfig } from "./config"
import type { SeasonGame } from "./lineups"
import { gameState, rankBy, type WeekGame } from "./scoring"
import { countsForGame, gameWeekId, weekContaining } from "./week"

export const MAX_PREDICTED_SCORE = 30

export interface PickemGame extends WeekGame {
  homeScore: number | null
  awayScore: number | null
}

export interface Prediction {
  gameId: string
  homeScore: number
  awayScore: number
}

export interface PickemResult {
  correct: number
  goalError: number
  /** True while a game still has no final score. */
  provisional: boolean
}

const isScore = (value: number) => Number.isInteger(value) && value >= 0 && value <= MAX_PREDICTED_SCORE

/** A Prediction must be a real score from 0 up to MAX_PREDICTED_SCORE with a winner: tied scores are rejected. */
export function isValidPrediction({ homeScore, awayScore }: Prediction) {
  return isScore(homeScore) && isScore(awayScore) && homeScore !== awayScore
}

/** A game with no final score yet. Pick'em needs the score, not a boxscore. */
const isUnscored = ({ status, homeScore, awayScore }: PickemGame) =>
  status !== "final" || homeScore === null || awayScore === null

export type PredictionOutcome = "correct" | "wrong" | "pending" | "void"

/** How one Prediction fared. */
export function judgePrediction(game: PickemGame, prediction: Prediction) {
  if (gameState(game) === "void") return { outcome: "void" as const, goalError: 0 }
  const { homeScore, awayScore } = game
  if (isUnscored(game) || homeScore === null || awayScore === null) {
    return { outcome: "pending" as const, goalError: 0 }
  }
  const goalError = Math.abs(prediction.homeScore - homeScore) + Math.abs(prediction.awayScore - awayScore)
  const sameWinner = Math.sign(prediction.homeScore - prediction.awayScore) === Math.sign(homeScore - awayScore)
  return { outcome: sameWinner ? ("correct" as const) : ("wrong" as const), goalError }
}

/**
 * Scores a Manager's Predictions over a set of games, such as a Week or a season. A skipped
 * game has no penalty: it can't be a correct winner, and goal error counts only predicted games.
 */
export function scorePickem(games: PickemGame[], predictions: Prediction[]): PickemResult {
  const byGame = new Map(predictions.map((p) => [p.gameId, p]))
  const result: PickemResult = { correct: 0, goalError: 0, provisional: false }

  for (const game of games) {
    if (gameState(game) === "void") continue
    const prediction = byGame.get(game.id)
    const { outcome, goalError } = prediction ? judgePrediction(game, prediction) : { outcome: null, goalError: 0 }
    if (isUnscored(game)) result.provisional = true
    if (outcome === "correct") result.correct++
    result.goalError += goalError
  }
  return result
}

/** Most correct winners first, then lowest goal error. */
export function rankPickem<T extends { correct: number; goalError: number }>(entries: T[]) {
  return rankBy(entries, (a, b) => b.correct - a.correct || a.goalError - b.goalError)
}

export interface PublicPrediction extends Prediction {
  outcome: PredictionOutcome
}

export interface PickemRow {
  rank: number
  /** Public on purpose: the Manager page URL uses it, since Team Names can be renamed. */
  managerId: number
  teamName: string
  correct: number
  goalError: number
}

export interface PickemWeekRow extends PickemRow {
  predictions: PublicPrediction[]
}

export interface PickemWeek {
  id: string
  /** True while a game in the Week has no final score, so the result can still change. */
  provisional: boolean
  /** Only Managers who made a Prediction for the Week. */
  rows: PickemWeekRow[]
}

/** Plain data: this is stored in the page cache, so it has to survive JSON. */
export interface PickemStandings {
  /** Locked Weeks with counting games, oldest first. */
  weeks: PickemWeek[]
  season: { provisional: boolean; rows: PickemRow[] }
}

export interface PickemStandingsInput {
  /** Pass Team Names only. Nothing else about a Manager belongs in public standings. */
  managers: { id: number; teamName: string }[]
  predictions: (Prediction & { managerId: number })[]
  games: SeasonGame[]
  config: FantasyConfig
  launchedAt: Date
  now: Date
}

const ranked = <T extends { managerId: number; teamName: string; correct: number; goalError: number }>(rows: T[]) =>
  rankPickem([...rows].sort((a, b) => a.teamName.localeCompare(b.teamName)))

/** Derived from the current scores on every call. Predictions in a Week that hasn't locked never appear. */
export function buildPickemStandings(input: PickemStandingsInput): PickemStandings {
  const { managers, predictions, games, config, launchedAt, now } = input
  const lastLockedWeek = weekContaining(now, config.lock).id

  const gamesByWeek = new Map<string, SeasonGame[]>()
  for (const game of games) {
    if (!countsForGame(game, launchedAt, config.lock)) continue
    const weekId = gameWeekId(game, config.lock)
    if (weekId > lastLockedWeek) continue
    gamesByWeek.set(weekId, [...(gamesByWeek.get(weekId) ?? []), game])
  }

  const predictionsByManager = new Map<number, Prediction[]>()
  for (const { managerId, ...prediction } of predictions) {
    predictionsByManager.set(managerId, [...(predictionsByManager.get(managerId) ?? []), prediction])
  }

  const season = new Map(managers.map((m) => [m.id, { correct: 0, goalError: 0 }]))
  const weeks = [...gamesByWeek.keys()].sort().map((id): PickemWeek => {
    const weekGames = gamesByWeek.get(id)!
    const rows = managers.flatMap(({ id: managerId, teamName }) => {
      const made = (predictionsByManager.get(managerId) ?? []).filter((p) => weekGames.some((g) => g.id === p.gameId))
      if (made.length === 0) return []
      const { correct, goalError } = scorePickem(weekGames, made)
      const total = season.get(managerId)!
      total.correct += correct
      total.goalError += goalError
      const byId = new Map(weekGames.map((g) => [g.id, g]))
      return [
        {
          managerId,
          teamName,
          correct,
          goalError,
          predictions: made.map((p) => ({ ...p, outcome: judgePrediction(byId.get(p.gameId)!, p).outcome })),
        },
      ]
    })
    return {
      id,
      provisional: weekGames.some((g) => gameState(g) !== "void" && isUnscored(g)),
      rows: ranked(rows),
    }
  })

  const withPredictions = new Set(
    weeks.flatMap((week) => week.rows.map((row) => row.teamName))
  )
  return {
    weeks,
    season: {
      provisional: weeks.some((week) => week.provisional),
      rows: ranked(
        managers
          .filter(({ teamName }) => withPredictions.has(teamName))
          .map(({ id, teamName }) => ({ managerId: id, teamName, ...season.get(id)! }))
      ),
    },
  }
}
