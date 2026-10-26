import { cookies } from "next/headers"
import crypto from "crypto"
import type { OperatorRole } from "@/lib/auth-policy"

const COOKIE_NAME = "admin_session"
const MAX_AGE = 14400 // 4 hours in seconds

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 random characters")
  return secret
}

/**
 * Sign a token payload using HMAC-SHA256.
 * Token format: base64(payload).base64(signature)
 */
export function signToken(payload: Record<string, unknown>): string {
  const secret = getSecret()
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payloadStr)
    .digest("base64url")
  return `${payloadStr}.${signature}`
}

/**
 * Verify and decode a signed token. Returns null if invalid or expired.
 */
export function verifyToken(token: string): Record<string, unknown> | null {
  try {
    const secret = getSecret()
    const [payloadStr, signature] = token.split(".")
    if (!payloadStr || !signature || token.split(".").length !== 2) return null

    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(payloadStr)
      .digest("base64url")

    // Timing-safe comparison to prevent timing attacks
    if (
      signature.length !== expectedSig.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))
    ) {
      return null
    }

    const payload = JSON.parse(
      Buffer.from(payloadStr, "base64url").toString("utf-8")
    )

    // Check token age
    if (!Number.isSafeInteger(payload.iat) || payload.iat > Date.now() / 1000 + 30 || Date.now() / 1000 - payload.iat >= MAX_AGE) {
      return null // expired
    }

    return payload
  } catch {
    return null
  }
}

/**
 * Create a signed session token for an authenticated admin.
 */
export function createSessionToken(role: OperatorRole = "admin"): string {
  return signToken({
    authenticated: true,
    role,
    credentialVersion: credentialVersion(role),
    iat: Math.floor(Date.now() / 1000),
  })
}

/**
 * Set the admin session cookie on a Response.
 */
export function setSessionCookie(response: Response, role: OperatorRole = "admin"): Response {
  const token = createSessionToken(role)
  response.headers.append(
    "Set-Cookie",
    [
      `${COOKIE_NAME}=${token}`,
      `Path=/`,
      `HttpOnly`,
      `SameSite=Lax`,
      `Max-Age=${MAX_AGE}`,
      ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
    ].join("; ")
  )
  return response
}

/**
 * Clear the admin session cookie on a Response.
 */
export function clearSessionCookie(response: Response): Response {
  response.headers.append(
    "Set-Cookie",
    [
      `${COOKIE_NAME}=`,
      `Path=/`,
      `HttpOnly`,
      `SameSite=Lax`,
      `Max-Age=0`,
    ].join("; ")
  )
  // Clear the deprecated cookie path as well, just in case they have a stale session
  response.headers.append(
    "Set-Cookie",
    [
      `${COOKIE_NAME}=`,
      `Path=/admin`,
      `HttpOnly`,
      `SameSite=Lax`,
      `Max-Age=0`,
    ].join("; ")
  )
  return response
}

/**
 * Check if the current request has a valid admin session.
 * For use in Server Components and API routes.
 */
function credentialVersion(role: OperatorRole): string {
  const credential = role === "admin" ? process.env.ADMIN_PIN : process.env.SCOREKEEPER_PIN
  if (!credential) throw new Error("Operator credential is not configured")
  return crypto.createHmac("sha256", getSecret()).update(`${role}:${credential}`).digest("hex")
}

export async function getOperatorRole(): Promise<OperatorRole | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  const payload = verifyToken(token)
  if (payload?.authenticated !== true || (payload.role !== "admin" && payload.role !== "scorekeeper")) return null
  try { return payload.credentialVersion === credentialVersion(payload.role) ? payload.role : null } catch { return null }
}

/** Admin-only. Scorekeeper cookies never authorize administrative routes. */
export async function getSession(): Promise<boolean> {
  return await getOperatorRole() === "admin"
}

/**
 * Require a valid admin session. Returns true if valid, throws 401 response if not.
 * For use in API route handlers.
 */
export async function requireAdminSession(): Promise<void> {
  const isValid = await getSession()
  if (!isValid) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }
}
