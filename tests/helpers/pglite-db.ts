import { PGlite } from "@electric-sql/pglite"
import { pushSchema } from "drizzle-kit/api"
import { drizzle } from "drizzle-orm/pglite"
import { readFileSync } from "node:fs"
import * as schema from "@/lib/db/schema"

// schema.ts can't express these, so they load from the scripts production ran.
// secure-mcp-access.sql starts with role grants that only exist on production.
function objectsOutsideSchemaTs() {
  const access = readFileSync("scripts/secure-mcp-access.sql", "utf8")
  return [
    readFileSync("scripts/operator-security-schema.sql", "utf8"),
    readFileSync("lib/push/schema.sql", "utf8"),
    access.slice(access.indexOf("CREATE OR REPLACE FUNCTION clear_legacy_game_pin")),
  ]
}

// An in-memory Postgres built from the real schema, including the functions and triggers.
export async function createTestDb() {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  const { apply } = await pushSchema(schema, db as never)
  await apply()
  for (const script of objectsOutsideSchemaTs()) await client.exec(script)
  return { client, db }
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>
