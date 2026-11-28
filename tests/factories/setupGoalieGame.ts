import { db, schema } from "@/lib/db"

export async function setupGoalieGame({
  player,
  game,
  ...stats
}: Partial<typeof schema.goalieGameStats.$inferInsert> & {
  player: typeof schema.players.$inferSelect
  game: typeof schema.games.$inferSelect
}) {
  await db.insert(schema.goalieGameStats).values({ playerId: player.id, gameId: game.id, ...stats })
}
