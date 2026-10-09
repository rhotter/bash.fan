import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import type { SQL } from "drizzle-orm"
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

// DB_TARGET selects which connection string to use: "dev" → DATABASE_URL_DEV,
// "prod" → DATABASE_URL_PROD. Falls back to plain DATABASE_URL if unset.
// In local development, defaults to "dev". On Vercel / production, defaults to "prod".
const defaultTarget = (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") ? "prod" : "dev"
const target = (process.env.DB_TARGET ?? defaultTarget).toLowerCase()
const targetVar = `DATABASE_URL_${target.toUpperCase()}`
const url = process.env[targetVar] ?? process.env.DATABASE_URL
if (!url) {
  throw new Error(`No database URL found (tried ${targetVar} and DATABASE_URL)`)
}
if (typeof window === "undefined") {
  const { host, label } = describeDbEndpoint(url)
  console.log(`[db] DB_TARGET=${target} (${targetVar in process.env ? targetVar : "DATABASE_URL"})`)
  console.log(`[db] Connected to: ${label} [${host}]`)
}

export const connection = neon(url)

export const db = drizzle(connection, { schema })

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
