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
 * games left out are cleared. A Week other than the open one is refused, so a form left open
 * past the Lock can't change a frozen Week or land in the next one.
 */
export async function savePredictions(
  manager: ManagerIdentity,
  season: FantasySeason,
  weekId: string,
  predictions: Prediction[],
  now = new Date()
): Promise<SavePredictionsResult> {
  const { lock } = season.config
  const open = openWeek(now, lock)
  if (weekId !== open.id) return { outcome: "locked", openWeekId: open.id }

  const games = (await readSeasonGames(manager.seasonId, season.config.gameTypes)).filter(
    (game) => countsForGame(game, season.launchedAt, lock) && gameWeekId(game, lock) === weekId
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

  // Save before clearing, so a failure between the two never loses a Prediction.
  if (predictions.length > 0) {
    await db
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
  await db
    .delete(fantasyPredictions)
    .where(
      and(
        eq(fantasyPredictions.managerId, manager.id),
        inArray(fantasyPredictions.gameId, [...weekGameIds]),
        predictions.length > 0 ? notInArray(fantasyPredictions.gameId, predictions.map((p) => p.gameId)) : undefined
      )
    )
  return { outcome: "saved" }
}
