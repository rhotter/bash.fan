import { db, schema } from "@/lib/db"
import { faker } from "@faker-js/faker"

type Season = typeof schema.seasons.$inferSelect
type Team = typeof schema.teams.$inferSelect

export type GameOverrides = Omit<Partial<typeof schema.games.$inferInsert>, "id" | "homeTeam" | "awayTeam">

/** A final, scored game on a random date unless overridden. Pass `date` when a test depends on it. */
export async function setupGame({
  season,
  homeTeam,
  awayTeam,
  ...overrides
}: GameOverrides & { season: Season; homeTeam: Team; awayTeam: Team }) {
  const [game] = await db
    .insert(schema.games)
    .values({
      id: faker.string.nanoid(8),
      seasonId: season.id,
      homeTeam: homeTeam.slug,
      awayTeam: awayTeam.slug,
      date: faker.date.future().toISOString().slice(0, 10),
      time: `${faker.number.int({ min: 6, max: 11 })}:00${faker.helpers.arrayElement(["a", "p"])}`,
      homeScore: faker.number.int({ min: 0, max: 12 }),
      awayScore: faker.number.int({ min: 0, max: 12 }),
      status: "final",
      hasBoxscore: true,
      ...overrides,
    })
    .returning()
  return { game }
}
