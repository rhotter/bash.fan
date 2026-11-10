import { db, schema } from "@/lib/db"
import { faker } from "@faker-js/faker"

type Season = typeof schema.seasons.$inferSelect
type Team = typeof schema.teams.$inferSelect

/** `roster` adds a player_seasons row per entry, so two entries make a traded Player. */
export async function setupPlayer({
  roster = [],
  ...overrides
}: Omit<Partial<typeof schema.players.$inferInsert>, "id"> & {
  roster?: { season: Season; team: Team; isGoalie?: boolean }[]
} = {}) {
  const [player] = await db
    .insert(schema.players)
    .values({ name: faker.person.fullName(), ...overrides })
    .returning()
  if (roster.length > 0) {
    await db.insert(schema.playerSeasons).values(
      roster.map(({ season, team, isGoalie = false }) => ({
        playerId: player.id,
        seasonId: season.id,
        teamSlug: team.slug,
        isGoalie,
      }))
    )
  }
  return { player }
}
