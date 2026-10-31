import { z } from "zod"
import { recordingSource } from "@/lib/video/recordings"
import { fail, videoHandler } from "@/lib/video/server"
import { playbackUrl, streamRequest, type LiveInput } from "@/lib/video/cloudflare"

export const runtime = "nodejs"
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export async function GET(request: Request) { return videoHandler(async () => {
  const query = await recordingSource()
  const day = new URL(request.url).searchParams.get("day")
  if (!day) {
    const days = await query`WITH sessions AS (
      SELECT id, ended_at, COALESCE(capture_day, (created_at AT TIME ZONE 'America/Los_Angeles')::date::text) AS day FROM video_sessions
    ), clips AS (
      SELECT s.day, count(*) FILTER (WHERE v.uploaded_at IS NOT NULL)::int AS uploaded,
        count(*) FILTER (WHERE v.uploaded_at IS NULL)::int AS pending,
        COALESCE(sum(v.duration) FILTER (WHERE v.uploaded_at IS NOT NULL), 0)::float AS seconds
      FROM sessions s JOIN video_segments v ON v.session_id = s.id GROUP BY s.day
    ), cameras AS (
      SELECT s.day, bool_or(s.ended_at IS NULL AND c.streaming AND c.stream_input_id IS NOT NULL
        AND c.last_seen_at > now() - interval '25 seconds') AS live
      FROM sessions s JOIN video_cameras c ON c.session_id = s.id GROUP BY s.day
    ) SELECT DISTINCT s.day, COALESCE(v.uploaded, 0) AS uploaded, COALESCE(v.pending, 0) AS pending,
      COALESCE(v.seconds, 0) AS seconds, COALESCE(c.live, false) AS live
      FROM sessions s LEFT JOIN clips v USING (day) LEFT JOIN cameras c USING (day) ORDER BY s.day DESC`
    return Response.json({ days })
  }
  daySchema.parse(day)
  const [cameras, segments] = await Promise.all([
    query`SELECT c.session_id, c.side,
      (s.ended_at IS NULL AND c.streaming AND c.stream_input_id IS NOT NULL AND c.last_seen_at > now() - interval '25 seconds') AS live,
      (s.ended_at IS NULL AND c.recording AND c.last_seen_at > now() - interval '25 seconds') AS recording
      FROM video_cameras c JOIN video_sessions s ON s.id = c.session_id
      WHERE COALESCE(s.capture_day, (s.created_at AT TIME ZONE 'America/Los_Angeles')::date::text) = ${day}
      ORDER BY s.created_at DESC`,
    query`SELECT v.id, v.session_id, v.side, v.started_at, v.duration::float, v.bytes::float, v.uploaded_at
      FROM video_segments v JOIN video_sessions s ON s.id = v.session_id
      WHERE COALESCE(s.capture_day, (s.created_at AT TIME ZONE 'America/Los_Angeles')::date::text) = ${day}
      ORDER BY v.started_at, v.id`,
  ])
  return Response.json({ cameras, segments })
}) }

const playback = z.discriminatedUnion("action", [
  z.object({ action: z.literal("playback"), segmentId: z.string().uuid() }),
  z.object({ action: z.literal("livePlayback"), sessionId: z.string().uuid(), side: z.enum(["left", "right"]) }),
])
export async function POST(request: Request) { return videoHandler(async () => {
  const query = await recordingSource()
  const body = playback.parse(await request.json())
  if (body.action === "playback") {
    const [segment] = await query`SELECT object_key FROM video_segments WHERE id = ${body.segmentId}::uuid AND uploaded_at IS NOT NULL`
    if (!segment) fail("This clip has not finished uploading", 404)
    return Response.json({ url: await playbackUrl(segment.object_key) })
  }
  const [camera] = await query`SELECT c.stream_input_id FROM video_cameras c JOIN video_sessions s ON s.id = c.session_id
    WHERE c.session_id = ${body.sessionId} AND c.side = ${body.side} AND s.ended_at IS NULL
      AND c.streaming AND c.stream_input_id IS NOT NULL AND c.last_seen_at > now() - interval '25 seconds'`
  if (!camera) fail("This camera is not live right now", 404)
  const input = await streamRequest<LiveInput>(`live_inputs/${camera.stream_input_id}`)
  const origin = input.playback?.hls ? new URL(input.playback.hls) : null
  if (!origin || origin.protocol !== "https:" || !origin.hostname.endsWith(".cloudflarestream.com")) fail("Live playback is not ready", 503)
  const { token } = await streamRequest<{ token: string }>(`${camera.stream_input_id}/token`, {
    method: "POST", body: JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3 * 3600 }),
  })
  return Response.json({ url: `${origin.origin}/${token}/manifest/video.m3u8` })
}) }
