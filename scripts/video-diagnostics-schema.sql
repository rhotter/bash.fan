CREATE TABLE IF NOT EXISTS video_camera_diagnostics (
  session_id text NOT NULL,
  side text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL,
  PRIMARY KEY (session_id, side),
  FOREIGN KEY (session_id, side) REFERENCES video_cameras(session_id, side)
);
