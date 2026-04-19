import { cookies } from "next/headers"
import crypto from "crypto"

const COOKIE_NAME = "admin_session"
const MAX_AGE = 14400 // 4 hours in seconds

function getSecret(): string {
  const pin = process.env.SCOREKEEPER_PIN
  if (!pin) throw new Error("SCOREKEEPER_PIN environment variable is required")
  return pin
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
    if (!payloadStr || !signature) return null

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
    if (payload.iat && Date.now() / 1000 - payload.iat > MAX_AGE) {
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
export function createSessionToken(): string {
  return signToken({
    authenticated: true,
    iat: Math.floor(Date.now() / 1000),
  })
}

/**
 * Set the admin session cookie on a Response.
 */
export function setSessionCookie(response: Response): Response {
  const token = createSessionToken()
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
export async function getSession(): Promise<boolean> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return false
  const payload = verifyToken(token)
  return payload?.authenticated === true
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
