-- Run as the database owner, first on a disposable branch, then production.
-- This changes access only; the scorekeeper PIN and public draft API stay intact.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM readonly;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public REVOKE SELECT ON TABLES FROM readonly;
GRANT SELECT ON seasons, teams, season_teams, games, players, player_seasons,
  player_game_stats, player_season_stats, goalie_game_stats, adhoc_game_rosters,
  player_awards, hall_of_fame, game_officials TO readonly;
ALTER ROLE readonly SET default_transaction_read_only = on;
ALTER ROLE readonly SET statement_timeout = '5s';
ALTER ROLE readonly SET lock_timeout = '1s';
ALTER ROLE readonly SET search_path = pg_catalog, public;

-- The column is unused for authentication. Retain it for deployment compatibility,
-- but never persist a credential, including from an older still-running deployment.
CREATE OR REPLACE FUNCTION clear_legacy_game_pin() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.pin_hash := ''; RETURN NEW; END $$;
CREATE OR REPLACE TRIGGER clear_legacy_game_pin BEFORE INSERT OR UPDATE ON game_live
FOR EACH ROW EXECUTE FUNCTION clear_legacy_game_pin();
UPDATE game_live SET pin_hash = '' WHERE pin_hash <> '';
