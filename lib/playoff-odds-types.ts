export type PlayoffOddsMode = "weighted" | "50_50" | "classic"

export type BigGameOutcomeKey = "away_reg" | "away_ot" | "home_ot" | "home_reg"

export type SeasonKind = "fall" | "summer"

/**
 * Compact regular-season game record used by the pure Monte Carlo engine
 * (both on the server and for instant client-side What-If re-simulation).
 */
export interface PlayoffSimGame {
  id: string
  date: string
  time: string
  location: string
  awaySlug: string
  awayName: string
  homeSlug: string
  homeName: string
  awayScore: number | null
  homeScore: number | null
  status: "final" | "upcoming" | "live"
  isOvertime: boolean
  hasShootout: boolean
  isForfeit: boolean
  /**
   * Internal What-If marker: a locked result whose exact form is not decided by the pick.
   * "reg" = regulation win with simulated margin; "extra" = OT/SO win (OT vs SO, and thus ROW,
   * is simulated). Never set on real games.
   */
  whatIfLock?: "reg" | "extra"
}

export interface PlayoffFormat {
  teamCount: number
  playoffSpots: number
  directByeSpots: number
  hasPlayIn: boolean
  allTeamsQualify: boolean
}

export interface CalibrationProfile {
  pythagenPuckPower: number
  ebShrinkageGames: number
  /** Pre-ratio Gamma-Poisson prior games toward league-average goals/game (0 = Laplace +0.25) */
  goalPriorGames?: number
  /** Empirical league-average goals scored per team-game (SOWG stripped) */
  leagueMeanGoalsPerTeam?: number
  /** League-average share of games decided in overtime (target mean across matchups) */
  otRate: number
  /** League-average share of games decided by shootout (target mean across matchups) */
  soRate: number
  homeFieldAdvantage: number
  /**
   * Concentration multiplier for per-simulation Bayesian strength draws:
   * theta ~ Beta(kappa*s, kappa*(1-s)) with kappa = strengthConcentration * (GP + ebShrinkageGames + goalPriorGames).
   * 0 disables parameter uncertainty (plug-in strengths).
   */
  strengthConcentration: number
  /** Regulation goal-margin CDF for margins 1..N (last entry = 1.0) */
  regMarginCdf: readonly number[]
  /** Typical goals scored by the losing team in a regulation game (used for GF tiebreak tallies) */
  regLoserGoals: number
  /** Typical goals scored by the losing team in an OT/SO game (used for GF tiebreak tallies) */
  otLoserGoals: number
}

export interface TeamLastGame {
  gameId: string
  date: string
  opponentSlug: string
  opponentName: string
  isHome: boolean
  resultLabel: "W" | "OTW" | "SOW" | "OTL" | "SOL" | "L" | "T" | "FFW" | "FFL"
  teamScore: number
  opponentScore: number
}

export interface TeamNextGame {
  gameId: string
  date: string
  time: string
  opponentSlug: string
  opponentName: string
  isHome: boolean
}

export interface WhatIfRecordRow {
  label: string
  minAddedPts: number
  maxAddedPts: number
  minFinalPts: number
  maxFinalPts: number
  playoffPct: number
  avgSeed: number
  bestSeed: number
  worstSeed: number
  simCount: number
  isTailProbe: boolean
  /** Fewer than 250 simulated seasons landed in this row (wide Monte Carlo error) */
  lowSample?: boolean
}

export interface TeamOddsRow {
  slug: string
  name: string
  currentRank: number
  gp: number
  gamesRemaining: number
  gamesInHand: number
  w: number
  otw: number
  sow: number
  otl: number
  l: number
  /** Historical (pre-shootout era) ties; 1 point each */
  ties?: number
  /** Regulation + Overtime wins (excludes shootout wins per BASH Rule 213) */
  row: number
  pts: number
  gf: number
  ga: number
  gd: number
  playoffPct: number
  playoffDelta: number | null
  clinched: boolean
  eliminated: boolean
  directByePct: number
  playInPct: number
  /** Length = format.teamCount; index 0 is Seed 1 %, index k-1 is Seed k % */
  seedPcts: number[]
  avgSeed: number
  avgSeedDelta: number | null
  bestSeed: number
  worstSeed: number
  strength: number
  rawPythPct: number
  actualPtsPct: number
  luckDelta: number
  rpi: number
  rpiRank: number
  lastGame: TeamLastGame | null
  nextGame: TeamNextGame | null
  whatIfRows: WhatIfRecordRow[]
  /** Finish rows conditioned on 0 remaining OT/SO games for this team (regulation wins/losses only) */
  whatIfRowsNoOt?: WhatIfRecordRow[]
}

export interface BigGameOutcomeCell {
  playoffPct: number
  playoffDelta: number
  avgSeed: number
  seedDelta: number
  lowSample: boolean
}

export interface BigGameAffectedTeam {
  slug: string
  name: string
  isParticipant: boolean
  currentPlayoffPct: number
  currentAvgSeed: number
  playoffSwing: number
  seedSwing: number
  bestOutcome: BigGameOutcomeKey
  /** True when bestOutcome optimizes avgSeed rather than playoffPct (all-in or insignificant playoff swing). */
  optimizeSeed?: boolean
  outcomes: Record<BigGameOutcomeKey, BigGameOutcomeCell>
}

export interface BigGameImpact {
  gameId: string
  date: string
  time: string
  location: string
  isNextMatchday: boolean
  awaySlug: string
  awayName: string
  homeSlug: string
  homeName: string
  awayWinProb: number
  homeWinProb: number
  totalPlayoffSwing: number
  totalSeedSwing: number
  outcomeSampleCounts: Record<BigGameOutcomeKey, number>
  affectedTeams: BigGameAffectedTeam[]
}

export interface TimelineTeamEntry {
  playoffPct: number
  avgSeed: number
  pts: number
  /** BASH 3-2-1 equivalent of SCS "Points Above .500": pts - 1.5 * gp */
  ptsAbove500: number
}

export interface TimelinePoint {
  date: string
  label: string
  gamesCompleted: number
  teams: Record<string, TimelineTeamEntry>
}

export interface PlayoffOddsSnapshot {
  seasonId: string
  seasonName: string
  seasonType: SeasonKind
  seasonStatus: string
  mode: PlayoffOddsMode
  stateHash: string
  generatedAt: string
  iterations: number
  computeMs: number
  gamesPlayed: number
  gamesRemaining: number
  totalRegularGames: number
  endedEarly: boolean
  format: PlayoffFormat
  calibration: CalibrationProfile
  teams: TeamOddsRow[]
  bigGames: BigGameImpact[]
  nextMatchdayDate: string | null
  timeline: TimelinePoint[]
  /** Compact regular-season schedule enabling instant client-side What-If re-simulation */
  regularGames: PlayoffSimGame[]
  /** Team slug -> hex color (season_teams.color, falling back to franchise color) */
  teamColors?: Record<string, string>
}

export function isValidPlayoffOddsMode(value: string | null | undefined): value is PlayoffOddsMode {
  return value === "weighted" || value === "50_50" || value === "classic"
}
