import { randomBytes, randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { rawSql } from "@/lib/db"
import { captureVideo, digestToken, fail, tokenMatches, videoHandler } from "@/lib/video/server"
import { reviewSessionId } from "@/lib/video/review-access"
export const runtime = "nodejs"

export async function POST(request: Request) { return videoHandler(async () => {
  const reviewId = await reviewSessionId()
  await captureVideo(reviewId ?? undefined)
  const body = z.object({ side: z.enum(["left", "right"]), replace: z.boolean().default(false),
    quality: z.enum(["hd30", "hd60", "uhd30", "uhd60"]).optional(), allowQualityMismatch: z.boolean().default(false),
    sessionId: z.string().uuid().optional(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() }).parse(await request.json())
  const [session] = reviewId ? await rawSql(sql`INSERT INTO video_sessions(id, title)
    VALUES (${reviewId}, 'App Review recording') ON CONFLICT(id) DO UPDATE SET id = EXCLUDED.id RETURNING id, ended_at`)
    : await rawSql(sql`INSERT INTO video_sessions(id, title, capture_day)
    VALUES (${randomUUID()}, 'Rink recording', to_char(now() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD'))
    ON CONFLICT(capture_day) DO UPDATE SET capture_day = EXCLUDED.capture_day RETURNING id, ended_at`)
  if (session.ended_at) fail("Today's recording has ended", 409)
  if (body.quality && !body.allowQualityMismatch) {
    const [other] = await rawSql(sql`SELECT side, recording_quality FROM video_cameras
      WHERE session_id = ${session.id} AND side <> ${body.side}
        AND token_hash IS NOT NULL AND token_expires_at > now()`)
    if (other && other.recording_quality !== body.quality) {
      return Response.json({ qualityMismatch: { side: other.side, quality: other.recording_quality } })
    }
  }
  const [existing] = await rawSql(sql`SELECT token_hash, token_expires_at FROM video_cameras WHERE session_id = ${session.id} AND side = ${body.side}`)
  if (body.sessionId === session.id && body.token && existing?.token_hash && tokenMatches(body.token, existing.token_hash)
    && Date.parse(existing.token_expires_at) > Date.now()) {
    if (body.quality) await rawSql(sql`UPDATE video_cameras SET recording_quality = ${body.quality}
      WHERE session_id = ${session.id} AND side = ${body.side} AND token_hash = ${existing.token_hash}`)
    return Response.json({ sessionId: session.id, side: body.side, token: body.token })
  }
  const token = randomBytes(32).toString("base64url")
  const rows = await rawSql(sql`INSERT INTO video_cameras(session_id, side, token_hash, token_expires_at, recording_quality)
    VALUES (${session.id}, ${body.side}, ${digestToken(token)}, now() + interval '7 days', ${body.quality ?? 'uhd60'})
    ON CONFLICT(session_id, side) DO UPDATE SET token_hash = EXCLUDED.token_hash, token_expires_at = EXCLUDED.token_expires_at, recording_quality = EXCLUDED.recording_quality
    WHERE video_cameras.token_hash IS NULL OR video_cameras.token_expires_at <= now() OR ${body.replace} RETURNING side`)
  if (!rows.length) fail("Another phone is using this side. Choose the other side or replace it.", 409)
  return Response.json({ sessionId: session.id, side: body.side, token }, { status: 201 })
}) }
