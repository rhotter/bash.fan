import type {
  BigGameAffectedTeam,
  BigGameImpact,
  BigGameOutcomeCell,
  BigGameOutcomeKey,
  CalibrationProfile,
  PlayoffFormat,
  PlayoffOddsMode,
  PlayoffOddsSnapshot,
  PlayoffSimGame,
  SeasonKind,
  TeamLastGame,
  TeamNextGame,
  TeamOddsRow,
  TimelinePoint,
  WhatIfRecordRow,
} from "@/lib/playoff-odds-types"
import { isLegacyTeamSlug } from "@/lib/team-filters"
import { compareGamesChronological } from "@/lib/format-time"

export const DEFAULT_ITERATIONS = 100_000
export const CLIENT_WHATIF_ITERATIONS = 20_000
export const TIMELINE_ITERATIONS = 10_000
export const TAIL_PROBE_ITERATIONS = 1_000

const OUTCOME_KEYS: readonly BigGameOutcomeKey[] = [
  "away_reg",
  "away_ot",
  "home_ot",
  "home_reg",
] as const

/**
 * Empirically calibrated BASH league constants via season-blocked Leave-One-Season-Out (LOSO)
 * cross-validation across 2,107 non-forfeit, non-tie regular-season games (1,561 Fall across
 * 27 seasons + 546 Summer across 27 seasons). See docs/research-sports-club-stats.md §6.
 */
export const BASH_CALIBRATION: Record<SeasonKind, CalibrationProfile> = {
  fall: {
    pythagenPuckPower: 0.22,
    ebShrinkageGames: 4,
    goalPriorGames: 4,
    leagueMeanGoalsPerTeam: 3.73,
    otRate: 0.075,
    soRate: 0.045,
    homeFieldAdvantage: 0.5,
    // Calibrated on remaining-season points CRPS & PIT variance (0.0833 at 25%, 0.0836 at 50%; 84.9% / 91.9% cov.)
    strengthConcentration: 1.5,
    // Empirical Fall regulation goal-margin CDF (1..6+ goals, n=1,357)
    regMarginCdf: [0.2174, 0.4149, 0.5976, 0.7406, 0.8305, 1.0],
    // Empirical Fall mean regulation loser goals: 2.04; OT/SO median loser goals: 3 (mean 2.80)
    regLoserGoals: 2,
    otLoserGoals: 3,
  },
  summer: {
    pythagenPuckPower: 0.458,
    ebShrinkageGames: 4,
    goalPriorGames: 4,
    leagueMeanGoalsPerTeam: 6.13,
    otRate: 0.055,
    soRate: 0.035,
    homeFieldAdvantage: 0.5,
    // Calibrated on remaining-season pts% coverage: 82.7% / 92.0% nominal 80%/90% intervals
    strengthConcentration: 3,
    // Empirical Summer regulation goal-margin CDF (1..6+ goals, n=488)
    regMarginCdf: [0.2152, 0.3914, 0.5451, 0.6701, 0.7766, 1.0],
    // Empirical Summer mean regulation loser goals: 4.24; OT/SO median loser goals: 5 (mean 5.35)
    regLoserGoals: 4,
    otLoserGoals: 5,
  },
}

/** What-If finish rows need at least this many simulated seasons to be shown (else tail-probed). */
const WHAT_IF_MIN_ROW_SAMPLES = 25
/** What-If finish rows below this many simulated seasons are flagged as low-sample (`*`). */
const WHAT_IF_LOW_SAMPLE = 250

// ─── Deterministic Hashing & PRNG (xoshiro128** seeded via FNV-1a + SplitMix32) ─

export function fnv1aHash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function createPrng(seed: number): () => number {
  let s = seed >>> 0
  const splitmix32 = () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
    return (z ^ (z >>> 16)) >>> 0
  }
  let s0 = splitmix32()
  let s1 = splitmix32()
  let s2 = splitmix32()
  let s3 = splitmix32()
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1

  return () => {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0
    const t = (s1 << 9) >>> 0
    s2 ^= s0
    s3 ^= s1
    s1 ^= s2
    s0 ^= s3
    s2 ^= t
    s3 = rotl(s3, 11)
    return result / 4294967296
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0
}

// ─── Format Resolution ───────────────────────────────────────────────────────

export function resolvePlayoffFormat(opts: {
  seasonType: SeasonKind
  seasonStatus: string
  configuredPlayoffTeams?: number | null
  teamCount: number
  actualPlayoffTeamCount?: number
}): PlayoffFormat {
  const { seasonType, seasonStatus, configuredPlayoffTeams, teamCount, actualPlayoffTeamCount = 0 } = opts
  if (teamCount <= 0) {
    return {
      teamCount: 0,
      playoffSpots: 0,
      directByeSpots: 0,
      hasPlayIn: false,
      allTeamsQualify: false,
    }
  }

  let playoffSpots: number

  if (seasonStatus === "completed" && actualPlayoffTeamCount >= 2) {
    playoffSpots = Math.min(actualPlayoffTeamCount, teamCount)
  } else if (seasonType === "summer") {
    // Rule 219: all Summer teams make playoffs. Ignore the schema default `4` on >4-team Summer seasons.
    const explicitNonDefaultRestriction =
      seasonStatus !== "completed" &&
      typeof configuredPlayoffTeams === "number" &&
      configuredPlayoffTeams !== 4 &&
      configuredPlayoffTeams >= 2 &&
      configuredPlayoffTeams < teamCount
    playoffSpots = explicitNonDefaultRestriction ? configuredPlayoffTeams! : teamCount
  } else if (
    teamCount >= 7 &&
    (configuredPlayoffTeams == null || configuredPlayoffTeams === 4)
  ) {
    // Rule 412: 7+ team Fall seasons qualify top 5 (1-3 bye, 4v5 play-in).
    // Guard against Postgres schema default `playoff_teams = 4` on both active (including during playoffs) and historical 7-team seasons.
    playoffSpots = Math.min(5, teamCount)
  } else if (
    typeof configuredPlayoffTeams === "number" &&
    configuredPlayoffTeams >= 1 &&
    configuredPlayoffTeams <= teamCount
  ) {
    playoffSpots = configuredPlayoffTeams
  } else {
    // Rule 412 fallback: 7+ team Fall seasons qualify top 5 (1-3 direct, 4v5 play-in); <=6 teams qualify top 4
    playoffSpots = teamCount >= 7 ? Math.min(5, teamCount) : Math.min(4, teamCount)
  }

  const allTeamsQualify = playoffSpots >= teamCount
  const hasPlayIn = seasonType === "fall" && playoffSpots === 5 && teamCount >= 7
  const directByeSpots = hasPlayIn ? 3 : 0

  return {
    teamCount,
    playoffSpots,
    directByeSpots,
    hasPlayIn,
    allTeamsQualify,
  }
}

// ─── Strength & Matchup Probability Formulas ─────────────────────────────────

export function clampStrength(val: number): number {
  return Math.max(0.05, Math.min(0.95, val))
}

/**
 * Ken Roberts's exact piecewise-linear regression formula (blog p225, Mar 2, 2009)
 * paired with PercentOfPointsWon (BASH 3-2-1 points / 3*GP).
 */
export function computeKenClassicStrength(
  pts: number,
  gp: number,
  remaining: number
): number {
  if (gp <= 0) return 0.5
  const rawPtsPct = pts / (3 * gp)
  const total = gp + remaining
  const pctPlayed = total > 0 ? gp / total : 1
  let regressPct =
    pctPlayed < 0.5 ? -1.5 * pctPlayed + 1.0 : -0.5 * pctPlayed + 0.5
  regressPct += 0.1 * pctPlayed
  const regressed = rawPtsPct - (rawPtsPct - 0.5) * regressPct
  return clampStrength(regressed)
}

/**
 * BASH-Calibrated PythagenPuck + Empirical Bayes Shrinkage toward 0.500.
 */
export function computeWeightedStrength(
  gfPlayed: number,
  gaPlayed: number,
  gpPlayed: number,
  calibration: CalibrationProfile
): { strength: number; rawPythPct: number } {
  if (gpPlayed <= 0) {
    return { strength: 0.5, rawPythPct: 0.5 }
  }
  const m = calibration.goalPriorGames ?? 0
  const mu = calibration.leagueMeanGoalsPerTeam ?? 0
  // Pre-ratio Gamma-Poisson goal-rate shrinkage when configured (eliminates shutout singularities
  // cleanly); otherwise tiny Laplace smoothing (+0.25 goal) guards against 0-0 edge cases.
  const gfg = m > 0 && mu > 0 ? (gfPlayed + m * mu) / (gpPlayed + m) : (gfPlayed + 0.25) / gpPlayed
  const gag = m > 0 && mu > 0 ? (gaPlayed + m * mu) / (gpPlayed + m) : (gaPlayed + 0.25) / gpPlayed
  const exp = Math.max(0.5, Math.pow(gfg + gag, calibration.pythagenPuckPower))
  const gfPow = Math.pow(gfg, exp)
  const gaPow = Math.pow(gag, exp)
  const rawPythPct = gfPow / (gfPow + gaPow)
  const shrunk =
    (gpPlayed * rawPythPct + calibration.ebShrinkageGames * 0.5) /
    (gpPlayed + calibration.ebShrinkageGames)
  return {
    strength: clampStrength(shrunk),
    rawPythPct,
  }
}

/**
 * Bill James Log5 matchup win probability (zero home-field advantage for BASH single venue).
 */
export function log5(strengthA: number, strengthB: number): number {
  const num = strengthA * (1 - strengthB)
  const den = num + strengthB * (1 - strengthA)
  if (den <= 0) return 0.5
  return num / den
}

// ─── Official BASH Rule 213 Tiebreaker Engine ────────────────────────────────

/**
 * Ranks teams `0..teamCount-1` in descending finish order (index 0 = Seed 1)
 * using official BASH Rule 213:
 *   1. Points (PTS)
 *   2. ROW (Regulation + Overtime Wins; Shootout wins excluded)
 *   3. Head-to-Head % of available points earned among tied clubs (recursive on narrowed subgroups)
 *   4. Goal Differential (GD)
 *   5. Goals For (GF)
 *   6. Draw Lots (tiebreakRand)
 */
export function rankTeamsRule213(
  teamCount: number,
  pts: Int16Array,
  row: Int16Array,
  gd: Int16Array,
  gf: Int16Array,
  h2hPts: Int16Array,
  h2hGames: Int16Array,
  tiebreakRand: Float64Array,
  orderOut?: Int16Array,
  h2hPctScratch?: Float64Array
): Int16Array {
  const order = orderOut ?? new Int16Array(teamCount)
  const h2hPctBuf = h2hPctScratch ?? new Float64Array(teamCount)

  for (let i = 0; i < teamCount; i++) order[i] = i

  // Fast insertion sort by (PTS desc, ROW desc) — optimal for small T (4..12)
  for (let i = 1; i < teamCount; i++) {
    const key = order[i]
    const keyPts = pts[key]
    const keyRow = row[key]
    let j = i - 1
    while (
      j >= 0 &&
      (pts[order[j]] < keyPts ||
        (pts[order[j]] === keyPts && row[order[j]] < keyRow))
    ) {
      order[j + 1] = order[j]
      j--
    }
    order[j + 1] = key
  }

  // Resolve any contiguous blocks tied on both PTS and ROW
  let start = 0
  while (start < teamCount) {
    let end = start + 1
    const basePts = pts[order[start]]
    const baseRow = row[order[start]]
    while (
      end < teamCount &&
      pts[order[end]] === basePts &&
      row[order[end]] === baseRow
    ) {
      end++
    }
    if (end - start > 1) {
      resolveTiedSlice(
        order,
        start,
        end,
        teamCount,
        gd,
        gf,
        h2hPts,
        h2hGames,
        tiebreakRand,
        h2hPctBuf
      )
    }
    start = end
  }

  return order
}

function isH2hGroupConnected(
  order: Int16Array,
  start: number,
  end: number,
  teamCount: number,
  h2hGames: Int16Array
): boolean {
  const size = end - start
  const visited = new Uint8Array(size)
  const stack = [0]
  visited[0] = 1
  let seen = 1
  while (stack.length > 0) {
    const x = stack.pop()!
    const tx = order[start + x]
    for (let y = 0; y < size; y++) {
      if (visited[y]) continue
      if (h2hGames[tx * teamCount + order[start + y]] > 0) {
        visited[y] = 1
        seen++
        stack.push(y)
      }
    }
  }
  return seen === size
}

function resolveTiedSlice(
  order: Int16Array,
  start: number,
  end: number,
  teamCount: number,
  gd: Int16Array,
  gf: Int16Array,
  h2hPts: Int16Array,
  h2hGames: Int16Array,
  tiebreakRand: Float64Array,
  h2hPctBuf: Float64Array
): void {
  // Step 3: H2H % of available points among tied clubs in order[start..end)
  let allHaveH2h = true
  for (let a = start; a < end; a++) {
    const ti = order[a]
    let earned = 0
    let games = 0
    const rowOffset = ti * teamCount
    for (let b = start; b < end; b++) {
      if (a === b) continue
      const tj = order[b]
      earned += h2hPts[rowOffset + tj]
      games += h2hGames[rowOffset + tj]
    }
    if (games === 0) {
      allHaveH2h = false
      break
    }
    h2hPctBuf[ti] = earned / (3 * games)
  }

  // H2H percentages are only comparable when the tied clubs' games link them all together
  // (e.g. A–B and C–D played but no A/B vs C/D games → skip to goal differential).
  if (allHaveH2h && end - start > 2 && !isH2hGroupConnected(order, start, end, teamCount, h2hGames)) {
    allHaveH2h = false
  }

  if (allHaveH2h) {
    // Insertion sort slice by H2H % descending
    for (let i = start + 1; i < end; i++) {
      const key = order[i]
      const keyPct = h2hPctBuf[key]
      let j = i - 1
      while (j >= start && h2hPctBuf[order[j]] < keyPct - 1e-9) {
        order[j + 1] = order[j]
        j--
      }
      order[j + 1] = key
    }

    // Check if H2H actually broke the tie into at least 2 distinct subgroups
    const topPct = h2hPctBuf[order[start]]
    const botPct = h2hPctBuf[order[end - 1]]
    if (topPct - botPct > 1e-9) {
      let subStart = start
      while (subStart < end) {
        let subEnd = subStart + 1
        const refPct = h2hPctBuf[order[subStart]]
        while (subEnd < end && Math.abs(h2hPctBuf[order[subEnd]] - refPct) <= 1e-9) {
          subEnd++
        }
        if (subEnd - subStart > 1) {
          // Recursively apply Rule 213 H2H on the narrowed subgroup (e.g., 3-way -> 2-way)
          resolveTiedSlice(
            order,
            subStart,
            subEnd,
            teamCount,
            gd,
            gf,
            h2hPts,
            h2hGames,
            tiebreakRand,
            h2hPctBuf
          )
        }
        subStart = subEnd
      }
      return
    }
  }

  // Step 4 (GD) -> Step 5 (GF) -> Step 6 (Draw Lots)
  for (let i = start + 1; i < end; i++) {
    const key = order[i]
    const keyGd = gd[key]
    const keyGf = gf[key]
    const keyRand = tiebreakRand[key]
    let j = i - 1
    while (j >= start) {
      const cur = order[j]
      if (
        gd[cur] < keyGd ||
        (gd[cur] === keyGd &&
          (gf[cur] < keyGf ||
            (gf[cur] === keyGf && tiebreakRand[cur] < keyRand)))
      ) {
        order[j + 1] = cur
        j--
      } else {
        break
      }
    }
    order[j + 1] = key
  }
}

// ─── Base Season State Aggregation ───────────────────────────────────────────

interface TeamAccumulator {
  index: number
  slug: string
  name: string
  gp: number
  gamesRemaining: number
  w: number
  otw: number
  sow: number
  otl: number
  l: number
  row: number
  pts: number
  gf: number
  ga: number
  /** Historical (pre-shootout era) ties: 1 point each, no ROW */
  ties: number
  /**
   * Non-forfeit scoring stats used for PythagenPuck efficiency. Shootout-deciding goals are
   * excluded (they are not open-play goals), matching SCS "PythagenpatIgnoreShootOutWinningGoals".
   */
  gpPlayed: number
  gfPlayed: number
  gaPlayed: number
  /** Points earned in non-forfeit games (pairs with gpPlayed for the luck/pace comparison) */
  ptsPlayed: number
  lastGame: TeamLastGame | null
  nextGame: TeamNextGame | null
}

interface LockedSimGame {
  winner: number
  loser: number
  /** "reg": margin is simulated; "extra": OT vs SO (and therefore ROW) is simulated */
  kind: "reg" | "extra"
}

interface ParsedSeasonState {
  teams: TeamAccumulator[]
  slugToIdx: Map<string, number>
  completedGames: PlayoffSimGame[]
  remainingGames: PlayoffSimGame[]
  basePts: Int16Array
  baseRow: Int16Array
  baseGd: Int16Array
  baseGf: Int16Array
  baseH2hPts: Int16Array
  baseH2hGames: Int16Array
  rpiValues: number[]
  rpiRanks: number[]
  /** What-If locked results whose margin / OT-vs-SO form is simulated each iteration */
  lockedSimGames: LockedSimGame[]
  /** Per-team count of locked OT/SO wins whose ROW credit is still undetermined */
  uncertainRowWins: Int16Array
}

function applyLockedOutcomes(
  games: PlayoffSimGame[],
  lockedOutcomes?: Record<string, BigGameOutcomeKey>
): PlayoffSimGame[] {
  if (!lockedOutcomes || Object.keys(lockedOutcomes).length === 0) {
    return games
  }
  return games.map((g) => {
    if (g.status === "final") return g
    const pick = lockedOutcomes[g.id]
    if (!pick) return g
    // Scores are placeholders for the winner/points only: regulation margins and OT-vs-SO
    // (which decides ROW) are simulated per iteration via `whatIfLock`.
    switch (pick) {
      case "away_reg":
        return { ...g, status: "final", awayScore: 1, homeScore: 0, isOvertime: false, hasShootout: false, isForfeit: false, whatIfLock: "reg" }
      case "away_ot":
        return { ...g, status: "final", awayScore: 1, homeScore: 0, isOvertime: true, hasShootout: false, isForfeit: false, whatIfLock: "extra" }
      case "home_ot":
        return { ...g, status: "final", awayScore: 0, homeScore: 1, isOvertime: true, hasShootout: false, isForfeit: false, whatIfLock: "extra" }
      case "home_reg":
        return { ...g, status: "final", awayScore: 0, homeScore: 1, isOvertime: false, hasShootout: false, isForfeit: false, whatIfLock: "reg" }
    }
  })
}

function parseSeasonState(
  games: PlayoffSimGame[],
  treatUpcomingAsCancelled: boolean
): ParsedSeasonState {
  const validGames = games.filter(
    (g) => !isLegacyTeamSlug(g.awaySlug) && !isLegacyTeamSlug(g.homeSlug)
  )

  const teamNames = new Map<string, string>()
  for (const g of validGames) {
    if (!teamNames.has(g.awaySlug)) teamNames.set(g.awaySlug, g.awayName)
    if (!teamNames.has(g.homeSlug)) teamNames.set(g.homeSlug, g.homeName)
  }

  // Deterministic alphabetical indexing by slug
  const sortedSlugs = [...teamNames.keys()].sort((a, b) => a.localeCompare(b))
  const slugToIdx = new Map<string, number>()
  const teams: TeamAccumulator[] = sortedSlugs.map((slug, index) => {
    slugToIdx.set(slug, index)
    return {
      index,
      slug,
      name: teamNames.get(slug)!,
      gp: 0,
      gamesRemaining: 0,
      w: 0,
      otw: 0,
      sow: 0,
      otl: 0,
      l: 0,
      row: 0,
      pts: 0,
      gf: 0,
      ga: 0,
      ties: 0,
      gpPlayed: 0,
      gfPlayed: 0,
      gaPlayed: 0,
      ptsPlayed: 0,
      lastGame: null,
      nextGame: null,
    }
  })

  const T = teams.length
  const basePts = new Int16Array(T)
  const baseRow = new Int16Array(T)
  const baseGd = new Int16Array(T)
  const baseGf = new Int16Array(T)
  const baseH2hPts = new Int16Array(T * T)
  const baseH2hGames = new Int16Array(T * T)

  const completedGames: PlayoffSimGame[] = []
  const remainingGames: PlayoffSimGame[] = []
  const lockedSimGames: LockedSimGame[] = []
  const uncertainRowWins = new Int16Array(T)

  // Sort chronologically by date + parsed 24h time so same-day doubleheaders order accurately
  const sortedGames = [...validGames].sort(compareGamesChronological)

  for (const g of sortedGames) {
    const aIdx = slugToIdx.get(g.awaySlug)!
    const hIdx = slugToIdx.get(g.homeSlug)!
    const away = teams[aIdx]
    const home = teams[hIdx]

    if (g.status === "final" && g.awayScore !== null && g.homeScore !== null) {
      completedGames.push(g)
      away.gp++
      home.gp++

      // Double forfeit (Rule 208): both teams take 0-5 loss, 0 pts
      if (g.isForfeit && g.awayScore === g.homeScore) {
        away.l++
        home.l++
        away.ga += 5
        home.ga += 5
        baseGd[aIdx] -= 5
        baseGd[hIdx] -= 5
        baseH2hGames[aIdx * T + hIdx]++
        baseH2hGames[hIdx * T + aIdx]++

        away.lastGame = {
          gameId: g.id,
          date: g.date,
          opponentSlug: home.slug,
          opponentName: home.name,
          isHome: false,
          resultLabel: "FFL",
          teamScore: 0,
          opponentScore: 5,
        }
        home.lastGame = {
          gameId: g.id,
          date: g.date,
          opponentSlug: away.slug,
          opponentName: away.name,
          isHome: true,
          resultLabel: "FFL",
          teamScore: 0,
          opponentScore: 5,
        }
        continue
      }

      const aScore = g.awayScore
      const hScore = g.homeScore
      baseH2hGames[aIdx * T + hIdx]++
      baseH2hGames[hIdx * T + aIdx]++

      // What-If locked result: points/standing are fixed; margin and OT-vs-SO are simulated
      if (g.whatIfLock) {
        const homeWon = hScore > aScore
        const winner = homeWon ? home : away
        const loser = homeWon ? away : home
        const wIdx = homeWon ? hIdx : aIdx
        const lIdx = homeWon ? aIdx : hIdx
        if (g.whatIfLock === "reg") {
          winner.w++
          winner.row++
          winner.pts += 3
          loser.l++
          basePts[wIdx] += 3
          baseRow[wIdx]++
          baseH2hPts[wIdx * T + lIdx] += 3
        } else {
          winner.otw++
          winner.pts += 2
          loser.otl++
          loser.pts += 1
          basePts[wIdx] += 2
          basePts[lIdx] += 1
          baseH2hPts[wIdx * T + lIdx] += 2
          baseH2hPts[lIdx * T + wIdx] += 1
          uncertainRowWins[wIdx]++
        }
        lockedSimGames.push({ winner: wIdx, loser: lIdx, kind: g.whatIfLock })
        continue
      }

      away.gf += aScore
      away.ga += hScore
      home.gf += hScore
      home.ga += aScore
      baseGf[aIdx] += aScore
      baseGf[hIdx] += hScore
      baseGd[aIdx] += aScore - hScore
      baseGd[hIdx] += hScore - aScore

      const isExtra = g.isOvertime || g.hasShootout
      const isSO = g.hasShootout

      if (!g.isForfeit) {
        // Exclude the shootout-deciding goal from strength inputs (not an open-play goal)
        const soAdj = isSO && hScore !== aScore ? 1 : 0
        const homeAdj = soAdj && hScore > aScore ? 1 : 0
        const awayAdj = soAdj && aScore > hScore ? 1 : 0
        away.gpPlayed++
        away.gfPlayed += aScore - awayAdj
        away.gaPlayed += hScore - homeAdj
        home.gpPlayed++
        home.gfPlayed += hScore - homeAdj
        home.gaPlayed += aScore - awayAdj
      }

      // Historical tie (pre-shootout seasons): 1 point each, no ROW
      if (hScore === aScore) {
        home.ties++
        away.ties++
        home.pts += 1
        away.pts += 1
        basePts[hIdx] += 1
        basePts[aIdx] += 1
        baseH2hPts[hIdx * T + aIdx] += 1
        baseH2hPts[aIdx * T + hIdx] += 1
        if (!g.isForfeit) {
          home.ptsPlayed += 1
          away.ptsPlayed += 1
        }
        home.lastGame = {
          gameId: g.id,
          date: g.date,
          opponentSlug: away.slug,
          opponentName: away.name,
          isHome: true,
          resultLabel: "T",
          teamScore: hScore,
          opponentScore: aScore,
        }
        away.lastGame = {
          gameId: g.id,
          date: g.date,
          opponentSlug: home.slug,
          opponentName: home.name,
          isHome: false,
          resultLabel: "T",
          teamScore: aScore,
          opponentScore: hScore,
        }
        continue
      }

      const homeWon = hScore > aScore
      const winner = homeWon ? home : away
      const loser = homeWon ? away : home
      const wIdx = homeWon ? hIdx : aIdx
      const lIdx = homeWon ? aIdx : hIdx

      if (isExtra) {
        if (isSO) {
          winner.sow++
        } else {
          winner.otw++
          winner.row++
          baseRow[wIdx]++
        }
        winner.pts += 2
        loser.otl++
        loser.pts += 1
        basePts[wIdx] += 2
        basePts[lIdx] += 1
        baseH2hPts[wIdx * T + lIdx] += 2
        baseH2hPts[lIdx * T + wIdx] += 1
        if (!g.isForfeit) {
          winner.ptsPlayed += 2
          loser.ptsPlayed += 1
        }
      } else {
        winner.w++
        winner.row++
        winner.pts += 3
        loser.l++
        basePts[wIdx] += 3
        baseRow[wIdx]++
        baseH2hPts[wIdx * T + lIdx] += 3
        if (!g.isForfeit) winner.ptsPlayed += 3
      }

      const wScore = homeWon ? hScore : aScore
      const lScore = homeWon ? aScore : hScore
      winner.lastGame = {
        gameId: g.id,
        date: g.date,
        opponentSlug: loser.slug,
        opponentName: loser.name,
        isHome: homeWon,
        resultLabel: g.isForfeit ? "FFW" : isSO ? "SOW" : isExtra ? "OTW" : "W",
        teamScore: wScore,
        opponentScore: lScore,
      }
      loser.lastGame = {
        gameId: g.id,
        date: g.date,
        opponentSlug: winner.slug,
        opponentName: winner.name,
        isHome: !homeWon,
        resultLabel: g.isForfeit ? "FFL" : isSO ? "SOL" : isExtra ? "OTL" : "L",
        teamScore: lScore,
        opponentScore: wScore,
      }
    } else if (!treatUpcomingAsCancelled) {
      remainingGames.push(g)
      away.gamesRemaining++
      home.gamesRemaining++

      if (!away.nextGame) {
        away.nextGame = {
          gameId: g.id,
          date: g.date,
          time: g.time,
          opponentSlug: home.slug,
          opponentName: home.name,
          isHome: false,
        }
      }
      if (!home.nextGame) {
        home.nextGame = {
          gameId: g.id,
          date: g.date,
          time: g.time,
          opponentSlug: away.slug,
          opponentName: away.name,
          isHome: true,
        }
      }
    }
  }

  // Compute RPI = 0.25*WP + 0.50*OWP + 0.25*OOWP (informational, matching SCS)
  const { rpiValues, rpiRanks } = computeRpi(teams, baseH2hPts, baseH2hGames)

  return {
    teams,
    slugToIdx,
    completedGames,
    remainingGames,
    basePts,
    baseRow,
    baseGd,
    baseGf,
    baseH2hPts,
    baseH2hGames,
    rpiValues,
    rpiRanks,
    lockedSimGames,
    uncertainRowWins,
  }
}

function computeRpi(
  teams: TeamAccumulator[],
  h2hPts: Int16Array,
  h2hGames: Int16Array
): { rpiValues: number[]; rpiRanks: number[] } {
  const T = teams.length
  const wp = teams.map((t) => (t.gp > 0 ? t.pts / (3 * t.gp) : 0.5))

  // OWP[i]: average WP of i's completed opponents, excluding games played against i
  const owp = new Array<number>(T).fill(0.5)
  for (let i = 0; i < T; i++) {
    let sum = 0
    let count = 0
    for (let j = 0; j < T; j++) {
      if (i === j) continue
      const gij = h2hGames[i * T + j]
      if (gij <= 0) continue
      const oppGpExcl = teams[j].gp - gij
      const oppPtsExcl = teams[j].pts - h2hPts[j * T + i]
      const oppWpExcl = oppGpExcl > 0 ? oppPtsExcl / (3 * oppGpExcl) : 0.5
      sum += oppWpExcl * gij
      count += gij
    }
    owp[i] = count > 0 ? sum / count : 0.5
  }

  // OOWP[i]: average OWP of i's completed opponents
  const oowp = new Array<number>(T).fill(0.5)
  for (let i = 0; i < T; i++) {
    let sum = 0
    let count = 0
    for (let j = 0; j < T; j++) {
      if (i === j) continue
      const gij = h2hGames[i * T + j]
      if (gij <= 0) continue
      sum += owp[j] * gij
      count += gij
    }
    oowp[i] = count > 0 ? sum / count : 0.5
  }

  const rpiValues = teams.map((_, i) => 0.25 * wp[i] + 0.5 * owp[i] + 0.25 * oowp[i])
  // Competition ranking: exactly tied RPI values share a rank (no alphabetical tiebreak)
  const rpiRanks = teams.map((_, i) => {
    let higher = 0
    for (let j = 0; j < T; j++) if (rpiValues[j] > rpiValues[i] + 1e-12) higher++
    return higher + 1
  })
  return { rpiValues, rpiRanks }
}

// ─── Exact Mathematical Clinch & Elimination Checker ─────────────────────────

/**
 * Ranks a zero-remaining-games state under forward and reversed Step-6 Draw-Lots vectors
 * to detect any contiguous block still deadlocked through Step 5 (GF).
 */
function resolveFinalBlocksWithDrawLots(state: ParsedSeasonState): {
  fwdOrder: Int16Array
  blockStartByIdx: Int16Array
  blockEndByIdx: Int16Array
} {
  const T = state.teams.length
  const fwdRand = new Float64Array(T)
  const revRand = new Float64Array(T)
  for (let i = 0; i < T; i++) {
    fwdRand[i] = (T - i) / (T + 1)
    revRand[i] = (i + 1) / (T + 1)
  }
  const fwdOrder = rankTeamsRule213(
    T,
    state.basePts,
    state.baseRow,
    state.baseGd,
    state.baseGf,
    state.baseH2hPts,
    state.baseH2hGames,
    fwdRand
  )
  const revOrder = rankTeamsRule213(
    T,
    state.basePts,
    state.baseRow,
    state.baseGd,
    state.baseGf,
    state.baseH2hPts,
    state.baseH2hGames,
    revRand
  )

  const revPos = new Int16Array(T)
  for (let pos = 0; pos < T; pos++) revPos[revOrder[pos]] = pos

  const blockStartByIdx = new Int16Array(T)
  const blockEndByIdx = new Int16Array(T)

  let bStart = 0
  while (bStart < T) {
    let bEnd = Math.max(bStart, revPos[fwdOrder[bStart]])
    let cursor = bStart + 1
    while (cursor <= bEnd) {
      const rp = revPos[fwdOrder[cursor]]
      if (rp > bEnd) bEnd = rp
      cursor++
    }
    for (let pos = bStart; pos <= bEnd; pos++) {
      const idx = fwdOrder[pos]
      blockStartByIdx[idx] = bStart
      blockEndByIdx[idx] = bEnd
    }
    bStart = bEnd + 1
  }

  return { fwdOrder, blockStartByIdx, blockEndByIdx }
}

/**
 * Tiny max-flow feasibility check (Edmonds–Karp on an adjacency matrix).
 * Distributes each game's 3 points (any integer split 3-0 / 2-1 / 1-2 / 0-3 is possible under
 * BASH 3-2-1 scoring) between its two teams so that each team receives at least `need[team]`.
 * Returns true when every team's need can be met simultaneously.
 */
function canMeetPointNeeds(
  games: ReadonlyArray<readonly [number, number]>,
  teams: readonly number[],
  need: (team: number) => number
): boolean {
  let totalNeed = 0
  const needByTeam = new Map<number, number>()
  for (const t of teams) {
    const n = Math.max(0, need(t))
    needByTeam.set(t, n)
    totalNeed += n
  }
  if (totalNeed === 0) return true
  if (3 * games.length < totalNeed) return false

  // Nodes: 0 = source, 1..G = games, G+1..G+M = teams, G+M+1 = sink
  const G = games.length
  const M = teams.length
  const N = G + M + 2
  const sink = N - 1
  const teamNode = new Map<number, number>()
  teams.forEach((t, i) => teamNode.set(t, G + 1 + i))
  const cap = new Int32Array(N * N)
  for (let g = 0; g < G; g++) {
    cap[0 * N + (g + 1)] = 3
    const [u, v] = games[g]
    const nu = teamNode.get(u)
    const nv = teamNode.get(v)
    if (nu !== undefined) cap[(g + 1) * N + nu] = 3
    if (nv !== undefined) cap[(g + 1) * N + nv] = 3
  }
  for (const t of teams) cap[teamNode.get(t)! * N + sink] = needByTeam.get(t)!

  let flow = 0
  const parent = new Int32Array(N)
  for (;;) {
    parent.fill(-1)
    parent[0] = 0
    const queue = [0]
    for (let qi = 0; qi < queue.length && parent[sink] === -1; qi++) {
      const x = queue[qi]
      for (let y = 0; y < N; y++) {
        if (parent[y] === -1 && cap[x * N + y] > 0) {
          parent[y] = x
          queue.push(y)
        }
      }
    }
    if (parent[sink] === -1) break
    let bottleneck = Infinity
    for (let y = sink; y !== 0; y = parent[y]) bottleneck = Math.min(bottleneck, cap[parent[y] * N + y])
    for (let y = sink; y !== 0; y = parent[y]) {
      cap[parent[y] * N + y] -= bottleneck
      cap[y * N + parent[y]] += bottleneck
    }
    flow += bottleneck
    if (flow >= totalNeed) return true
  }
  return flow >= totalNeed
}

function forEachSubset(items: readonly number[], size: number, visit: (subset: number[]) => boolean): void {
  const chosen: number[] = []
  let stop = false
  const rec = (start: number) => {
    if (stop) return
    if (chosen.length === size) {
      if (visit(chosen)) stop = true
      return
    }
    for (let i = start; i <= items.length - (size - chosen.length); i++) {
      chosen.push(items[i])
      rec(i + 1)
      chosen.pop()
      if (stop) return
    }
  }
  rec(0)
}

/**
 * Exact (points-level) clinch / elimination using max-flow over the remaining schedule.
 *
 * Clinched: in EVERY completion t finishes in the top `spots`. We look for a counterexample
 * where t loses out in regulation and some set R of `spots` rivals all reach t's total
 * (ties count against t unless the rival can never match t's minimum ROW).
 *
 * Eliminated: in EVERY completion at least `spots` rivals finish ahead. We look for a
 * counterexample where t wins out in regulation and at most `spots-1` rivals finish above t
 * (ties count in t's favor unless the rival already has more ROW than t can reach).
 *
 * Tiebreakers beyond ROW (H2H, GD) are treated conservatively, so neither label is ever
 * awarded falsely — at worst a decided team shows ">99.9%" / "<0.1%".
 */
function computeExactClinchElim(
  state: ParsedSeasonState,
  format: PlayoffFormat
): { clinched: boolean[]; eliminated: boolean[] } {
  const T = state.teams.length
  const spots = format.playoffSpots
  const clinched = new Array<boolean>(T).fill(false)
  const eliminated = new Array<boolean>(T).fill(false)

  if (format.allTeamsQualify) {
    clinched.fill(true)
    return { clinched, eliminated }
  }

  if (state.remainingGames.length === 0 && state.lockedSimGames.length === 0) {
    const { blockStartByIdx, blockEndByIdx } = resolveFinalBlocksWithDrawLots(state)
    for (let i = 0; i < T; i++) {
      const bestPossibleSeed = blockStartByIdx[i] + 1
      const worstPossibleSeed = blockEndByIdx[i] + 1
      if (worstPossibleSeed <= spots) clinched[i] = true
      else if (bestPossibleSeed > spots) eliminated[i] = true
    }
    return { clinched, eliminated }
  }

  const pairs: Array<readonly [number, number]> = state.remainingGames.map(
    (g) => [state.slugToIdx.get(g.awaySlug)!, state.slugToIdx.get(g.homeSlug)!] as const
  )
  const rem = state.teams.map((t) => t.gamesRemaining)
  const minRow = (i: number) => state.baseRow[i]
  const maxRow = (i: number) => state.baseRow[i] + rem[i] + state.uncertainRowWins[i]

  const binomialExceeds = (n: number, k: number, limit: number): boolean => {
    if (k < 0 || k > n) return false
    const kk = Math.min(k, n - k)
    let res = 1
    for (let i = 1; i <= kk; i++) {
      res = (res * (n - kk + i)) / i
      if (res > limit) return true
    }
    return false
  }
  const MAX_SUBSETS = 2_000
  const skipClinchExact = binomialExceeds(T - 1, spots, MAX_SUBSETS)
  const skipElimExact = binomialExceeds(T - 1, Math.min(spots - 1, T - 1), MAX_SUBSETS)

  for (let t = 0; t < T; t++) {
    const rivals = Array.from({ length: T }, (_, i) => i).filter((i) => i !== t)

    // ── Clinch: can `spots` rivals all reach t's minimum total while t loses out? ──
    const tMinPts = state.basePts[t]
    const tMinRow = minRow(t)
    // Points each rival needs to finish at/above t (strictly above if it can never win the ROW tiebreak)
    const clinchTarget = (r: number) =>
      tMinPts + (maxRow(r) < tMinRow ? 1 : 0)
    let counterexample = skipClinchExact
    if (!skipClinchExact && rivals.length >= spots) {
      forEachSubset(rivals, spots, (R) => {
        const inR = new Set(R)
        // Points each R member banks for free: wins over t and over non-R teams
        const freePts = new Map<number, number>()
        const internal: Array<readonly [number, number]> = []
        for (const r of R) freePts.set(r, 0)
        for (const [u, v] of pairs) {
          const uIn = inR.has(u)
          const vIn = inR.has(v)
          if (uIn && vIn) internal.push([u, v])
          else if (uIn) freePts.set(u, freePts.get(u)! + 3)
          else if (vIn) freePts.set(v, freePts.get(v)! + 3)
        }
        const ok = canMeetPointNeeds(
          internal,
          R,
          (r) => clinchTarget(r) - state.basePts[r] - freePts.get(r)!
        )
        if (ok) counterexample = true
        return ok
      })
    }
    if (!counterexample) {
      clinched[t] = true
      continue
    }

    // ── Elimination: can t win out and have at most spots-1 rivals finish above it? ──
    const tMaxPts = state.basePts[t] + 3 * rem[t]
    const tMaxRow = maxRow(t)
    // Max points a rival may finish with and still not be above t
    const elimCap = (r: number) => tMaxPts - (minRow(r) > tMaxRow ? 1 : 0)
    const gamesWithoutT = pairs.filter(([u, v]) => u !== t && v !== t)
    let escape = skipElimExact
    if (!skipElimExact) {
      forEachSubset(rivals, Math.min(spots - 1, rivals.length), (S) => {
      const inS = new Set(S)
      const constrained = rivals.filter((r) => !inS.has(r))
      // Constrained teams must stay at or below their cap; S teams may finish above t.
      // Games involving an S team give all points to the S team; games vs t are wins for t.
      for (const r of constrained) {
        if (state.basePts[r] > elimCap(r)) return false
      }
      const constrainedSet = new Set(constrained)
      const internal = gamesWithoutT.filter(([u, v]) => constrainedSet.has(u) && constrainedSet.has(v))
      // Feasible iff internal points (3 per game) fit under the caps: equivalently each game's
      // 3 points must be absorbed by remaining capacity → a need of 3*games against capacities.
      const capacity = (r: number) => elimCap(r) - state.basePts[r]
      let totalCap = 0
      for (const r of constrained) totalCap += capacity(r)
      if (3 * internal.length > totalCap) return false
      // Max-flow: games (3 each) -> constrained teams (capacity) ; need full saturation of games
      const ok = canAbsorbGamePoints(internal, constrained, capacity)
      if (ok) escape = true
      return ok
      })
    }
    if (!escape) eliminated[t] = true
  }

  return { clinched, eliminated }
}

/**
 * Max-flow check that every game's 3 points can be assigned to its two teams without any team
 * exceeding `capacity(team)`.
 */
function canAbsorbGamePoints(
  games: ReadonlyArray<readonly [number, number]>,
  teams: readonly number[],
  capacity: (team: number) => number
): boolean {
  if (games.length === 0) return true
  const G = games.length
  const M = teams.length
  const N = G + M + 2
  const sink = N - 1
  const teamNode = new Map<number, number>()
  teams.forEach((t, i) => teamNode.set(t, G + 1 + i))
  const cap = new Int32Array(N * N)
  for (let g = 0; g < G; g++) {
    cap[g + 1] = 3
    const [u, v] = games[g]
    cap[(g + 1) * N + teamNode.get(u)!] = 3
    cap[(g + 1) * N + teamNode.get(v)!] = 3
  }
  for (const t of teams) cap[teamNode.get(t)! * N + sink] = Math.max(0, capacity(t))
  const required = 3 * G
  let flow = 0
  const parent = new Int32Array(N)
  for (;;) {
    parent.fill(-1)
    parent[0] = 0
    const queue = [0]
    for (let qi = 0; qi < queue.length && parent[sink] === -1; qi++) {
      const x = queue[qi]
      for (let y = 0; y < N; y++) {
        if (parent[y] === -1 && cap[x * N + y] > 0) {
          parent[y] = x
          queue.push(y)
        }
      }
    }
    if (parent[sink] === -1) break
    let bottleneck = Infinity
    for (let y = sink; y !== 0; y = parent[y]) bottleneck = Math.min(bottleneck, cap[parent[y] * N + y])
    for (let y = sink; y !== 0; y = parent[y]) {
      cap[parent[y] * N + y] -= bottleneck
      cap[y * N + parent[y]] += bottleneck
    }
    flow += bottleneck
    if (flow >= required) return true
  }
  return flow >= required
}

// ─── Core Monte Carlo Kernel ─────────────────────────────────────────────────

interface PrecomputedGame {
  awayIdx: number
  homeIdx: number
  /** Point-estimate win probabilities (display only; simulation draws per-iteration probabilities) */
  homeWinProb: number
  awayWinProb: number
  bigGameIdx: number // -1 if not tracked in Big Games window
}

interface CoreSimResult {
  playoffPct: number[]
  directByePct: number[]
  playInPct: number[]
  seedPcts: number[][]
  avgSeed: number[]
  bestSeed: number[]
  worstSeed: number[]
  strengths: number[]
  rawPythPcts: number[]
  bigGames: BigGameImpact[]
  whatIfRows: WhatIfRecordRow[][]
  whatIfRowsNoOt: WhatIfRecordRow[][]
}

/** Conditional home-win share slopes inside overtime and shootouts (OT favors the stronger team more than SO). */
const OT_HOME_SLOPE = 0.7
const SO_HOME_SLOPE = 0.3
/** Upper bound on the per-game extra-time probability after normalization. */
const MAX_EXTRA_TIME_PROB = 0.6
/**
 * Convert the Log5 strength-scale probability into a regulation propensity so the simulated
 * expected 3-2-1 points share matches Log5 exactly (removes the ~9% "double compression" that
 * occurs when OT/SO 2-1 splits are layered on top of a points-%-calibrated strength).
 */
const DECOMPRESS_POINTS = true
/** Big Games: minimum samples per outcome before a cell is considered stable (else flagged `*`). */
const BIG_GAME_LOW_SAMPLE = 500
/** Big Games: a scoreboard-watching team is shown only if its swing clears both floors. */
const WATCH_MIN_PLAYOFF_SWING = 0.5
const WATCH_MIN_SEED_SWING = 0.15
const WATCH_MIN_Z = 2.5

function extraTimeCloseness(pHome: number): number {
  return 0.5 + 0.5 * (4 * pHome * (1 - pHome))
}

/**
 * Writes cumulative 6-outcome probabilities [homeReg, homeOt, homeSo, awaySo, awayOt] into `out`
 * (the remaining mass is the away regulation win) and returns the home win probability.
 */
function fillOutcomeCdf(
  pHome: number,
  calibration: CalibrationProfile,
  extraNorm: number,
  out: Float64Array,
  off: number
): number {
  const scale = extraTimeCloseness(pHome) * extraNorm
  let pOt = calibration.otRate * scale
  let pSo = calibration.soRate * scale
  const extra = pOt + pSo
  if (extra > MAX_EXTRA_TIME_PROB) {
    pOt *= MAX_EXTRA_TIME_PROB / extra
    pSo *= MAX_EXTRA_TIME_PROB / extra
  }
  const pReg = 1 - pOt - pSo
  let q = pHome
  if (DECOMPRESS_POINTS) {
    const k = (3 * pReg + OT_HOME_SLOPE * pOt + SO_HOME_SLOPE * pSo) / 3
    if (k > 0) q = Math.max(0.02, Math.min(0.98, 0.5 + (pHome - 0.5) / k))
  }
  const d = q - 0.5
  const pHomeReg = pReg * q
  const pHomeOt = pOt * (0.5 + OT_HOME_SLOPE * d)
  const pHomeSo = pSo * (0.5 + SO_HOME_SLOPE * d)
  const pAwaySo = pSo - pHomeSo
  const pAwayOt = pOt - pHomeOt
  out[off] = pHomeReg
  out[off + 1] = out[off] + pHomeOt
  out[off + 2] = out[off + 1] + pHomeSo
  out[off + 3] = out[off + 2] + pAwaySo
  out[off + 4] = out[off + 3] + pAwayOt
  return pHomeReg + pHomeOt + pHomeSo
}

/**
 * Normalizes the matchup-closeness extra-time scaling so the league-average OT+SO rate across
 * the season's matchups equals the calibrated target (closeness alone can only lower the rate).
 */
function computeExtraTimeNorm(
  pairs: ReadonlyArray<readonly [number, number]>,
  strengths: number[]
): number {
  if (pairs.length === 0) return 1
  let sum = 0
  for (const [a, h] of pairs) sum += extraTimeCloseness(log5(strengths[h], strengths[a]))
  const mean = sum / pairs.length
  return mean > 0 ? 1 / mean : 1
}

function sampleRegMargin(u: number, cdf: readonly number[]): number {
  for (let i = 0; i < cdf.length; i++) {
    if (u <= cdf[i]) return i + 1
  }
  return 1
}

// ─── Bayesian strength sampling (Marsaglia–Tsang Gamma → Beta) ────────────────

function sampleStdNormal(rand: () => number): number {
  const u1 = rand() || 1e-12
  const u2 = rand()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function sampleGamma(shape: number, rand: () => number): number {
  if (shape < 1) {
    const u = rand() || 1e-12
    return sampleGamma(shape + 1, rand) * Math.pow(u, 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      x = sampleStdNormal(rand)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rand() || 1e-12
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

function sampleBeta(alpha: number, beta: number, rand: () => number): number {
  const x = sampleGamma(alpha, rand)
  const y = sampleGamma(beta, rand)
  const sum = x + y
  return sum > 0 ? x / sum : 0.5
}

function runCoreSimulation(opts: {
  state: ParsedSeasonState
  strengthState?: ParsedSeasonState
  format: PlayoffFormat
  mode: PlayoffOddsMode
  calibration: CalibrationProfile
  iterations: number
  seed: number
  trackBigGames: boolean
  trackWhatIf: boolean
  includeTailProbes: boolean
}): CoreSimResult {
  const {
    state,
    strengthState = state,
    format,
    mode,
    calibration,
    iterations: rawIterations,
    seed,
    trackBigGames,
    trackWhatIf,
    includeTailProbes,
  } = opts
  const iterations = Math.max(1, Math.floor(rawIterations))

  const T = state.teams.length
  const spots = format.playoffSpots
  const byeSpots = format.directByeSpots
  const marginCdf = calibration.regMarginCdf
  const loserGoals = calibration.regLoserGoals
  const otLoserGoals = calibration.otLoserGoals
  const otShare =
    calibration.otRate + calibration.soRate > 0
      ? calibration.otRate / (calibration.otRate + calibration.soRate)
      : 1

  // 1. Point-estimate strengths from actual completed games (strengthState) so What-If lockedOutcomes
  // do not cause strength drift across other remaining games
  const strengths = new Array<number>(T).fill(0.5)
  const rawPythPcts = new Array<number>(T).fill(0.5)
  const kappa = new Float64Array(T)
  for (let i = 0; i < T; i++) {
    const t = strengthState.teams[i] ?? state.teams[i]
    const weighted = computeWeightedStrength(t.gfPlayed, t.gaPlayed, t.gpPlayed, calibration)
    rawPythPcts[i] = weighted.rawPythPct
    if (mode === "50_50") {
      strengths[i] = 0.5
    } else if (mode === "classic") {
      strengths[i] = computeKenClassicStrength(t.pts, t.gp, t.gamesRemaining)
    } else {
      strengths[i] = weighted.strength
    }
    // Posterior concentration ~ effective sample size (games observed + prior games)
    const priorGames = calibration.ebShrinkageGames + (calibration.goalPriorGames ?? 0)
    kappa[i] = calibration.strengthConcentration * (t.gpPlayed + priorGames)
  }
  const sampleStrengths = mode === "weighted" && calibration.strengthConcentration > 0
  const lockedSim = state.lockedSimGames

  // Fast path: 0 remaining games and nothing left to simulate (completed or ended early)
  if (state.remainingGames.length === 0 && lockedSim.length === 0) {
    const { blockStartByIdx, blockEndByIdx } = resolveFinalBlocksWithDrawLots(state)
    const playoffPct = new Array<number>(T).fill(0)
    const directByePct = new Array<number>(T).fill(0)
    const playInPct = new Array<number>(T).fill(0)
    const seedPcts = Array.from({ length: T }, () => new Array<number>(T).fill(0))
    const avgSeed = new Array<number>(T).fill(1)
    const bestSeed = new Array<number>(T).fill(1)
    const worstSeed = new Array<number>(T).fill(1)
    const whatIfRows: WhatIfRecordRow[][] = Array.from({ length: T }, () => [])
    const whatIfRowsNoOt: WhatIfRecordRow[][] = Array.from({ length: T }, () => [])

    for (let idx = 0; idx < T; idx++) {
      const bStart = blockStartByIdx[idx]
      const bEnd = blockEndByIdx[idx]
      const blockSize = bEnd - bStart + 1
      let poSlots = 0
      let byeSlots = 0
      let playInSlots = 0
      const perSlotPct = round3(100 / blockSize)

      for (let pos = bStart; pos <= bEnd; pos++) {
        const seedNum = pos + 1
        seedPcts[idx][pos] = blockSize === 1 ? 100 : perSlotPct
        if (seedNum <= spots) poSlots++
        if (byeSpots > 0 && seedNum <= byeSpots) byeSlots++
        if (format.hasPlayIn && seedNum > byeSpots && seedNum <= spots) playInSlots++
      }

      bestSeed[idx] = bStart + 1
      worstSeed[idx] = bEnd + 1
      avgSeed[idx] = round2((bStart + 1 + (bEnd + 1)) / 2)
      playoffPct[idx] = round1((poSlots / blockSize) * 100)
      directByePct[idx] = round1((byeSlots / blockSize) * 100)
      playInPct[idx] = round1((playInSlots / blockSize) * 100)
    }

    return {
      playoffPct,
      directByePct,
      playInPct,
      seedPcts,
      avgSeed,
      bestSeed,
      worstSeed,
      strengths,
      rawPythPcts,
      bigGames: [],
      whatIfRows,
      whatIfRowsNoOt,
    }
  }

  // 2. Select Big Games window: next 2 distinct upcoming matchdays (capped at 12 games)
  const trackedGames: PlayoffSimGame[] = []
  const trackedGameIdToBigIdx = new Map<string, number>()
  let nextMatchdayDate: string | null = null
  if (trackBigGames && state.remainingGames.length > 0) {
    const upcomingDates = [...new Set(state.remainingGames.map((g) => g.date))].sort()
    nextMatchdayDate = upcomingDates[0] ?? null
    const windowDates = new Set(upcomingDates.slice(0, 2))
    for (const g of state.remainingGames) {
      if (windowDates.has(g.date) && trackedGames.length < 12) {
        trackedGameIdToBigIdx.set(g.id, trackedGames.length)
        trackedGames.push(g)
      }
    }
  }

  // League-average OT/SO normalization over the season's matchups (completed + remaining).
  // When Beta strength sampling is active, Jensen's inequality on concave extraTimeCloseness(p)
  // pulls realized OT+SO rates ~1–2 pp below target if normalized at point estimates; a fast
  // 100-draw pre-loop expectation restores exact target OT+SO rates with zero hot-loop overhead.
  const seasonPairs: Array<readonly [number, number]> = []
  for (const g of [...state.completedGames, ...state.remainingGames]) {
    const a = state.slugToIdx.get(g.awaySlug)
    const h = state.slugToIdx.get(g.homeSlug)
    if (a !== undefined && h !== undefined) seasonPairs.push([a, h])
  }
  let extraNorm: number
  if (sampleStrengths && seasonPairs.length > 0) {
    const normRng = createPrng((seed ^ 0x517cc1b7) >>> 0)
    const normTheta = new Float64Array(T)
    const NORM_DRAWS = 100
    let closenessSum = 0
    for (let d = 0; d < NORM_DRAWS; d++) {
      for (let i = 0; i < T; i++) {
        const s = strengths[i]
        const k = Math.max(2, kappa[i])
        normTheta[i] = clampStrength(sampleBeta(k * s, k * (1 - s), normRng))
      }
      for (let p = 0; p < seasonPairs.length; p++) {
        const [a, h] = seasonPairs[p]
        closenessSum += extraTimeCloseness(log5(normTheta[h], normTheta[a]))
      }
    }
    const meanCloseness = closenessSum / (NORM_DRAWS * seasonPairs.length)
    extraNorm = meanCloseness > 0 ? 1 / meanCloseness : 1
  } else {
    extraNorm = computeExtraTimeNorm(seasonPairs, strengths)
  }

  const G = state.remainingGames.length
  const displayCdf = new Float64Array(5)
  const preGames: PrecomputedGame[] = state.remainingGames.map((g) => {
    const awayIdx = state.slugToIdx.get(g.awaySlug)!
    const homeIdx = state.slugToIdx.get(g.homeSlug)!
    const homeWinProb = fillOutcomeCdf(
      log5(strengths[homeIdx], strengths[awayIdx]),
      calibration,
      extraNorm,
      displayCdf,
      0
    )
    return {
      awayIdx,
      homeIdx,
      homeWinProb,
      awayWinProb: 1 - homeWinProb,
      bigGameIdx: trackedGameIdToBigIdx.get(g.id) ?? -1,
    }
  })
  const K = trackedGames.length

  // Per-iteration outcome CDFs (fixed when strengths are not sampled, e.g. 50/50 mode)
  const gameCdf = new Float64Array(G * 5)
  const theta = new Float64Array(T)
  const fillAllGameCdfs = (teamStrength: ArrayLike<number>) => {
    for (let g = 0; g < G; g++) {
      const game = preGames[g]
      fillOutcomeCdf(
        log5(teamStrength[game.homeIdx], teamStrength[game.awayIdx]),
        calibration,
        extraNorm,
        gameCdf,
        g * 5
      )
    }
  }
  if (!sampleStrengths) fillAllGameCdfs(strengths)

  const drawIterationStrengths = (rng: () => number) => {
    if (!sampleStrengths) return
    for (let i = 0; i < T; i++) {
      const s = strengths[i]
      const k = Math.max(2, kappa[i])
      theta[i] = clampStrength(sampleBeta(k * s, k * (1 - s), rng))
    }
    fillAllGameCdfs(theta)
  }

  // 3. Allocate flat accumulators (zero allocations inside hot loop!)
  const playoffHits = new Int32Array(T)
  const directByeHits = new Int32Array(T)
  const playInHits = new Int32Array(T)
  const seedCounts = new Int32Array(T * T)
  const seedSums = new Float64Array(T)
  const bestSeedArr = new Int16Array(T).fill(T)
  const worstSeedArr = new Int16Array(T).fill(1)

  // Single-pass Big Games conditional accumulators (4 outcomes: 0=away_reg, 1=away_ot, 2=home_ot, 3=home_reg)
  const bgOutcomeCounts = new Int32Array(K * 4)
  const bgPlayoffHits = new Int32Array(K * 4 * T)
  const bgSeedSums = new Float64Array(K * 4 * T)
  const bgSeedSqSums = new Float64Array(K * 4 * T)
  const iterBgOutcome = new Int8Array(K)

  // What-If finish-scenario accumulators (bucketed by actual regulation wins)
  const maxRem = Math.max(0, ...state.teams.map((t) => t.gamesRemaining))
  const maxRegWinSlots = maxRem + 1
  const wiCount = trackWhatIf ? new Int32Array(T * maxRegWinSlots) : null
  const wiPlayoff = trackWhatIf ? new Int32Array(T * maxRegWinSlots) : null
  const wiSeedSum = trackWhatIf ? new Float64Array(T * maxRegWinSlots) : null
  const wiBest = trackWhatIf ? new Int16Array(T * maxRegWinSlots).fill(T) : null
  const wiWorst = trackWhatIf ? new Int16Array(T * maxRegWinSlots).fill(1) : null
  const wiMinPts = trackWhatIf ? new Int16Array(T * maxRegWinSlots).fill(9999) : null
  const wiMaxPts = trackWhatIf ? new Int16Array(T * maxRegWinSlots).fill(-9999) : null
  const wiNoOtCount = trackWhatIf ? new Int32Array(T * maxRegWinSlots) : null
  const wiNoOtPlayoff = trackWhatIf ? new Int32Array(T * maxRegWinSlots) : null
  const wiNoOtSeedSum = trackWhatIf ? new Float64Array(T * maxRegWinSlots) : null
  const wiNoOtBest = trackWhatIf ? new Int16Array(T * maxRegWinSlots).fill(T) : null
  const wiNoOtWorst = trackWhatIf ? new Int16Array(T * maxRegWinSlots).fill(1) : null
  const wiNoOtMinPts = trackWhatIf ? new Int16Array(T * maxRegWinSlots).fill(9999) : null
  const wiNoOtMaxPts = trackWhatIf ? new Int16Array(T * maxRegWinSlots).fill(-9999) : null

  // Per-iteration reusable scratch buffers
  const pts = new Int16Array(T)
  const row = new Int16Array(T)
  const regWins = new Int16Array(T)
  const otGames = new Int16Array(T)
  const gd = new Int16Array(T)
  const gf = new Int16Array(T)
  const h2hPts = new Int16Array(T * T)
  const h2hGames = new Int16Array(T * T)
  const tiebreakRand = new Float64Array(T)
  const order = new Int16Array(T)
  const seedOf = new Int16Array(T)
  const h2hPctScratch = new Float64Array(T)

  const resetIteration = () => {
    pts.set(state.basePts)
    row.set(state.baseRow)
    regWins.fill(0)
    otGames.fill(0)
    gd.set(state.baseGd)
    gf.set(state.baseGf)
    h2hPts.set(state.baseH2hPts)
    h2hGames.set(state.baseH2hGames)
  }

  /** Regulation win for `w` over `l` with a simulated margin. */
  const applyRegWin = (w: number, l: number, rng: () => number) => {
    const margin = sampleRegMargin(rng(), marginCdf)
    pts[w] += 3
    row[w] += 1
    regWins[w] += 1
    gd[w] += margin
    gd[l] -= margin
    gf[w] += loserGoals + margin
    gf[l] += loserGoals
    h2hPts[w * T + l] += 3
  }
  /** OT (countsRow) or SO win for `w` over `l` (2-1 points, one-goal decision). */
  const applyExtraWin = (w: number, l: number, countsRow: boolean) => {
    pts[w] += 2
    pts[l] += 1
    otGames[w] += 1
    otGames[l] += 1
    if (countsRow) row[w] += 1
    gd[w] += 1
    gd[l] -= 1
    gf[w] += otLoserGoals + 1
    gf[l] += otLoserGoals
    h2hPts[w * T + l] += 2
    h2hPts[l * T + w] += 1
  }
  /** What-If locked results: points/H2H are fixed in base state; margin and OT-vs-SO (ROW) are simulated. */
  const applyLockedSimGames = (rng: () => number) => {
    for (let i = 0; i < lockedSim.length; i++) {
      const lk = lockedSim[i]
      if (lk.kind === "reg") {
        const margin = sampleRegMargin(rng(), marginCdf)
        gd[lk.winner] += margin
        gd[lk.loser] -= margin
        gf[lk.winner] += loserGoals + margin
        gf[lk.loser] += loserGoals
      } else {
        if (rng() < otShare) row[lk.winner] += 1
        gd[lk.winner] += 1
        gd[lk.loser] -= 1
        gf[lk.winner] += otLoserGoals + 1
        gf[lk.loser] += otLoserGoals
      }
    }
  }
  /** Simulates game `g` from its CDF; returns the Big Games bucket (0=away_reg,1=away_ot,2=home_ot,3=home_reg). */
  const simulateGame = (g: number, rng: () => number): number => {
    const game = preGames[g]
    const a = game.awayIdx
    const h = game.homeIdx
    const off = g * 5
    const u = rng()
    let bucket: number
    if (u < gameCdf[off]) {
      applyRegWin(h, a, rng)
      bucket = 3
    } else if (u < gameCdf[off + 1]) {
      applyExtraWin(h, a, true)
      bucket = 2
    } else if (u < gameCdf[off + 2]) {
      applyExtraWin(h, a, false)
      bucket = 2
    } else if (u < gameCdf[off + 3]) {
      applyExtraWin(a, h, false)
      bucket = 1
    } else if (u < gameCdf[off + 4]) {
      applyExtraWin(a, h, true)
      bucket = 1
    } else {
      applyRegWin(a, h, rng)
      bucket = 0
    }
    h2hGames[a * T + h] += 1
    h2hGames[h * T + a] += 1
    return bucket
  }

  const rand = createPrng(seed)

  // 4. Main Monte Carlo Loop
  for (let iter = 0; iter < iterations; iter++) {
    resetIteration()
    drawIterationStrengths(rand)
    applyLockedSimGames(rand)

    for (let g = 0; g < G; g++) {
      const bucket = simulateGame(g, rand)
      const bgIdx = preGames[g].bigGameIdx
      if (bgIdx >= 0) iterBgOutcome[bgIdx] = bucket
    }

    for (let i = 0; i < T; i++) tiebreakRand[i] = rand()

    rankTeamsRule213(T, pts, row, gd, gf, h2hPts, h2hGames, tiebreakRand, order, h2hPctScratch)

    for (let pos = 0; pos < T; pos++) {
      const idx = order[pos]
      const seedNum = pos + 1
      seedOf[idx] = seedNum
      seedCounts[idx * T + pos]++
      seedSums[idx] += seedNum
      if (seedNum < bestSeedArr[idx]) bestSeedArr[idx] = seedNum
      if (seedNum > worstSeedArr[idx]) worstSeedArr[idx] = seedNum

      const inPlayoffs = seedNum <= spots
      if (inPlayoffs) playoffHits[idx]++
      if (byeSpots > 0 && seedNum <= byeSpots) directByeHits[idx]++
      if (format.hasPlayIn && seedNum > byeSpots && seedNum <= spots) playInHits[idx]++

      if (trackWhatIf && wiCount && wiPlayoff && wiSeedSum && wiBest && wiWorst && wiMinPts && wiMaxPts) {
        const w = regWins[idx]
        const slot = idx * maxRegWinSlots + w
        wiCount[slot]++
        if (inPlayoffs) wiPlayoff[slot]++
        wiSeedSum[slot] += seedNum
        if (seedNum < wiBest[slot]) wiBest[slot] = seedNum
        if (seedNum > wiWorst[slot]) wiWorst[slot] = seedNum
        if (pts[idx] < wiMinPts[slot]) wiMinPts[slot] = pts[idx]
        if (pts[idx] > wiMaxPts[slot]) wiMaxPts[slot] = pts[idx]
        if (
          otGames[idx] === 0 &&
          wiNoOtCount &&
          wiNoOtPlayoff &&
          wiNoOtSeedSum &&
          wiNoOtBest &&
          wiNoOtWorst &&
          wiNoOtMinPts &&
          wiNoOtMaxPts
        ) {
          wiNoOtCount[slot]++
          if (inPlayoffs) wiNoOtPlayoff[slot]++
          wiNoOtSeedSum[slot] += seedNum
          if (seedNum < wiNoOtBest[slot]) wiNoOtBest[slot] = seedNum
          if (seedNum > wiNoOtWorst[slot]) wiNoOtWorst[slot] = seedNum
          if (pts[idx] < wiNoOtMinPts[slot]) wiNoOtMinPts[slot] = pts[idx]
          if (pts[idx] > wiNoOtMaxPts[slot]) wiNoOtMaxPts[slot] = pts[idx]
        }
      }
    }

    // Single-pass conditional Big Games tallying (Ken Roberts Nov 2009 #10964). Because team strengths
    // are drawn per iteration, conditioning on an outcome also performs the Bayesian strength update.
    for (let k = 0; k < K; k++) {
      const bucket = iterBgOutcome[k]
      const outIdx = k * 4 + bucket
      bgOutcomeCounts[outIdx]++
      const baseOff = outIdx * T
      for (let t = 0; t < T; t++) {
        const sNum = seedOf[t]
        if (sNum <= spots) bgPlayoffHits[baseOff + t]++
        bgSeedSums[baseOff + t] += sNum
        bgSeedSqSums[baseOff + t] += sNum * sNum
      }
    }
  }

  // 5. Summarize main probabilities
  const playoffPct = new Array<number>(T)
  const directByePct = new Array<number>(T)
  const playInPct = new Array<number>(T)
  const seedPcts = Array.from({ length: T }, () => new Array<number>(T))
  const avgSeed = new Array<number>(T)
  const bestSeed = new Array<number>(T)
  const worstSeed = new Array<number>(T)

  for (let i = 0; i < T; i++) {
    playoffPct[i] = round1((playoffHits[i] / iterations) * 100)
    directByePct[i] = round1((directByeHits[i] / iterations) * 100)
    playInPct[i] = round1((playInHits[i] / iterations) * 100)
    for (let s = 0; s < T; s++) {
      seedPcts[i][s] = round3((seedCounts[i * T + s] / iterations) * 100)
    }
    avgSeed[i] = round2(seedSums[i] / iterations)
    bestSeed[i] = bestSeedArr[i]
    worstSeed[i] = worstSeedArr[i]
  }

  // 6. Isolated Tail-Probing Pass for What-If extreme rows (sidereal #10674 fix: NEVER alters main odds!)
  const tailWinOut = new Map<number, { playoffPct: number; avgSeed: number; bestSeed: number; worstSeed: number; count: number }>()
  const tailLoseOut = new Map<number, { playoffPct: number; avgSeed: number; bestSeed: number; worstSeed: number; count: number }>()

  if (trackWhatIf && includeTailProbes) {
    const tailRand = createPrng(seed ^ 0x5bd1e995)
    for (let target = 0; target < T; target++) {
      const rem = state.teams[target].gamesRemaining
      if (rem <= 0) continue

      const step = whatIfStepForRem(rem)
      const topLo = Math.max(0, rem - step + 1)
      let botHi = rem
      while (botHi - step >= 0) botHi -= step

      for (const forceWin of [true, false]) {
        // Only run tail probe if the enclosing bucket in buildWhatIfRowsForTeam lacks enough samples
        if (wiCount) {
          const baseSlot = target * maxRegWinSlots
          const rangeLo = forceWin ? topLo : 0
          const rangeHi = forceWin ? rem : botHi
          let bucketCount = 0
          let noOtBucketCount = 0
          for (let w = rangeLo; w <= rangeHi; w++) {
            bucketCount += wiCount[baseSlot + w]
            if (wiNoOtCount) noOtBucketCount += wiNoOtCount[baseSlot + w]
          }
          if (
            bucketCount >= WHAT_IF_MIN_ROW_SAMPLES &&
            (!wiNoOtCount || noOtBucketCount >= WHAT_IF_MIN_ROW_SAMPLES)
          ) {
            continue
          }
        }
        let poHits = 0
        let sSum = 0
        let bSeed = T
        let wSeed = 1

        for (let iter = 0; iter < TAIL_PROBE_ITERATIONS; iter++) {
          resetIteration()
          drawIterationStrengths(tailRand)
          applyLockedSimGames(tailRand)

          for (let g = 0; g < G; g++) {
            const game = preGames[g]
            const a = game.awayIdx
            const h = game.homeIdx
            if (a === target || h === target) {
              const winner = forceWin ? target : a === target ? h : a
              const loser = winner === a ? h : a
              applyRegWin(winner, loser, tailRand)
              h2hGames[a * T + h] += 1
              h2hGames[h * T + a] += 1
            } else {
              simulateGame(g, tailRand)
            }
          }

          for (let i = 0; i < T; i++) tiebreakRand[i] = tailRand()
          rankTeamsRule213(T, pts, row, gd, gf, h2hPts, h2hGames, tiebreakRand, order, h2hPctScratch)
          let targetSeed = T
          for (let pos = 0; pos < T; pos++) {
            if (order[pos] === target) {
              targetSeed = pos + 1
              break
            }
          }
          if (targetSeed <= spots) poHits++
          sSum += targetSeed
          if (targetSeed < bSeed) bSeed = targetSeed
          if (targetSeed > wSeed) wSeed = targetSeed
        }

        const summary = {
          playoffPct: round1((poHits / TAIL_PROBE_ITERATIONS) * 100),
          avgSeed: round2(sSum / TAIL_PROBE_ITERATIONS),
          bestSeed: bSeed,
          worstSeed: wSeed,
          count: TAIL_PROBE_ITERATIONS,
        }
        if (forceWin) tailWinOut.set(target, summary)
        else tailLoseOut.set(target, summary)
      }
    }
  }

  // 7. Build What-If Finish Tables per team
  const whatIfRows: WhatIfRecordRow[][] = Array.from({ length: T }, () => [])
  const whatIfRowsNoOt: WhatIfRecordRow[][] = Array.from({ length: T }, () => [])
  if (trackWhatIf && wiCount && wiPlayoff && wiSeedSum && wiBest && wiWorst && wiMinPts && wiMaxPts) {
    for (let i = 0; i < T; i++) {
      whatIfRows[i] = buildWhatIfRowsForTeam(
        i,
        state.teams[i],
        maxRegWinSlots,
        wiCount,
        wiPlayoff,
        wiSeedSum,
        wiBest,
        wiWorst,
        wiMinPts,
        wiMaxPts,
        tailWinOut.get(i) ?? null,
        tailLoseOut.get(i) ?? null
      )
      if (
        wiNoOtCount &&
        wiNoOtPlayoff &&
        wiNoOtSeedSum &&
        wiNoOtBest &&
        wiNoOtWorst &&
        wiNoOtMinPts &&
        wiNoOtMaxPts
      ) {
        whatIfRowsNoOt[i] = buildWhatIfRowsForTeam(
          i,
          state.teams[i],
          maxRegWinSlots,
          wiNoOtCount,
          wiNoOtPlayoff,
          wiNoOtSeedSum,
          wiNoOtBest,
          wiNoOtWorst,
          wiNoOtMinPts,
          wiNoOtMaxPts,
          tailWinOut.get(i) ?? null,
          tailLoseOut.get(i) ?? null
        )
      }
    }
  }

  // 8. Build Big Games conditional report.
  // Swings are anchored on the two regulation outcomes (the high-sample buckets, ~85–90% of
  // simulations) so rare OT/SO cells (~4–6% each) cannot manufacture noise-driven swings.
  const bigGames: BigGameImpact[] = []
  if (trackBigGames && K > 0) {
    for (let k = 0; k < K; k++) {
      const rawGame = trackedGames[k]
      const preGame = preGames.find((pg) => pg.bigGameIdx === k)!
      const aIdx = preGame.awayIdx
      const hIdx = preGame.homeIdx

      const outcomeSampleCounts: Record<BigGameOutcomeKey, number> = {
        away_reg: bgOutcomeCounts[k * 4 + 0],
        away_ot: bgOutcomeCounts[k * 4 + 1],
        home_ot: bgOutcomeCounts[k * 4 + 2],
        home_reg: bgOutcomeCounts[k * 4 + 3],
      }

      let totalPlayoffSwing = 0
      let totalSeedSwing = 0
      const affectedTeams: BigGameAffectedTeam[] = []

      for (let t = 0; t < T; t++) {
        const isParticipant = t === aIdx || t === hIdx
        const curPo = playoffPct[t]
        const curSeed = avgSeed[t]

        // Raw (unrounded) conditional estimates + Monte Carlo standard errors per bucket
        const rawPo = new Float64Array(4)
        const sePo = new Float64Array(4)
        const rawSeed = new Float64Array(4)
        const seSeed = new Float64Array(4)
        const outcomes = {} as Record<BigGameOutcomeKey, BigGameOutcomeCell>
        for (let b = 0; b < 4; b++) {
          const key = OUTCOME_KEYS[b]
          const cnt = bgOutcomeCounts[k * 4 + b]
          const baseOff = (k * 4 + b) * T
          const p = cnt > 0 ? bgPlayoffHits[baseOff + t] / cnt : curPo / 100
          const meanSeed = cnt > 0 ? bgSeedSums[baseOff + t] / cnt : curSeed
          const varSeed =
            cnt > 1 ? Math.max(0, bgSeedSqSums[baseOff + t] / cnt - meanSeed * meanSeed) : 0
          rawPo[b] = p * 100
          sePo[b] = cnt > 0 ? Math.sqrt((p * (1 - p)) / cnt) * 100 : Infinity
          rawSeed[b] = meanSeed
          seSeed[b] = cnt > 1 ? Math.sqrt(varSeed / cnt) : Infinity
          const condPo = round1(rawPo[b])
          const condSeed = round2(meanSeed)
          outcomes[key] = {
            playoffPct: condPo,
            playoffDelta: round1(condPo - curPo),
            avgSeed: condSeed,
            seedDelta: round2(condSeed - curSeed),
            lowSample: cnt < BIG_GAME_LOW_SAMPLE,
          }
        }

        // Regulation-anchored swings (away_reg = 0, home_reg = 3) with z-scores
        const poSwingRaw = Math.abs(rawPo[0] - rawPo[3])
        const poSe = Math.sqrt(sePo[0] * sePo[0] + sePo[3] * sePo[3])
        const poZ = !Number.isFinite(poSe)
          ? 0
          : poSe > 0
            ? poSwingRaw / poSe
            : poSwingRaw > 0
              ? Infinity
              : 0
        const sdSwingRaw = Math.abs(rawSeed[0] - rawSeed[3])
        const sdSe = Math.sqrt(seSeed[0] * seSeed[0] + seSeed[3] * seSeed[3])
        const sdZ = !Number.isFinite(sdSe)
          ? 0
          : sdSe > 0
            ? sdSwingRaw / sdSe
            : sdSwingRaw > 0
              ? Infinity
              : 0
        const poSwing = round1(poSwingRaw)
        const sdSwing = round2(sdSwingRaw)

        const significantPo = poSwingRaw >= WATCH_MIN_PLAYOFF_SWING && poZ >= WATCH_MIN_Z
        const significantSeed = sdSwingRaw >= WATCH_MIN_SEED_SWING && sdZ >= WATCH_MIN_Z

        // Best outcome: the better regulation result, unless an OT/SO cell beats it by > 2 SE
        const optimizeSeed = format.allTeamsQualify || !significantPo
        const better = (x: number, y: number) =>
          optimizeSeed ? rawSeed[x] < rawSeed[y] - 1e-9 : rawPo[x] > rawPo[y] + 1e-9
        let bestB = better(3, 0) ? 3 : 0
        for (const otB of [1, 2]) {
          if (bgOutcomeCounts[k * 4 + otB] <= 0) continue
          const margin = optimizeSeed
            ? rawSeed[bestB] - rawSeed[otB] - 2 * Math.sqrt(seSeed[otB] ** 2 + seSeed[bestB] ** 2)
            : rawPo[otB] - rawPo[bestB] - 2 * Math.sqrt(sePo[otB] ** 2 + sePo[bestB] ** 2)
          if (margin > 0) bestB = otB
        }
        const bestKey = OUTCOME_KEYS[bestB]

        // Participants always shown; scoreboard-watching teams only when the swing is real (not MC noise)
        const include =
          isParticipant || (format.allTeamsQualify ? significantSeed : significantPo || significantSeed)
        if (include) {
          totalPlayoffSwing += poSwing
          totalSeedSwing += sdSwing
          affectedTeams.push({
            slug: state.teams[t].slug,
            name: state.teams[t].name,
            isParticipant,
            currentPlayoffPct: curPo,
            currentAvgSeed: curSeed,
            playoffSwing: poSwing,
            seedSwing: sdSwing,
            bestOutcome: bestKey,
            optimizeSeed,
            outcomes,
          })
        }
      }

      // Sort affected teams: participants first (away, home), then scoreboard-watching teams by impact
      affectedTeams.sort((x, y) => {
        if (x.isParticipant !== y.isParticipant) return x.isParticipant ? -1 : 1
        if (x.isParticipant && y.isParticipant) {
          return x.slug === rawGame.awaySlug ? -1 : 1
        }
        return y.playoffSwing - x.playoffSwing || y.seedSwing - x.seedSwing
      })

      bigGames.push({
        gameId: rawGame.id,
        date: rawGame.date,
        time: rawGame.time,
        location: rawGame.location,
        isNextMatchday: rawGame.date === nextMatchdayDate,
        awaySlug: rawGame.awaySlug,
        awayName: rawGame.awayName,
        homeSlug: rawGame.homeSlug,
        homeName: rawGame.homeName,
        awayWinProb: round1(preGame.awayWinProb * 100),
        homeWinProb: round1(preGame.homeWinProb * 100),
        totalPlayoffSwing: round1(totalPlayoffSwing),
        totalSeedSwing: round2(totalSeedSwing),
        outcomeSampleCounts,
        affectedTeams,
      })
    }

    // Sort Big Games: by total playoff swing descending (or total seed swing in all-in / clinched races)
    bigGames.sort((a, b) => {
      if (!format.allTeamsQualify && Math.abs(b.totalPlayoffSwing - a.totalPlayoffSwing) > 0.05) {
        return b.totalPlayoffSwing - a.totalPlayoffSwing
      }
      if (Math.abs(b.totalSeedSwing - a.totalSeedSwing) > 0.01) {
        return b.totalSeedSwing - a.totalSeedSwing
      }
      return a.date.localeCompare(b.date) || a.gameId.localeCompare(b.gameId)
    })
  }

  return {
    playoffPct,
    directByePct,
    playInPct,
    seedPcts,
    avgSeed,
    bestSeed,
    worstSeed,
    strengths,
    rawPythPcts,
    bigGames,
    whatIfRows,
    whatIfRowsNoOt,
  }
}

function whatIfStepForRem(rem: number): number {
  return rem < 10 ? 1 : 2
}

function formatRegWinLabel(lo: number, hi: number): string {
  if (lo === 0 && hi === 0) return "0 reg wins"
  if (lo === hi) return `${hi} ${hi === 1 ? "win" : "wins"}`
  return `${lo}–${hi} wins`
}

function buildWhatIfRowsForTeam(
  teamIdx: number,
  team: TeamAccumulator,
  maxRegWinSlots: number,
  wiCount: Int32Array,
  wiPlayoff: Int32Array,
  wiSeedSum: Float64Array,
  wiBest: Int16Array,
  wiWorst: Int16Array,
  wiMinPts: Int16Array,
  wiMaxPts: Int16Array,
  tailWinOut: { playoffPct: number; avgSeed: number; bestSeed: number; worstSeed: number; count: number } | null,
  tailLoseOut: { playoffPct: number; avgSeed: number; bestSeed: number; worstSeed: number; count: number } | null
): WhatIfRecordRow[] {
  const rem = team.gamesRemaining
  if (rem === 0) return []

  const step = whatIfStepForRem(rem)
  const rows: WhatIfRecordRow[] = []

  // Build descending buckets from rem regulation wins down to 0
  for (let hi = rem; hi >= 0; hi -= step) {
    const lo = Math.max(0, hi - step + 1)
    let cnt = 0
    let po = 0
    let sSum = 0
    let best = 99
    let worst = 1
    let minFinal = 9999
    let maxFinal = -9999
    const baseSlot = teamIdx * maxRegWinSlots
    for (let w = lo; w <= hi; w++) {
      const slot = baseSlot + w
      const c = wiCount[slot]
      if (c > 0) {
        cnt += c
        po += wiPlayoff[slot]
        sSum += wiSeedSum[slot]
        if (wiBest[slot] < best) best = wiBest[slot]
        if (wiWorst[slot] > worst) worst = wiWorst[slot]
        if (wiMinPts[slot] < minFinal) minFinal = wiMinPts[slot]
        if (wiMaxPts[slot] > maxFinal) maxFinal = wiMaxPts[slot]
      }
    }

    if (cnt >= WHAT_IF_MIN_ROW_SAMPLES) {
      rows.push({
        label: formatRegWinLabel(lo, hi),
        minAddedPts: minFinal - team.pts,
        maxAddedPts: maxFinal - team.pts,
        minFinalPts: minFinal,
        maxFinalPts: maxFinal,
        playoffPct: round1((po / cnt) * 100),
        avgSeed: round2(sSum / cnt),
        bestSeed: best,
        worstSeed: worst,
        simCount: cnt,
        isTailProbe: false,
        lowSample: cnt < WHAT_IF_LOW_SAMPLE,
      })
    } else if (hi === rem && tailWinOut) {
      const maxAdd = 3 * rem
      rows.push({
        label: `Win out (${rem} ${rem === 1 ? "win" : "wins"})`,
        minAddedPts: maxAdd,
        maxAddedPts: maxAdd,
        minFinalPts: team.pts + maxAdd,
        maxFinalPts: team.pts + maxAdd,
        playoffPct: tailWinOut.playoffPct,
        avgSeed: tailWinOut.avgSeed,
        bestSeed: tailWinOut.bestSeed,
        worstSeed: tailWinOut.worstSeed,
        simCount: tailWinOut.count,
        isTailProbe: true,
      })
    } else if (lo === 0 && tailLoseOut) {
      rows.push({
        label: "Lose out",
        minAddedPts: 0,
        maxAddedPts: 0,
        minFinalPts: team.pts,
        maxFinalPts: team.pts,
        playoffPct: tailLoseOut.playoffPct,
        avgSeed: tailLoseOut.avgSeed,
        bestSeed: tailLoseOut.bestSeed,
        worstSeed: tailLoseOut.worstSeed,
        simCount: tailLoseOut.count,
        isTailProbe: true,
      })
    }
  }

  return rows
}

// ─── Timeline Generation (Deterministic Matchday Replay) ─────────────────────

function formatShortDate(isoDate: string): string {
  const parts = isoDate.split("-")
  if (parts.length !== 3) return isoDate
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const m = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  if (!m || !d || m < 1 || m > 12) return isoDate
  return `${months[m - 1]} ${d}`
}

function buildTimeline(opts: {
  allRegularGames: PlayoffSimGame[]
  seasonId: string
  format: PlayoffFormat
  mode: PlayoffOddsMode
  calibration: CalibrationProfile
  latestState: ParsedSeasonState
  latestSim: CoreSimResult
  endedEarly: boolean
  maxIterations: number
}): TimelinePoint[] {
  const {
    allRegularGames,
    seasonId,
    format,
    mode,
    calibration,
    latestState,
    latestSim,
    endedEarly,
    maxIterations,
  } = opts

  const completedDates = [
    ...new Set(
      allRegularGames
        .filter((g) => g.status === "final" && g.awayScore !== null && g.homeScore !== null)
        .map((g) => g.date)
    ),
  ].sort()

  const timeline: TimelinePoint[] = []

  // Helper to record one point
  const makeEntry = (
    date: string,
    label: string,
    st: ParsedSeasonState,
    sim: CoreSimResult
  ): TimelinePoint => {
    const teamsRecord: TimelinePoint["teams"] = {}
    for (let i = 0; i < st.teams.length; i++) {
      const t = st.teams[i]
      teamsRecord[t.slug] = {
        playoffPct: sim.playoffPct[i],
        avgSeed: sim.avgSeed[i],
        pts: t.pts,
        ptsAbove500: round1(t.pts - 1.5 * t.gp),
      }
    }
    return {
      date,
      label,
      gamesCompleted: st.completedGames.length,
      teams: teamsRecord,
    }
  }

  if (completedDates.length === 0) {
    timeline.push(makeEntry("Preseason", "Start", latestState, latestSim))
    return timeline
  }

  // Preseason point (analytic symmetric baseline: zero extra MC needed!)
  const preTeams: TimelinePoint["teams"] = {}
  const equalPo = round1((format.playoffSpots / Math.max(1, format.teamCount)) * 100)
  const equalAvgSeed = round2((format.teamCount + 1) / 2)
  for (const t of latestState.teams) {
    preTeams[t.slug] = {
      playoffPct: equalPo,
      avgSeed: equalAvgSeed,
      pts: 0,
      ptsAbove500: 0,
    }
  }
  timeline.push({
    date: "Preseason",
    label: "Start",
    gamesCompleted: 0,
    teams: preTeams,
  })

  // Intermediate completed matchdays (skip last date—we reuse latestSim directly!)
  for (let dIdx = 0; dIdx < completedDates.length - 1; dIdx++) {
    const cutoffDate = completedDates[dIdx]
    const replayGames: PlayoffSimGame[] = allRegularGames.map((g) =>
      g.status === "final" && g.date <= cutoffDate
        ? g
        : {
            ...g,
            status: "upcoming",
            awayScore: null,
            homeScore: null,
            isOvertime: false,
            hasShootout: false,
            isForfeit: false,
          }
    )
    const st = parseSeasonState(replayGames, false)
    const daySeed = fnv1aHash(`${seasonId}|${mode}|${cutoffDate}|${st.completedGames.length}`)
    // The point right before "now" drives the change badges, so run it at full precision
    // (independent 10k-run noise alone would be ±1 pp at 95%).
    const isPreviousMatchday = dIdx === completedDates.length - 2
    const sim = runCoreSimulation({
      state: st,
      format,
      mode,
      calibration,
      iterations: isPreviousMatchday
        ? Math.min(maxIterations, DEFAULT_ITERATIONS)
        : Math.min(maxIterations, TIMELINE_ITERATIONS),
      seed: daySeed,
      trackBigGames: false,
      trackWhatIf: false,
      includeTailProbes: false,
    })
    timeline.push(makeEntry(cutoffDate, formatShortDate(cutoffDate), st, sim))
  }

  // Final point = exact main snapshot (100k iterations!)
  const lastDate = completedDates[completedDates.length - 1]
  timeline.push(
    makeEntry(
      lastDate,
      endedEarly ? `${formatShortDate(lastDate)} (Final)` : formatShortDate(lastDate),
      latestState,
      latestSim
    )
  )

  return timeline
}

// ─── Public Orchestrator ─────────────────────────────────────────────────────

export interface ComputePlayoffOddsOptions {
  seasonId: string
  seasonName: string
  seasonType: SeasonKind
  seasonStatus: string
  configuredPlayoffTeams?: number | null
  actualPlayoffTeamCount?: number
  /** Optional pre-resolved format (e.g., from baseline snapshot in client What-If) to avoid re-resolving. */
  resolvedFormat?: PlayoffFormat
  games: PlayoffSimGame[]
  mode?: PlayoffOddsMode
  iterations?: number
  includeTimeline?: boolean
  includeTailProbes?: boolean
  lockedOutcomes?: Record<string, BigGameOutcomeKey>
}

export function computePlayoffOdds(options: ComputePlayoffOddsOptions): PlayoffOddsSnapshot {
  const startTime = typeof performance !== "undefined" ? performance.now() : Date.now()

  const {
    seasonId,
    seasonName,
    seasonType,
    seasonStatus,
    configuredPlayoffTeams = null,
    actualPlayoffTeamCount = 0,
    resolvedFormat,
    games,
    mode = "weighted",
    iterations = DEFAULT_ITERATIONS,
    includeTimeline = true,
    includeTailProbes = true,
    lockedOutcomes,
  } = options

  const calibration = BASH_CALIBRATION[seasonType]
  const safeIterations = Math.max(1, Math.floor(iterations))
  const effectiveGames = applyLockedOutcomes(games, lockedOutcomes)

  const rawFinalCount = effectiveGames.filter(
    (g) => g.status === "final" && g.awayScore !== null && g.homeScore !== null
  ).length
  const hasLockedOverrides = Boolean(lockedOutcomes && Object.keys(lockedOutcomes).length > 0)
  const endedEarly =
    !hasLockedOverrides &&
    seasonStatus === "completed" &&
    rawFinalCount < effectiveGames.length

  const state = parseSeasonState(effectiveGames, endedEarly)
  // Compute strengths strictly from real completed games so What-If lockedOutcomes don't drift other games' odds
  const strengthState = hasLockedOverrides ? parseSeasonState(games, false) : state
  const format =
    resolvedFormat ??
    resolvePlayoffFormat({
      seasonType,
      seasonStatus,
      configuredPlayoffTeams,
      teamCount: state.teams.length,
      actualPlayoffTeamCount,
    })

  // Canonical state hash guarantees bit-identical determinism across refreshes & serverless instances
  const sigParts = [
    seasonId,
    seasonType,
    mode,
    String(format.playoffSpots),
    String(safeIterations),
    ...effectiveGames
      .map(
        (g) =>
          `${g.id}:${g.date}:${g.awaySlug}@${g.homeSlug}:${g.status}:${g.awayScore ?? ""}-${g.homeScore ?? ""}:${g.isOvertime ? 1 : 0}${g.hasShootout ? 1 : 0}${g.isForfeit ? 1 : 0}${g.whatIfLock ? `:${g.whatIfLock}` : ""}`
      )
      .sort(),
  ]
  const stateHash = fnv1aHash(sigParts.join("|")).toString(16).padStart(8, "0")
  const seed = parseInt(stateHash, 16) >>> 0

  const sim = runCoreSimulation({
    state,
    strengthState,
    format,
    mode,
    calibration,
    iterations: safeIterations,
    seed,
    trackBigGames: true,
    trackWhatIf: true,
    includeTailProbes,
  })

  // Current standings rank by Rule 213 (deterministic alphabetical tiebreak for current-rank display)
  const T = state.teams.length
  const curRand = new Float64Array(T)
  for (let i = 0; i < T; i++) curRand[i] = (T - i) / (T + 1)
  const curOrder = rankTeamsRule213(
    T,
    state.basePts,
    state.baseRow,
    state.baseGd,
    state.baseGf,
    state.baseH2hPts,
    state.baseH2hGames,
    curRand
  )
  const currentRankByIdx = new Int16Array(T)
  for (let pos = 0; pos < T; pos++) {
    currentRankByIdx[curOrder[pos]] = pos + 1
  }

  // Exact mathematical clinch/elimination verification
  const { clinched, eliminated } = computeExactClinchElim(state, format)

  // Timeline & matchday-over-matchday delta
  const timeline = includeTimeline
    ? buildTimeline({
        allRegularGames: effectiveGames,
        seasonId,
        format,
        mode,
        calibration,
        latestState: state,
        latestSim: sim,
        endedEarly,
        maxIterations: safeIterations,
      })
    : []

  const prevTimelinePoint = timeline.length >= 2 ? timeline[timeline.length - 2] : null
  const maxGp = Math.max(0, ...state.teams.map((t) => t.gp))

  const teamRows: TeamOddsRow[] = state.teams.map((t, idx) => {
    // Keep actualPtsPct, luckDelta, and lastGame anchored to real completed games (strengthState)
    // so What-If lockedOutcomes never fabricate a "Last game" score or skew luck metrics.
    const realTeam = strengthState.teams[idx] ?? t
    // Forfeits are excluded from both sides of the pace comparison (they are not played games)
    const actualPtsPct = realTeam.gpPlayed > 0 ? realTeam.ptsPlayed / (3 * realTeam.gpPlayed) : 0.5
    const rawPythPct = sim.rawPythPcts[idx]
    const prevTeam = prevTimelinePoint?.teams[t.slug]

    return {
      slug: t.slug,
      name: t.name,
      currentRank: currentRankByIdx[idx],
      gp: t.gp,
      gamesRemaining: t.gamesRemaining,
      gamesInHand: Math.min(t.gamesRemaining, Math.max(0, maxGp - t.gp)),
      w: t.w,
      otw: t.otw,
      sow: t.sow,
      otl: t.otl,
      l: t.l,
      ...(t.ties > 0 ? { ties: t.ties } : {}),
      row: t.row,
      pts: t.pts,
      gf: t.gf,
      ga: t.ga,
      gd: t.gf - t.ga,
      playoffPct: sim.playoffPct[idx],
      playoffDelta: prevTeam ? round1(sim.playoffPct[idx] - prevTeam.playoffPct) : null,
      clinched: clinched[idx],
      eliminated: eliminated[idx],
      directByePct: sim.directByePct[idx],
      playInPct: sim.playInPct[idx],
      seedPcts: sim.seedPcts[idx],
      avgSeed: sim.avgSeed[idx],
      avgSeedDelta: prevTeam ? round2(sim.avgSeed[idx] - prevTeam.avgSeed) : null,
      bestSeed: sim.bestSeed[idx],
      worstSeed: sim.worstSeed[idx],
      strength: round3(sim.strengths[idx]),
      rawPythPct: round3(rawPythPct),
      actualPtsPct: round3(actualPtsPct),
      luckDelta: round3(actualPtsPct - rawPythPct),
      rpi: round3(state.rpiValues[idx]),
      rpiRank: state.rpiRanks[idx],
      lastGame: realTeam.lastGame,
      nextGame: t.nextGame,
      whatIfRows: sim.whatIfRows[idx],
      whatIfRowsNoOt: sim.whatIfRowsNoOt[idx],
    }
  })

  // Sort teams by Playoff % desc -> Avg Seed asc -> Current Rule 213 Rank asc
  teamRows.sort((a, b) => {
    if (b.playoffPct !== a.playoffPct) return b.playoffPct - a.playoffPct
    if (a.avgSeed !== b.avgSeed) return a.avgSeed - b.avgSeed
    return a.currentRank - b.currentRank
  })

  const nextMatchdayDate =
    state.remainingGames.length > 0
      ? [...new Set(state.remainingGames.map((g) => g.date))].sort()[0] ?? null
      : null

  const endTime = typeof performance !== "undefined" ? performance.now() : Date.now()

  return {
    seasonId,
    seasonName,
    seasonType,
    seasonStatus,
    mode,
    stateHash,
    generatedAt: new Date().toISOString(),
    iterations: safeIterations,
    computeMs: Math.round(endTime - startTime),
    gamesPlayed: state.completedGames.length,
    gamesRemaining: state.remainingGames.length,
    totalRegularGames: state.completedGames.length + state.remainingGames.length,
    endedEarly,
    format,
    calibration,
    teams: teamRows,
    bigGames: sim.bigGames,
    nextMatchdayDate,
    timeline,
    regularGames: games,
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
function round2(v: number): number {
  return Math.round(v * 100) / 100
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
