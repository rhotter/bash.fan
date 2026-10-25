import { randomBytes, randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { rawSql } from "@/lib/db"
import { adminVideo, digestToken, fail, videoHandler } from "@/lib/video/server"
import { playbackUrl, streamRequest, videoConfiguration, type LiveInput } from "@/lib/video/cloudflare"
import type { LiveGameState } from "@/lib/scorekeeper-types"
import type { GameTimingEntry } from "@/lib/scorekeeper-timing"
export const runtime = "nodejs"
type Context = { params: Promise<{ id: string }> }
async function sessionFor(id: string) {
  const [session] = await rawSql(sql`SELECT * FROM video_sessions WHERE id = ${id}`)
  if (!session) fail("Session not found", 404)
  return session
}
export async function GET(_request: Request, context: Context) { return videoHandler(async () => {
  await adminVideo()
  const { id } = await context.params
  const session = await sessionFor(id)
  const cameras = await rawSql(sql`SELECT side, device_name, last_seen_at, recording, streaming, battery, error, stream_input_id, offset_ms
    FROM video_cameras WHERE session_id = ${id} ORDER BY side`)
  const segments = await rawSql(sql`SELECT id, side, started_at, duration, bytes, uploaded_at FROM video_segments WHERE session_id = ${id} ORDER BY started_at`)
  const markers = await rawSql(sql`SELECT id, label, occurred_at, source FROM video_markers WHERE session_id = ${id} ORDER BY occurred_at`)
  if (session.game_id) {
    const [live] = await rawSql(sql`SELECT state FROM game_live WHERE game_id = ${session.game_id}`)
    const state = live?.state as LiveGameState | undefined
    const goals = new Set(state?.goals?.map(g => g.id) ?? [])
    const entries: GameTimingEntry[] = [...(state?.timing?.entries ?? [])]
    // Support both the original JSON history and the append-only timing migration.
    const [timingTable] = await rawSql(sql`SELECT to_regclass('public.game_timing_events') AS name`)
    if (timingTable?.name) {
      const history = await rawSql(sql`SELECT entry_id, kind, action, captured_at, recorded_at, source, period, clock_seconds, details
        FROM game_timing_events WHERE game_id = ${session.game_id} AND kind = 'goal' AND action = 'add' ORDER BY received_at`)
      entries.unshift(...history.map(e => ({ id: e.entry_id, kind: e.kind, action: e.action,
        capturedAt: Date.parse(e.captured_at), recordedAt: Date.parse(e.recorded_at), source: e.source,
        period: e.period, clockSeconds: e.clock_seconds, details: e.details } as GameTimingEntry)))
    }
    const seen = new Set<string>()
    for (const entry of entries) {
      const eventId = String(entry.details.eventId)
      if (entry.kind !== "goal" || entry.action !== "add" || !goals.has(eventId) || seen.has(eventId)) continue
      seen.add(eventId)
      markers.push({ id: entry.id, label: `Goal · Period ${entry.period}`, occurred_at: new Date(entry.capturedAt).toISOString(), source: "scorekeeper" })
    }
  }
  markers.sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
  return Response.json({ session, cameras, segments, markers, configured: videoConfiguration() })
}) }
const operation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pair"), side: z.enum(["left", "right"]) }),
  z.object({ action: z.literal("prepareStream"), side: z.enum(["left", "right"]) }),
  z.object({ action: z.literal("livePlayback"), side: z.enum(["left", "right"]) }),
  z.object({ action: z.literal("offset"), side: z.enum(["left", "right"]), offsetMs: z.number().int().min(-3600000).max(3600000) }),
  z.object({ action: z.literal("marker"), label: z.string().trim().min(1).max(120), occurredAt: z.string().datetime() }),
  z.object({ action: z.literal("playback"), segmentId: z.string().uuid() }),
  z.object({ action: z.literal("end") }),
])
export async function POST(request: Request, context: Context) { return videoHandler(async () => {
  await adminVideo()
  const { id } = await context.params
  const session = await sessionFor(id)
  const body = operation.parse(await request.json())
  if (body.action === "pair") {
    if (session.ended_at) fail("Session has ended")
    const token = randomBytes(32).toString("base64url")
    await rawSql(sql`INSERT INTO video_cameras(session_id, side, token_hash, token_expires_at)
      VALUES (${id}, ${body.side}, ${digestToken(token)}, now() + interval '7 days')
      ON CONFLICT(session_id, side) DO UPDATE SET token_hash = EXCLUDED.token_hash, token_expires_at = EXCLUDED.token_expires_at`)
    return Response.json({ token, expiresIn: 604800 })
  }
  if (body.action === "prepareStream" || body.action === "livePlayback") {
    const [camera] = await rawSql(sql`SELECT stream_input_id FROM video_cameras WHERE session_id = ${id} AND side = ${body.side}`)
    if (!camera) fail("Pair the camera first")
    if (body.action === "livePlayback") {
      if (!camera.stream_input_id) fail("Prepare the livestream first")
      const input = await streamRequest<LiveInput>(`live_inputs/${camera.stream_input_id}`)
      const playbackOrigin = input.playback?.hls ? new URL(input.playback.hls) : null
      if (!playbackOrigin || playbackOrigin.protocol !== "https:" || !playbackOrigin.hostname.endsWith(".cloudflarestream.com")) fail("Live playback is not ready", 503)
      // Cover a two-hour game plus setup/intermissions without expiring mid-broadcast.
      const result = await streamRequest<{ token: string }>(`${camera.stream_input_id}/token`, { method: "POST", body: JSON.stringify({ exp: Math.floor(Date.now()/1000) + 3 * 3600 }) })
      return Response.json({ url: `${playbackOrigin.origin}/${result.token}/manifest/video.m3u8` })
    }
    if (session.ended_at) fail("Session has ended")
    if (!camera.stream_input_id) {
      const input = await streamRequest<LiveInput>("live_inputs", { method: "POST", body: JSON.stringify({
        meta: { name: `${session.title} · ${body.side}`, sessionId: id }, recording: { mode: "automatic", requireSignedURLs: true, timeoutSeconds: 60 },
      }) })
      const saved = await rawSql(sql`UPDATE video_cameras SET stream_input_id = ${input.uid} WHERE session_id = ${id} AND side = ${body.side} AND stream_input_id IS NULL RETURNING side`)
      if (!saved.length) await streamRequest(`live_inputs/${input.uid}`, { method: "DELETE" })
    }
  } else if (body.action === "offset") {
    await rawSql(sql`UPDATE video_cameras SET offset_ms = ${body.offsetMs} WHERE session_id = ${id} AND side = ${body.side}`)
  } else if (body.action === "marker") {
    await rawSql(sql`INSERT INTO video_markers(id, session_id, label, occurred_at) VALUES (${randomUUID()}, ${id}, ${body.label}, ${body.occurredAt}::timestamptz)`)
  } else if (body.action === "playback") {
    const [segment] = await rawSql(sql`SELECT object_key FROM video_segments WHERE id = ${body.segmentId}::uuid AND session_id = ${id} AND uploaded_at IS NOT NULL`)
    if (!segment) fail("Recording not available", 404)
    return Response.json({ url: await playbackUrl(segment.object_key) })
  } else {
    await rawSql(sql`UPDATE video_sessions SET ended_at = COALESCE(ended_at, now()) WHERE id = ${id}`)
  }
  return Response.json({ ok: true })
}) }
