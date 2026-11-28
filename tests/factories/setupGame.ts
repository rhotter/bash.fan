import { db, schema } from "@/lib/db"
import { faker } from "@faker-js/faker"

type Season = typeof schema.seasons.$inferSelect
type Team = typeof schema.teams.$inferSelect

export type GameOverrides = Omit<Partial<typeof schema.games.$inferInsert>, "id" | "homeTeam" | "awayTeam">

/** A score other than `taken`, because a final BASH game can't end tied. */
function score(taken?: number | null) {
  return faker.helpers.arrayElement(Array.from({ length: 13 }, (_, goals) => goals).filter((goals) => goals !== taken))
}

/**
 * A final, scored game on a random date unless overridden. Pass `date` when a test depends on it.
 * A game with any other status gets no score or boxscore unless the test passes them.
 */
export async function setupGame({
  season,
  homeTeam,
  awayTeam,
  ...overrides
}: GameOverrides & { season: Season; homeTeam: Team; awayTeam: Team }) {
  const isFinal = (overrides.status ?? "final") === "final"
  const homeScore = overrides.homeScore !== undefined ? overrides.homeScore : isFinal ? score(overrides.awayScore) : null
  const [game] = await db
    .insert(schema.games)
    .values({
      id: faker.string.nanoid(8),
      seasonId: season.id,
      homeTeam: homeTeam.slug,
      awayTeam: awayTeam.slug,
      date: faker.date.future().toISOString().slice(0, 10),
      time: `${faker.number.int({ min: 6, max: 11 })}:00${faker.helpers.arrayElement(["a", "p"])}`,
      homeScore,
      awayScore: isFinal ? score(homeScore) : null,
      status: "final",
      hasBoxscore: isFinal,
      ...overrides,
    })
    .returning()
  return { game }
}
