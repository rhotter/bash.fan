import { Pool } from "pg"

// A pool holds open connections, and `next dev` re-evaluates modules on edits,
// so the pool is kept on globalThis to stop each reload opening another one.
const globalForDb = globalThis as unknown as { localDbPool?: { url: string; pool: Pool } }

/** The connection pool for a local Postgres. A changed URL gets a new pool and closes the old one. */
export function getLocalPool(url: string): Pool {
  const cached = globalForDb.localDbPool
  if (cached?.url === url) return cached.pool
  cached?.pool.end().catch((error: unknown) => console.error("[db] Could not close the previous local pool:", error))

  const pool = new Pool({ connectionString: url })
  // Restarting or resetting the container drops idle connections. Without a listener, that
  // "error" event would crash the process; the pool reconnects on the next query.
  pool.on("error", (error) => console.error("[db] Lost an idle local database connection:", error.message))
  if (process.env.NODE_ENV !== "production") globalForDb.localDbPool = { url, pool }
  return pool
}
