import { sql } from "drizzle-orm"
import { rawSql } from "@/lib/db"
import { gameWindows, liveGame, matchedGame } from "./auto-match"
import type { GameTimingEntry } from "@/lib/scorekeeper-timing"
import type { LiveGameState } from "@/lib/scorekeeper-types"

export async function automaticCoverage(captureDay: string, gameId: string, now = Date.now()) {
  const rows = await rawSql(sql`SELECT g.id, g.status, l.state FROM games g JOIN game_live l ON l.game_id = g.id
    WHERE g.date BETWEEN (${captureDay}::date - 1)::text AND (${captureDay}::date + 1)::text`)
  const [table] = await rawSql(sql`SELECT to_regclass('public.game_timing_events') AS name`)
  const history = table?.name ? await rawSql(sql`SELECT game_id, kind, action, source, captured_at, details
    FROM game_timing_events WHERE game_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(rows.map(r => r.id))}::jsonb))
    AND source = 'device' AND (kind = 'clock' OR action = 'add' OR kind IN ('shots','shootout'))`) : []
  const windows = gameWindows(rows.map(row => {
    const state = row.state as LiveGameState
    const entries: Pick<GameTimingEntry, "kind" | "action" | "source" | "capturedAt" | "details">[] = [
      ...history.filter(e => e.game_id === row.id).map(e => ({ kind: e.kind, action: e.action, source: e.source, capturedAt: Date.parse(e.captured_at), details: e.details })),
      ...(state.timing?.entries ?? []),
    ].filter(e => e.source === "device" && (e.kind === "clock" || e.action === "add" || e.kind === "shots" || e.kind === "shootout"))
    const starts = entries.filter(e => e.kind === "clock" && (e.details.after as { running?: boolean })?.running).map(e => e.capturedAt)
    return { id: row.id, status: row.status, firstStart: state.timing?.firstPlayStartedAt ?? (starts.length ? Math.min(...starts) : undefined),
      observations: entries.map(e => e.capturedAt), clockStartedAt: state.clockStartedAt, clockRunning: state.clockRunning, clockSeconds: state.clockSeconds }
  }), now)
  const active = rows.some(r => r.id === gameId && r.status === "live") && liveGame(windows, now) === gameId
  return {
    live: active,
    includes: (segment: { started_at: string; duration: number }) => {
      const start = Date.parse(segment.started_at)
      return matchedGame(windows, start, start + Number(segment.duration) * 1000) === gameId
    },
  }
}
