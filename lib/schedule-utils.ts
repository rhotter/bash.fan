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
}

export interface GeneratedGame {
  date: string
  time: string
  homeTeam: string
  awayTeam: string
  location: string
  gameType: string
  status: string
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

// ─── Round Robin (Berger tables) ────────────────────────────────────────────

/**
 * Generate a round-robin schedule using the Berger tables algorithm.
 *
 * @param numTeams      Number of teams (will be bumped to even if odd via a "bye" team).
 * @param gamesPerWeek  How many games are played each "week" / round.
 * @param cycles        How many full round-robin cycles to generate.
 * @returns             Array of { round, home, away } using 0-based team indices.
 */
export function generateRoundRobin(
  numTeams: number,
  gamesPerWeek: number,
  cycles: number = 1,
  maxTotalGames?: number
): RoundRobinSlot[] {
  if (numTeams < 2) return []

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

      for (let match = 0; match < matchesPerRound; match++) {
        const home = teams[match]
        const away = teams[n - 1 - match]

        // Skip bye matches
        if (hasBye && (home >= numTeams || away >= numTeams)) continue

        // Alternate home/away by round for fairness
        if (round % 2 === 0) {
          allSlots.push({ round: roundNum, home, away })
        } else {
          allSlots.push({ round: roundNum, home: away, away: home })
        }
        
        if (maxTotalGames && allSlots.length >= maxTotalGames) {
          break
        }
      }
      if (maxTotalGames && allSlots.length >= maxTotalGames) break
    }
    if (maxTotalGames && allSlots.length >= maxTotalGames) break
  }

  // Now chunk into weeks based on gamesPerWeek
  // Each "week" gets gamesPerWeek games from the flat list in order
  if (gamesPerWeek > 0 && gamesPerWeek < matchesPerRound) {
    const reNumbered: RoundRobinSlot[] = []
    let weekNum = 1
    for (let i = 0; i < allSlots.length; i++) {
      reNumbered.push({ ...allSlots[i], round: weekNum })
      if ((i + 1) % gamesPerWeek === 0) weekNum++
    }
    return reNumbered
  }

  return allSlots
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
      })
    }
  }

  return games
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
