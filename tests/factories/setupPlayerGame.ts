import { db, schema } from "@/lib/db"

export async function setupPlayerGame({
  player,
  game,
  ...stats
}: Partial<typeof schema.playerGameStats.$inferInsert> & {
  player: typeof schema.players.$inferSelect
  game: typeof schema.games.$inferSelect
}) {
  await db.insert(schema.playerGameStats).values({ playerId: player.id, gameId: game.id, ...stats })
}
