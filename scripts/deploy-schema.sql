-- Deploy schema migration for torres_schedule (PR #6+#7+#9 stack)
-- Idempotent: safe to run multiple times.
-- Apply to prod once before deploying the new code.

BEGIN;

-- ─── seasons ────────────────────────────────────────────────────────────────
ALTER TABLE seasons ALTER COLUMN league_id DROP NOT NULL;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS standings_method text NOT NULL DEFAULT 'pts-pbla';
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS game_length integer NOT NULL DEFAULT 60;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS default_location text;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS admin_notes text;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS stats_only boolean NOT NULL DEFAULT false;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS playoff_teams integer DEFAULT 4;

-- Backfill: only the current season is "active"; everything else is "completed".
UPDATE seasons SET status = 'completed' WHERE is_current = false;
UPDATE seasons SET status = 'active'    WHERE is_current = true;

-- Backfill default_location from season_type
UPDATE seasons SET default_location = 'James Lick Arena'
  WHERE season_type = 'fall' AND default_location IS NULL;
UPDATE seasons SET default_location = 'Dolores Park Multi-purpose Court'
  WHERE season_type = 'summer' AND default_location IS NULL;

-- ─── games ──────────────────────────────────────────────────────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS game_type text NOT NULL DEFAULT 'regular';
ALTER TABLE games ADD COLUMN IF NOT EXISTS has_shootout boolean NOT NULL DEFAULT false;
ALTER TABLE games ADD COLUMN IF NOT EXISTS away_notes text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS home_notes text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS home_placeholder text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS away_placeholder text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS next_game_id text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS next_game_slot text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS bracket_round text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS series_id text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS series_game_number integer;

-- Default change only — does NOT update existing rows
ALTER TABLE games ALTER COLUMN location SET DEFAULT 'The Lick';

-- ─── player_seasons ─────────────────────────────────────────────────────────
ALTER TABLE player_seasons ADD COLUMN IF NOT EXISTS is_rookie boolean NOT NULL DEFAULT false;

-- ─── tbd team (sentinel for unassigned/seed placeholders) ───────────────────
INSERT INTO teams (slug, name) VALUES ('tbd', '(TBD)') ON CONFLICT (slug) DO NOTHING;

-- ─── Constraint name harmonization ──────────────────────────────────────────
-- Postgres auto-named these with _key suffix at table creation time;
-- Drizzle now expects _unique suffix. Rename to align so future db:push is a no-op.
ALTER TABLE player_awards RENAME CONSTRAINT player_awards_player_name_season_id_award_type_key TO player_awards_player_name_season_id_award_type_unique;
ALTER TABLE hall_of_fame  RENAME CONSTRAINT hall_of_fame_player_name_class_year_key            TO hall_of_fame_player_name_class_year_unique;
ALTER TABLE players       RENAME CONSTRAINT players_name_key                                    TO players_name_unique;

COMMIT;
