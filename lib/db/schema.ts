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
  playoffTeams: integer("playoff_teams").default(4),
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
    location: text("location").default("The Lick"),
    hasBoxscore: boolean("has_boxscore").notNull().default(false),
    notes: text("notes"),
    // ─── Schedule Management (additive) ─────────────────────────────────
    gameType: text("game_type").notNull().default("regular"),
    hasShootout: boolean("has_shootout").notNull().default(false),
    awayNotes: text("away_notes"),
    homeNotes: text("home_notes"),
    homePlaceholder: text("home_placeholder"),
    awayPlaceholder: text("away_placeholder"),
    nextGameId: text("next_game_id"),
    nextGameSlot: text("next_game_slot"),
    bracketRound: text("bracket_round"),
    seriesId: text("series_id"),
    seriesGameNumber: integer("series_game_number"),
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

// ─── Auth (NextAuth Drizzle Adapter) ────────────────────────────────────────
// Tables: users, accounts, sessions, verification_tokens — match the
// adapter's expected shape exactly. See https://authjs.dev/reference/adapter/drizzle.

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  passwordHash: text("password_hash"),
  playerId: integer("player_id").references(() => players.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
})

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    // The Auth.js Drizzle adapter expects snake_case JS field names for the
    // OAuth2-spec columns. DB column names match.
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]
)

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
})

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })]
)

// ─── Registration Periods ───────────────────────────────────────────────────

export const registrationPeriods = pgTable("registration_periods", {
  id: text("id").primaryKey(),
  seasonId: text("season_id")
    .notNull()
    .references(() => seasons.id),
  status: text("status").notNull().default("draft"), // draft | open | closed
  dateOpen: timestamp("date_open", { withTimezone: true }),
  dateClose: timestamp("date_close", { withTimezone: true }),
  baseFee: integer("base_fee").notNull().default(0), // cents
  maxPlayers: integer("max_players"),
  ageMinimum: integer("age_minimum"),
  ageAsOfDate: text("age_as_of_date"),
  earlybirdDeadline: timestamp("earlybird_deadline", { withTimezone: true }),
  earlybirdDiscount: integer("earlybird_discount").default(0),
  lateFeeDate: timestamp("late_fee_date", { withTimezone: true }),
  lateFeeAmount: integer("late_fee_amount").default(0),
  requiresEmergencyInfo: boolean("requires_emergency_info").notNull().default(true),
  requiresJerseySize: boolean("requires_jersey_size").notNull().default(false),
  confirmationEmailBody: text("confirmation_email_body"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
})

// ─── Custom Questions (per period) ──────────────────────────────────────────

export const registrationQuestions = pgTable(
  "registration_questions",
  {
    id: serial("id").primaryKey(),
    periodId: text("period_id")
      .notNull()
      .references(() => registrationPeriods.id, { onDelete: "cascade" }),
    questionText: text("question_text").notNull(),
    questionType: text("question_type").notNull().default("text"), // text | select
    options: jsonb("options"),
    sortOrder: integer("sort_order").notNull().default(0),
    isRequired: boolean("is_required").notNull().default(false),
  },
  (t) => [index("idx_registration_questions_period").on(t.periodId)]
)

// ─── Legal Notices / Waivers ────────────────────────────────────────────────

export const legalNotices = pgTable("legal_notices", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  ackType: text("ack_type").notNull().default("basic"), // basic | legal
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
})

export const registrationPeriodNotices = pgTable(
  "registration_period_notices",
  {
    periodId: text("period_id")
      .notNull()
      .references(() => registrationPeriods.id, { onDelete: "cascade" }),
    noticeId: integer("notice_id")
      .notNull()
      .references(() => legalNotices.id),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.periodId, t.noticeId] })]
)

// ─── Registrations ──────────────────────────────────────────────────────────
// NOTE: rookie status is NOT stored here — it's derived from prior `paid`
// registrations + prior fall `player_seasons` rows. See PRD §3.9.

export const registrations = pgTable(
  "registrations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    periodId: text("period_id")
      .notNull()
      .references(() => registrationPeriods.id),
    status: text("status").notNull().default("draft"),
    // draft | pending_payment | registered_unpaid | paid | cancelled | waitlisted
    registrationType: text("registration_type").notNull().default("individual"),
    teamSlug: text("team_slug").references(() => teams.slug),

    // Contact snapshot
    phone: text("phone"),
    address: text("address"),

    // Personal
    birthdate: text("birthdate"),
    gender: text("gender"),
    tshirtSize: text("tshirt_size"),

    // Emergency / Medical
    emergencyName: text("emergency_name"),
    emergencyPhone: text("emergency_phone"),
    healthPlan: text("health_plan"),
    healthPlanId: text("health_plan_id"),
    doctorName: text("doctor_name"),
    doctorPhone: text("doctor_phone"),
    medicalNotes: text("medical_notes"),

    // Experience
    yearsPlayed: integer("years_played"),
    skillLevel: text("skill_level"),
    positions: text("positions"),
    lastLeague: text("last_league"),
    lastTeam: text("last_team"),
    miscNotes: text("misc_notes"),

    // Payment
    amountPaid: integer("amount_paid"),
    discountCodeId: integer("discount_code_id"), // soft ref; FK added below if needed
    stripeSessionId: text("stripe_session_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    manualPayment: boolean("manual_payment").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_registrations_user").on(t.userId),
    index("idx_registrations_period").on(t.periodId),
    unique().on(t.userId, t.periodId),
  ]
)

// ─── Custom Answers ─────────────────────────────────────────────────────────

export const registrationAnswers = pgTable(
  "registration_answers",
  {
    registrationId: text("registration_id")
      .notNull()
      .references(() => registrations.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => registrationQuestions.id),
    answer: text("answer"),
  },
  (t) => [primaryKey({ columns: [t.registrationId, t.questionId] })]
)

// ─── Notice Acknowledgements ────────────────────────────────────────────────

export const noticeAcknowledgements = pgTable(
  "notice_acknowledgements",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    noticeId: integer("notice_id")
      .notNull()
      .references(() => legalNotices.id),
    noticeVersion: integer("notice_version").notNull(),
    registrationId: text("registration_id").references(() => registrations.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_notice_ack_user").on(t.userId)]
)

// ─── Discount Codes ─────────────────────────────────────────────────────────

export const discountCodes = pgTable("discount_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  reason: text("reason"),
  amountOff: integer("amount_off").notNull(), // cents (flat dollar)
  limitation: text("limitation").notNull().default("unlimited"),
  // unlimited | once_per_family | once_per_registrant
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
})

export const registrationPeriodDiscounts = pgTable(
  "registration_period_discounts",
  {
    periodId: text("period_id")
      .notNull()
      .references(() => registrationPeriods.id, { onDelete: "cascade" }),
    discountId: integer("discount_id")
      .notNull()
      .references(() => discountCodes.id),
  },
  (t) => [primaryKey({ columns: [t.periodId, t.discountId] })]
)

// ─── Extras / Add-Ons ───────────────────────────────────────────────────────

export const extras = pgTable("extras", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: integer("price").notNull().default(0), // cents
  detailType: text("detail_type"), // null | text | size_dropdown
  detailLabel: text("detail_label"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
})

export const registrationPeriodExtras = pgTable(
  "registration_period_extras",
  {
    periodId: text("period_id")
      .notNull()
      .references(() => registrationPeriods.id, { onDelete: "cascade" }),
    extraId: integer("extra_id")
      .notNull()
      .references(() => extras.id),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.periodId, t.extraId] })]
)

export const registrationExtras = pgTable(
  "registration_extras",
  {
    registrationId: text("registration_id")
      .notNull()
      .references(() => registrations.id, { onDelete: "cascade" }),
    extraId: integer("extra_id")
      .notNull()
      .references(() => extras.id),
    detail: text("detail"),
  },
  (t) => [primaryKey({ columns: [t.registrationId, t.extraId] })]
)
