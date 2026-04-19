import {
  pgTable,
  text,
  boolean,
  integer,
  serial,
  jsonb,
  timestamp,
  primaryKey,
  index,
  unique,
} from "drizzle-orm/pg-core"

// ─── Seasons ────────────────────────────────────────────────────────────────

export const seasons = pgTable("seasons", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  leagueId: text("league_id"),
  isCurrent: boolean("is_current").notNull().default(false),
  seasonType: text("season_type").notNull().default("fall"),
  status: text("status").notNull().default("active"),
  standingsMethod: text("standings_method").notNull().default("pts-pbla"),
  gameLength: integer("game_length").notNull().default(60),
  defaultLocation: text("default_location"),
  adminNotes: text("admin_notes"),
  statsOnly: boolean("stats_only").notNull().default(false),
})

// ─── Teams ──────────────────────────────────────────────────────────────────

export const teams = pgTable("teams", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
})

// ─── Season Teams ───────────────────────────────────────────────────────────

export const seasonTeams = pgTable(
  "season_teams",
  {
    seasonId: text("season_id")
      .notNull()
      .references(() => seasons.id),
    teamSlug: text("team_slug")
      .notNull()
      .references(() => teams.slug),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.teamSlug] })]
)

// ─── Games ──────────────────────────────────────────────────────────────────

export const games = pgTable(
  "games",
  {
    id: text("id").primaryKey(),
    seasonId: text("season_id")
      .notNull()
      .references(() => seasons.id),
    date: text("date").notNull(),
    time: text("time").notNull(),
    homeTeam: text("home_team")
      .notNull()
      .references(() => teams.slug),
    awayTeam: text("away_team")
      .notNull()
      .references(() => teams.slug),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    status: text("status").notNull().default("upcoming"),
    isOvertime: boolean("is_overtime").notNull().default(false),
    isPlayoff: boolean("is_playoff").notNull().default(false),
    isForfeit: boolean("is_forfeit").notNull().default(false),
    location: text("location").default("James Lick Arena"),
    hasBoxscore: boolean("has_boxscore").notNull().default(false),
    notes: text("notes"),
  },
  (t) => [
    index("idx_games_season").on(t.seasonId),
    index("idx_games_status").on(t.status),
  ]
)

// ─── Players ────────────────────────────────────────────────────────────────

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
})

// ─── Player Seasons ─────────────────────────────────────────────────────────

export const playerSeasons = pgTable(
  "player_seasons",
  {
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    seasonId: text("season_id")
      .notNull()
      .references(() => seasons.id),
    teamSlug: text("team_slug")
      .notNull()
      .references(() => teams.slug),
    isGoalie: boolean("is_goalie").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.seasonId, t.teamSlug] }),
    index("idx_player_seasons_season").on(t.seasonId),
    index("idx_player_seasons_player").on(t.playerId),
  ]
)

// ─── Player Game Stats ──────────────────────────────────────────────────────

export const playerGameStats = pgTable(
  "player_game_stats",
  {
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    goals: integer("goals").notNull().default(0),
    assists: integer("assists").notNull().default(0),
    points: integer("points").notNull().default(0),
    gwg: integer("gwg").notNull().default(0),
    ppg: integer("ppg").notNull().default(0),
    shg: integer("shg").notNull().default(0),
    eng: integer("eng").notNull().default(0),
    hatTricks: integer("hat_tricks").notNull().default(0),
    pen: integer("pen").notNull().default(0),
    pim: integer("pim").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.gameId] }),
    index("idx_player_game_stats_game").on(t.gameId),
    index("idx_player_game_stats_player").on(t.playerId),
  ]
)

// ─── Goalie Game Stats ──────────────────────────────────────────────────────

export const goalieGameStats = pgTable(
  "goalie_game_stats",
  {
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    seconds: integer("seconds").notNull().default(0),
    goalsAgainst: integer("goals_against").notNull().default(0),
    shotsAgainst: integer("shots_against").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    shutouts: integer("shutouts").notNull().default(0),
    goalieAssists: integer("goalie_assists").notNull().default(0),
    result: text("result"),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.gameId] }),
    index("idx_goalie_game_stats_game").on(t.gameId),
    index("idx_goalie_game_stats_player").on(t.playerId),
  ]
)

// ─── Game Officials ─────────────────────────────────────────────────────────

export const gameOfficials = pgTable(
  "game_officials",
  {
    id: serial("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    name: text("name").notNull(),
    role: text("role").notNull().default("ref"),
  },
  (t) => [index("idx_game_officials_game").on(t.gameId)]
)

// ─── Sync Metadata ──────────────────────────────────────────────────────────

export const syncMetadata = pgTable("sync_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
})

// ─── Player Awards ──────────────────────────────────────────────────────────

export const playerAwards = pgTable(
  "player_awards",
  {
    id: serial("id").primaryKey(),
    playerName: text("player_name").notNull(),
    playerId: integer("player_id").references(() => players.id),
    seasonId: text("season_id").notNull(),
    awardType: text("award_type").notNull(),
  },
  (t) => [
    unique().on(t.playerName, t.seasonId, t.awardType),
    index("idx_player_awards_player").on(t.playerId),
    index("idx_player_awards_season").on(t.seasonId),
  ]
)

// ─── Hall of Fame ───────────────────────────────────────────────────────────

export const hallOfFame = pgTable(
  "hall_of_fame",
  {
    id: serial("id").primaryKey(),
    playerName: text("player_name").notNull(),
    playerId: integer("player_id").references(() => players.id),
    classYear: integer("class_year").notNull(),
    wing: text("wing").notNull().default("players"),
    yearsActive: text("years_active"),
    achievements: text("achievements"),
  },
  (t) => [
    unique().on(t.playerName, t.classYear),
    index("idx_hall_of_fame_player").on(t.playerId),
  ]
)

// ─── Player Season Stats (historical) ───────────────────────────────────────

export const playerSeasonStats = pgTable(
  "player_season_stats",
  {
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    seasonId: text("season_id")
      .notNull()
      .references(() => seasons.id),
    teamSlug: text("team_slug")
      .notNull()
      .references(() => teams.slug),
    isPlayoff: boolean("is_playoff").notNull().default(false),
    gp: integer("gp").notNull().default(0),
    goals: integer("goals").notNull().default(0),
    assists: integer("assists").notNull().default(0),
    points: integer("points").notNull().default(0),
    gwg: integer("gwg").notNull().default(0),
    ppg: integer("ppg").notNull().default(0),
    shg: integer("shg").notNull().default(0),
    eng: integer("eng").notNull().default(0),
    hatTricks: integer("hat_tricks").notNull().default(0),
    pen: integer("pen").notNull().default(0),
    pim: integer("pim").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.seasonId, t.teamSlug, t.isPlayoff] }),
    index("idx_player_season_stats_season").on(t.seasonId),
    index("idx_player_season_stats_player").on(t.playerId),
  ]
)

// ─── Game Live ──────────────────────────────────────────────────────────────

export const gameLive = pgTable(
  "game_live",
  {
    gameId: text("game_id")
      .primaryKey()
      .references(() => games.id),
    state: jsonb("state").notNull().default({}),
    pinHash: text("pin_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_game_live_updated").on(t.updatedAt)]
)
