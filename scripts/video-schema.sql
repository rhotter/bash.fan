CREATE TABLE IF NOT EXISTS video_sessions (
  id text PRIMARY KEY, game_id text REFERENCES games(id), title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
);
CREATE TABLE IF NOT EXISTS video_cameras (
  session_id text NOT NULL REFERENCES video_sessions(id), side text NOT NULL CHECK (side IN ('left','right')),
  token_hash text, token_expires_at timestamptz, device_name text, last_seen_at timestamptz,
  recording boolean NOT NULL DEFAULT false, streaming boolean NOT NULL DEFAULT false,
  battery double precision, error text, stream_input_id text, offset_ms integer NOT NULL DEFAULT 0,
  PRIMARY KEY(session_id, side)
);
CREATE TABLE IF NOT EXISTS video_segments (
  id uuid PRIMARY KEY, session_id text NOT NULL, side text NOT NULL,
  object_key text NOT NULL UNIQUE, started_at timestamptz NOT NULL,
  duration double precision NOT NULL CHECK(duration > 0 AND duration <= 180),
  bytes bigint NOT NULL CHECK(bytes > 0 AND bytes <= 536870912), uploaded_at timestamptz,
  FOREIGN KEY(session_id, side) REFERENCES video_cameras(session_id, side)
);
CREATE INDEX IF NOT EXISTS video_segments_session ON video_segments(session_id, started_at);
CREATE TABLE IF NOT EXISTS video_markers (
  id uuid PRIMARY KEY, session_id text NOT NULL REFERENCES video_sessions(id),
  label text NOT NULL, occurred_at timestamptz NOT NULL, source text NOT NULL DEFAULT 'manual'
);

CREATE UNIQUE INDEX IF NOT EXISTS video_sessions_open_game ON video_sessions(game_id)
  WHERE ended_at IS NULL AND game_id IS NOT NULL;
