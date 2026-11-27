import { createHmac } from "node:crypto"
import { and, eq, lte, sql } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { createManager, registrationSchema } from "@/lib/fantasy/managers"
import { reply } from "@/lib/fantasy/reply"
import { listCurrentFantasyContests, parseContest, pickRegistrationContest } from "@/lib/fantasy/season"
import { runStatus, takesRegistrations } from "@/lib/fantasy/week"

const { operatorAuthAttempts: attempts } = schema

const CLIENT_LIMIT = 10
const GLOBAL_LIMIT = 200
const GLOBAL_BUCKET = "fantasy-register:global"
const REGISTRATION_WINDOW_SECONDS = 3600

/** Adds one attempt to a bucket, starting it again once its window has passed. */
async function countAttempt(bucket: string, now: Date) {
  const expiresAt = new Date(now.getTime() + REGISTRATION_WINDOW_SECONDS * 1000)
  await db.delete(attempts).where(and(eq(attempts.bucket, bucket), lte(attempts.expiresAt, now)))
  const [row] = await db
    .insert(attempts)
    .values({ bucket, failures: 1, expiresAt })
    .onConflictDoUpdate({ target: attempts.bucket, set: { failures: sql`${attempts.failures} + 1` } })
    .returning({ failures: attempts.failures, expiresAt: attempts.expiresAt })
  return row
}

const secondsUntil = (time: Date, now: Date) => Math.max(1, Math.ceil((time.getTime() - now.getTime()) / 1000))

/**
 * Counts this attempt. Returns null if it may go ahead, or else the seconds to wait. Shares the
 * operator_auth_attempts table but not check_operator_attempt: its global bucket also limits admin
 * sign-in, which a flood of anonymous registrations must not be able to exhaust.
 */
async function registrationWait(request: Request, secret: string, now: Date) {
  // Same rule as checkCredential: only Vercel's header is trusted, and unknown hosts share a bucket.
  const ip = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() || "unknown" : "local"
  const client = await countAttempt(`fantasy-register:${createHmac("sha256", secret).update(ip).digest("hex")}`, now)
  // A blocked client stops here, so it can't use up the limit everyone shares.
  if (client.failures > CLIENT_LIMIT) return secondsUntil(client.expiresAt, now)

  const global = await countAttempt(GLOBAL_BUCKET, now)
  if (global.failures <= GLOBAL_LIMIT) return null
  // Once per window, so a flood doesn't flood the log too.
  if (global.failures === GLOBAL_LIMIT + 1) {
    console.warn(`Fantasy registration reached its limit of ${GLOBAL_LIMIT} for all clients; new teams are blocked until ${global.expiresAt.toISOString()}.`)
  }
  return secondsUntil(global.expiresAt, now)
}

export async function POST(request: Request) {
  try {
    const secret = process.env.SESSION_SECRET
    if (!secret || secret.length < 32) return reply({ error: "Registration isn't available right now." }, 503)

    const requested = new URL(request.url).searchParams.get("contest")
    const contest = requested === null ? undefined : parseContest(requested)
    const contests = contest === null ? [] : await listCurrentFantasyContests()
    const now = new Date()
    const season = pickRegistrationContest(contests, contest ?? undefined, now)
    if (!season) return reply({ error: "Fantasy isn't open for registration." }, 404)
    if (!takesRegistrations(runStatus(season.config, now))) {
      return reply({ error: "This run has closed, so registration is closed too." }, 409)
    }

    // Checked before counting, so requests that could never register anyone use up nobody's limit.
    const input = registrationSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) {
      return reply({ error: "Enter a Team Name of up to 40 characters, and your first and last name." }, 400)
    }

    const wait = await registrationWait(request, secret, now)
    if (wait !== null) {
      return reply({ error: "Too many registrations. Try again later." }, 429, { "Retry-After": String(wait) })
    }

    const manager = await createManager(season.seasonId, season.contest, input.data)
    if (!manager) return reply({ error: "That Team Name is taken." }, 409)
    return reply(manager, 201)
  } catch (error) {
    console.error("Fantasy registration failed:", error)
    return reply({ error: "Registration failed. Please try again." }, 500)
  }
}
