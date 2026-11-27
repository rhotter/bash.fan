import { and, eq, inArray, notInArray, sql } from "drizzle-orm"
import { z } from "zod"
import { db, schema } from "@/lib/db"
import type { ManagerIdentity } from "./managers"
import { readSeasonGames } from "./lineups"
import { isValidPrediction, MAX_PREDICTED_SCORE, type Prediction } from "./pickem"
import type { FantasySeason } from "./season"
import { countsForGame, gameWeekId, openWeek } from "./week"

const { fantasyPredictions } = schema

const sqlExcluded = (column: string) => sql.raw(`excluded."${column}"`)

const score = z.number().int().min(0).max(MAX_PREDICTED_SCORE)

export const predictionsRequestSchema = z.object({
  weekId: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  predictions: z
    .array(z.object({ gameId: z.string().min(1).max(100), homeScore: score, awayScore: score }))
    .max(100),
})

export type PredictionError = "tied-score" | "unknown-game" | "duplicate-game"

export type SavePredictionsResult =
  | { outcome: "saved" }
  | { outcome: "locked"; openWeekId: string }
  | { outcome: "no-games" }
  | { outcome: "invalid"; errors: PredictionError[] }

/**
 * Replaces the Manager's Predictions for the Week they were editing: games sent are saved and
 * games left out are cleared. Any Week with games that hasn't locked can be saved. A locked one
 * is refused, so a form left open past its Lock can't change a frozen Week.
 */
export async function savePredictions(
  manager: ManagerIdentity,
  season: FantasySeason,
  weekId: string,
  predictions: Prediction[],
  now = new Date()
): Promise<SavePredictionsResult> {
  const open = openWeek(now, season.config.lock)
  if (weekId < open.id) return { outcome: "locked", openWeekId: open.id }
  return replaceWeekPredictions(manager, season, weekId, predictions, now)
}

/** Replaces a Manager's Predictions for any Week, ignoring the Lock. Every other rule applies. */
export async function adminSavePredictions(
  manager: ManagerIdentity,
  season: FantasySeason,
  weekId: string,
  predictions: Prediction[],
  now = new Date()
) {
  return replaceWeekPredictions(manager, season, weekId, predictions, now)
}

async function replaceWeekPredictions(
  manager: ManagerIdentity,
  season: FantasySeason,
  weekId: string,
  predictions: Prediction[],
  now: Date
): Promise<Exclude<SavePredictionsResult, { outcome: "locked" }>> {
  const { lock } = season.config
  const games = (await readSeasonGames(manager.seasonId, season.config.gameTypes)).filter(
    (game) => countsForGame(game, season.launchedAt, season.config) && gameWeekId(game, lock) === weekId
  )
  if (games.length === 0) return { outcome: "no-games" }

  const weekGameIds = new Set(games.map((game) => game.id))
  const errors = new Set<PredictionError>()
  const seen = new Set<string>()
  for (const prediction of predictions) {
    if (!weekGameIds.has(prediction.gameId)) errors.add("unknown-game")
    else if (seen.has(prediction.gameId)) errors.add("duplicate-game")
    else if (!isValidPrediction(prediction)) errors.add("tied-score")
    seen.add(prediction.gameId)
  }
  if (errors.size > 0) return { outcome: "invalid", errors: [...errors] }

  // One statement, so overlapping saves can't each delete what the other just saved.
  const cleared = db.$with("cleared").as(
    db
      .delete(fantasyPredictions)
      .where(
        and(
          eq(fantasyPredictions.managerId, manager.id),
          inArray(fantasyPredictions.gameId, [...weekGameIds]),
          predictions.length > 0 ? notInArray(fantasyPredictions.gameId, predictions.map((p) => p.gameId)) : undefined
        )
      )
      .returning({ gameId: fantasyPredictions.gameId })
  )
  if (predictions.length === 0) {
    await db.with(cleared).select().from(cleared)
  } else {
    await db
      .with(cleared)
      .insert(fantasyPredictions)
      .values(predictions.map((p) => ({ ...p, managerId: manager.id, updatedAt: now })))
      .onConflictDoUpdate({
        target: [fantasyPredictions.managerId, fantasyPredictions.gameId],
        set: {
          homeScore: sqlExcluded("home_score"),
          awayScore: sqlExcluded("away_score"),
          updatedAt: sqlExcluded("updated_at"),
        },
      })
  }
  return { outcome: "saved" }
}
