import { sql } from "drizzle-orm"
import { rawSql } from "@/lib/db"
import { fail } from "@/lib/video/server"
import { videoConfiguration } from "@/lib/video/cloudflare"
import type { LiveGameState } from "@/lib/scorekeeper-types"
import type { GameTimingEntry } from "@/lib/scorekeeper-timing"
import type { VideoDetail } from "@/lib/video/types"

export async function sessionFor(id: string) {
  const [session] = await rawSql(sql`SELECT * FROM video_sessions WHERE id = ${id}`)
  if (!session) fail("Session not found", 404)
  return session
}
export async function readVideoDetail(id: string, linkedGameId?: string): Promise<VideoDetail> {
  const session = await sessionFor(id)
  const cameras = await rawSql(sql`SELECT side, device_name, last_seen_at, recording, streaming, battery, error, stream_input_id, offset_ms
    FROM video_cameras WHERE session_id = ${id} ORDER BY side`)
  const segments = await rawSql(sql`SELECT id, side, started_at, duration, bytes, uploaded_at FROM video_segments WHERE session_id = ${id} ORDER BY started_at`)
  const markers = await rawSql(sql`SELECT id, label, occurred_at, source FROM video_markers WHERE session_id = ${id} ORDER BY occurred_at`)
  const gameId = linkedGameId ?? session.game_id
  if (gameId) {
    const [live] = await rawSql(sql`SELECT state FROM game_live WHERE game_id = ${gameId}`)
    const state = live?.state as LiveGameState | undefined
    const events = {
      goal: new Set(state?.goals?.map(g => g.id) ?? []),
      penalty: new Set(state?.penalties?.map(p => p.id) ?? []),
    }
    const entries: GameTimingEntry[] = [...(state?.timing?.entries ?? [])]
    // Support both the original JSON history and the append-only timing migration.
    const [timingTable] = await rawSql(sql`SELECT to_regclass('public.game_timing_events') AS name`)
    if (timingTable?.name) {
      const history = await rawSql(sql`SELECT entry_id, kind, action, captured_at, recorded_at, source, period, clock_seconds, details
        FROM game_timing_events WHERE game_id = ${gameId} AND kind IN ('goal', 'penalty') AND action = 'add' ORDER BY received_at`)
      entries.unshift(...history.map(e => ({ id: e.entry_id, kind: e.kind, action: e.action,
        capturedAt: Date.parse(e.captured_at), recordedAt: Date.parse(e.recorded_at), source: e.source,
        period: e.period, clockSeconds: e.clock_seconds, details: e.details } as GameTimingEntry)))
    }
    const seen = new Set<string>()
    for (const entry of entries) {
      if (entry.kind !== "goal" && entry.kind !== "penalty") continue
      const eventId = String(entry.details?.eventId)
      const key = `${entry.kind}:${eventId}`
      if (entry.action !== "add" || !events[entry.kind].has(eventId) || seen.has(key) || !Number.isFinite(entry.capturedAt)) continue
      seen.add(key)
      markers.push({ id: entry.id, label: `${entry.kind === "goal" ? "Goal" : "Penalty"} · Period ${entry.period}`,
        occurred_at: new Date(entry.capturedAt).toISOString(), source: "scorekeeper", eventId, eventKind: entry.kind,
        ...(entry.kind === "goal" ? { goalId: eventId } : {}) })
    }
  }
  markers.sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
  return { session, cameras, segments, markers, configured: videoConfiguration() } as VideoDetail
}
