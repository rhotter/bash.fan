import { createHash, timingSafeEqual } from "node:crypto"
import { sql } from "drizzle-orm"
import { ZodError } from "zod"
import { requireAdminSession } from "@/lib/admin-session"
import { rawSql } from "@/lib/db"
import { reviewSessionId } from "@/lib/video/review-access"

export function digestToken(token: string) { return createHash("sha256").update(token).digest("hex") }
export function tokenMatches(token: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return false
  return timingSafeEqual(Buffer.from(digestToken(token), "hex"), Buffer.from(hash, "hex"))
}
export function fail(message: string, status = 400): never { throw Response.json({ error: message }, { status }) }
export async function adminVideo(sessionId?: string) {
  if (!sessionId || await reviewSessionId() !== sessionId) await requireAdminSession()
  if (process.env.VIDEO_ENABLED !== "1") fail("Video is not enabled in this environment", 503)
}
export async function cameraVideo(request: Request, id: string, side: string) {
  if (process.env.VIDEO_ENABLED !== "1") fail("Video is not enabled", 503)
  if (side !== "left" && side !== "right") fail("Invalid camera")
  const token = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]
  if (!token) fail("Unauthorized", 401)
  const [camera] = await rawSql(sql`SELECT c.*, s.ended_at, s.game_id, s.title FROM video_cameras c JOIN video_sessions s ON s.id = c.session_id
    WHERE c.session_id = ${id} AND c.side = ${side}`)
  if (!camera?.token_hash || !tokenMatches(token, camera.token_hash) || !Number.isFinite(Date.parse(camera.token_expires_at)) || Date.parse(camera.token_expires_at) <= Date.now()) fail("Pair this camera again", 401)
  return camera
}
export async function videoHandler(fn: () => Promise<Response>) {
  try {
    const result = await fn()
    result.headers.set("Cache-Control", "private, no-store")
    return result
  } catch (error) {
    if (error instanceof Response) { error.headers.set("Cache-Control", "private, no-store"); return error }
    if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: "Invalid video request" }, { status: 400, headers: { "Cache-Control": "no-store" } })
    // Never log SDK request objects: they can contain signed URLs and credentials.
    console.error("Video request failed", error instanceof Error ? error.name : "unknown")
    return Response.json({ error: "Video service unavailable. Check configuration and retry." }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
