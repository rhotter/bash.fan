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
 * Empirically calibrated BASH league constants (2,126 non-forfeit regular-season games:
 * 1,573 Fall + 553 Summer). See docs/research-sports-club-stats.md §6.
 */
export const BASH_CALIBRATION: Record<SeasonKind, CalibrationProfile> = {
  fall: {
    pythagenPuckPower: 0.22,
    ebShrinkageGames: 10,
    otRate: 0.075,
    soRate: 0.045,
    homeFieldAdvantage: 0.5,
  },
  summer: {
    pythagenPuckPower: 0.37,
    ebShrinkageGames: 6,
    otRate: 0.055,
    soRate: 0.035,
    homeFieldAdvantage: 0.5,
  },
}

// Discrete regulation margin distribution (1..6 goals) calibrated to BASH street hockey
const REG_MARGIN_CDF = [0.28, 0.55, 0.75, 0.87, 0.95, 1.0] as const

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
    // Rule 219: all Summer teams make playoffs unless explicitly restricted on an active season
    const explicitRestricted =
      seasonStatus !== "completed" &&
      typeof configuredPlayoffTeams === "number" &&
      configuredPlayoffTeams >= 2 &&
      configuredPlayoffTeams < teamCount
    playoffSpots = explicitRestricted ? configuredPlayoffTeams! : teamCount
  } else if (
    seasonStatus === "completed" &&
    teamCount >= 7 &&
    configuredPlayoffTeams === 4 &&
    actualPlayoffTeamCount === 0
  ) {
    // Historical 7-team Fall season with legacy DB default (e.g. cancelled 2019-2020): apply Rule 412
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
  // Tiny Laplace smoothing (+0.25 goal) guards against 0-0 or shutout-only singularities
  const gfg = (gfPlayed + 0.25) / gpPlayed
  const gag = (gaPlayed + 0.25) / gpPlayed
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
  /** Non-forfeit scoring stats used for PythagenPuck efficiency */
  gpPlayed: number
  gfPlayed: number
  gaPlayed: number
  lastGame: TeamLastGame | null
  nextGame: TeamNextGame | null
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
    switch (pick) {
      case "away_reg":
        return { ...g, status: "final", awayScore: 4, homeScore: 2, isOvertime: false, hasShootout: false, isForfeit: false }
      case "away_ot":
        return { ...g, status: "final", awayScore: 3, homeScore: 2, isOvertime: true, hasShootout: false, isForfeit: false }
      case "home_ot":
        return { ...g, status: "final", awayScore: 2, homeScore: 3, isOvertime: true, hasShootout: false, isForfeit: false }
      case "home_reg":
        return { ...g, status: "final", awayScore: 2, homeScore: 4, isOvertime: false, hasShootout: false, isForfeit: false }
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
      gpPlayed: 0,
      gfPlayed: 0,
      gaPlayed: 0,
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

  // Sort chronologically so lastGame & nextGame are accurate
  const sortedGames = [...validGames].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  )

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
      away.gf += aScore
      away.ga += hScore
      home.gf += hScore
      home.ga += aScore
      baseGf[aIdx] += aScore
      baseGf[hIdx] += hScore
      baseGd[aIdx] += aScore - hScore
      baseGd[hIdx] += hScore - aScore

      if (!g.isForfeit) {
        away.gpPlayed++
        away.gfPlayed += aScore
        away.gaPlayed += hScore
        home.gpPlayed++
        home.gfPlayed += hScore
        home.gaPlayed += aScore
      }

      baseH2hGames[aIdx * T + hIdx]++
      baseH2hGames[hIdx * T + aIdx]++

      const isExtra = g.isOvertime || g.hasShootout
      const isSO = g.hasShootout

      if (hScore > aScore) {
        if (isExtra) {
          if (isSO) {
            home.sow++
          } else {
            home.otw++
            home.row++
            baseRow[hIdx]++
          }
          home.pts += 2
          away.otl++
          away.pts += 1
          basePts[hIdx] += 2
          basePts[aIdx] += 1
          baseH2hPts[hIdx * T + aIdx] += 2
          baseH2hPts[aIdx * T + hIdx] += 1
        } else {
          home.w++
          home.row++
          home.pts += 3
          away.l++
          basePts[hIdx] += 3
          baseRow[hIdx]++
          baseH2hPts[hIdx * T + aIdx] += 3
        }

        home.lastGame = {
          gameId: g.id,
          date: g.date,
          opponentSlug: away.slug,
          opponentName: away.name,
          isHome: true,
          resultLabel: g.isForfeit ? "FFW" : isSO ? "SOW" : isExtra ? "OTW" : "W",
          teamScore: hScore,
          opponentScore: aScore,
        }
        away.lastGame = {
          gameId: g.id,
          date: g.date,
          opponentSlug: home.slug,
          opponentName: home.name,
          isHome: false,
          resultLabel: g.isForfeit ? "FFL" : isSO ? "SOL" : isExtra ? "OTL" : "L",
          teamScore: aScore,
          opponentScore: hScore,
        }
      } else {
        if (isExtra) {
          if (isSO) {
            away.sow++
          } else {
            away.otw++
            away.row++
            baseRow[aIdx]++
          }
          away.pts += 2
          home.otl++
          home.pts += 1
          basePts[aIdx] += 2
          basePts[hIdx] += 1
          baseH2hPts[aIdx * T + hIdx] += 2
          baseH2hPts[hIdx * T + aIdx] += 1
        } else {
          away.w++
          away.row++
          away.pts += 3
          home.l++
          basePts[aIdx] += 3
          baseRow[aIdx]++
          baseH2hPts[aIdx * T + hIdx] += 3
        }

        away.lastGame = {
          gameId: g.id,
          date: g.date,
          opponentSlug: home.slug,
          opponentName: home.name,
          isHome: false,
          resultLabel: g.isForfeit ? "FFW" : isSO ? "SOW" : isExtra ? "OTW" : "W",
          teamScore: aScore,
          opponentScore: hScore,
        }
        home.lastGame = {
          gameId: g.id,
          date: g.date,
          opponentSlug: away.slug,
          opponentName: away.name,
          isHome: true,
          resultLabel: g.isForfeit ? "FFL" : isSO ? "SOL" : isExtra ? "OTL" : "L",
          teamScore: hScore,
          opponentScore: aScore,
        }
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
  const indices = teams.map((_, i) => i).sort((a, b) => rpiValues[b] - rpiValues[a])
  const rpiRanks = new Array<number>(T).fill(1)
  indices.forEach((teamIdx, pos) => {
    rpiRanks[teamIdx] = pos + 1
  })
  return { rpiValues, rpiRanks }
}

// ─── Exact Mathematical Clinch & Elimination Checker ─────────────────────────

function computeExactClinchElim(
  state: ParsedSeasonState,
  format: PlayoffFormat,
  currentRankByIdx: Int16Array
): { clinched: boolean[]; eliminated: boolean[] } {
  const T = state.teams.length
  const spots = format.playoffSpots
  const clinched = new Array<boolean>(T).fill(false)
  const eliminated = new Array<boolean>(T).fill(false)

  if (format.allTeamsQualify) {
    clinched.fill(true)
    return { clinched, eliminated }
  }

  if (state.remainingGames.length === 0) {
    for (let i = 0; i < T; i++) {
      if (currentRankByIdx[i] <= spots) clinched[i] = true
      else eliminated[i] = true
    }
    return { clinched, eliminated }
  }

  // Precompute pairwise remaining game counts between teams
  const remPair = new Int16Array(T * T)
  for (const g of state.remainingGames) {
    const a = state.slugToIdx.get(g.awaySlug)!
    const h = state.slugToIdx.get(g.homeSlug)!
    remPair[a * T + h]++
    remPair[h * T + a]++
  }

  for (let t = 0; t < T; t++) {
    const tMinPts = state.basePts[t]
    const tMaxPts = state.basePts[t] + 3 * state.teams[t].gamesRemaining

    // 1. Conservative Elimination Check:
    // Count rivals guaranteed strictly above tMaxPts (even if t wins out in regulation)
    let guaranteedAbove = 0
    for (let r = 0; r < T; r++) {
      if (r === t) continue
      const rMin = state.basePts[r]
      if (rMin > tMaxPts) {
        guaranteedAbove++
      } else if (
        rMin === tMaxPts &&
        state.teams[t].gamesRemaining === 0 &&
        state.teams[r].gamesRemaining === 0 &&
        currentRankByIdx[r] < currentRankByIdx[t]
      ) {
        guaranteedAbove++
      }
    }
    if (guaranteedAbove >= spots) {
      eliminated[t] = true
      continue
    }

    // 2. Conservative Clinch Check (with rival shared-game point-pool conservation!):
    // Rivals who individually have maxPts >= tMinPts (can tie or pass t if t gets 0 more pts)
    const contenders: number[] = []
    for (let r = 0; r < T; r++) {
      if (r === t) continue
      const rMax = state.basePts[r] + 3 * state.teams[r].gamesRemaining
      if (rMax > tMinPts) {
        contenders.push(r)
      } else if (rMax === tMinPts) {
        // Could potentially tie on points (conservatively include unless both finished & t wins tiebreak)
        const bothDone =
          state.teams[t].gamesRemaining === 0 && state.teams[r].gamesRemaining === 0
        if (!bothDone || currentRankByIdx[r] < currentRankByIdx[t]) {
          contenders.push(r)
        }
      }
    }

    if (contenders.length < spots) {
      clinched[t] = true
      continue
    }

    // Subset point-pool check for small leagues (T <= 12):
    // Can ANY subset of `spots` rivals simultaneously finish >= tMinPts?
    if (contenders.length <= 10) {
      let anySubsetCanBeat = false
      const chosen: number[] = []

      const dfs = (idx: number) => {
        if (anySubsetCanBeat) return
        if (chosen.length === spots) {
          let neededPts = 0
          let internalGamesTwice = 0
          let externalGames = 0
          for (let i = 0; i < spots; i++) {
            const u = chosen[i]
            neededPts += Math.max(0, tMinPts - state.basePts[u])
            let remWithSubset = 0
            for (let j = 0; j < spots; j++) {
              if (i !== j) remWithSubset += remPair[u * T + chosen[j]]
            }
            internalGamesTwice += remWithSubset
            externalGames += state.teams[u].gamesRemaining - remWithSubset
          }
          const maxAvailablePts = 3 * (internalGamesTwice / 2) + 3 * externalGames
          if (maxAvailablePts >= neededPts) {
            anySubsetCanBeat = true
          }
          return
        }
        if (idx >= contenders.length || contenders.length - idx < spots - chosen.length) {
          return
        }
        chosen.push(contenders[idx])
        dfs(idx + 1)
        chosen.pop()
        dfs(idx + 1)
      }

      dfs(0)
      if (!anySubsetCanBeat) {
        clinched[t] = true
      }
    }
  }

  return { clinched, eliminated }
}

// ─── Core Monte Carlo Kernel ─────────────────────────────────────────────────

interface PrecomputedGame {
  awayIdx: number
  homeIdx: number
  /** Cumulative 6-outcome probabilities: [homeReg, homeOt, homeSo, awaySo, awayOt, 1.0] */
  c0: number
  c1: number
  c2: number
  c3: number
  c4: number
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
}

function buildPrecomputedGames(
  state: ParsedSeasonState,
  strengths: number[],
  calibration: CalibrationProfile,
  trackedGameIdToBigIdx: Map<string, number>
): PrecomputedGame[] {
  return state.remainingGames.map((g) => {
    const awayIdx = state.slugToIdx.get(g.awaySlug)!
    const homeIdx = state.slugToIdx.get(g.homeSlug)!
    const pHome = log5(strengths[homeIdx], strengths[awayIdx])
    const closeness = 4 * pHome * (1 - pHome) // 1.0 for 50/50, shrinks for mismatches
    const extraScale = 0.5 + 0.5 * closeness
    const pOt = calibration.otRate * extraScale
    const pSo = calibration.soRate * extraScale
    const pReg = 1 - pOt - pSo

    const pHomeReg = pReg * pHome
    const pHomeOt = pOt * (0.5 + 0.7 * (pHome - 0.5))
    const pHomeSo = pSo * (0.5 + 0.3 * (pHome - 0.5))
    const pAwaySo = pSo - pHomeSo
    const pAwayOt = pOt - pHomeOt

    const c0 = pHomeReg
    const c1 = c0 + pHomeOt
    const c2 = c1 + pHomeSo
    const c3 = c2 + pAwaySo
    const c4 = c3 + pAwayOt

    const homeWinProb = pHomeReg + pHomeOt + pHomeSo
    return {
      awayIdx,
      homeIdx,
      c0,
      c1,
      c2,
      c3,
      c4,
      homeWinProb,
      awayWinProb: 1 - homeWinProb,
      bigGameIdx: trackedGameIdToBigIdx.get(g.id) ?? -1,
    }
  })
}

function sampleRegMargin(u: number): number {
  for (let i = 0; i < REG_MARGIN_CDF.length; i++) {
    if (u <= REG_MARGIN_CDF[i]) return i + 1
  }
  return 1
}

function runCoreSimulation(opts: {
  state: ParsedSeasonState
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
    format,
    mode,
    calibration,
    iterations,
    seed,
    trackBigGames,
    trackWhatIf,
    includeTailProbes,
  } = opts

  const T = state.teams.length
  const spots = format.playoffSpots
  const byeSpots = format.directByeSpots

  // 1. Compute team strengths
  const strengths = new Array<number>(T).fill(0.5)
  const rawPythPcts = new Array<number>(T).fill(0.5)
  for (let i = 0; i < T; i++) {
    const t = state.teams[i]
    const weighted = computeWeightedStrength(
      t.gfPlayed,
      t.gaPlayed,
      t.gpPlayed,
      calibration
    )
    rawPythPcts[i] = weighted.rawPythPct
    if (mode === "50_50") {
      strengths[i] = 0.5
    } else if (mode === "classic") {
      strengths[i] = computeKenClassicStrength(t.pts, t.gp, t.gamesRemaining)
    } else {
      strengths[i] = weighted.strength
    }
  }

  // Fast path: 0 remaining games (completed or ended early)
  if (state.remainingGames.length === 0) {
    const tiebreakRand = new Float64Array(T)
    for (let i = 0; i < T; i++) tiebreakRand[i] = (T - i) / (T + 1)
    const order = rankTeamsRule213(
      T,
      state.basePts,
      state.baseRow,
      state.baseGd,
      state.baseGf,
      state.baseH2hPts,
      state.baseH2hGames,
      tiebreakRand
    )
    const playoffPct = new Array<number>(T).fill(0)
    const directByePct = new Array<number>(T).fill(0)
    const playInPct = new Array<number>(T).fill(0)
    const seedPcts = Array.from({ length: T }, () => new Array<number>(T).fill(0))
    const avgSeed = new Array<number>(T).fill(1)
    const bestSeed = new Array<number>(T).fill(1)
    const worstSeed = new Array<number>(T).fill(1)
    const whatIfRows: WhatIfRecordRow[][] = Array.from({ length: T }, () => [])

    for (let pos = 0; pos < T; pos++) {
      const idx = order[pos]
      const seedNum = pos + 1
      seedPcts[idx][pos] = 100
      avgSeed[idx] = seedNum
      bestSeed[idx] = seedNum
      worstSeed[idx] = seedNum
      playoffPct[idx] = seedNum <= spots ? 100 : 0
      directByePct[idx] = byeSpots > 0 && seedNum <= byeSpots ? 100 : 0
      playInPct[idx] = format.hasPlayIn && seedNum > byeSpots && seedNum <= spots ? 100 : 0
      whatIfRows[idx] = [
        {
          label: "Final record",
          minAddedPts: 0,
          maxAddedPts: 0,
          minFinalPts: state.basePts[idx],
          maxFinalPts: state.basePts[idx],
          playoffPct: playoffPct[idx],
          avgSeed: seedNum,
          bestSeed: seedNum,
          worstSeed: seedNum,
          simCount: iterations,
          isTailProbe: false,
        },
      ]
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

  const preGames = buildPrecomputedGames(
    state,
    strengths,
    calibration,
    trackedGameIdToBigIdx
  )
  const G = preGames.length
  const K = trackedGames.length

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
  const iterBgOutcome = new Int8Array(K)

  // What-If finish-points accumulators
  const maxRem = Math.max(0, ...state.teams.map((t) => t.gamesRemaining))
  const maxAddedPtsSlots = 3 * maxRem + 1
  const wiCount = trackWhatIf ? new Int32Array(T * maxAddedPtsSlots) : null
  const wiPlayoff = trackWhatIf ? new Int32Array(T * maxAddedPtsSlots) : null
  const wiSeedSum = trackWhatIf ? new Float64Array(T * maxAddedPtsSlots) : null
  const wiBest = trackWhatIf ? new Int16Array(T * maxAddedPtsSlots).fill(T) : null
  const wiWorst = trackWhatIf ? new Int16Array(T * maxAddedPtsSlots).fill(1) : null

  // Per-iteration reusable scratch buffers
  const pts = new Int16Array(T)
  const row = new Int16Array(T)
  const gd = new Int16Array(T)
  const gf = new Int16Array(T)
  const h2hPts = new Int16Array(T * T)
  const h2hGames = new Int16Array(T * T)
  const tiebreakRand = new Float64Array(T)
  const order = new Int16Array(T)
  const seedOf = new Int16Array(T)
  const h2hPctScratch = new Float64Array(T)

  const rand = createPrng(seed)

  // 4. Main Monte Carlo Loop
  for (let iter = 0; iter < iterations; iter++) {
    pts.set(state.basePts)
    row.set(state.baseRow)
    gd.set(state.baseGd)
    gf.set(state.baseGf)
    h2hPts.set(state.baseH2hPts)
    h2hGames.set(state.baseH2hGames)

    for (let g = 0; g < G; g++) {
      const game = preGames[g]
      const a = game.awayIdx
      const h = game.homeIdx
      const u = rand()
      let bgBucket: number // 0=away_reg, 1=away_ot, 2=home_ot, 3=home_reg

      if (u < game.c0) {
        // Home Reg Win (3-0, +1 ROW)
        const margin = sampleRegMargin(rand())
        pts[h] += 3
        row[h] += 1
        gd[h] += margin
        gd[a] -= margin
        gf[h] += 2 + margin
        gf[a] += 2
        h2hPts[h * T + a] += 3
        bgBucket = 3
      } else if (u < game.c1) {
        // Home OT Win (2-1, +1 ROW)
        pts[h] += 2
        pts[a] += 1
        row[h] += 1
        gd[h] += 1
        gd[a] -= 1
        gf[h] += 3
        gf[a] += 2
        h2hPts[h * T + a] += 2
        h2hPts[a * T + h] += 1
        bgBucket = 2
      } else if (u < game.c2) {
        // Home SO Win (2-1, 0 ROW)
        pts[h] += 2
        pts[a] += 1
        gd[h] += 1
        gd[a] -= 1
        gf[h] += 3
        gf[a] += 2
        h2hPts[h * T + a] += 2
        h2hPts[a * T + h] += 1
        bgBucket = 2
      } else if (u < game.c3) {
        // Away SO Win (1-2, 0 ROW)
        pts[a] += 2
        pts[h] += 1
        gd[a] += 1
        gd[h] -= 1
        gf[a] += 3
        gf[h] += 2
        h2hPts[a * T + h] += 2
        h2hPts[h * T + a] += 1
        bgBucket = 1
      } else if (u < game.c4) {
        // Away OT Win (1-2, +1 ROW)
        pts[a] += 2
        pts[h] += 1
        row[a] += 1
        gd[a] += 1
        gd[h] -= 1
        gf[a] += 3
        gf[h] += 2
        h2hPts[a * T + h] += 2
        h2hPts[h * T + a] += 1
        bgBucket = 1
      } else {
        // Away Reg Win (0-3, +1 ROW)
        const margin = sampleRegMargin(rand())
        pts[a] += 3
        row[a] += 1
        gd[a] += margin
        gd[h] -= margin
        gf[a] += 2 + margin
        gf[h] += 2
        h2hPts[a * T + h] += 3
        bgBucket = 0
      }

      h2hGames[a * T + h] += 1
      h2hGames[h * T + a] += 1

      if (game.bigGameIdx >= 0) {
        iterBgOutcome[game.bigGameIdx] = bgBucket
      }
    }

    for (let i = 0; i < T; i++) tiebreakRand[i] = rand()

    rankTeamsRule213(
      T,
      pts,
      row,
      gd,
      gf,
      h2hPts,
      h2hGames,
      tiebreakRand,
      order,
      h2hPctScratch
    )

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

      if (trackWhatIf && wiCount && wiPlayoff && wiSeedSum && wiBest && wiWorst) {
        const added = pts[idx] - state.basePts[idx]
        const slot = idx * maxAddedPtsSlots + added
        wiCount[slot]++
        if (inPlayoffs) wiPlayoff[slot]++
        wiSeedSum[slot] += seedNum
        if (seedNum < wiBest[slot]) wiBest[slot] = seedNum
        if (seedNum > wiWorst[slot]) wiWorst[slot] = seedNum
      }
    }

    // Single-pass conditional Big Games tallying (Ken Roberts Nov 2009 #10964)
    for (let k = 0; k < K; k++) {
      const bucket = iterBgOutcome[k]
      const outIdx = k * 4 + bucket
      bgOutcomeCounts[outIdx]++
      const baseOff = outIdx * T
      for (let t = 0; t < T; t++) {
        const sNum = seedOf[t]
        if (sNum <= spots) bgPlayoffHits[baseOff + t]++
        bgSeedSums[baseOff + t] += sNum
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
      seedPcts[i][s] = round1((seedCounts[i * T + s] / iterations) * 100)
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

      for (const forceWin of [true, false]) {
        const targetAdded = forceWin ? 3 * rem : 0
        // Only run tail probe if main loop had < 25 samples for this extreme point total
        if (wiCount && wiCount[target * maxAddedPtsSlots + targetAdded] >= 25) {
          continue
        }
        let poHits = 0
        let sSum = 0
        let bSeed = T
        let wSeed = 1

        for (let iter = 0; iter < TAIL_PROBE_ITERATIONS; iter++) {
          pts.set(state.basePts)
          row.set(state.baseRow)
          gd.set(state.baseGd)
          gf.set(state.baseGf)
          h2hPts.set(state.baseH2hPts)
          h2hGames.set(state.baseH2hGames)

          for (let g = 0; g < G; g++) {
            const game = preGames[g]
            const a = game.awayIdx
            const h = game.homeIdx
            if (a === target || h === target) {
              const targetWon = forceWin
              const winner = targetWon ? target : a === target ? h : a
              const loser = winner === a ? h : a
              pts[winner] += 3
              row[winner] += 1
              gd[winner] += 2
              gd[loser] -= 2
              gf[winner] += 4
              gf[loser] += 2
              h2hPts[winner * T + loser] += 3
            } else {
              const u = tailRand()
              if (u < game.c0) {
                pts[h] += 3; row[h] += 1; gd[h] += 2; gd[a] -= 2; gf[h] += 4; gf[a] += 2; h2hPts[h * T + a] += 3
              } else if (u < game.c1) {
                pts[h] += 2; pts[a] += 1; row[h] += 1; gd[h] += 1; gd[a] -= 1; gf[h] += 3; gf[a] += 2; h2hPts[h * T + a] += 2; h2hPts[a * T + h] += 1
              } else if (u < game.c2) {
                pts[h] += 2; pts[a] += 1; gd[h] += 1; gd[a] -= 1; gf[h] += 3; gf[a] += 2; h2hPts[h * T + a] += 2; h2hPts[a * T + h] += 1
              } else if (u < game.c3) {
                pts[a] += 2; pts[h] += 1; gd[a] += 1; gd[h] -= 1; gf[a] += 3; gf[h] += 2; h2hPts[a * T + h] += 2; h2hPts[h * T + a] += 1
              } else if (u < game.c4) {
                pts[a] += 2; pts[h] += 1; row[a] += 1; gd[a] += 1; gd[h] -= 1; gf[a] += 3; gf[h] += 2; h2hPts[a * T + h] += 2; h2hPts[h * T + a] += 1
              } else {
                pts[a] += 3; row[a] += 1; gd[a] += 2; gd[h] -= 2; gf[a] += 4; gf[h] += 2; h2hPts[a * T + h] += 3
              }
            }
            h2hGames[a * T + h] += 1
            h2hGames[h * T + a] += 1
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
  if (trackWhatIf && wiCount && wiPlayoff && wiSeedSum && wiBest && wiWorst) {
    for (let i = 0; i < T; i++) {
      whatIfRows[i] = buildWhatIfRowsForTeam(
        i,
        state.teams[i],
        maxAddedPtsSlots,
        wiCount,
        wiPlayoff,
        wiSeedSum,
        wiBest,
        wiWorst,
        tailWinOut.get(i) ?? null,
        tailLoseOut.get(i) ?? null
      )
    }
  }

  // 8. Build Big Games conditional report
  const bigGames: BigGameImpact[] = []
  if (trackBigGames && K > 0) {
    for (let k = 0; k < K; k++) {
      const rawGame = trackedGames[k]
      const preGame = preGames.find(
        (pg) => pg.bigGameIdx === k
      )!
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
        let minPo = 100
        let maxPo = 0
        let minSeed = T
        let maxSeed = 1
        let bestKey: BigGameOutcomeKey = "away_reg"
        let bestPo = -1
        let bestAvgS = T + 1

        const outcomes = {} as Record<BigGameOutcomeKey, BigGameOutcomeCell>
        for (let b = 0; b < 4; b++) {
          const key = OUTCOME_KEYS[b]
          const cnt = bgOutcomeCounts[k * 4 + b]
          const baseOff = (k * 4 + b) * T
          const condPo = cnt > 0 ? round1((bgPlayoffHits[baseOff + t] / cnt) * 100) : curPo
          const condSeed = cnt > 0 ? round2(bgSeedSums[baseOff + t] / cnt) : curSeed
          const lowSample = cnt < 100

          outcomes[key] = {
            playoffPct: condPo,
            playoffDelta: round1(condPo - curPo),
            avgSeed: condSeed,
            seedDelta: round2(condSeed - curSeed),
            lowSample,
          }

          if (cnt > 0) {
            if (condPo < minPo) minPo = condPo
            if (condPo > maxPo) maxPo = condPo
            if (condSeed < minSeed) minSeed = condSeed
            if (condSeed > maxSeed) maxSeed = condSeed
            if (
              condPo > bestPo + 0.05 ||
              (Math.abs(condPo - bestPo) <= 0.05 && condSeed < bestAvgS)
            ) {
              bestPo = condPo
              bestAvgS = condSeed
              bestKey = key
            }
          }
        }

        const poSwing = round1(Math.max(0, maxPo - minPo))
        const sdSwing = round2(Math.max(0, maxSeed - minSeed))
        totalPlayoffSwing += poSwing
        totalSeedSwing += sdSwing

        // Include both participating teams + any third-party team above Ken's 0.3% noise floor (or 0.15 seed swing)
        if (
          isParticipant ||
          poSwing >= 0.3 ||
          (format.allTeamsQualify && sdSwing >= 0.15)
        ) {
          affectedTeams.push({
            slug: state.teams[t].slug,
            name: state.teams[t].name,
            isParticipant,
            currentPlayoffPct: curPo,
            currentAvgSeed: curSeed,
            playoffSwing: poSwing,
            seedSwing: sdSwing,
            bestOutcome: bestKey,
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
  }
}

function buildWhatIfRowsForTeam(
  teamIdx: number,
  team: TeamAccumulator,
  maxAddedPtsSlots: number,
  wiCount: Int32Array,
  wiPlayoff: Int32Array,
  wiSeedSum: Float64Array,
  wiBest: Int16Array,
  wiWorst: Int16Array,
  tailWinOut: { playoffPct: number; avgSeed: number; bestSeed: number; worstSeed: number; count: number } | null,
  tailLoseOut: { playoffPct: number; avgSeed: number; bestSeed: number; worstSeed: number; count: number } | null
): WhatIfRecordRow[] {
  const rem = team.gamesRemaining
  const maxAdd = 3 * rem
  if (rem === 0) return []

  // Choose readable bucket step size (~6-9 rows regardless of remaining games)
  const step = rem <= 3 ? 1 : rem <= 6 ? 3 : rem <= 11 ? 4 : 6
  const rows: WhatIfRecordRow[] = []

  // Build descending buckets from maxAdd down to 0
  // Keep exact Win-Out (maxAdd) and Lose-Out (0) highlighted cleanly when tail-probed!
  for (let hi = maxAdd; hi >= 0; hi -= step) {
    const lo = Math.max(0, hi - step + 1)
    let cnt = 0
    let po = 0
    let sSum = 0
    let best = 99
    let worst = 1
    const baseSlot = teamIdx * maxAddedPtsSlots
    for (let p = lo; p <= hi; p++) {
      const slot = baseSlot + p
      const c = wiCount[slot]
      if (c > 0) {
        cnt += c
        po += wiPlayoff[slot]
        sSum += wiSeedSum[slot]
        if (wiBest[slot] < best) best = wiBest[slot]
        if (wiWorst[slot] > worst) worst = wiWorst[slot]
      }
    }

    if (cnt >= 10) {
      rows.push({
        label: lo === hi ? `+${hi} pts` : `+${lo}–${hi} pts`,
        minAddedPts: lo,
        maxAddedPts: hi,
        minFinalPts: team.pts + lo,
        maxFinalPts: team.pts + hi,
        playoffPct: round1((po / cnt) * 100),
        avgSeed: round2(sSum / cnt),
        bestSeed: best,
        worstSeed: worst,
        simCount: cnt,
        isTailProbe: false,
      })
    } else if (hi === maxAdd && tailWinOut) {
      rows.push({
        label: `Win out (+${maxAdd} pts)`,
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
        label: "Lose out (+0 pts)",
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
    const sim = runCoreSimulation({
      state: st,
      format,
      mode,
      calibration,
      iterations: TIMELINE_ITERATIONS,
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
    games,
    mode = "weighted",
    iterations = DEFAULT_ITERATIONS,
    includeTimeline = true,
    includeTailProbes = true,
    lockedOutcomes,
  } = options

  const calibration = BASH_CALIBRATION[seasonType]
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
  const format = resolvePlayoffFormat({
    seasonType,
    seasonStatus,
    configuredPlayoffTeams,
    teamCount: state.teams.length,
    actualPlayoffTeamCount,
  })

  // Canonical state hash guarantees bit-identical determinism across refreshes & serverless instances
  const sigParts = [
    seasonId,
    mode,
    String(format.playoffSpots),
    String(iterations),
    ...effectiveGames
      .map(
        (g) =>
          `${g.id}:${g.status}:${g.awayScore ?? ""}-${g.homeScore ?? ""}:${g.isOvertime ? 1 : 0}${g.hasShootout ? 1 : 0}${g.isForfeit ? 1 : 0}`
      )
      .sort(),
  ]
  const stateHash = fnv1aHash(sigParts.join("|")).toString(16).padStart(8, "0")
  const seed = parseInt(stateHash, 16) >>> 0

  const sim = runCoreSimulation({
    state,
    format,
    mode,
    calibration,
    iterations,
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
  const { clinched, eliminated } = computeExactClinchElim(state, format, currentRankByIdx)

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
      })
    : []

  const prevTimelinePoint = timeline.length >= 2 ? timeline[timeline.length - 2] : null
  const maxGp = Math.max(0, ...state.teams.map((t) => t.gp))

  const teamRows: TeamOddsRow[] = state.teams.map((t, idx) => {
    const actualPtsPct = t.gp > 0 ? t.pts / (3 * t.gp) : 0.5
    const rawPythPct = sim.rawPythPcts[idx]
    const prevTeam = prevTimelinePoint?.teams[t.slug]

    return {
      slug: t.slug,
      name: t.name,
      currentRank: currentRankByIdx[idx],
      gp: t.gp,
      gamesRemaining: t.gamesRemaining,
      gamesInHand: Math.max(0, maxGp - t.gp),
      w: t.w,
      otw: t.otw,
      sow: t.sow,
      otl: t.otl,
      l: t.l,
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
      lastGame: t.lastGame,
      nextGame: t.nextGame,
      whatIfRows: sim.whatIfRows[idx],
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
    iterations,
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
