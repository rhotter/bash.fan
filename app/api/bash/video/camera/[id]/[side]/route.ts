import { liveHealth } from "@/lib/video/live-health"
import { cameraDiagnostics } from "@/lib/video/diagnostics"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { rawSql } from "@/lib/db"
import { cameraVideo, fail, videoHandler } from "@/lib/video/server"
import { streamRequest, uploadUrl, verifyUpload, videoConfiguration, type LiveInput } from "@/lib/video/cloudflare"
export const runtime = "nodejs"
type Context = { params: Promise<{ id: string; side: string }> }
export async function GET(request: Request, context: Context) { return videoHandler(async () => {
  const { id, side } = await context.params
  const camera = await cameraVideo(request, id, side)
  const input = camera.stream_input_id && !camera.ended_at ? await streamRequest<LiveInput>(`live_inputs/${camera.stream_input_id}`) : null
  const [game] = camera.game_id ? await rawSql(sql`SELECT g.id, g.date, g.time, g.status, g.location,
    home.name AS "homeTeam", away.name AS "awayTeam" FROM games g
    JOIN teams home ON home.slug = g.home_team JOIN teams away ON away.slug = g.away_team WHERE g.id = ${camera.game_id}`) : []
  return Response.json({ sessionId: id, side, title: camera.title, game: game ?? null, ended: !!camera.ended_at, serverTime: Date.now(),
    rtmpsUrl: input?.rtmps.url ?? null, streamKey: input?.rtmps.streamKey ?? null, configured: videoConfiguration() })
}) }
const operation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("clock") }),
  z.object({ action: z.literal("liveHealth") }),
  z.object({ action: z.literal("heartbeat"), deviceName: z.string().max(80), recording: z.boolean(), streaming: z.boolean(), battery: z.number().min(-1).max(1), error: z.string().max(300).nullable(), diagnostics: cameraDiagnostics.optional() }),
  z.object({ action: z.literal("upload"), segmentId: z.string().uuid(), startedAt: z.string().datetime(), duration: z.number().positive().max(180), bytes: z.number().int().positive().max(536870912) }),
  z.object({ action: z.literal("complete"), segmentId: z.string().uuid() }),
])
export async function POST(request: Request, context: Context) { return videoHandler(async () => {
  const receivedAt = Date.now()
  const { id, side } = await context.params
  const camera = await cameraVideo(request, id, side)
  const body = operation.parse(await request.json())
  if (body.action === "liveHealth") return Response.json(camera.stream_input_id && !camera.ended_at
    ? await liveHealth(camera.stream_input_id) : { available: false })
  if (body.action === "clock") return Response.json({ receivedAt, sentAt: Date.now() })
  if (body.action === "heartbeat") {
    if (body.diagnostics) {
      await rawSql(sql`WITH heartbeat AS (
        UPDATE video_cameras SET device_name = ${body.deviceName}, last_seen_at = now(), recording = ${body.recording}, streaming = ${body.streaming}, battery = ${body.battery}, error = ${body.error}
        WHERE session_id = ${id} AND side = ${side} RETURNING session_id, side
      ) INSERT INTO video_camera_diagnostics (session_id, side, snapshot)
        SELECT session_id, side, ${JSON.stringify(body.diagnostics)}::jsonb FROM heartbeat
        ON CONFLICT (session_id, side) DO UPDATE SET snapshot = EXCLUDED.snapshot, received_at = now()`)
    } else await rawSql(sql`UPDATE video_cameras SET device_name = ${body.deviceName}, last_seen_at = now(), recording = ${body.recording}, streaming = ${body.streaming}, battery = ${body.battery}, error = ${body.error}
      WHERE session_id = ${id} AND side = ${side}`)
    return Response.json({ ok: true, ended: !!camera.ended_at, serverTime: Date.now() })
  }
  if (body.action === "upload") {
    const key = `sessions/${id}/${side}/${body.segmentId}.mp4`
    const rows = await rawSql(sql`INSERT INTO video_segments(id, session_id, side, object_key, started_at, duration, bytes)
      VALUES (${body.segmentId}::uuid, ${id}, ${side}, ${key}, ${body.startedAt}::timestamptz, ${body.duration}, ${body.bytes})
      ON CONFLICT(id) DO NOTHING RETURNING id`)
    if (!rows.length) {
      const [existing] = await rawSql(sql`SELECT * FROM video_segments WHERE id = ${body.segmentId}::uuid`)
      if (existing?.session_id !== id || existing?.side !== side || Number(existing.bytes) !== body.bytes || Number(existing.duration) !== body.duration || Date.parse(existing.started_at) !== Date.parse(body.startedAt)) fail("Segment metadata conflicts", 409)
      if (existing.uploaded_at) return Response.json({ alreadyUploaded: true })
    }
    return Response.json({ url: await uploadUrl(key, body.bytes), alreadyUploaded: false })
  }
  const [segment] = await rawSql(sql`SELECT * FROM video_segments WHERE id = ${body.segmentId}::uuid AND session_id = ${id} AND side = ${side}`)
  if (!segment) fail("Segment not found", 404)
  if (!await verifyUpload(segment.object_key, Number(segment.bytes))) fail("Upload has not been verified", 409)
  await rawSql(sql`UPDATE video_segments SET uploaded_at = COALESCE(uploaded_at, now()) WHERE id = ${body.segmentId}::uuid`)
  return Response.json({ verified: true })
}) }
