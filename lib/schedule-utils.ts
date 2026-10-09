/**
 * Schedule generation utilities for BASH league admin.
 *
 * Pure functions — no side effects, no database calls.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RoundRobinSlot {
  round: number
  home: number // team index (0-based)
  away: number // team index (0-based)
  slotInDay?: number // 0-based intra-day game index (0 = Game 1, 1 = Game 2, etc.)
}

export interface GeneratedGame {
  date: string
  time: string
  homeTeam: string
  awayTeam: string
  location: string
  gameType: string
  status: string
  gameNumberInDay?: number // 1-based (1 = Game 1, 2 = Game 2, etc.)
  homePlaceholder?: string | null
  awayPlaceholder?: string | null
  bracketRound?: string | null
  seriesId?: string | null
  seriesGameNumber?: number | null
  nextGameId?: string | null
  nextGameSlot?: string | null
  id?: string
}

export interface BracketConfig {
  numTeams: number          // 4–8
  playIn: boolean           // true if odd team count needs a play-in
  quarterSeriesLength: 1 | 3
  semiSeriesLength: 1 | 3
  finalSeriesLength: 1 | 3
  seeds: string[]           // team slugs in seeded order (index 0 = #1 seed)
  usePlaceholders: boolean  // true → use "Seed 1" labels instead of real teams
  defaultLocation?: string  // season default location (falls back to "The Lick")
}

export interface BracketGame {
  id: string
  homeTeam: string
  awayTeam: string
  homePlaceholder: string | null
  awayPlaceholder: string | null
  bracketRound: string
  seriesId: string
  seriesGameNumber: number
  nextGameId: string | null
  nextGameSlot: "home" | "away" | null
  gameType: string
  status: string
  date: string
  time: string
  location: string
}

export interface SeriesGame {
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string
}

export interface Holiday {
  name: string
  date: string // YYYY-MM-DD
}

export interface TeamEquityStats {
  teamSlug: string
  teamName: string
  homeGames: number
  awayGames: number
  totalGames: number
  homeAwayDiff: number // |home - away|
  gameSlots: Record<number, number> // 1-based intra-day game slot -> count (e.g. { 1: 6, 2: 6, 3: 6 })
  timeSlots: Record<string, number> // time string -> count
  byes: number
  maxStreak: number // max consecutive H or A
}

export interface ScheduleEquityReport {
  teams: TeamEquityStats[]
  isHomeAwayEquitable: boolean
  isGameSlotsEquitable: boolean
  isTimeSlotsEquitable: boolean
  maxHomeAwayDiff: number
  maxGameSlotDiff: number
  numGameSlotsPerDay: number
  slotLabels: { slotNumber: number; label: string; time?: string }[]
}

// ─── Round Robin (Berger tables) ────────────────────────────────────────────

/**
 * Generate a round-robin schedule using the Berger tables algorithm.
 *
 * @param numTeams      Number of teams (will be bumped to even if odd via a "bye" team).
 * @param gamesPerWeek  How many games are played each "week" / round.
 * @param cycles        How many full round-robin cycles to generate.
 * @returns             Array of { round, home, away } using 0-based team indices.
 */
/**
 * Deterministic 32-bit pseudo-random number generator (Mulberry32).
 */
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Optimize Home/Away orientation for round-robin match slots.
 *
 * Guarantees:
 * 1. Head-to-head fairness: For every pair of teams playing K times,
 *    |home(u vs v) - home(v vs u)| <= 1.
 * 2. Global team balance: For every team, |home - away| <= (totalGames % 2).
 *    (e.g. exactly 9 Home and 9 Away for an 18-game schedule).
 * 3. Streak minimization: Minimizes consecutive Home or Away games.
 *
 * Preserves match order within rounds, keeping game-time rotations intact.
 */
export function balanceHomeAway(
  slots: RoundRobinSlot[],
  numTeams: number,
  pinnedRounds?: Set<number>
): RoundRobinSlot[] {
  if (numTeams < 2 || slots.length === 0) return slots

  const isPinnedIdx = (idx: number) => (pinnedRounds ? pinnedRounds.has(slots[idx].round) : false)

  const seed = (numTeams * 10007 + slots.length * 37) & 0xffffffff
  const rng = mulberry32(seed)

  const totalGames = new Array(numTeams).fill(0)
  for (const s of slots) {
    if (s.home < numTeams) totalGames[s.home]++
    if (s.away < numTeams) totalGames[s.away]++
  }

  const pairMeetings: Record<string, number[]> = {}
  for (let idx = 0; idx < slots.length; idx++) {
    const s = slots[idx]
    const u = Math.min(s.home, s.away)
    const v = Math.max(s.home, s.away)
    const key = `${u}-${v}`
    if (!pairMeetings[key]) pairMeetings[key] = []
    pairMeetings[key].push(idx)
  }

  const result = slots.map((s) => ({ ...s }))

  // Initial assignment: alternate for each pair to guarantee head-to-head equity
  for (const [key, indices] of Object.entries(pairMeetings)) {
    const [uStr, vStr] = key.split("-")
    const u = Number(uStr)
    const v = Number(vStr)
    const firstIsU = rng() > 0.5

    const pinnedIndices = indices.filter(isPinnedIdx)
    const unpinnedIndices = indices.filter((i) => !isPinnedIdx(i))

    // Preserve pinned slots exactly as given
    for (const idx of pinnedIndices) {
      result[idx].home = slots[idx].home
      result[idx].away = slots[idx].away
    }

    if (pinnedIndices.length === 0) {
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i]
        const uHome = i % 2 === 0 ? firstIsU : !firstIsU
        result[idx].home = uHome ? u : v
        result[idx].away = uHome ? v : u
      }
    } else {
      // Alternate remaining meetings around pinned meeting(s)
      let uHomeCount = pinnedIndices.filter((idx) => slots[idx].home === u).length
      let vHomeCount = pinnedIndices.length - uHomeCount

      for (const idx of unpinnedIndices) {
        let uHome: boolean
        if (uHomeCount < vHomeCount) {
          uHome = true
          uHomeCount++
        } else if (vHomeCount < uHomeCount) {
          uHome = false
          vHomeCount++
        } else {
          uHome = rng() > 0.5
          if (uHome) uHomeCount++
          else vHomeCount++
        }
        result[idx].home = uHome ? u : v
        result[idx].away = uHome ? v : u
      }
    }
  }

  const keys = Object.keys(pairMeetings)

  const getCost = (curSlots: RoundRobinSlot[]) => {
    const homeCounts = new Array(numTeams).fill(0)
    const awayCounts = new Array(numTeams).fill(0)
    for (const s of curSlots) {
      if (s.home < numTeams) homeCounts[s.home]++
      if (s.away < numTeams) awayCounts[s.away]++
    }

    let cost = 0
    // 1. Strict penalty for |home - away| > (totalGames % 2)
    for (let t = 0; t < numTeams; t++) {
      const diff = Math.abs(homeCounts[t] - awayCounts[t])
      const maxAllowed = totalGames[t] % 2 === 0 ? 0 : 1
      if (diff > maxAllowed) {
        cost += (diff - maxAllowed) * 10000
      }
    }

    // 2. Penalty for streaks >= 3
    for (let t = 0; t < numTeams; t++) {
      const teamGames: RoundRobinSlot[] = []
      for (const s of curSlots) {
        if (s.home === t || s.away === t) teamGames.push(s)
      }
      teamGames.sort((a, b) => a.round - b.round)

      let streak = 0
      let lastWasHome: boolean | null = null
      for (const g of teamGames) {
        const isHome = g.home === t
        if (isHome === lastWasHome) {
          streak++
          if (streak === 2) cost += 15 // 3 in a row
          else if (streak >= 3) cost += streak * 100 // 4+ in a row
        } else {
          streak = 0
          lastWasHome = isHome
        }
      }
    }

    // 3. Strict penalty for head-to-head imbalance between any pair
    for (const indices of Object.values(pairMeetings)) {
      if (indices.length <= 1) continue
      let homeForU = 0
      let homeForV = 0
      const u = Math.min(curSlots[indices[0]].home, curSlots[indices[0]].away)
      for (const idx of indices) {
        if (curSlots[idx].home === u) homeForU++
        else homeForV++
      }
      const h2hDiff = Math.abs(homeForU - homeForV)
      const maxAllowedH2H = indices.length % 2 === 0 ? 0 : 1
      if (h2hDiff > maxAllowedH2H) {
        cost += (h2hDiff - maxAllowedH2H) * 50000
      }
    }

    return cost
  }

  let currentCost = getCost(result)
  let bestCost = currentCost
  let bestResult = result.map((s) => ({ ...s }))

  const maxIters = 8000
  let temp = 50.0

  for (let iter = 0; iter < maxIters; iter++) {
    if (bestCost === 0) break

    const randKey = keys[Math.floor(rng() * keys.length)]
    const indices = pairMeetings[randKey]
    const unpinned = indices.filter((i) => !isPinnedIdx(i))
    if (unpinned.length === 0) continue

    const moveType = rng()

    if (moveType < 0.6) {
      // Invert unpinned meetings for this pair
      for (const idx of unpinned) {
        const tmp = result[idx].home
        result[idx].home = result[idx].away
        result[idx].away = tmp
      }
      const newCost = getCost(result)
      const delta = newCost - currentCost
      if (delta <= 0 || rng() < Math.exp(-delta / Math.max(0.1, temp))) {
        currentCost = newCost
        if (newCost < bestCost) {
          bestCost = newCost
          bestResult = result.map((s) => ({ ...s }))
        }
      } else {
        // Revert
        for (const idx of unpinned) {
          const tmp = result[idx].home
          result[idx].home = result[idx].away
          result[idx].away = tmp
        }
      }
    } else if (unpinned.length >= 2) {
      // Swap orientations of two unpinned meetings in the same pair
      const i1 = unpinned[Math.floor(rng() * unpinned.length)]
      const i2 = unpinned[Math.floor(rng() * unpinned.length)]
      if (i1 !== i2 && result[i1].home !== result[i2].home) {
        const tmp1 = result[i1].home
        result[i1].home = result[i1].away
        result[i1].away = tmp1
        const tmp2 = result[i2].home
        result[i2].home = result[i2].away
        result[i2].away = tmp2
        const newCost = getCost(result)
        const delta = newCost - currentCost
        if (delta <= 0 || rng() < Math.exp(-delta / Math.max(0.1, temp))) {
          currentCost = newCost
          if (newCost < bestCost) {
            bestCost = newCost
            bestResult = result.map((s) => ({ ...s }))
          }
        } else {
          // Revert
          const rtmp1 = result[i1].home
          result[i1].home = result[i1].away
          result[i1].away = rtmp1
          const rtmp2 = result[i2].home
          result[i2].home = result[i2].away
          result[i2].away = rtmp2
        }
      }
    }

    temp *= 0.999
  }

  return bestResult
}

/**
 * Optimize intra-day game slot distribution (Game 1, Game 2, Game 3, Game 4...) across all teams.
 *
 * Permutes match ordering within each round/week so that every team rotates equally
 * through the game slots of the day (e.g. Game 1, Game 2, Game 3, Game 4).
 * Works flexibly for 4 teams (2 games/day), 6-7 teams (3 games/day), 8 teams (4 games/day), etc.
 */
export function balanceIntraDayGameSlots(
  slots: RoundRobinSlot[],
  numTeams: number,
  pinnedRounds?: Set<number>
): RoundRobinSlot[] {
  if (numTeams < 2 || slots.length === 0) return slots

  const roundMap = new Map<number, RoundRobinSlot[]>()
  for (const s of slots) {
    if (!roundMap.has(s.round)) roundMap.set(s.round, [])
    roundMap.get(s.round)!.push({ ...s })
  }

  let maxGamesPerDay = 0
  for (const matches of roundMap.values()) {
    if (matches.length > maxGamesPerDay) maxGamesPerDay = matches.length
  }
  if (maxGamesPerDay <= 1) {
    return slots.map((s) => ({ ...s, slotInDay: 0 }))
  }

  const rounds = Array.from(roundMap.keys())
  const roundMatches = rounds.map((r) => roundMap.get(r)!)

  const seed = (numTeams * 43217 + slots.length * 19) & 0xffffffff
  const rng = mulberry32(seed)

  const getSlotCounts = () => {
    const counts = Array.from(
      { length: numTeams },
      () => new Array(maxGamesPerDay).fill(0)
    )
    for (const matches of roundMatches) {
      matches.forEach((m, slotIdx) => {
        if (m.home < numTeams) counts[m.home][slotIdx]++
        if (m.away < numTeams) counts[m.away][slotIdx]++
      })
    }
    return counts
  }

  const getCost = () => {
    const counts = getSlotCounts()
    let cost = 0
    for (let t = 0; t < numTeams; t++) {
      const c = counts[t]
      const totalGames = c.reduce((a, b) => a + b, 0)
      const ideal = totalGames / maxGamesPerDay
      for (let s = 0; s < maxGamesPerDay; s++) {
        const diff = c[s] - ideal
        cost += diff * diff * 20
      }
      const spread = Math.max(...c) - Math.min(...c)
      if (spread > 1) {
        cost += (spread - 1) * 2000
      }
    }
    return cost
  }

  let currentCost = getCost()
  let bestCost = currentCost
  let bestRounds = roundMatches.map((r) => r.map((m) => ({ ...m })))

  const maxIters = 8000
  let temp = 30.0

  for (let iter = 0; iter < maxIters; iter++) {
    if (bestCost === 0) break

    const rIdx = Math.floor(rng() * roundMatches.length)
    const roundNum = rounds[rIdx]
    if (pinnedRounds?.has(roundNum)) continue

    const matches = roundMatches[rIdx]
    if (matches.length < 2) continue

    const i1 = Math.floor(rng() * matches.length)
    const i2 = Math.floor(rng() * matches.length)
    if (i1 === i2) continue

    const tmp = matches[i1]
    matches[i1] = matches[i2]
    matches[i2] = tmp

    const newCost = getCost()
    const delta = newCost - currentCost
    if (delta <= 0 || rng() < Math.exp(-delta / Math.max(0.1, temp))) {
      currentCost = newCost
      if (newCost < bestCost) {
        bestCost = newCost
        bestRounds = roundMatches.map((r) => r.map((m) => ({ ...m })))
      }
    } else {
      matches[i2] = matches[i1]
      matches[i1] = tmp
    }

    temp *= 0.999
  }

  const result: RoundRobinSlot[] = []
  for (const matches of bestRounds) {
    matches.forEach((m, slotIdx) => {
      result.push({ ...m, slotInDay: slotIdx })
    })
  }
  return result
}

/**
 * Generate a round-robin schedule using Berger tables, rotated match time slots,
 * intra-day game slot equity optimization, and automated Home/Away balance optimization.
 *
 * @param numTeams      Number of teams (will be bumped to even if odd via a "bye" team).
 * @param gamesPerWeek  How many games are played each "week" / round.
 * @param cycles        How many full round-robin cycles to generate.
 * @returns             Array of { round, home, away, slotInDay } using 0-based team indices.
 */
export function generateRoundRobin(
  numTeams: number,
  gamesPerWeek: number,
  cycles: number = 1,
  maxTotalGames?: number,
  pinnedSlots?: RoundRobinSlot[]
): RoundRobinSlot[] {
  if (numTeams < 2) return []

  const pinnedRounds = pinnedSlots && pinnedSlots.length > 0
    ? new Set(pinnedSlots.map((s) => s.round))
    : undefined

  // If odd, add a "bye" sentinel — team at index `n` is the bye.
  const n = numTeams % 2 === 0 ? numTeams : numTeams + 1
  const hasBye = numTeams % 2 !== 0

  // Berger tables: fix team 0, rotate teams 1..n-1
  const totalRounds = n - 1
  const matchesPerRound = n / 2

  const allSlots: RoundRobinSlot[] = []

  for (let cycle = 0; cycle < cycles; cycle++) {
    for (let round = 0; round < totalRounds; round++) {
      const roundNum = cycle * totalRounds + round + 1
      const teams: number[] = [0]
      for (let i = 1; i < n; i++) {
        // Rotate positions 1..n-1
        const pos = ((i - 1 + round) % (n - 1)) + 1
        teams.push(pos)
      }

      // Collect matches for this round before appending
      const roundMatches: RoundRobinSlot[] = []
      for (let match = 0; match < matchesPerRound; match++) {
        const home = teams[match]
        const away = teams[n - 1 - match]

        // Skip bye matches
        if (hasBye && (home >= numTeams || away >= numTeams)) continue

        // Initial assignment
        if (round % 2 === 0) {
          roundMatches.push({ round: roundNum, home, away })
        } else {
          roundMatches.push({ round: roundNum, home: away, away: home })
        }
      }

      // Rotate match ordering so teams cycle through different time slots
      // each week. Without this, team 0 (fixed in Berger tables) always
      // lands in match position 0 and gets the earliest time slot every round.
      // Use cumulative round index (roundNum) so the offset advances across cycles.
      const offset = (roundNum - 1) % Math.max(1, roundMatches.length)
      const rotated = offset === 0
        ? roundMatches
        : [...roundMatches.slice(offset), ...roundMatches.slice(0, offset)]

      for (const m of rotated) {
        allSlots.push(m)
        if (maxTotalGames && allSlots.length >= maxTotalGames) break
      }
      if (maxTotalGames && allSlots.length >= maxTotalGames) break
    }
    if (maxTotalGames && allSlots.length >= maxTotalGames) break
  }

  // Chunk into weeks based on gamesPerWeek if needed
  let finalSlots = allSlots
  if (gamesPerWeek > 0 && gamesPerWeek < matchesPerRound) {
    const reNumbered: RoundRobinSlot[] = []
    let weekNum = 1
    for (let i = 0; i < allSlots.length; i++) {
      reNumbered.push({ ...allSlots[i], round: weekNum })
      if ((i + 1) % gamesPerWeek === 0) weekNum++
    }
    finalSlots = reNumbered
  }

  // Inject pinned slots if provided
  if (pinnedSlots && pinnedSlots.length > 0 && pinnedRounds) {
    const unpinnedSlots = finalSlots.filter((s) => !pinnedRounds.has(s.round))
    finalSlots = [...pinnedSlots, ...unpinnedSlots].sort((a, b) =>
      a.round !== b.round ? a.round - b.round : (a.slotInDay ?? 0) - (b.slotInDay ?? 0)
    )
  }

  // 1. Balance intra-day game slots so teams rotate equally between Game 1, Game 2, Game 3, ...
  const slotBalanced = balanceIntraDayGameSlots(finalSlots, numTeams, pinnedRounds)

  // 2. Optimize Home/Away assignments to ensure equity
  return balanceHomeAway(slotBalanced, numTeams, pinnedRounds)
}

/**
 * Compute schedule equity metrics across all teams for home/away and intra-day game slots.
 */
export function computeScheduleEquity(
  games: GeneratedGame[],
  teams: { teamSlug: string; teamName: string }[],
  activeWeeksCount?: number
): ScheduleEquityReport {
  // If gameNumberInDay is missing on any games, infer it by grouping by date
  const gamesWithSlot = (() => {
    const hasMissing = games.some((g) => g.gameNumberInDay === undefined)
    if (!hasMissing) return games

    const byDate = new Map<string, GeneratedGame[]>()
    for (const g of games) {
      const d = g.date || "all"
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d)!.push(g)
    }

    const inferred: GeneratedGame[] = []
    for (const dayGames of byDate.values()) {
      dayGames.forEach((g, idx) => {
        inferred.push({
          ...g,
          gameNumberInDay: g.gameNumberInDay ?? idx + 1,
        })
      })
    }
    return inferred
  })()

  const teamMetrics: TeamEquityStats[] = teams.map((t) => {
    const slug = t.teamSlug
    const name = t.teamName

    const teamGames = gamesWithSlot.filter(
      (g) =>
        g.homeTeam === slug ||
        g.awayTeam === slug ||
        g.homePlaceholder === name ||
        g.awayPlaceholder === name
    )

    let homeCount = 0
    let awayCount = 0
    const timeSlotCounts: Record<string, number> = {}
    const gameSlotCounts: Record<number, number> = {}

    for (const g of teamGames) {
      const isHome = g.homeTeam === slug || g.homePlaceholder === name
      if (isHome) homeCount++
      else awayCount++

      if (g.gameNumberInDay !== undefined) {
        gameSlotCounts[g.gameNumberInDay] =
          (gameSlotCounts[g.gameNumberInDay] || 0) + 1
      }

      if (g.time && g.time !== "TBD") {
        timeSlotCounts[g.time] = (timeSlotCounts[g.time] || 0) + 1
      }
    }

    // Calculate streak
    const sortedGames = [...teamGames].sort((a, b) => {
      const dateCmp = (a.date || "").localeCompare(b.date || "")
      if (dateCmp !== 0) return dateCmp
      return (a.time || "").localeCompare(b.time || "")
    })

    let maxStreak = 0
    let currentStreak = 0
    let lastWasHome: boolean | null = null

    for (const g of sortedGames) {
      const isHome = g.homeTeam === slug || g.homePlaceholder === name
      if (isHome === lastWasHome) {
        currentStreak++
      } else {
        currentStreak = 1
        lastWasHome = isHome
      }
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak
      }
    }

    const totalGames = homeCount + awayCount
    const byes =
      activeWeeksCount !== undefined
        ? Math.max(0, activeWeeksCount - totalGames)
        : 0

    return {
      teamSlug: slug,
      teamName: name,
      homeGames: homeCount,
      awayGames: awayCount,
      totalGames,
      homeAwayDiff: Math.abs(homeCount - awayCount),
      gameSlots: gameSlotCounts,
      timeSlots: timeSlotCounts,
      byes,
      maxStreak,
    }
  })

  const maxHomeAwayDiff = Math.max(...teamMetrics.map((m) => m.homeAwayDiff), 0)
  const isHomeAwayEquitable = teamMetrics.every((m) => {
    const maxAllowed = m.totalGames % 2 === 0 ? 0 : 1
    return m.homeAwayDiff <= maxAllowed
  })

  // Intra-day game slot equity
  const allSlotNumbers = Array.from(
    new Set(teamMetrics.flatMap((m) => Object.keys(m.gameSlots).map(Number)))
  ).sort((a, b) => a - b)
  const numGameSlotsPerDay =
    allSlotNumbers.length > 0 ? Math.max(...allSlotNumbers) : 1

  let maxGameSlotDiff = 0
  for (const s of allSlotNumbers) {
    const counts = teamMetrics.map((m) => m.gameSlots[s] || 0)
    const diff = Math.max(...counts) - Math.min(...counts)
    if (diff > maxGameSlotDiff) maxGameSlotDiff = diff
  }
  const isGameSlotsEquitable = maxGameSlotDiff <= 2

  // Distinct time slot equity (optional check if clock times are specified)
  const allTimeKeys = Array.from(
    new Set(teamMetrics.flatMap((m) => Object.keys(m.timeSlots)))
  )
  let isTimeSlotsEquitable = true
  if (allTimeKeys.length > 1) {
    for (const key of allTimeKeys) {
      const counts = teamMetrics.map((m) => m.timeSlots[key] || 0)
      const min = Math.min(...counts)
      const max = Math.max(...counts)
      if (max - min > 2) {
        isTimeSlotsEquitable = false
        break
      }
    }
  }

  // Build slot labels with corresponding time if available
  const slotLabels = (allSlotNumbers.length > 0 ? allSlotNumbers : [1]).map(
    (s) => {
      const sample = gamesWithSlot.find(
        (g) => g.gameNumberInDay === s && g.time && g.time !== "TBD"
      )
      return {
        slotNumber: s,
        label: `Game ${s}`,
        time: sample?.time,
      }
    }
  )

  return {
    teams: teamMetrics,
    isHomeAwayEquitable,
    isGameSlotsEquitable,
    isTimeSlotsEquitable,
    maxHomeAwayDiff,
    maxGameSlotDiff,
    numGameSlotsPerDay,
    slotLabels,
  }
}

/**
 * Re-balance upcoming games for an in-progress season to compensate for past imbalances.
 *
 * Completed games ('final') remain untouched. Upcoming games have their Home/Away
 * orientations optimized to bring each team as close to 50/50 as possible.
 */
export function rebalanceUpcomingGames<
  T extends {
    id?: string
    homeTeam: string
    awayTeam: string
    status: string
    date?: string
    time?: string
  }
>(games: T[]): T[] {
  const isEligibleUpcoming = (g: T) =>
    g.status !== "final" &&
    Boolean(g.homeTeam && g.homeTeam !== "tbd" && g.awayTeam && g.awayTeam !== "tbd")

  const finalGames = games.filter((g) => g.status === "final")
  const eligibleUpcoming = games.filter(isEligibleUpcoming)

  if (eligibleUpcoming.length === 0) return games

  // Collect all teams
  const teamSet = new Set<string>()
  for (const g of games) {
    if (g.homeTeam && g.homeTeam !== "tbd") teamSet.add(g.homeTeam)
    if (g.awayTeam && g.awayTeam !== "tbd") teamSet.add(g.awayTeam)
  }
  const teamList = Array.from(teamSet)
  const teamIndexMap = new Map(teamList.map((slug, i) => [slug, i]))
  const numTeams = teamList.length

  if (numTeams < 2) return games

  // Count fixed games from finalGames and track fixed head-to-head meetings
  const fixedHomeCounts = new Array(numTeams).fill(0)
  const fixedAwayCounts = new Array(numTeams).fill(0)
  const fixedH2H: Record<string, { uHome: number; vHome: number }> = {}
  for (const g of finalGames) {
    const h = teamIndexMap.get(g.homeTeam)
    const a = teamIndexMap.get(g.awayTeam)
    if (h !== undefined) fixedHomeCounts[h]++
    if (a !== undefined) fixedAwayCounts[a]++
    if (h !== undefined && a !== undefined) {
      const u = Math.min(h, a)
      const v = Math.max(h, a)
      const key = `${u}-${v}`
      if (!fixedH2H[key]) fixedH2H[key] = { uHome: 0, vHome: 0 }
      if (h === u) fixedH2H[key].uHome++
      else fixedH2H[key].vHome++
    }
  }

  // Map upcoming games to slots
  const upcomingSlots: RoundRobinSlot[] = eligibleUpcoming.map((g, idx) => ({
    round: idx,
    home: teamIndexMap.get(g.homeTeam)!,
    away: teamIndexMap.get(g.awayTeam)!,
  }))

  // Pair meetings in upcoming
  const pairMeetings: Record<string, number[]> = {}
  for (let idx = 0; idx < upcomingSlots.length; idx++) {
    const s = upcomingSlots[idx]
    const u = Math.min(s.home, s.away)
    const v = Math.max(s.home, s.away)
    const key = `${u}-${v}`
    if (!pairMeetings[key]) pairMeetings[key] = []
    pairMeetings[key].push(idx)
  }

  const allPairKeys = Array.from(new Set([...Object.keys(pairMeetings), ...Object.keys(fixedH2H)]))
  const parsedPairs = allPairKeys.map((key) => {
    const [uStr] = key.split("-")
    const u = parseInt(uStr, 10)
    return {
      u,
      indices: pairMeetings[key] || [],
      fixedUHome: fixedH2H[key]?.uHome ?? 0,
      fixedVHome: fixedH2H[key]?.vHome ?? 0,
    }
  })

  const rng = mulberry32(1234567)
  const result = upcomingSlots.map((s) => ({ ...s }))

  // Cost function taking into account fixed completed games and head-to-head pair equity
  const getCost = (curSlots: RoundRobinSlot[]) => {
    const homeCounts = [...fixedHomeCounts]
    const awayCounts = [...fixedAwayCounts]
    for (const s of curSlots) {
      homeCounts[s.home]++
      awayCounts[s.away]++
    }

    let cost = 0
    // 1. Team Home/Away balance
    for (let t = 0; t < numTeams; t++) {
      const diff = Math.abs(homeCounts[t] - awayCounts[t])
      const total = homeCounts[t] + awayCounts[t]
      const maxAllowed = total % 2 === 0 ? 0 : 1
      if (diff > maxAllowed) {
        cost += (diff - maxAllowed) * 10000
      }
    }

    // 2. Strict head-to-head pair equity penalty
    for (const pair of parsedPairs) {
      let uHome = pair.fixedUHome
      let vHome = pair.fixedVHome
      for (const idx of pair.indices) {
        if (curSlots[idx].home === pair.u) uHome++
        else vHome++
      }
      const totalMeetings = uHome + vHome
      if (totalMeetings <= 1) continue
      const h2hDiff = Math.abs(uHome - vHome)
      const maxAllowedH2H = totalMeetings % 2 === 0 ? 0 : 1
      if (h2hDiff > maxAllowedH2H) {
        cost += (h2hDiff - maxAllowedH2H) * 50000
      }
    }

    return cost
  }

  let currentCost = getCost(result)
  let bestCost = currentCost
  let bestResult = result.map((s) => ({ ...s }))
  const keys = Object.keys(pairMeetings)
  let temp = 50.0

  for (let iter = 0; iter < 5000; iter++) {
    if (bestCost === 0) break
    const randKey = keys[Math.floor(rng() * keys.length)]
    const indices = pairMeetings[randKey]
    const idx = indices[Math.floor(rng() * indices.length)]

    const tmp = result[idx].home
    result[idx].home = result[idx].away
    result[idx].away = tmp

    const newCost = getCost(result)
    const delta = newCost - currentCost
    if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
      currentCost = newCost
      if (currentCost < bestCost) {
        bestCost = currentCost
        bestResult = result.map((s) => ({ ...s }))
      }
    } else {
      // Revert swap
      const rtmp = result[idx].home
      result[idx].home = result[idx].away
      result[idx].away = rtmp
    }
    temp *= 0.999
  }

  // Re-apply bestResult to upcomingGames
  let upIdx = 0
  return games.map((g) => {
    if (!isEligibleUpcoming(g)) return g
    const s = bestResult[upIdx++]
    const homeTeam = teamList[s.home] ?? g.homeTeam
    const awayTeam = teamList[s.away] ?? g.awayTeam
    return {
      ...g,
      homeTeam,
      awayTeam,
    }
  })
}

/**
 * Compute which team (by 0-based index) has a bye each week/round.
 *
 * For even team counts every team plays every round, so there are no byes.
 * For odd team counts, exactly one team sits out each round because the
 * Berger tables algorithm adds a phantom "bye" sentinel and skips those matches.
 *
 * @param slots       Output of generateRoundRobin()
 * @param numTeams    The REAL team count (before padding to even)
 * @returns           Map of weekNumber → team index with bye (or undefined if no bye)
 */
export function computeByeTeams(
  slots: RoundRobinSlot[],
  numTeams: number
): Record<number, number | undefined> {
  if (numTeams % 2 === 0) return {} // Even team count — no byes

  const byWeek: Record<number, Set<number>> = {}
  for (const s of slots) {
    if (!byWeek[s.round]) byWeek[s.round] = new Set()
    byWeek[s.round].add(s.home)
    byWeek[s.round].add(s.away)
  }

  const result: Record<number, number | undefined> = {}
  for (const [weekStr, playing] of Object.entries(byWeek)) {
    for (let t = 0; t < numTeams; t++) {
      if (!playing.has(t)) {
        result[Number(weekStr)] = t
        break
      }
    }
  }
  return result
}

/**
 * Generate a list of major US holidays (and some key dates like Super Bowl) for a given year.
 */
export function getHolidaysForYear(year: number): Holiday[] {
  const holidays: Holiday[] = []

  const add = (name: string, date: string) => holidays.push({ name, date })
  
  const fmt = (d: Date) => {
    const mm = d.getMonth() + 1
    const dd = d.getDate()
    return `${d.getFullYear()}-${mm < 10 ? '0' + mm : mm}-${dd < 10 ? '0' + dd : dd}`
  }

  // Fixed dates
  add("New Year's Day", `${year}-01-01`)
  add("Independence Day", `${year}-07-04`)
  add("Halloween", `${year}-10-31`)
  add("Veterans Day", `${year}-11-11`)
  add("Christmas Eve", `${year}-12-24`)
  add("Christmas Day", `${year}-12-25`)
  add("New Year's Eve", `${year}-12-31`)

  // Helpers for floating dates
  const getNth = (m: number, dow: number, n: number) => {
    const d = new Date(year, m, 1)
    const offset = (dow - d.getDay() + 7) % 7
    d.setDate(1 + offset + (n - 1) * 7)
    return fmt(d)
  }
  
  const getLast = (m: number, dow: number) => {
    const d = new Date(year, m + 1, 0)
    const offset = (d.getDay() - dow + 7) % 7
    d.setDate(d.getDate() - offset)
    return fmt(d)
  }

  // Floating dates (month is 0-indexed, dow: 0=Sun, 1=Mon...6=Sat)
  add("MLK Day", getNth(0, 1, 3)) // 3rd Monday in Jan
  add("Super Bowl", getNth(1, 0, 2)) // 2nd Sunday in Feb
  add("Presidents' Day", getNth(1, 1, 3)) // 3rd Monday in Feb
  add("Mother's Day", getNth(4, 0, 2)) // 2nd Sunday in May
  add("Memorial Day", getLast(4, 1)) // Last Monday in May
  add("Father's Day", getNth(5, 0, 3)) // 3rd Sunday in June
  add("Labor Day", getNth(8, 1, 1)) // 1st Monday in Sep
  add("Columbus Day", getNth(9, 1, 2)) // 2nd Monday in Oct
  add("Thanksgiving", getNth(10, 4, 4)) // 4th Thursday in Nov

  // Easter (Computus)
  const f = Math.floor
  const G = year % 19
  const C = f(year / 100)
  const H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30
  const I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11))
  const J = (year + f(year / 4) + I + 2 - C + f(C / 4)) % 7
  const L = I - J
  const month = 3 + f((L + 40) / 44)
  const day = L + 28 - 31 * f(month / 4)
  const em = month < 10 ? `0${month}` : month
  const ed = day < 10 ? `0${day}` : day
  add("Easter", `${year}-${em}-${ed}`)

  return holidays.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Map generic round-robin slots to real teams and dates.
 *
 * @param slots         Output of generateRoundRobin()
 * @param teamSlugs     Ordered team slugs (index = team number from slots)
 * @param weekDates     Map of week number → array of { date, time, location }
 * @param gameType      Default game type for all generated games
 */
export function mapRoundRobinToGames(
  slots: RoundRobinSlot[],
  teamSlugs: string[],
  weekDates: Record<number, { date: string; time: string; location: string }[]>,
  gameType: string = "regular",
  defaultLocation: string = "The Lick"
): GeneratedGame[] {
  const games: GeneratedGame[] = []

  // Group slots by week/round
  const byWeek: Record<number, RoundRobinSlot[]> = {}
  for (const s of slots) {
    if (!byWeek[s.round]) byWeek[s.round] = []
    byWeek[s.round].push(s)
  }

  for (const weekStr of Object.keys(byWeek).sort((a, b) => +a - +b)) {
    const week = +weekStr
    const weekSlots = byWeek[week]
    const dates = weekDates[week] || []

    for (let i = 0; i < weekSlots.length; i++) {
      const slot = weekSlots[i]
      const dateInfo = dates[i] || { date: "", time: "TBD", location: defaultLocation }

      games.push({
        date: dateInfo.date,
        time: dateInfo.time,
        homeTeam: teamSlugs[slot.home] ?? "tbd",
        awayTeam: teamSlugs[slot.away] ?? "tbd",
        location: dateInfo.location,
        gameType,
        status: "upcoming",
        gameNumberInDay: slot.slotInDay !== undefined ? slot.slotInDay + 1 : i + 1,
      })
    }
  }

  return games
}

/**
 * Returns default game start time (24-hour HH:mm) based on intra-day game index and total games per day.
 * - 4 games/day: 08:00, 10:00, 12:00, 14:00 (8:00, 10:00, 12:00, 2:00)
 * - 3 games/day: 09:00, 11:00, 13:00 (9:00, 11:00, 1:00)
 * - 2 games/day: 10:00, 12:00 (10:00, 12:00)
 * - 1 game/day:  10:00
 */
export function getDefaultTimeForSlot(slotIndex: number, totalGamesPerDay: number): string {
  if (totalGamesPerDay === 4) {
    return slotIndex === 0 ? "08:00" : slotIndex === 1 ? "10:00" : slotIndex === 2 ? "12:00" : slotIndex === 3 ? "14:00" : "TBD"
  }
  if (totalGamesPerDay === 3) {
    return slotIndex === 0 ? "09:00" : slotIndex === 1 ? "11:00" : slotIndex === 2 ? "13:00" : "TBD"
  }
  if (totalGamesPerDay === 2) {
    return slotIndex === 0 ? "10:00" : slotIndex === 1 ? "12:00" : "TBD"
  }
  if (totalGamesPerDay === 1) {
    return "10:00"
  }
  const startHour = 8 + slotIndex * 2
  const hh = startHour < 10 ? `0${startHour}` : `${startHour}`
  return `${hh}:00`
}

// ─── Playoff Bracket ────────────────────────────────────────────────────────

/**
 * Generate a playoff bracket for the BASH league.
 *
 * Supports 4–8 teams with standard bracket seeding:
 *   8: QF(#1v#8, #4v#5, #2v#7, #3v#6) → SF → Final
 *   7: Play-in(#7v#8→bye) then same as 8 with #1 bye on A-side
 *   6: QF(#4v#5, #3v#6) + #1,#2 byes → SF → Final
 *   5: Play-in(#4v#5) + #1,#2,#3 byes → SF → Final
 *   4: SF(#1v#4, #2v#3) → Final
 *
 * Each round can be best-of-1 or best-of-3.
 * Returns fully linked games with nextGameId/nextGameSlot references.
 */
export function generateBracket(config: BracketConfig): BracketGame[] {
  const {
    numTeams, playIn, quarterSeriesLength, semiSeriesLength,
    finalSeriesLength, seeds, usePlaceholders,
    defaultLocation: loc = "The Lick",
  } = config

  const games: BracketGame[] = []
  let idCounter = 1
  const makeId = () => `playoff-${idCounter++}`

  const teamOrTbd = (seedIndex: number): { slug: string; placeholder: string | null } => {
    if (seedIndex >= seeds.length || usePlaceholders) {
      return { slug: "tbd", placeholder: `Seed ${seedIndex + 1}` }
    }
    return { slug: seeds[seedIndex], placeholder: null }
  }

  const makeSeries = (
    seriesLen: number, seriesId: string, round: string,
    homeTeam: { slug: string; placeholder: string | null },
    awayTeam: { slug: string; placeholder: string | null },
    nextId: string | null, nextSlot: "home" | "away" | null,
  ): string[] => {
    const ids: string[] = []
    for (let g = 0; g < seriesLen; g++) {
      const id = makeId()
      ids.push(id)
      games.push({
        id,
        homeTeam: g % 2 === 0 ? homeTeam.slug : awayTeam.slug,
        awayTeam: g % 2 === 0 ? awayTeam.slug : homeTeam.slug,
        homePlaceholder: g % 2 === 0 ? homeTeam.placeholder : awayTeam.placeholder,
        awayPlaceholder: g % 2 === 0 ? awayTeam.placeholder : homeTeam.placeholder,
        bracketRound: round,
        seriesId,
        seriesGameNumber: g + 1,
        nextGameId: g === 0 ? nextId : null,
        nextGameSlot: g === 0 ? nextSlot : null,
        gameType: "playoff",
        status: "upcoming",
        date: "",
        time: "TBD",
        location: loc,
      })
    }
    return ids
  }

  // Pre-generate final IDs so we can link to them
  const finalIds: string[] = []
  for (let i = 0; i < finalSeriesLength; i++) finalIds.push(makeId())
  const finalFirstId = finalIds[0]

  // Pre-generate semi IDs so quarterfinals can link to them
  const sfaIds: string[] = []
  for (let i = 0; i < semiSeriesLength; i++) sfaIds.push(makeId())
  const sfbIds: string[] = []
  for (let i = 0; i < semiSeriesLength; i++) sfbIds.push(makeId())

  // ─── Determine bracket structure ────────────────────────
  // Standard bracket: A-side (#1,#8,#4,#5)  B-side (#2,#7,#3,#6)
  // With byes for missing seeds

  const hasPlayIn = playIn && numTeams % 2 !== 0

  if (numTeams <= 5) {
    // ─── 4–5 teams: optional play-in → semis → final ──────
    if (hasPlayIn && numTeams === 5) {
      const s4 = teamOrTbd(3)
      const s5 = teamOrTbd(4)
      makeSeries(1, "play-in", "play-in", s4, s5, sfaIds[0], "away")
    }

    const s1 = teamOrTbd(0)
    const sfaAway = (hasPlayIn && numTeams === 5)
      ? { slug: "tbd", placeholder: "Play-in Winner" }
      : teamOrTbd(3)
    const s2 = teamOrTbd(1)
    const s3 = teamOrTbd(2)

    // Overwrite the pre-generated IDs by building series that use them
    // SF-A
    for (let g = 0; g < semiSeriesLength; g++) {
      games.push({
        id: sfaIds[g],
        homeTeam: g % 2 === 0 ? s1.slug : sfaAway.slug,
        awayTeam: g % 2 === 0 ? sfaAway.slug : s1.slug,
        homePlaceholder: g % 2 === 0 ? s1.placeholder : sfaAway.placeholder,
        awayPlaceholder: g % 2 === 0 ? sfaAway.placeholder : s1.placeholder,
        bracketRound: "semifinal", seriesId: "sf-a", seriesGameNumber: g + 1,
        nextGameId: g === 0 ? finalFirstId : null,
        nextGameSlot: g === 0 ? "home" : null,
        gameType: "playoff", status: "upcoming", date: "", time: "TBD", location: loc,
      })
    }
    // SF-B
    for (let g = 0; g < semiSeriesLength; g++) {
      games.push({
        id: sfbIds[g],
        homeTeam: g % 2 === 0 ? s2.slug : s3.slug,
        awayTeam: g % 2 === 0 ? s3.slug : s2.slug,
        homePlaceholder: g % 2 === 0 ? s2.placeholder : s3.placeholder,
        awayPlaceholder: g % 2 === 0 ? s3.placeholder : s2.placeholder,
        bracketRound: "semifinal", seriesId: "sf-b", seriesGameNumber: g + 1,
        nextGameId: g === 0 ? finalFirstId : null,
        nextGameSlot: g === 0 ? "away" : null,
        gameType: "playoff", status: "upcoming", date: "", time: "TBD", location: loc,
      })
    }
  } else {
    // ─── 6–8 teams: quarterfinals → semis → final ─────────
    // A-side: QF-A (#1 vs #8), QF-B (#4 vs #5)  →  SF-A
    // B-side: QF-C (#2 vs #7), QF-D (#3 vs #6)  →  SF-B
    // Byes for missing seeds; play-in for odd counts

    // Determine which QF matchups exist
    // A-side
    const qfA_exists = numTeams >= 8 // #1 vs #8
    const qfB_exists = numTeams >= 6 // #4 vs #5

    // B-side
    const qfC_exists = numTeams >= 8 // #2 vs #7 (only with 8 teams, or 7+play-in gives #7 to play-in)
    const qfD_exists = numTeams >= 6 // #3 vs #6

    // Build QF series, linking winners to their respective semi
    // QF-A: #1 vs #8 → SF-A (home)
    if (qfA_exists) {
      makeSeries(quarterSeriesLength, "qf-a", "quarterfinal",
        teamOrTbd(0), teamOrTbd(7), sfaIds[0], "home")
    }
    // QF-B: #4 vs #5 → SF-A (away)
    if (qfB_exists) {
      makeSeries(quarterSeriesLength, "qf-b", "quarterfinal",
        teamOrTbd(3), teamOrTbd(4), sfaIds[0], "away")
    }
    // QF-C: #2 vs #7 → SF-B (home)
    if (qfC_exists) {
      makeSeries(quarterSeriesLength, "qf-c", "quarterfinal",
        teamOrTbd(1), teamOrTbd(6), sfbIds[0], "home")
    }
    // QF-D: #3 vs #6 → SF-B (away)
    if (qfD_exists) {
      const qfDAway = (hasPlayIn && numTeams === 7)
        ? { slug: "tbd", placeholder: "Play-in Winner" }
        : teamOrTbd(5)
      const qfDIds = makeSeries(quarterSeriesLength, "qf-d", "quarterfinal",
        teamOrTbd(2), qfDAway, sfbIds[0], "away")

      // If 7 teams, create play-in that feeds into QF-D
      if (hasPlayIn && numTeams === 7) {
        const s6 = teamOrTbd(5)
        const s7 = teamOrTbd(6)
        makeSeries(1, "play-in", "play-in", s6, s7, qfDIds[0], "away")
      }
    }

    // SF-A: determine home/away labels based on who has byes
    const sfaHome = qfA_exists
      ? { slug: "tbd", placeholder: "Winner QF-A" }
      : teamOrTbd(0) // #1 gets bye
    const sfaAway = qfB_exists
      ? { slug: "tbd", placeholder: "Winner QF-B" }
      : teamOrTbd(3)
    for (let g = 0; g < semiSeriesLength; g++) {
      games.push({
        id: sfaIds[g],
        homeTeam: g % 2 === 0 ? sfaHome.slug : sfaAway.slug,
        awayTeam: g % 2 === 0 ? sfaAway.slug : sfaHome.slug,
        homePlaceholder: g % 2 === 0 ? sfaHome.placeholder : sfaAway.placeholder,
        awayPlaceholder: g % 2 === 0 ? sfaAway.placeholder : sfaHome.placeholder,
        bracketRound: "semifinal", seriesId: "sf-a", seriesGameNumber: g + 1,
        nextGameId: g === 0 ? finalFirstId : null,
        nextGameSlot: g === 0 ? "home" : null,
        gameType: "playoff", status: "upcoming", date: "", time: "TBD", location: loc,
      })
    }

    // SF-B
    const sfbHome = qfC_exists
      ? { slug: "tbd", placeholder: "Winner QF-C" }
      : teamOrTbd(1) // #2 gets bye
    const sfbAway = qfD_exists
      ? { slug: "tbd", placeholder: "Winner QF-D" }
      : teamOrTbd(2)
    for (let g = 0; g < semiSeriesLength; g++) {
      games.push({
        id: sfbIds[g],
        homeTeam: g % 2 === 0 ? sfbHome.slug : sfbAway.slug,
        awayTeam: g % 2 === 0 ? sfbAway.slug : sfbHome.slug,
        homePlaceholder: g % 2 === 0 ? sfbHome.placeholder : sfbAway.placeholder,
        awayPlaceholder: g % 2 === 0 ? sfbAway.placeholder : sfbHome.placeholder,
        bracketRound: "semifinal", seriesId: "sf-b", seriesGameNumber: g + 1,
        nextGameId: g === 0 ? finalFirstId : null,
        nextGameSlot: g === 0 ? "away" : null,
        gameType: "playoff", status: "upcoming", date: "", time: "TBD", location: loc,
      })
    }
  }

  // ─── Final ─────────────────────────────────────────────
  const fHome = { slug: "tbd", placeholder: "Winner SF-A" }
  const fAway = { slug: "tbd", placeholder: "Winner SF-B" }
  for (let g = 0; g < finalSeriesLength; g++) {
    games.push({
      id: finalIds[g],
      homeTeam: g % 2 === 0 ? fHome.slug : fAway.slug,
      awayTeam: g % 2 === 0 ? fAway.slug : fHome.slug,
      homePlaceholder: g % 2 === 0 ? fHome.placeholder : fAway.placeholder,
      awayPlaceholder: g % 2 === 0 ? fAway.placeholder : fHome.placeholder,
      bracketRound: "final", seriesId: "final", seriesGameNumber: g + 1,
      nextGameId: null, nextGameSlot: null,
      gameType: "playoff", status: "upcoming", date: "", time: "TBD", location: loc,
    })
  }

  return games
}

// ─── Series Clinch Check ────────────────────────────────────────────────────

/**
 * Given all games in a series, determine if a team has clinched.
 *
 * @param seriesGames   All games with the same seriesId
 * @param seriesLength  Total possible games in the series (1 or 3)
 * @returns             { clinched, winner } where winner is a team slug or null
 */
export function checkSeriesClinch(
  seriesGames: SeriesGame[],
  seriesLength: 1 | 3
): { clinched: boolean; winner: string | null } {
  const winsNeeded = Math.ceil(seriesLength / 2)
  const wins: Record<string, number> = {}

  for (const game of seriesGames) {
    if (game.status !== "final" || game.homeScore === null || game.awayScore === null) continue

    const winner = game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam
    wins[winner] = (wins[winner] || 0) + 1
  }

  for (const [team, count] of Object.entries(wins)) {
    if (count >= winsNeeded) {
      return { clinched: true, winner: team }
    }
  }

  return { clinched: false, winner: null }
}
