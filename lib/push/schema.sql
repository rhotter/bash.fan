-- Additive, repeatable migration. Existing live history is deliberately not replayed.
CREATE TABLE IF NOT EXISTS push_devices (
 id uuid PRIMARY KEY, secret_hash text NOT NULL, token text NOT NULL,
 environment text NOT NULL CHECK (environment IN ('sandbox','production')),
 teams text[] NOT NULL DEFAULT '{}', games text[] NOT NULL DEFAULT '{}',
 enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS push_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), game_id text NOT NULL REFERENCES games(id),
 event_key text NOT NULL, kind text NOT NULL, goal_id text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(game_id,event_key)
);
CREATE TABLE IF NOT EXISTS push_deliveries (
 event_id uuid NOT NULL REFERENCES push_events(id) ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz, last_error text,
 PRIMARY KEY(event_id,device_id)
);
CREATE INDEX IF NOT EXISTS push_deliveries_pending ON push_deliveries(next_attempt_at) WHERE completed_at IS NULL;
CREATE OR REPLACE FUNCTION bash_enqueue_push(gid text, eventkey text, eventkind text, goalid text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE eid uuid;
BEGIN
 INSERT INTO push_events(game_id,event_key,kind,goal_id) VALUES(gid,eventkey,eventkind,goalid)
 ON CONFLICT DO NOTHING RETURNING id INTO eid;
 IF eid IS NULL THEN RETURN; END IF;
 INSERT INTO push_deliveries(event_id,device_id)
 SELECT eid,d.id FROM push_devices d JOIN games g ON g.id=gid
 WHERE d.enabled AND (gid=ANY(d.games) OR g.home_team=ANY(d.teams) OR g.away_team=ANY(d.teams));
END $$;
CREATE OR REPLACE FUNCTION bash_live_push_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior jsonb; goal jsonb; match games%ROWTYPE;
BEGIN
 -- Native scoring may create the live row on its first save. Final/historical imports are excluded below.
 IF TG_OP='INSERT' THEN prior := '{"period":0,"goals":[]}'::jsonb; ELSE prior := OLD.state; END IF;
 SELECT * INTO match FROM games WHERE id=NEW.game_id;
 IF match.is_forfeit OR match.date::date < (now() AT TIME ZONE 'America/Los_Angeles')::date-1
 OR match.date::date > (now() AT TIME ZONE 'America/Los_Angeles')::date+1 THEN RETURN NEW; END IF;
 -- Remember a live game's finalization attempt, but never turn a historical correction into a final alert.
 IF match.status <> 'final' AND NEW.state ? 'finalizationPending' THEN
  INSERT INTO push_events(game_id,event_key,kind) VALUES(NEW.game_id,'finalization-started','internal') ON CONFLICT DO NOTHING;
 END IF;
 IF match.status <> 'final' AND NOT (NEW.state ? 'finalizationPending') THEN
  IF coalesce((prior->>'period')::int,0)=0 AND coalesce((NEW.state->>'period')::int,0)>0 THEN
   PERFORM bash_enqueue_push(NEW.game_id,'start','start');
  END IF;
  FOR goal IN SELECT value FROM jsonb_array_elements(coalesce(NEW.state->'goals','[]')) LOOP
   IF goal->>'id' IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(prior->'goals','[]')) oldgoal WHERE oldgoal->>'id'=goal->>'id'
   ) THEN PERFORM bash_enqueue_push(NEW.game_id,'goal:'||(goal->>'id'),'goal',goal->>'id'); END IF;
  END LOOP;
 END IF;
 IF match.status='final' AND prior ? 'finalizationPending' AND NOT (NEW.state ? 'finalizationPending')
 AND EXISTS(SELECT 1 FROM push_events WHERE game_id=NEW.game_id AND event_key='finalization-started') THEN
  PERFORM bash_enqueue_push(NEW.game_id,'final','final');
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER bash_live_push AFTER INSERT OR UPDATE OF state ON game_live
FOR EACH ROW EXECUTE FUNCTION bash_live_push_events();
