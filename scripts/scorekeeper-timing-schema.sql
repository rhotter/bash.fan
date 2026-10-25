CREATE TABLE IF NOT EXISTS game_timing_events (
  game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  entry_id text NOT NULL,
  kind text NOT NULL,
  action text NOT NULL,
  captured_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  period integer NOT NULL,
  clock_seconds double precision NOT NULL,
  details jsonb NOT NULL,
  PRIMARY KEY (game_id, entry_id)
);
CREATE INDEX IF NOT EXISTS idx_game_timing_events_capture ON game_timing_events(game_id, captured_at);

-- Move any existing inline history before compacting it, in one atomic statement.
-- Re-running is safe, and timestamps/event IDs are preserved exactly.
WITH legacy AS MATERIALIZED (
  SELECT game_id, state FROM game_live
  WHERE jsonb_array_length(COALESCE(state#>'{timing,entries}', '[]'::jsonb)) > 0
  FOR UPDATE
), moved AS (
  INSERT INTO game_timing_events
    (game_id, entry_id, kind, action, captured_at, recorded_at, source, period, clock_seconds, details)
  SELECT l.game_id, e.id, e.kind, e.action,
    to_timestamp(e."capturedAt" / 1000.0), to_timestamp(e."recordedAt" / 1000.0),
    e.source, e.period, e."clockSeconds", e.details
  FROM legacy l CROSS JOIN LATERAL jsonb_to_recordset(l.state#>'{timing,entries}') AS e(
    id text, kind text, action text, "capturedAt" double precision, "recordedAt" double precision,
    source text, period integer, "clockSeconds" double precision, details jsonb)
  ON CONFLICT (game_id, entry_id) DO NOTHING
  RETURNING entry_id
)
UPDATE game_live l SET state = jsonb_set(l.state, '{timing}',
  ((l.state->'timing') - 'entries') || jsonb_build_object('version', 1, 'entries', '[]'::jsonb,
    'hasPlayStarted', COALESCE((l.state#>>'{timing,hasPlayStarted}')::boolean, false)
      OR l.state#>>'{timing,firstPlayStartedAt}' IS NOT NULL
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(l.state#>'{timing,entries}') e
        WHERE e->>'kind' = 'clock' AND e#>>'{details,after,running}' = 'true')))
FROM legacy WHERE l.game_id = legacy.game_id;
