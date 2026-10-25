import { sql, type SQL } from "drizzle-orm"
import { compactGameTiming, type GameTimingEntry } from "./scorekeeper-timing"
import type { LiveGameState } from "./scorekeeper-types"

/** Validate before casting timestamps in SQL; never acknowledge malformed batches. */
export function validateGameTiming(state: LiveGameState): string | null {
  if (state.timing === undefined) return null
  const t = state.timing
  const timestamp = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 8_640_000_000_000_000
  if (!t || t.version !== 1 || !Array.isArray(t.entries) || t.entries.length > 10000
    || (t.firstPlayStartedAt !== undefined && !timestamp(t.firstPlayStartedAt))
    || (t.hasPlayStarted !== undefined && typeof t.hasPlayStarted !== "boolean")) return "Invalid timing metadata"
  const ids = new Set<string>()
  for (const e of t.entries) {
    if (!e || typeof e.id !== "string" || !e.id.length || e.id.length > 160 || ids.has(e.id)
      || !["clock", "goal", "penalty", "timeout", "goaliePull", "goalieChange", "shots", "shootout"].includes(e.kind)
      || !["add", "edit", "remove", "change"].includes(e.action) || !["device", "server"].includes(e.source)
      || !timestamp(e.capturedAt) || !timestamp(e.recordedAt)
      || !Number.isInteger(e.period) || e.period < 0 || e.period > 100
      || !Number.isFinite(e.clockSeconds) || e.clockSeconds < 0
      || !e.details || typeof e.details !== "object" || Array.isArray(e.details)) return "Invalid timing entry"
    ids.add(e.id)
  }
  return null
}

/** Used inside the same SQL statement as the state write. Rejected snapshots insert nothing. */
export function insertGameTimingSql(entries: GameTimingEntry[], acceptedRows: SQL): SQL {
  return sql`
    INSERT INTO game_timing_events
      (game_id, entry_id, kind, action, captured_at, recorded_at, source, period, clock_seconds, details)
    SELECT accepted.game_id, e.id, e.kind, e.action,
      to_timestamp(e."capturedAt" / 1000.0), to_timestamp(e."recordedAt" / 1000.0),
      e.source, e.period, e."clockSeconds", e.details
    FROM ${acceptedRows} accepted
    CROSS JOIN jsonb_to_recordset(${JSON.stringify(entries)}::jsonb) AS e(
      id text, kind text, action text, "capturedAt" double precision, "recordedAt" double precision,
      source text, period integer, "clockSeconds" double precision, details jsonb)
    ON CONFLICT (game_id, entry_id) DO NOTHING
    RETURNING entry_id
  `
}

export function saveLiveStateSql(
  id: string, state: LiveGameState, expectedRevision: number, mutationId: string,
  scores: { home: number; away: number },
): SQL {
  const compact = { ...compactGameTiming(state), revision: expectedRevision + 1, lastMutationId: mutationId }
  return sql`
    WITH eligible_game AS MATERIALIZED (
      SELECT id FROM games WHERE id = ${id} AND status <> 'final' AND NOT is_forfeit FOR UPDATE
    ), saved_state AS (
      INSERT INTO game_live (game_id, state, pin_hash)
      SELECT id, ${JSON.stringify(compact)}::jsonb, '' FROM eligible_game
      WHERE ${expectedRevision} = 0 OR EXISTS (SELECT 1 FROM game_live WHERE game_id = ${id})
      ON CONFLICT (game_id) DO UPDATE SET state = (EXCLUDED.state - 'timing') ||
        CASE WHEN game_live.state ? 'timing' OR EXCLUDED.state ? 'timing' THEN
          jsonb_build_object('timing',
            COALESCE(game_live.state->'timing', '{}'::jsonb) || COALESCE(EXCLUDED.state->'timing', '{}'::jsonb) ||
            jsonb_build_object('version', 1, 'entries', '[]'::jsonb, 'hasPlayStarted',
              COALESCE((game_live.state#>>'{timing,hasPlayStarted}')::boolean, false) OR
              COALESCE((EXCLUDED.state#>>'{timing,hasPlayStarted}')::boolean, false)) ||
            CASE WHEN game_live.state#>>'{timing,firstPlayStartedAt}' IS NOT NULL THEN
              jsonb_build_object('firstPlayStartedAt', game_live.state#>'{timing,firstPlayStartedAt}')
              ELSE '{}'::jsonb END)
          ELSE '{}'::jsonb END,
        updated_at = NOW()
      WHERE NOT (game_live.state ? 'finalizationPending')
        AND (COALESCE((game_live.state->>'revision')::bigint, 0) = ${expectedRevision}
          OR (game_live.state->>'lastMutationId' = ${mutationId}
            AND game_live.state - 'timing' = EXCLUDED.state - 'timing'))
      RETURNING game_id, state
    ), saved_game AS (
      UPDATE games SET home_score = ${scores.home}, away_score = ${scores.away},
        status = CASE WHEN ${state.period} >= 1 THEN 'live' ELSE status END
      WHERE id IN (SELECT game_id FROM saved_state) RETURNING id
    ), saved_timing AS (${insertGameTimingSql(state.timing?.entries ?? [], sql` saved_state `)})
    SELECT game_id, (state->>'revision')::bigint AS revision FROM saved_state
  `
}
