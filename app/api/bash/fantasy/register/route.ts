import { createHmac } from "node:crypto"
import { and, inArray, lte, sql } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { createManager, registrationSchema } from "@/lib/fantasy/managers"
import { reply } from "@/lib/fantasy/reply"
import { getCurrentFantasySeason, parseContest } from "@/lib/fantasy/season"

const { operatorAuthAttempts: attempts } = schema

const CLIENT_LIMIT = 10
const GLOBAL_LIMIT = 200
const GLOBAL_BUCKET = "fantasy-register:global"
const REGISTRATION_WINDOW_SECONDS = 3600

/**
 * Counts this attempt and says whether it may go ahead. Shares the operator_auth_attempts
 * table but not check_operator_attempt: its global bucket also limits admin sign-in, which
 * a flood of anonymous registrations must not be able to exhaust.
 */
async function allowRegistration(request: Request, secret: string) {
  // Same rule as checkCredential: only Vercel's header is trusted, and unknown hosts share a bucket.
  const ip = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() || "unknown" : "local"
  const client = `fantasy-register:${createHmac("sha256", secret).update(ip).digest("hex")}`
  const buckets = [client, GLOBAL_BUCKET]
  const now = new Date()
  const expiresAt = new Date(now.getTime() + REGISTRATION_WINDOW_SECONDS * 1000)

  await db.delete(attempts).where(and(inArray(attempts.bucket, buckets), lte(attempts.expiresAt, now)))
  const rows = await db
    .insert(attempts)
    .values(buckets.map((bucket) => ({ bucket, failures: 1, expiresAt })))
    .onConflictDoUpdate({ target: attempts.bucket, set: { failures: sql`${attempts.failures} + 1` } })
    .returning({ bucket: attempts.bucket, failures: attempts.failures })
  return rows.every((row) => row.failures <= (row.bucket === GLOBAL_BUCKET ? GLOBAL_LIMIT : CLIENT_LIMIT))
}

export async function POST(request: Request) {
  try {
    const secret = process.env.SESSION_SECRET
    if (!secret || secret.length < 32) return reply({ error: "Registration isn't available right now." }, 503)

    const requested = new URL(request.url).searchParams.get("contest")
    const contest = requested === null ? undefined : parseContest(requested)
    const season = contest === null ? null : await getCurrentFantasySeason(contest)
    if (!season) return reply({ error: "Fantasy isn't open for registration." }, 404)

    if (!(await allowRegistration(request, secret))) {
      return reply({ error: "Too many registrations. Try again later." }, 429, {
        "Retry-After": String(REGISTRATION_WINDOW_SECONDS),
      })
    }

    const input = registrationSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) {
      return reply({ error: "Enter a Team Name of up to 40 characters, and your first and last name." }, 400)
    }

    const manager = await createManager(season.seasonId, season.contest, input.data)
    if (!manager) return reply({ error: "That Team Name is taken." }, 409)
    return reply(manager, 201)
  } catch (error) {
    console.error("Fantasy registration failed:", error)
    return reply({ error: "Registration failed. Please try again." }, 500)
  }
}
