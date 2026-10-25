import { sql } from "drizzle-orm"
import { z } from "zod"
import { rawSql } from "@/lib/db"
import { automaticCoverage } from "@/lib/video/auto-coverage"
import { readVideoDetail } from "@/lib/video/detail"
import { fail, videoHandler } from "@/lib/video/server"
import { playbackUrl, streamRequest, type LiveInput } from "@/lib/video/cloudflare"
import type { GameVideoData, VideoSession } from "@/lib/video/types"

export const runtime = "nodejs"
type Context = { params: Promise<{ id: string }> }
function enabled() { if (process.env.VIDEO_ENABLED !== "1") fail("Video is not enabled", 404) }

export async function GET(request: Request, context: Context) { return videoHandler(async () => {
  enabled()
  const { id } = await context.params
  const sessions = await rawSql(sql`SELECT id, game_id, capture_day, title, created_at, ended_at FROM video_sessions s
    WHERE game_id = ${id} OR capture_day BETWEEN
      (SELECT (date::date - 1)::text FROM games WHERE id = ${id}) AND (SELECT (date::date + 1)::text FROM games WHERE id = ${id})
    ORDER BY EXISTS (SELECT 1 FROM video_cameras c WHERE c.session_id = s.id AND s.ended_at IS NULL
      AND c.stream_input_id IS NOT NULL AND c.streaming AND c.last_seen_at > now() - interval '25 seconds') DESC,
      EXISTS (SELECT 1 FROM video_segments v WHERE v.session_id = s.id AND v.uploaded_at IS NOT NULL) DESC,
      created_at DESC LIMIT 100`) as VideoSession[]
  const requested = new URL(request.url).searchParams.get("session")
  for (const session of sessions) {
    if (requested && session.id !== requested) continue
    const coverage = session.capture_day ? await automaticCoverage(session.capture_day, id) : null
    const detail = await readVideoDetail(session.id, id)
    detail.segments = detail.segments.filter(s => s.uploaded_at && (!coverage || coverage.includes(s)))
    const liveAllowed = !coverage || coverage.live
    const hasLiveCamera = detail.cameras.some(c => c.stream_input_id && c.streaming && c.last_seen_at
      && Date.now() - Date.parse(c.last_seen_at) < 25000 && !session.ended_at)
    if (coverage && !(coverage.live && hasLiveCamera) && !detail.segments.length) continue
    if (coverage) detail.markers = detail.markers.filter(m => m.eventId || m.goalId)
    // Expose only viewer metadata. Never include device identity, errors, credential hashes,
    // provider input IDs, object keys, or the private scorekeeper timing history.
    return Response.json({ sessions: [session], session,
      cameras: detail.cameras.map(c => ({ side: c.side, offset_ms: c.offset_ms,
        live: liveAllowed && !!c.stream_input_id && c.streaming && !!c.last_seen_at && Date.now() - Date.parse(c.last_seen_at) < 25000 && !session.ended_at })),
      segments: detail.segments.filter(s => s.uploaded_at).map(s => ({ id: s.id, side: s.side,
        started_at: s.started_at, duration: s.duration, bytes: s.bytes, uploaded_at: s.uploaded_at })),
      markers: detail.markers.map(m => ({ id: m.id, label: m.label, occurred_at: m.occurred_at, source: m.source,
        eventId: m.eventId, eventKind: m.eventKind, goalId: m.goalId })),
    } satisfies GameVideoData)
  }
  if (requested) fail("Recording not found for this game", 404)
  return Response.json({ sessions: [], session: null, cameras: [], segments: [], markers: [] } satisfies GameVideoData)
}) }

const playback = z.discriminatedUnion("action", [
  z.object({ action: z.literal("playback"), sessionId: z.string().uuid(), segmentId: z.string().uuid() }),
  z.object({ action: z.literal("livePlayback"), sessionId: z.string().uuid(), side: z.enum(["left", "right"]) }),
])
export async function POST(request: Request, context: Context) { return videoHandler(async () => {
  enabled()
  const { id } = await context.params
  const body = playback.parse(await request.json())
  const [session] = await rawSql(sql`SELECT id, ended_at, capture_day FROM video_sessions WHERE id = ${body.sessionId} AND (game_id = ${id} OR capture_day IS NOT NULL)`)
  if (!session) fail("Recording not found for this game", 404)
  const coverage = session.capture_day ? await automaticCoverage(session.capture_day, id) : null
  if (body.action === "playback") {
    const [segment] = await rawSql(sql`SELECT object_key, started_at, duration FROM video_segments WHERE id = ${body.segmentId}::uuid AND session_id = ${session.id} AND uploaded_at IS NOT NULL`)
    if (!segment || (coverage && !coverage.includes({ started_at: segment.started_at, duration: Number(segment.duration) }))) fail("Recording not available", 404)
    return Response.json({ url: await playbackUrl(segment.object_key) })
  }
  if (coverage && !coverage.live) fail("Live stream not available for this game", 404)
  const [camera] = await rawSql(sql`SELECT stream_input_id FROM video_cameras WHERE session_id = ${session.id} AND side = ${body.side}`)
  if (session.ended_at || !camera?.stream_input_id) fail("Live stream not available", 404)
  const input = await streamRequest<LiveInput>(`live_inputs/${camera.stream_input_id}`)
  const origin = input.playback?.hls ? new URL(input.playback.hls) : null
  if (!origin || origin.protocol !== "https:" || !origin.hostname.endsWith(".cloudflarestream.com")) fail("Live playback is not ready", 503)
  const { token } = await streamRequest<{ token: string }>(`${camera.stream_input_id}/token`, {
    method: "POST", body: JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3 * 3600 }),
  })
  return Response.json({ url: `${origin.origin}/${token}/manifest/video.m3u8` })
}) }
