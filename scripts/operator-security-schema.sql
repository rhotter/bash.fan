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

-- Full score/boxscore snapshots before and after each committed transaction.
-- No FK to games: deleting a game must not erase its history.
CREATE TABLE IF NOT EXISTS game_score_history (
  id bigserial PRIMARY KEY,
  game_id text NOT NULL,
  transaction_id bigint NOT NULL,
  phase text NOT NULL CHECK (phase IN ('before', 'after')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  restored_from bigint,
  snapshot jsonb NOT NULL,
  UNIQUE (game_id, transaction_id, phase)
);
CREATE INDEX IF NOT EXISTS game_score_history_game ON game_score_history(game_id, id DESC);

CREATE OR REPLACE FUNCTION game_score_snapshot(target text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'game', (SELECT jsonb_build_object('home_score', home_score, 'away_score', away_score,
      'status', status, 'is_overtime', is_overtime, 'is_forfeit', is_forfeit,
      'has_shootout', has_shootout, 'has_boxscore', has_boxscore, 'notes', notes)
      FROM games WHERE id = target),
    'live', (SELECT state FROM game_live WHERE game_id = target),
    'skaters', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY player_id) FROM player_game_stats p WHERE game_id = target), '[]'::jsonb),
    'goalies', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY player_id) FROM goalie_game_stats p WHERE game_id = target), '[]'::jsonb),
    'officials', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM game_officials p WHERE game_id = target), '[]'::jsonb),
    'roster', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY player_id) FROM adhoc_game_rosters p WHERE game_id = target), '[]'::jsonb)
  )
$$;

CREATE OR REPLACE FUNCTION record_game_score_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text; image jsonb; moment text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'games' THEN target := COALESCE(NEW.id, OLD.id);
  ELSE target := COALESCE(NEW.game_id, OLD.game_id); END IF;
  moment := CASE WHEN TG_WHEN = 'BEFORE' THEN 'before' ELSE 'after' END;
  -- Capture BEFORE once. Deferred AFTER runs at commit and sees the complete
  -- transaction, so later row triggers can reuse the first AFTER image.
  IF EXISTS (SELECT 1 FROM game_score_history
    WHERE game_id = target AND transaction_id = txid_current() AND phase = moment) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  image := game_score_snapshot(target);
  INSERT INTO game_score_history(game_id, transaction_id, phase, snapshot, restored_from)
  VALUES (target, txid_current(), moment, image, NULLIF(current_setting('bash.restored_from', true), '')::bigint)
  ON CONFLICT (game_id, transaction_id, phase) DO UPDATE SET snapshot = EXCLUDED.snapshot;
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['games', 'game_live', 'player_game_stats', 'goalie_game_stats', 'game_officials', 'adhoc_game_rosters'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS score_history_before ON %I', table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS score_history_after ON %I', table_name);
    EXECUTE format('CREATE TRIGGER score_history_before BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION record_game_score_history()', table_name);
    -- Deferred until commit: a CTE that updates state, scores, and stats yields
    -- a consistent AFTER image, never an intermediate ordering of those writes.
    EXECUTE format('CREATE CONSTRAINT TRIGGER score_history_after AFTER INSERT OR UPDATE OR DELETE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION record_game_score_history()', table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION restore_game_score(target text, history_id bigint, expected_latest bigint, initial_state jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE image jsonb; old_revision bigint; current_state jsonb; actual_latest bigint; new_state jsonb;
BEGIN
  -- Rare administrative operation: block all concurrent scoring/import writes
  -- during the single atomic restore, including routes using sequential writes.
  LOCK TABLE games, game_live, player_game_stats, goalie_game_stats, game_officials, adhoc_game_rosters IN SHARE ROW EXCLUSIVE MODE;
  SELECT max(id) INTO actual_latest FROM game_score_history WHERE game_id = target;
  IF actual_latest IS DISTINCT FROM expected_latest THEN RAISE EXCEPTION 'Game changed; reload history before restoring'; END IF;
  SELECT state INTO current_state FROM game_live WHERE game_id = target;
  IF current_state#>>'{finalizationPending,phase}' = 'running' THEN RAISE EXCEPTION 'Finalization is running; wait before restoring'; END IF;
  SELECT snapshot INTO image FROM game_score_history WHERE id = history_id AND game_id = target;
  IF image IS NULL OR image->'game' = 'null'::jsonb THEN RAISE EXCEPTION 'Recovery point not found'; END IF;
  IF image->'live' ? 'finalizationPending' THEN RAISE EXCEPTION 'This snapshot was taken during incomplete finalization'; END IF;
  IF NOT EXISTS (SELECT 1 FROM games WHERE id = target) THEN RAISE EXCEPTION 'Game no longer exists'; END IF;
  PERFORM set_config('bash.restored_from', history_id::text, true);
  old_revision := COALESCE((current_state->>'revision')::bigint, 0);
  UPDATE games SET home_score = (image#>>'{game,home_score}')::integer,
    away_score = (image#>>'{game,away_score}')::integer,
    status = image#>>'{game,status}', is_overtime = (image#>>'{game,is_overtime}')::boolean,
    is_forfeit = (image#>>'{game,is_forfeit}')::boolean, has_shootout = (image#>>'{game,has_shootout}')::boolean,
    has_boxscore = (image#>>'{game,has_boxscore}')::boolean, notes = image#>>'{game,notes}' WHERE id = target;
  DELETE FROM player_game_stats WHERE game_id = target;
  INSERT INTO player_game_stats SELECT * FROM jsonb_populate_recordset(NULL::player_game_stats, image->'skaters');
  DELETE FROM goalie_game_stats WHERE game_id = target;
  INSERT INTO goalie_game_stats SELECT * FROM jsonb_populate_recordset(NULL::goalie_game_stats, image->'goalies');
  DELETE FROM game_officials WHERE game_id = target;
  INSERT INTO game_officials(game_id, name, role) SELECT target, p.name, p.role
    FROM jsonb_populate_recordset(NULL::game_officials, image->'officials') p;
  DELETE FROM adhoc_game_rosters WHERE game_id = target;
  INSERT INTO adhoc_game_rosters SELECT * FROM jsonb_populate_recordset(NULL::adhoc_game_rosters, image->'roster');
  new_state := (COALESCE(NULLIF(image->'live', 'null'::jsonb), initial_state) - 'lastMutationId') || jsonb_build_object('revision', old_revision + 1,
    'updatedAt', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint);
  INSERT INTO game_live(game_id, state, pin_hash) VALUES(target, new_state, '')
  ON CONFLICT(game_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now();
  RETURN old_revision + 1;
END $$;
