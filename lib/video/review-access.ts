import { cookies } from "next/headers"
import { timingSafeEqual } from "node:crypto"
import { signToken, verifyToken } from "@/lib/admin-session"

const cookieName = "video_review_session"
export function reviewPinMatches(pin: unknown) {
  const expected = process.env.VIDEO_REVIEW_PIN
  return typeof pin === "string" && !!expected && pin.length === expected.length &&
    Buffer.byteLength(pin) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(pin), Buffer.from(expected))
}
export function setReviewCookie(response: Response) {
  const token = signToken({ scope: "video-review", sessionId: process.env.VIDEO_REVIEW_SESSION_ID, iat: Math.floor(Date.now() / 1000) })
  response.headers.append("Set-Cookie", `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=14400${process.env.NODE_ENV === "production" ? "; Secure" : ""}`)
  return response
}
export async function reviewSessionId() {
  const expected = process.env.VIDEO_REVIEW_SESSION_ID
  if (!expected || !process.env.VIDEO_REVIEW_PIN) return null
  const token = (await cookies()).get(cookieName)?.value
  const payload = token ? verifyToken(token) : null
  return payload?.scope === "video-review" && payload.sessionId === expected && typeof payload.iat === "number" ? expected : null
}
