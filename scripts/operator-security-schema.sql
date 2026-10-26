-- Durable throttling shared by all auth routes and serverless instances.
CREATE TABLE IF NOT EXISTS operator_auth_attempts (
  bucket text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);
CREATE OR REPLACE FUNCTION check_operator_attempt(client_key text, failed boolean)
RETURNS TABLE(allowed boolean) LANGUAGE plpgsql AS $$
DECLARE client_count integer; total_count integer;
BEGIN
  -- Lock in a consistent order. Global ceiling also bounds distributed guessing.
  INSERT INTO operator_auth_attempts VALUES ('global', 0, now() + interval '15 minutes')
  ON CONFLICT DO NOTHING;
  UPDATE operator_auth_attempts SET
    failures = CASE WHEN expires_at <= now() THEN 0 ELSE failures END,
    expires_at = CASE WHEN expires_at <= now() THEN now() + interval '15 minutes' ELSE expires_at END
  WHERE bucket = 'global' RETURNING failures INTO total_count;
  INSERT INTO operator_auth_attempts VALUES (client_key, 0, now() + interval '15 minutes')
  ON CONFLICT DO NOTHING;
  UPDATE operator_auth_attempts SET
    failures = CASE WHEN expires_at <= now() THEN 0 ELSE failures END,
    expires_at = CASE WHEN expires_at <= now() THEN now() + interval '15 minutes' ELSE expires_at END
  WHERE bucket = client_key RETURNING failures INTO client_count;
  IF client_count >= 10 OR total_count >= 500 THEN
    RETURN QUERY SELECT false; RETURN;
  END IF;
  IF failed THEN
    UPDATE operator_auth_attempts SET failures = failures + 1 WHERE bucket IN ('global', client_key);
  END IF;
  DELETE FROM operator_auth_attempts WHERE expires_at < now() - interval '1 day' AND bucket <> 'global';
  RETURN QUERY SELECT true;
END $$;
