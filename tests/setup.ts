import { config } from "dotenv"
config({ path: ".env.local" })

import { sql } from "drizzle-orm"
import { beforeEach, vi } from "vitest"
import type { TestDb } from "./helpers/pglite-db"

let testDb: TestDb | undefined

// Any test importing @/lib/db gets a real in-memory Postgres, built on first import.
// Tests that declare their own vi.mock("@/lib/db") keep it.
// Browser (jsdom) tests get an empty stub instead: they have no business querying.
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema")
  if (typeof window !== "undefined") return { db: {}, schema, rawSql: vi.fn() }
  const { createTestDb } = await import("./helpers/pglite-db")
  testDb = await createTestDb()
  const { db } = testDb
  return {
    db,
    schema,
    rawSql: async (query: Parameters<typeof db.execute>[0]) => (await db.execute(query)).rows,
  }
})

beforeEach(async () => {
  await testDb?.db.execute(sql`
    DO $$
    DECLARE stmt text;
    BEGIN
      SELECT 'TRUNCATE TABLE ' || string_agg(quote_ident(tablename), ', ') || ' RESTART IDENTITY CASCADE'
        INTO stmt
        FROM pg_tables
        WHERE schemaname = 'public';
      EXECUTE stmt;
    END $$;
  `)
})
