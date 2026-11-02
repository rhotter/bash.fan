import { config } from "dotenv"
config({ path: ".env.local" })

import { sql } from "drizzle-orm"
import { beforeEach, vi } from "vitest"
import type { TestDb } from "./helpers/pglite-db"

let testDb: TestDb | undefined

// Any test importing @/lib/db gets a real in-memory Postgres, built on first import.
// Tests that declare their own vi.mock("@/lib/db") keep it.
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("./helpers/pglite-db")
  testDb = await createTestDb()
  const { db } = testDb
  return {
    db,
    schema: await import("@/lib/db/schema"),
    rawSql: async (query: Parameters<typeof db.execute>[0]) => (await db.execute(query)).rows,
  }
})

beforeEach(async () => {
  await testDb?.db.execute(sql`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `)
})
