-- Idempotent. Applied by scripts/deploy-fantasy-schema.ts. Mirrors lib/db/schema.ts.
-- The deploy script splits on semicolons, so no DO blocks and no semicolons in comments.
CREATE TABLE IF NOT EXISTS fantasy_seasons (
  season_id text NOT NULL CONSTRAINT fantasy_seasons_season_id_seasons_id_fk REFERENCES seasons(id) ON DELETE CASCADE,
  -- A season can run several contests, such as the regular season and the playoffs.
  contest text NOT NULL DEFAULT 'regular',
  config jsonb NOT NULL,
  launched_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fantasy_seasons_season_id_contest_pk PRIMARY KEY (season_id, contest),
  CONSTRAINT fantasy_seasons_contest_check CHECK (contest ~ '^[a-z0-9][a-z0-9-]{0,29}$')
);

CREATE TABLE IF NOT EXISTS fantasy_managers (
  id serial PRIMARY KEY,
  season_id text NOT NULL,
  contest text NOT NULL DEFAULT 'regular',
  team_name text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fantasy_managers_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT fantasy_managers_season_fk
    FOREIGN KEY (season_id, contest) REFERENCES fantasy_seasons (season_id, contest) ON DELETE CASCADE,
  CONSTRAINT fantasy_managers_names_check CHECK (char_length(team_name) BETWEEN 1 AND 40
    AND char_length(first_name) BETWEEN 1 AND 60 AND char_length(last_name) BETWEEN 1 AND 60)
);

CREATE UNIQUE INDEX IF NOT EXISTS fantasy_managers_contest_team_name
  ON fantasy_managers (season_id, contest, lower(team_name));

CREATE TABLE IF NOT EXISTS fantasy_lineups (
  manager_id integer NOT NULL CONSTRAINT fantasy_lineups_manager_id_fantasy_managers_id_fk REFERENCES fantasy_managers(id) ON DELETE CASCADE,
  week_id text NOT NULL,
  skaters integer[] NOT NULL,
  goalies integer[] NOT NULL,
  skater_backups integer[] NOT NULL,
  goalie_backups integer[] NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fantasy_lineups_manager_id_week_id_pk PRIMARY KEY (manager_id, week_id),
  CONSTRAINT fantasy_lineups_week_id_check CHECK (week_id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);

CREATE TABLE IF NOT EXISTS fantasy_predictions (
  manager_id integer NOT NULL CONSTRAINT fantasy_predictions_manager_id_fantasy_managers_id_fk REFERENCES fantasy_managers(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  home_score integer NOT NULL,
  away_score integer NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fantasy_predictions_manager_id_game_id_pk PRIMARY KEY (manager_id, game_id),
  CONSTRAINT fantasy_predictions_scores_check CHECK (home_score >= 0 AND away_score >= 0 AND home_score <> away_score)
);
