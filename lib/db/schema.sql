-- Seasons
CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  league_id TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false
);

-- Teams (shared across seasons)
CREATE TABLE IF NOT EXISTS teams (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- Which teams participate in which season
CREATE TABLE IF NOT EXISTS season_teams (
  season_id TEXT NOT NULL REFERENCES seasons(id),
  team_slug TEXT NOT NULL REFERENCES teams(slug),
  PRIMARY KEY (season_id, team_slug)
);

-- Games scoped to a season
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  home_team TEXT NOT NULL REFERENCES teams(slug),
  away_team TEXT NOT NULL REFERENCES teams(slug),
  home_score INTEGER,
  away_score INTEGER,
  status TEXT NOT NULL DEFAULT 'upcoming',
  is_overtime BOOLEAN NOT NULL DEFAULT false,
  is_playoff BOOLEAN NOT NULL DEFAULT false,
  location TEXT DEFAULT 'James Lick Arena',
  has_boxscore BOOLEAN NOT NULL DEFAULT false
);

-- Players (global identity)
CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Player-season-team membership
CREATE TABLE IF NOT EXISTS player_seasons (
  player_id INTEGER NOT NULL REFERENCES players(id),
  season_id TEXT NOT NULL REFERENCES seasons(id),
  team_slug TEXT NOT NULL REFERENCES teams(slug),
  is_goalie BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (player_id, season_id)
);

-- Per-game player stats (skaters)
CREATE TABLE IF NOT EXISTS player_game_stats (
  player_id INTEGER NOT NULL REFERENCES players(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  goals INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  gwg INTEGER NOT NULL DEFAULT 0,
  ppg INTEGER NOT NULL DEFAULT 0,
  shg INTEGER NOT NULL DEFAULT 0,
  eng INTEGER NOT NULL DEFAULT 0,
  hat_tricks INTEGER NOT NULL DEFAULT 0,
  pen INTEGER NOT NULL DEFAULT 0,
  pim INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, game_id)
);

-- Per-game goalie stats
CREATE TABLE IF NOT EXISTS goalie_game_stats (
  player_id INTEGER NOT NULL REFERENCES players(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  minutes INTEGER NOT NULL DEFAULT 0,
  goals_against INTEGER NOT NULL DEFAULT 0,
  shots_against INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  shutouts INTEGER NOT NULL DEFAULT 0,
  goalie_assists INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  PRIMARY KEY (player_id, game_id)
);

-- Game officials
CREATE TABLE IF NOT EXISTS game_officials (
  id SERIAL PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ref'
);

-- Sync metadata
CREATE TABLE IF NOT EXISTS sync_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_games_season ON games(season_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_player_seasons_season ON player_seasons(season_id);
CREATE INDEX IF NOT EXISTS idx_player_game_stats_game ON player_game_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_goalie_game_stats_game ON goalie_game_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_game_officials_game ON game_officials(game_id);
