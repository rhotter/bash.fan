import { db, schema } from "@/lib/db"
import { faker } from "@faker-js/faker"

/** The slug comes from the name. A random suffix keeps two default teams from colliding. */
export async function setupTeam(overrides: Partial<typeof schema.teams.$inferInsert> = {}) {
  const name = overrides.name ?? `${faker.company.name()} ${faker.string.alphanumeric(4)}`
  const [team] = await db
    .insert(schema.teams)
    .values({ name, slug: faker.helpers.slugify(name).toLowerCase(), ...overrides })
    .returning()
  return { team }
}
