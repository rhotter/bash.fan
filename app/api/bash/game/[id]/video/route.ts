import { sql } from "drizzle-orm"
import { z } from "zod"
import { rawSql } from "@/lib/db"
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
  const sessions = await rawSql(sql`SELECT id, game_id, title, created_at, ended_at FROM video_sessions WHERE game_id = ${id} ORDER BY created_at DESC LIMIT 100`) as VideoSession[]
  const requested = new URL(request.url).searchParams.get("session")
  const session = requested ? sessions.find(s => s.id === requested) : sessions[0]
  if (requested && !session) fail("Recording not found for this game", 404)
  if (!session) return Response.json({ sessions, session: null, cameras: [], segments: [], markers: [] } satisfies GameVideoData)
  const detail = await readVideoDetail(session.id)
  // Expose only viewer metadata. Never include device identity, errors, credential hashes,
  // provider input IDs, object keys, or the private scorekeeper timing history.
  return Response.json({ sessions, session,
    cameras: detail.cameras.map(c => ({ side: c.side, offset_ms: c.offset_ms,
      live: !!c.stream_input_id && c.streaming && !!c.last_seen_at && Date.now() - Date.parse(c.last_seen_at) < 25000 && !session.ended_at })),
    segments: detail.segments.filter(s => s.uploaded_at).map(s => ({ id: s.id, side: s.side,
      started_at: s.started_at, duration: s.duration, bytes: s.bytes, uploaded_at: s.uploaded_at })),
    markers: detail.markers.map(m => ({ id: m.id, label: m.label, occurred_at: m.occurred_at, source: m.source, goalId: m.goalId })),
  } satisfies GameVideoData)
}) }

const playback = z.discriminatedUnion("action", [
  z.object({ action: z.literal("playback"), sessionId: z.string().uuid(), segmentId: z.string().uuid() }),
  z.object({ action: z.literal("livePlayback"), sessionId: z.string().uuid(), side: z.enum(["left", "right"]) }),
])
export async function POST(request: Request, context: Context) { return videoHandler(async () => {
  enabled()
  const { id } = await context.params
  const body = playback.parse(await request.json())
  const [session] = await rawSql(sql`SELECT id, ended_at FROM video_sessions WHERE id = ${body.sessionId} AND game_id = ${id}`)
  if (!session) fail("Recording not found for this game", 404)
  if (body.action === "playback") {
    const [segment] = await rawSql(sql`SELECT object_key FROM video_segments WHERE id = ${body.segmentId}::uuid AND session_id = ${session.id} AND uploaded_at IS NOT NULL`)
    if (!segment) fail("Recording not available", 404)
    return Response.json({ url: await playbackUrl(segment.object_key) })
  }
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
