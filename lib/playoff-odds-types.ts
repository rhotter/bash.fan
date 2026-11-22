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
  otRate: number
  soRate: number
  homeFieldAdvantage: number
}

export interface TeamLastGame {
  gameId: string
  date: string
  opponentSlug: string
  opponentName: string
  isHome: boolean
  resultLabel: "W" | "OTW" | "SOW" | "OTL" | "SOL" | "L" | "FFW" | "FFL"
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
