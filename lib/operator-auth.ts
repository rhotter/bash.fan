import { createHmac } from "node:crypto"
import { sql } from "drizzle-orm"
import { rawSql } from "@/lib/db"
import { getOperatorRole, getSession } from "@/lib/admin-session"
import { scorekeeperDateAllowed, secretMatches, type OperatorRole } from "@/lib/auth-policy"

const denied = (error: string, status: number, headers = {}) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } })

/** Shared database counters cover every PIN entry point, across instances.
 * Vercel replaces x-vercel-forwarded-for; untrusted forwarding headers are ignored.
 * Unknown hosts share a bucket (fail closed), rather than trusting spoofable IPs. */
export async function checkCredential(request: Request, value: unknown, adminOnly = false): Promise<OperatorRole | Response> {
  try {
    const secret = process.env.SESSION_SECRET
    if (!secret || secret.length < 32) return denied("Authentication is not configured. Contact an administrator.", 503)
    const ip = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() || "unknown" : "local"
    const key = createHmac("sha256", secret).update(ip).digest("hex")
    const role = secretMatches(value, process.env.ADMIN_PIN) ? "admin" :
      !adminOnly && secretMatches(value, process.env.SCOREKEEPER_PIN) ? "scorekeeper" : null
    const [limit] = await rawSql(sql`SELECT * FROM check_operator_attempt(${key}, ${role === null})`)
    if (!limit?.allowed) return denied("Too many incorrect attempts. Try again in 15 minutes.", 429, { "Retry-After": "900" })
    return role ?? denied("Invalid passcode", 401)
  } catch {
    return denied("Sign-in is temporarily unavailable. Please try again.", 503)
  }
}

export async function authorizeScorekeeper(request: Request, gameId: string): Promise<Response | null> {
  // Retain this admin check as the central bypass for unrestricted corrections.
  if (await getSession()) return null
  let role: OperatorRole | Response | null = await getOperatorRole()
  if (!role) {
    const pin = request.headers.get("x-pin")
    if (!pin) return denied("Sign in to keep score", 401)
    role = await checkCredential(request, pin)
    if (role instanceof Response) return role
  }
  if (role === "admin") return null
  try {
    const [game] = await rawSql(sql`SELECT date FROM games WHERE id = ${gameId}`)
    if (!game) return denied("Game not found", 404)
    if (!scorekeeperDateAllowed(game.date)) return denied("Scorekeeper edits are allowed only on game day and the following day (Pacific time). Ask an admin for other corrections.", 403)
    return null
  } catch {
    return denied("Could not verify this game's edit window. Please try again.", 503)
  }
}
