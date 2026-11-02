import { db, schema } from "@/lib/db"
import { faker } from "@faker-js/faker"

export async function setupTeam(overrides: Omit<Partial<typeof schema.teams.$inferInsert>, "slug"> = {}) {
  const [team] = await db
    .insert(schema.teams)
    .values({ slug: faker.helpers.slugify(faker.company.name()).toLowerCase(), name: faker.company.name(), ...overrides })
    .returning()
  return { team }
}
