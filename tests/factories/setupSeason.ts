import { db, schema } from "@/lib/db"
import { faker } from "@faker-js/faker"

export async function setupSeason(overrides: Omit<Partial<typeof schema.seasons.$inferInsert>, "id"> = {}) {
  const [season] = await db
    .insert(schema.seasons)
    .values({ id: faker.string.nanoid(8), name: faker.lorem.words(2), ...overrides })
    .returning()
  return { season }
}
