import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres"
import type { SQL } from "drizzle-orm"
import { isLocalDbUrl } from "./is-local-db-url"
import { getLocalPool } from "./local-pool"
import { resolveDbUrl } from "./resolve-db-url"
import * as schema from "./schema"

function describeDbEndpoint(dbUrl: string): { host: string; label: string } {
  try {
    const parsed = new URL(dbUrl)
    const host = parsed.host
    if (process.env.DB_LABEL) {
      return { host, label: process.env.DB_LABEL }
    }
    if (host.includes("ep-frosty-shadow")) {
      return { host, label: "Website Live Production DB (ep-frosty-shadow)" }
    }
    if (host.includes("ep-winter-bird")) {
      return { host, label: "Dev DB (ep-winter-bird / bash_ranger)" }
    }
    return { host, label: "Custom DB" }
  } catch {
    return { host: "unknown", label: process.env.DB_LABEL ?? "Unknown DB" }
  }
}

const { target, targetVar, source, url } = resolveDbUrl(process.env)
if (!url) {
  throw new Error(`No database URL found (tried ${targetVar} and DATABASE_URL)`)
}
if (typeof window === "undefined") {
  const { host, label } = describeDbEndpoint(url)
  console.log(`[db] DB_TARGET=${target} (${source})`)
  console.log(`[db] Connected to: ${label} [${host}]`)
}

function createNeonDb(dbUrl: string) {
  return drizzle(neon(dbUrl), { schema })
}

// Neon's driver only speaks HTTP, so a local Docker Postgres needs node-postgres.
// The cast keeps one db type: code stays limited to what neon-http supports, so
// nothing that only works locally (such as db.transaction) type-checks differently.
function createLocalDb(dbUrl: string) {
  return drizzleNodePg(getLocalPool(dbUrl), { schema }) as unknown as ReturnType<typeof createNeonDb>
}

export const db = isLocalDbUrl(url) ? createLocalDb(url) : createNeonDb(url)

/**
 * Execute raw SQL and return rows with loose typing (like the raw neon driver).
 * Use this for complex queries (CTEs, CROSS JOINs, etc.) where Drizzle's
 * query builder can't express the query.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rawSql(query: SQL): Promise<Record<string, any>[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.execute(query) as any
  return result.rows
}

// Re-export schema for convenience
export { schema }
