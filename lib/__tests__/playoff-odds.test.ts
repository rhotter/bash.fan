import { describe, it, expect } from "vitest"
import {
  BASH_CALIBRATION,
  computeKenClassicStrength,
  computeWeightedStrength,
  log5,
  resolvePlayoffFormat,
  rankTeamsRule213,
  computePlayoffOdds,
} from "@/lib/playoff-odds"
import type { PlayoffSimGame } from "@/lib/playoff-odds-types"

function makeGame(
  overrides: Partial<PlayoffSimGame> & {
    id: string
    date: string
    awaySlug: string
    homeSlug: string
  }
): PlayoffSimGame {
  return {
    time: "9:00am",
    location: "The Lick",
    awayName: overrides.awaySlug.toUpperCase(),
    homeName: overrides.homeSlug.toUpperCase(),
    awayScore: null,
    homeScore: null,
    status: "upcoming",
    isOvertime: false,
    hasShootout: false,
    isForfeit: false,
    ...overrides,
  }
}

/**
 * Generates a compact round-robin season schedule for N teams across R rounds.
 */
function buildSyntheticSeason(
  teamSlugs: string[],
  rounds: number,
  playedDatesCount: number
): PlayoffSimGame[] {
  const games: PlayoffSimGame[] = []
  let gid = 1
  let dayIndex = 0

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < teamSlugs.length; i++) {
      for (let j = i + 1; j < teamSlugs.length; j++) {
        const home = (r + i + j) % 2 === 0 ? teamSlugs[i] : teamSlugs[j]
        const away = home === teamSlugs[i] ? teamSlugs[j] : teamSlugs[i]
        const matchday = Math.floor(dayIndex / 3)
        const month = 10 + Math.floor(matchday / 4)
        const day = 1 + (matchday % 4) * 7
        const year = month > 12 ? 2027 : 2026
        const normMonth = month > 12 ? month - 12 : month
        const date = `${year}-${String(normMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`
        const isFinal = matchday < playedDatesCount

        // Give earlier teams in teamSlugs slightly stronger deterministic results
        const awayStrengthIdx = teamSlugs.indexOf(away)
        const homeStrengthIdx = teamSlugs.indexOf(home)
        let awayScore: number | null = null
        let homeScore: number | null = null
        let isOvertime = false
        let hasShootout = false

        if (isFinal) {
          if (awayStrengthIdx < homeStrengthIdx) {
            awayScore = 5
            homeScore = 3
          } else if (homeStrengthIdx < awayStrengthIdx) {
            homeScore = 4
            awayScore = 3
            isOvertime = gid % 3 === 0
            hasShootout = gid % 6 === 0
          } else {
            homeScore = 3
            awayScore = 2
          }
        }

        games.push(
          makeGame({
            id: `g${gid++}`,
            date,
            awaySlug: away,
            homeSlug: home,
            awayScore,
            homeScore,
            status: isFinal ? "final" : "upcoming",
            isOvertime,
            hasShootout,
          })
        )
        dayIndex++
      }
    }
  }
  return games
}

describe("Playoff Odds Engine — Format & Strength Models", () => {
  it("resolves playoff formats accurately for 7-team Fall, 6-team Fall, Summer, and historical overrides", () => {
    const fall7 = resolvePlayoffFormat({
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 5,
      teamCount: 7,
      actualPlayoffTeamCount: 0,
    })
    expect(fall7).toEqual({
      teamCount: 7,
      playoffSpots: 5,
      directByeSpots: 3,
      hasPlayIn: true,
      allTeamsQualify: false,
    })

    const fall6 = resolvePlayoffFormat({
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 4,
      teamCount: 6,
      actualPlayoffTeamCount: 0,
    })
    expect(fall6).toEqual({
      teamCount: 6,
      playoffSpots: 4,
      directByeSpots: 0,
      hasPlayIn: false,
      allTeamsQualify: false,
    })

    const summer6 = resolvePlayoffFormat({
      seasonType: "summer",
      seasonStatus: "completed",
      configuredPlayoffTeams: 4, // legacy schema default
      teamCount: 6,
      actualPlayoffTeamCount: 6,
    })
    expect(summer6).toEqual({
      teamCount: 6,
      playoffSpots: 6,
      directByeSpots: 0,
      hasPlayIn: false,
      allTeamsQualify: true,
    })

    const historical2018 = resolvePlayoffFormat({
      seasonType: "fall",
      seasonStatus: "completed",
      configuredPlayoffTeams: 4, // legacy DB default before playoff_teams column
      teamCount: 7,
      actualPlayoffTeamCount: 5,
    })
    expect(historical2018.playoffSpots).toBe(5)
    expect(historical2018.hasPlayIn).toBe(true)
    expect(historical2018.directByeSpots).toBe(3)

    // Active Summer (>4 teams) and active 7-team Fall with Postgres schema default playoff_teams = 4
    const activeSummerDefault = resolvePlayoffFormat({
      seasonType: "summer",
      seasonStatus: "active",
      configuredPlayoffTeams: 4,
      teamCount: 6,
      actualPlayoffTeamCount: 0,
    })
    expect(activeSummerDefault.allTeamsQualify).toBe(true)
    expect(activeSummerDefault.playoffSpots).toBe(6)

    const activeFall7Default = resolvePlayoffFormat({
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 4,
      teamCount: 7,
      actualPlayoffTeamCount: 0,
    })
    expect(activeFall7Default.playoffSpots).toBe(5)
    expect(activeFall7Default.hasPlayIn).toBe(true)
    expect(activeFall7Default.directByeSpots).toBe(3)

    // Active 7-team Fall season after the 4v5 Play-In game finalizes (actualPlayoffTeamCount >= 2 while still active)
    const activeFall7MidPlayoffs = resolvePlayoffFormat({
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 4,
      teamCount: 7,
      actualPlayoffTeamCount: 2,
    })
    expect(activeFall7MidPlayoffs.playoffSpots).toBe(5)
    expect(activeFall7MidPlayoffs.hasPlayIn).toBe(true)
    expect(activeFall7MidPlayoffs.directByeSpots).toBe(3)
  })

  it("reproduces Ken Roberts's exact p225 regression formula from archived 2018-2019 BASH page", () => {
    // Verified against archived BayAreaStreetHockey.html (Feb 18, 2019):
    // Kings: 27 pts in 11 GP (7 rem) -> .737
    expect(computeKenClassicStrength(27, 11, 7)).toBeCloseTo(0.737, 3)
    // Red Army: 22 pts in 11 GP (7 rem) -> .624
    expect(computeKenClassicStrength(22, 11, 7)).toBeCloseTo(0.624, 3)
    // Landsharks: 14 pts in 12 GP (6 rem) -> .415
    expect(computeKenClassicStrength(14, 12, 6)).toBeCloseTo(0.415, 3)
    // Seals: 6 pts in 11 GP (7 rem) -> .263
    expect(computeKenClassicStrength(6, 11, 7)).toBeCloseTo(0.263, 3)
    // Haze: 4 pts in 11 GP (7 rem) -> .218
    expect(computeKenClassicStrength(4, 11, 7)).toBeCloseTo(0.218, 3)
    // 0 GP -> exactly 0.500
    expect(computeKenClassicStrength(0, 0, 18)).toBe(0.5)
  })

  it("computes BASH-calibrated PythagenPuck + Empirical Bayes shrinkage & symmetric Log5", () => {
    const neutral = computeWeightedStrength(0, 0, 0, BASH_CALIBRATION.fall)
    expect(neutral.strength).toBe(0.5)
    expect(neutral.rawPythPct).toBe(0.5)

    // Dominant goal differential shrinks gently toward 0.500 early in the season
    // (with pre-ratio Gamma-Poisson goal shrinkage + post-ratio EB shrinkage)
    const earlyHot = computeWeightedStrength(20, 8, 4, BASH_CALIBRATION.fall)
    expect(earlyHot.rawPythPct).toBeGreaterThan(0.6)
    expect(earlyHot.strength).toBeLessThan(earlyHot.rawPythPct)
    expect(earlyHot.strength).toBeGreaterThan(0.55)

    // Shutout in 1 game (3-0) must NOT produce an extreme >0.85 rawPythPct thanks to pre-ratio prior
    const oneGameShutout = computeWeightedStrength(3, 0, 1, BASH_CALIBRATION.fall)
    expect(oneGameShutout.rawPythPct).toBeLessThan(0.7)
    expect(oneGameShutout.strength).toBeLessThan(0.6)

    // Symmetry & zero HFA in Log5
    expect(log5(0.5, 0.5)).toBe(0.5)
    expect(log5(0.65, 0.4) + log5(0.4, 0.65)).toBeCloseTo(1.0, 10)
  })
})

describe("Playoff Odds Engine — Official BASH Rule 213 Tiebreakers", () => {
  it("breaks ties in strict order: PTS -> ROW (excluding SO wins) -> H2H pts% -> GD -> GF", () => {
    // 4 teams all tied on 6 points:
    // Team 0: 2 Reg wins (ROW=2) -> should be #1
    // Team 1: 1 Reg + 1 OT + 1 RegL? Wait: 3+2+1=6 pts, ROW=2 (beats Team 0 on H2H!) -> let's test clearly!
    // Let's test 2-way ROW separating OT win from SO win:
    const pts = Int16Array.from([5, 5])
    const row = Int16Array.from([2, 1]) // Team 0: 1 RegW + 1 OTW (ROW=2); Team 1: 1 RegW + 1 SOW (ROW=1)
    const gd = Int16Array.from([1, 10]) // Team 1 has huge GD, should STILL lose on ROW!
    const gf = Int16Array.from([5, 20])
    const h2hPts = Int16Array.from([0, 0, 0, 0])
    const h2hGames = Int16Array.from([0, 0, 0, 0])
    const tiebreakRand = Float64Array.from([0.2, 0.8])

    const order = rankTeamsRule213(2, pts, row, gd, gf, h2hPts, h2hGames, tiebreakRand)
    expect(Array.from(order)).toEqual([0, 1])
  })

  it("resolves 2-way and 3-way H2H percentage of available points recursively", () => {
    // 3 teams tied at 9 PTS and 3 ROW:
    // H2H games among {0, 1, 2}:
    // Team 0 beat Team 1 (3-0) and beat Team 2 (3-0) -> 6/6 = 1.000 -> Seed 1
    // Team 1 lost to Team 0 (0-3) and beat Team 2 (2-1 OT) -> 2/6 = 0.333 -> Seed 2
    // Team 2 lost to Team 0 (0-3) and lost to Team 1 (1-2 OT) -> 1/6 = 0.167 -> Seed 3
    // Give Team 2 the best overall GD to prove H2H overrides GD!
    const T = 3
    const pts = Int16Array.from([9, 9, 9])
    const row = Int16Array.from([3, 3, 3])
    const gd = Int16Array.from([-2, 0, 15])
    const gf = Int16Array.from([10, 12, 30])
    const h2hPts = new Int16Array(T * T)
    const h2hGames = new Int16Array(T * T)

    // 0 beat 1 reg
    h2hPts[0 * T + 1] = 3; h2hPts[1 * T + 0] = 0; h2hGames[0 * T + 1] = 1; h2hGames[1 * T + 0] = 1
    // 0 beat 2 reg
    h2hPts[0 * T + 2] = 3; h2hPts[2 * T + 0] = 0; h2hGames[0 * T + 2] = 1; h2hGames[2 * T + 0] = 1
    // 1 beat 2 OT
    h2hPts[1 * T + 2] = 2; h2hPts[2 * T + 1] = 1; h2hGames[1 * T + 2] = 1; h2hGames[2 * T + 1] = 1

    const order = rankTeamsRule213(T, pts, row, gd, gf, h2hPts, h2hGames, Float64Array.from([0.1, 0.2, 0.3]))
    expect(Array.from(order)).toEqual([0, 1, 2])
  })

  it("falls through circular 3-way H2H ties to GD and recursively re-runs 2-way H2H when one team separates", () => {
    // Case A: Circular 3-way tie (all 3/6 = 0.500 H2H) falls through to GD (8 > 5 > 2)
    const T = 3
    const pts = Int16Array.from([9, 9, 9])
    const row = Int16Array.from([3, 3, 3])
    const gd = Int16Array.from([2, 8, 5])
    const gf = Int16Array.from([10, 10, 10])
    const h2hPts = new Int16Array(T * T)
    const h2hGames = new Int16Array(T * T)
    h2hPts[0 * T + 1] = 3; h2hGames[0 * T + 1] = 1; h2hGames[1 * T + 0] = 1
    h2hPts[1 * T + 2] = 3; h2hGames[1 * T + 2] = 1; h2hGames[2 * T + 1] = 1
    h2hPts[2 * T + 0] = 3; h2hGames[2 * T + 0] = 1; h2hGames[0 * T + 2] = 1

    const orderCircular = rankTeamsRule213(T, pts, row, gd, gf, h2hPts, h2hGames, Float64Array.from([0.9, 0.1, 0.5]))
    expect(Array.from(orderCircular)).toEqual([1, 2, 0])

    // Case B: True recursive 3-way -> 2-way narrowing!
    // Team 0 sweeps both 1 & 2 (6/6 = 1.0 -> #1).
    // Teams 1 & 2 play each other TWICE (1 wins reg 3-0, then 1 wins OT 2-1 -> wait: to tie in 3-way H2H,
    // let 0 beat 1 (3-0) and 0 beat 2 (2-1 OT -> 2 gets 1 pt!), and 1 beat 2 (2-1 OT -> 1 gets 2 pts, 2 gets 1 pt):
    // 3-way H2H totals: Team 0 = 5/6 (0.833) -> #1; Team 1 = 2/6 (0.333); Team 2 = 2/6 (0.333) -> TIED!
    // Recursive 2-way H2H between {1, 2}: Team 1 has 2/3 (0.667) vs Team 2 has 1/3 (0.333) -> Team 1 beats Team 2
    // EVEN THOUGH Team 2 has much higher GD (+20 vs -5)!
    const gdNarrow = Int16Array.from([0, -5, 20])
    const h2hPtsN = new Int16Array(T * T)
    const h2hGamesN = new Int16Array(T * T)
    // 0 beat 1 reg (3-0)
    h2hPtsN[0 * T + 1] = 3; h2hPtsN[1 * T + 0] = 0; h2hGamesN[0 * T + 1] = 1; h2hGamesN[1 * T + 0] = 1
    // 0 beat 2 OT (2-1)
    h2hPtsN[0 * T + 2] = 2; h2hPtsN[2 * T + 0] = 1; h2hGamesN[0 * T + 2] = 1; h2hGamesN[2 * T + 0] = 1
    // 1 beat 2 OT (2-1)
    h2hPtsN[1 * T + 2] = 2; h2hPtsN[2 * T + 1] = 1; h2hGamesN[1 * T + 2] = 1; h2hGamesN[2 * T + 1] = 1

    const orderNarrow = rankTeamsRule213(T, pts, row, gdNarrow, gf, h2hPtsN, h2hGamesN, Float64Array.from([0.1, 0.2, 0.9]))
    expect(Array.from(orderNarrow)).toEqual([0, 1, 2])
  })

  it("handles forfeits and double forfeits accurately per Rule 208", () => {
    const games: PlayoffSimGame[] = [
      // Single forfeit: team A wins 5-0 (3 pts, +5 GD, ROW +1)
      makeGame({ id: "g1", date: "2026-10-10", awaySlug: "a", homeSlug: "b", awayScore: 5, homeScore: 0, status: "final", isForfeit: true }),
      // Double forfeit: 0-0 with isForfeit=true -> both get 0 pts, 0-5 loss (ga += 5, gd -= 5)
      makeGame({ id: "g2", date: "2026-10-17", awaySlug: "c", homeSlug: "d", awayScore: 0, homeScore: 0, status: "final", isForfeit: true }),
      // Regular game so C and D aren't identical
      makeGame({ id: "g3", date: "2026-10-24", awaySlug: "a", homeSlug: "c", awayScore: 4, homeScore: 2, status: "final" }),
      makeGame({ id: "g4", date: "2026-10-24", awaySlug: "b", homeSlug: "d", awayScore: 3, homeScore: 2, status: "final", isOvertime: true, hasShootout: true }),
    ]

    const snap = computePlayoffOdds({
      seasonId: "test-forfeit",
      seasonName: "Test Forfeit",
      seasonType: "fall",
      seasonStatus: "completed",
      configuredPlayoffTeams: 2,
      games,
      mode: "weighted",
      iterations: 1000,
    })

    const bySlug = Object.fromEntries(snap.teams.map((t) => [t.slug, t]))
    expect(bySlug.a.pts).toBe(6)
    expect(bySlug.a.gd).toBe(7) // +5 forfeit +2 reg
    expect(bySlug.a.row).toBe(2)

    expect(bySlug.b.pts).toBe(2) // SOW
    expect(bySlug.b.sow).toBe(1)
    expect(bySlug.b.row).toBe(0) // Shootout win does NOT count toward ROW!

    expect(bySlug.c.pts).toBe(0)
    expect(bySlug.c.l).toBe(2)
    expect(bySlug.c.ga).toBe(9) // 5 from double forfeit + 4 from reg
    expect(bySlug.c.gd).toBe(-7)

    expect(bySlug.d.pts).toBe(1) // SOL
    expect(bySlug.d.ga).toBe(8) // 5 from double forfeit + 3 from SO
  })
})

describe("Playoff Odds Engine — Monte Carlo Invariants, Big Games & Tail Probing", () => {
  const teams7 = ["kings", "yetis", "red-army", "rink-rats", "landsharks", "seals", "haze"]
  const midSeasonGames = buildSyntheticSeason(teams7, 2, 7) // 21 final, 21 upcoming across 7 teams

  it("conserves probabilities (sum of Playoff % = spots*100; every seed col = 100%) and is deterministic", () => {
    for (const mode of ["weighted", "50_50", "classic"] as const) {
      const snap1 = computePlayoffOdds({
        seasonId: "test-7",
        seasonName: "Test 7-Team Fall",
        seasonType: "fall",
        seasonStatus: "active",
        configuredPlayoffTeams: 5,
        games: midSeasonGames,
        mode,
        iterations: 20_000,
      })
      const snap2 = computePlayoffOdds({
        seasonId: "test-7",
        seasonName: "Test 7-Team Fall",
        seasonType: "fall",
        seasonStatus: "active",
        configuredPlayoffTeams: 5,
        games: midSeasonGames,
        mode,
        iterations: 20_000,
      })

      // Bit-identical determinism
      expect(snap1.stateHash).toBe(snap2.stateHash)
      expect(snap1.teams.map((t) => t.playoffPct)).toEqual(snap2.teams.map((t) => t.playoffPct))
      expect(snap1.teams.map((t) => t.seedPcts)).toEqual(snap2.teams.map((t) => t.seedPcts))

      // Sum of Playoff % = 5 * 100 = 500
      const playoffSum = snap1.teams.reduce((s, t) => s + t.playoffPct, 0)
      expect(playoffSum).toBeCloseTo(500, 0)

      // Every seed column sums to 100%
      for (let seedIdx = 0; seedIdx < 7; seedIdx++) {
        const colSum = snap1.teams.reduce((s, t) => s + t.seedPcts[seedIdx], 0)
        expect(colSum).toBeCloseTo(100, 0)
      }

      // Every team's own seed percentages sum to 100%
      for (const team of snap1.teams) {
        const rowSum = team.seedPcts.reduce((s, p) => s + p, 0)
        expect(rowSum).toBeCloseTo(100, 0)
        // Playoff % equals sum of top 5 seed percentages
        const top5 = team.seedPcts.slice(0, 5).reduce((s, p) => s + p, 0)
        expect(team.playoffPct).toBeCloseTo(top5, 0)
      }
    }
  })

  it("satisfies Law of Total Probability in Single-Pass Big Games and keeps tail probing isolated", () => {
    const snap = computePlayoffOdds({
      seasonId: "test-bg",
      seasonName: "Test Big Games",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 5,
      games: midSeasonGames,
      mode: "weighted",
      iterations: 25_000,
    })

    expect(snap.bigGames.length).toBeGreaterThan(0)
    // Sorted descending by totalPlayoffSwing
    for (let i = 1; i < snap.bigGames.length; i++) {
      expect(snap.bigGames[i - 1].totalPlayoffSwing).toBeGreaterThanOrEqual(
        snap.bigGames[i].totalPlayoffSwing - 0.001
      )
    }

    // Law of total probability: sum_o (count(o)/N * P(in|o)) == P(in)
    for (const bg of snap.bigGames) {
      const totalSamples =
        bg.outcomeSampleCounts.away_reg +
        bg.outcomeSampleCounts.away_ot +
        bg.outcomeSampleCounts.home_ot +
        bg.outcomeSampleCounts.home_reg
      expect(totalSamples).toBe(25_000)

      for (const aff of bg.affectedTeams) {
        const reconstructed =
          (bg.outcomeSampleCounts.away_reg * aff.outcomes.away_reg.playoffPct +
            bg.outcomeSampleCounts.away_ot * aff.outcomes.away_ot.playoffPct +
            bg.outcomeSampleCounts.home_ot * aff.outcomes.home_ot.playoffPct +
            bg.outcomeSampleCounts.home_reg * aff.outcomes.home_reg.playoffPct) /
          totalSamples
        expect(reconstructed).toBeCloseTo(aff.currentPlayoffPct, 0)
      }
    }

    // Verify tail-probe isolation: running without tail probing must yield IDENTICAL main probabilities
    const snapNoTail = computePlayoffOdds({
      seasonId: "test-bg",
      seasonName: "Test Big Games",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 5,
      games: midSeasonGames,
      mode: "weighted",
      iterations: 25_000,
      includeTailProbes: false,
    })
    expect(snap.teams.map((t) => t.playoffPct)).toEqual(snapNoTail.teams.map((t) => t.playoffPct))
    expect(snap.teams.map((t) => t.seedPcts)).toEqual(snapNoTail.teams.map((t) => t.seedPcts))
  })

  it("verifies mathematical clinches & eliminations without false positives", () => {
    // 4 teams, top 2 qualify. 1 game remaining each:
    // A: 12 pts, B: 9 pts, C: 2 pts, D: 1 pt -> A & B strictly clinched, C & D strictly eliminated!
    const games: PlayoffSimGame[] = [
      makeGame({ id: "g1", date: "2026-10-10", awaySlug: "a", homeSlug: "c", awayScore: 5, homeScore: 1, status: "final" }),
      makeGame({ id: "g2", date: "2026-10-10", awaySlug: "b", homeSlug: "d", awayScore: 4, homeScore: 1, status: "final" }),
      makeGame({ id: "g3", date: "2026-10-17", awaySlug: "a", homeSlug: "d", awayScore: 5, homeScore: 0, status: "final" }),
      makeGame({ id: "g4", date: "2026-10-17", awaySlug: "b", homeSlug: "c", awayScore: 4, homeScore: 2, status: "final" }),
      makeGame({ id: "g5", date: "2026-10-24", awaySlug: "a", homeSlug: "b", awayScore: 3, homeScore: 1, status: "final" }),
      makeGame({ id: "g6", date: "2026-10-24", awaySlug: "c", homeSlug: "d", awayScore: 3, homeScore: 2, status: "final", isOvertime: true }),
      makeGame({ id: "g7", date: "2026-10-31", awaySlug: "a", homeSlug: "c", awayScore: 4, homeScore: 0, status: "final" }),
      makeGame({ id: "g8", date: "2026-10-31", awaySlug: "b", homeSlug: "d", awayScore: 3, homeScore: 0, status: "final" }),
      // 2 upcoming games:
      makeGame({ id: "g9", date: "2026-11-07", awaySlug: "a", homeSlug: "b", status: "upcoming" }),
      makeGame({ id: "g10", date: "2026-11-07", awaySlug: "c", homeSlug: "d", status: "upcoming" }),
    ]

    const snap = computePlayoffOdds({
      seasonId: "test-clinch",
      seasonName: "Test Clinch",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 2,
      games,
      mode: "weighted",
      iterations: 5_000,
    })

    const bySlug = Object.fromEntries(snap.teams.map((t) => [t.slug, t]))
    expect(bySlug.a.clinched).toBe(true)
    expect(bySlug.a.eliminated).toBe(false)
    expect(bySlug.b.clinched).toBe(true)
    expect(bySlug.c.eliminated).toBe(true)
    expect(bySlug.d.eliminated).toBe(true)

    // Edge case 1: Two completely deadlocked finished teams (Draw Lots ~50/50) while another game remains
    // must NOT be falsely marked clinched/eliminated by alphabetical slug order!
    const drawLotsGames: PlayoffSimGame[] = [
      // a & b each finish 1-1 with identical 3 pts, 1 ROW, 0 GD, 4 GF and split H2H 1-1 (3-1 each)
      makeGame({ id: "d1", date: "2026-10-10", awaySlug: "a", homeSlug: "b", awayScore: 3, homeScore: 1, status: "final" }),
      makeGame({ id: "d2", date: "2026-10-17", awaySlug: "b", homeSlug: "a", awayScore: 3, homeScore: 1, status: "final" }),
      // c & d have 1 upcoming game left; c already has 6 pts (clinched #1), d has 0 pts (eliminated #4)
      makeGame({ id: "d3", date: "2026-10-10", awaySlug: "c", homeSlug: "d", awayScore: 5, homeScore: 0, status: "final" }),
      makeGame({ id: "d4", date: "2026-10-17", awaySlug: "c", homeSlug: "d", awayScore: 5, homeScore: 0, status: "final" }),
      makeGame({ id: "d5", date: "2026-10-24", awaySlug: "c", homeSlug: "d", status: "upcoming" }),
    ]
    const drawSnap = computePlayoffOdds({
      seasonId: "test-draw-lots",
      seasonName: "Draw Lots",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 2,
      games: drawLotsGames,
      mode: "50_50",
      iterations: 4_000,
      includeTimeline: false,
    })
    const drawBySlug = Object.fromEntries(drawSnap.teams.map((t) => [t.slug, t]))
    expect(drawBySlug.c.clinched).toBe(true)
    expect(drawBySlug.a.clinched).toBe(false)
    expect(drawBySlug.a.eliminated).toBe(false)
    expect(drawBySlug.b.clinched).toBe(false)
    expect(drawBySlug.b.eliminated).toBe(false)
    expect(drawBySlug.a.playoffPct).toBeGreaterThan(45)
    expect(drawBySlug.a.playoffPct).toBeLessThan(55)

    // Same Draw-Lots deadlock when 0 games remain (e.g., final unrelated game locked in What-If or finished)
    // must STILL assign exact 50/50 odds and NOT falsely mark alphabetical winner as clinched/eliminated!
    const drawZeroRemSnap = computePlayoffOdds({
      seasonId: "test-draw-lots-zero",
      seasonName: "Draw Lots Zero Rem",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 2,
      games: drawLotsGames,
      mode: "50_50",
      iterations: 2_000,
      includeTimeline: false,
      lockedOutcomes: { d5: "away_reg" },
    })
    const drawZeroBySlug = Object.fromEntries(drawZeroRemSnap.teams.map((t) => [t.slug, t]))
    expect(drawZeroBySlug.c.clinched).toBe(true)
    expect(drawZeroBySlug.d.eliminated).toBe(true)
    expect(drawZeroBySlug.a.clinched).toBe(false)
    expect(drawZeroBySlug.a.eliminated).toBe(false)
    expect(drawZeroBySlug.b.clinched).toBe(false)
    expect(drawZeroBySlug.b.eliminated).toBe(false)
    // The locked result's margin is simulated (it could matter for GD tiebreaks), so a/b odds come
    // from Monte Carlo rather than the zero-remaining exact path: symmetric within MC error.
    expect(Math.abs(drawZeroBySlug.a.playoffPct - 50)).toBeLessThan(4)
    expect(Math.abs(drawZeroBySlug.a.playoffPct + drawZeroBySlug.b.playoffPct - 100)).toBeLessThan(0.2)

    // Edge case 2: Subset point-pool clinch where 2 rivals individually have maxPts >= tMinPts
    // (spots = 2, contenders = {b, c} -> length 2 >= 2), BUT b & c play EACH OTHER in the only
    // remaining game so at most ONE of them can reach tMinPts! Thus team `a` is strictly clinched.
    const poolGames: PlayoffSimGame[] = [
      makeGame({ id: "p1", date: "2026-10-10", awaySlug: "a", homeSlug: "b", awayScore: 4, homeScore: 1, status: "final" }),
      makeGame({ id: "p2", date: "2026-10-10", awaySlug: "a", homeSlug: "c", awayScore: 4, homeScore: 1, status: "final" }),
      makeGame({ id: "p3", date: "2026-10-17", awaySlug: "b", homeSlug: "c", awayScore: 3, homeScore: 1, status: "final" }),
      makeGame({ id: "p4", date: "2026-10-17", awaySlug: "c", homeSlug: "b", awayScore: 3, homeScore: 1, status: "final" }),
      // a = 6 pts (0 rem), b = 3 pts (1 rem vs c), c = 3 pts (1 rem vs b):
      // neededPts for {b, c} to both reach 6 = (6-3)+(6-3) = 6, but 1 shared game yields only 3 pts!
      makeGame({ id: "p5", date: "2026-10-24", awaySlug: "b", homeSlug: "c", status: "upcoming" }),
    ]
    const poolSnap = computePlayoffOdds({
      seasonId: "test-pool",
      seasonName: "Pool Clinch",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 2,
      games: poolGames,
      mode: "50_50",
      iterations: 2_000,
      includeTimeline: false,
    })
    const poolBySlug = Object.fromEntries(poolSnap.teams.map((t) => [t.slug, t]))
    expect(poolBySlug.a.clinched).toBe(true)
    expect(poolBySlug.a.playoffPct).toBe(100)
  })

  it("orders same-day doubleheaders chronologically by time and caps gamesInHand at gamesRemaining", () => {
    const doubleheaderGames: PlayoffSimGame[] = [
      // Note IDs intentionally reverse time order ("g10" < "g9" lexicographically!)
      makeGame({ id: "g10", date: "2026-10-10", time: "1:00pm", awaySlug: "a", homeSlug: "b", awayScore: 5, homeScore: 1, status: "final" }),
      makeGame({ id: "g9", date: "2026-10-10", time: "9:00am", awaySlug: "a", homeSlug: "c", awayScore: 2, homeScore: 4, status: "final" }),
      makeGame({ id: "g20", date: "2026-10-17", time: "1:00pm", awaySlug: "b", homeSlug: "a", status: "upcoming" }),
      makeGame({ id: "g3", date: "2026-10-17", time: "9:00am", awaySlug: "c", homeSlug: "a", status: "upcoming" }),
    ]
    const snap = computePlayoffOdds({
      seasonId: "test-dh",
      seasonName: "Doubleheader",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 2,
      games: doubleheaderGames,
      mode: "weighted",
      iterations: 1_000,
      includeTimeline: false,
    })
    const teamA = snap.teams.find((t) => t.slug === "a")!
    // Last game must be the 1:00pm game (g10), NOT 9:00am (g9)
    expect(teamA.lastGame?.gameId).toBe("g10")
    // Next game must be the 9:00am game (g3), NOT 1:00pm (g20)
    expect(teamA.nextGame?.gameId).toBe("g3")

    // On a completed early-ended season with unequal GP, finished teams must have 0 gamesInHand
    const earlySnap = computePlayoffOdds({
      seasonId: "test-early-gih",
      seasonName: "Early End",
      seasonType: "fall",
      seasonStatus: "completed",
      configuredPlayoffTeams: 2,
      games: doubleheaderGames,
      mode: "weighted",
      iterations: 1_000,
      includeTimeline: false,
    })
    expect(earlySnap.endedEarly).toBe(true)
    expect(earlySnap.teams.every((t) => t.gamesInHand === 0)).toBe(true)
  })

  it("keeps team strengths stable under What-If lockedOutcomes (zero strength drift)", () => {
    const firstUpcoming = midSeasonGames.find((g) => g.status === "upcoming")!
    const base = computePlayoffOdds({
      seasonId: "test-whatif",
      seasonName: "Test What-If",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 5,
      games: midSeasonGames,
      mode: "weighted",
      iterations: 10_000,
      includeTimeline: false,
    })

    const locked = computePlayoffOdds({
      seasonId: "test-whatif",
      seasonName: "Test What-If",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 5,
      games: midSeasonGames,
      mode: "weighted",
      iterations: 10_000,
      includeTimeline: false,
      lockedOutcomes: { [firstUpcoming.id]: "away_reg" },
    })

    expect(locked.gamesPlayed).toBe(base.gamesPlayed + 1)
    expect(locked.gamesRemaining).toBe(base.gamesRemaining - 1)
    const baseAway = base.teams.find((t) => t.slug === firstUpcoming.awaySlug)!
    const lockedAway = locked.teams.find((t) => t.slug === firstUpcoming.awaySlug)!
    expect(lockedAway.pts).toBe(baseAway.pts + 3)
    // Underlying strength, luck, and lastGame must stay anchored to real completed games (zero What-If leakage)
    expect(lockedAway.strength).toBe(baseAway.strength)
    expect(lockedAway.actualPtsPct).toBe(baseAway.actualPtsPct)
    expect(lockedAway.luckDelta).toBe(baseAway.luckDelta)
    expect(lockedAway.lastGame).toEqual(baseAway.lastGame)
  })

  it("handles edge cases: 0 GP pre-season, completed season, truncated season, and Summer all-in", () => {
    // 1. Pre-season (0 GP)
    const preSeasonGames = buildSyntheticSeason(["a", "b", "c", "d", "e", "f"], 1, 0)
    const preSnap = computePlayoffOdds({
      seasonId: "pre",
      seasonName: "Preseason",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 4,
      games: preSeasonGames,
      mode: "weighted",
      iterations: 10_000,
    })
    expect(preSnap.gamesPlayed).toBe(0)
    expect(preSnap.teams.every((t) => t.strength === 0.5)).toBe(true)
    expect(preSnap.teams.every((t) => t.playoffPct > 55 && t.playoffPct < 78)).toBe(true)

    // 2. Completed season
    const doneGames = buildSyntheticSeason(["a", "b", "c", "d"], 1, 10)
    const doneSnap = computePlayoffOdds({
      seasonId: "done",
      seasonName: "Completed",
      seasonType: "fall",
      seasonStatus: "completed",
      configuredPlayoffTeams: 2,
      games: doneGames,
      mode: "weighted",
      iterations: 5_000,
    })
    expect(doneSnap.gamesRemaining).toBe(0)
    expect(doneSnap.bigGames).toHaveLength(0)
    expect(doneSnap.teams.filter((t) => t.clinched)).toHaveLength(2)
    expect(doneSnap.teams.filter((t) => t.eliminated)).toHaveLength(2)
    expect(doneSnap.timeline.length).toBeGreaterThan(1)

    // 3. Truncated completed season (like 2019-2020 COVID cutoff)
    const covidGames = buildSyntheticSeason(["a", "b", "c", "d"], 2, 2)
    const covidSnap = computePlayoffOdds({
      seasonId: "2019-2020",
      seasonName: "2019-2020",
      seasonType: "fall",
      seasonStatus: "completed",
      configuredPlayoffTeams: 2,
      games: covidGames,
      mode: "weighted",
      iterations: 5_000,
    })
    expect(covidSnap.endedEarly).toBe(true)
    expect(covidSnap.bigGames).toHaveLength(0)

    // 4. Summer all-teams-qualify
    const summerGames = buildSyntheticSeason(["a", "b", "c", "d", "e"], 2, 2)
    const summerSnap = computePlayoffOdds({
      seasonId: "2026-summer",
      seasonName: "2026 Summer",
      seasonType: "summer",
      seasonStatus: "active",
      configuredPlayoffTeams: 5,
      games: summerGames,
      mode: "weighted",
      iterations: 10_000,
    })
    expect(summerSnap.format.allTeamsQualify).toBe(true)
    expect(summerSnap.teams.every((t) => t.playoffPct === 100 && t.clinched)).toBe(true)
    expect(summerSnap.bigGames.length).toBeGreaterThan(0)
    for (let i = 1; i < summerSnap.bigGames.length; i++) {
      expect(summerSnap.bigGames[i - 1].totalSeedSwing).toBeGreaterThanOrEqual(
        summerSnap.bigGames[i].totalSeedSwing - 0.001
      )
    }
  })

  it("verifies exact max-flow clinch on the 7-team 5-spot counterexample where simple pool checks leak", () => {
    // 7 teams, 5 playoff spots:
    // t0, t1, t2 each have 36 pts (12 wins); t3 has 0 pts; t4 has 24 pts (8 wins);
    // t5 & t6 each have 21 pts (7 wins). Remaining games: (t0,t1), (t2,t3), (t5,t6).
    // Only 1 of {t5, t6} can reach 24 pts (since they play each other), so at most 4 rivals
    // {t0, t1, t2, winner(t5,t6)} can reach t4's 24 pts -> t4 MUST be mathematically clinched!
    const games: PlayoffSimGame[] = []
    let gid = 1
    const addWins = (winner: string, loser: string, count: number) => {
      for (let i = 0; i < count; i++) {
        games.push(
          makeGame({
            id: `mf-${gid++}`,
            date: "2026-10-10",
            awaySlug: winner,
            homeSlug: loser,
            awayScore: 4,
            homeScore: 1,
            status: "final",
          })
        )
      }
    }
    addWins("t0", "t3", 12) // t0=36
    addWins("t1", "t3", 12) // t1=36
    addWins("t2", "t3", 12) // t2=36
    addWins("t4", "t3", 8)  // t4=24
    addWins("t5", "t3", 7)  // t5=21
    addWins("t6", "t3", 7)  // t6=21
    games.push(
      makeGame({ id: "mf-u1", date: "2026-10-24", awaySlug: "t0", homeSlug: "t1", status: "upcoming" }),
      makeGame({ id: "mf-u2", date: "2026-10-24", awaySlug: "t2", homeSlug: "t3", status: "upcoming" }),
      makeGame({ id: "mf-u3", date: "2026-10-24", awaySlug: "t5", homeSlug: "t6", status: "upcoming" })
    )
    const snap = computePlayoffOdds({
      seasonId: "test-maxflow-7t",
      seasonName: "MaxFlow 7T",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 5,
      games,
      mode: "50_50",
      iterations: 2_000,
      includeTimeline: false,
    })
    const bySlug = Object.fromEntries(snap.teams.map((t) => [t.slug, t]))
    expect(bySlug.t0.clinched).toBe(true)
    expect(bySlug.t1.clinched).toBe(true)
    expect(bySlug.t2.clinched).toBe(true)
    expect(bySlug.t4.clinched).toBe(true)
    expect(bySlug.t3.eliminated).toBe(true)
    expect(bySlug.t5.clinched).toBe(false)
    expect(bySlug.t6.clinched).toBe(false)
  })

  it("handles historical non-forfeit ties cleanly (1 pt each, 0 ROW, resultLabel 'T') and strips SOWG from PythagenPuck", () => {
    const games: PlayoffSimGame[] = [
      // Historical tie 3-3
      makeGame({
        id: "tie-1",
        date: "2026-10-10",
        awaySlug: "a",
        homeSlug: "b",
        awayScore: 3,
        homeScore: 3,
        status: "final",
      }),
      // Shootout win 4-3 (SOWG stripped -> 3 GF / 3 GA each for PythagenPuck!)
      makeGame({
        id: "so-1",
        date: "2026-10-10",
        awaySlug: "c",
        homeSlug: "d",
        awayScore: 4,
        homeScore: 3,
        hasShootout: true,
        status: "final",
      }),
      makeGame({ id: "u-1", date: "2026-10-17", awaySlug: "a", homeSlug: "c", status: "upcoming" }),
      makeGame({ id: "u-2", date: "2026-10-17", awaySlug: "b", homeSlug: "d", status: "upcoming" }),
    ]
    const snap = computePlayoffOdds({
      seasonId: "test-ties-sowg",
      seasonName: "Ties & SOWG",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 2,
      games,
      mode: "weighted",
      iterations: 2_000,
      includeTimeline: false,
    })
    const bySlug = Object.fromEntries(snap.teams.map((t) => [t.slug, t]))
    // Non-forfeit tie: 1 pt each, 1 tie, 0 ROW, resultLabel "T"
    expect(bySlug.a.pts).toBe(1)
    expect(bySlug.b.pts).toBe(1)
    expect(bySlug.a.ties).toBe(1)
    expect(bySlug.b.ties).toBe(1)
    expect(bySlug.a.row).toBe(0)
    expect(bySlug.b.row).toBe(0)
    expect(bySlug.a.lastGame?.resultLabel).toBe("T")
    expect(bySlug.b.lastGame?.resultLabel).toBe("T")

    // Shootout winning goal stripped: c & d both have 3 non-SOWG GF and 3 GA -> identical 0.500 strength!
    expect(bySlug.c.strength).toBeCloseTo(0.5, 4)
    expect(bySlug.d.strength).toBeCloseTo(0.5, 4)
    expect(bySlug.c.row).toBe(0) // Shootout win does NOT count as ROW
    expect(bySlug.c.pts).toBe(2)
    expect(bySlug.d.pts).toBe(1)
  })

  it("falls through disconnected 4-team H2H graphs to GD and shares RPI ranks on ties", () => {
    // 4 teams all tied on 6 pts, 2 ROW; only (0 vs 1) and (2 vs 3) have played (disconnected graph!).
    // Team 3 has best GD (+10) -> must win seed #1 instead of being distorted by intra-pair H2H.
    const pts = Int16Array.from([6, 6, 6, 6])
    const row = Int16Array.from([2, 2, 2, 2])
    const gd = Int16Array.from([2, 1, 5, 10])
    const gf = Int16Array.from([10, 9, 12, 18])
    const h2hPts = new Int16Array(16)
    const h2hPoss = new Int16Array(16)
    // 0 beat 1 (3-0), 2 beat 3 (3-0), no cross-games between {0,1} and {2,3}
    h2hPts[0 * 4 + 1] = 3
    h2hPoss[0 * 4 + 1] = 3
    h2hPoss[1 * 4 + 0] = 3
    h2hPts[2 * 4 + 3] = 3
    h2hPoss[2 * 4 + 3] = 3
    h2hPoss[3 * 4 + 2] = 3

    const order = rankTeamsRule213(
      4,
      pts,
      row,
      gd,
      gf,
      h2hPts,
      h2hPoss,
      Float64Array.from([0.5, 0.5, 0.5, 0.5])
    )
    expect(Array.from(order)).toEqual([3, 2, 0, 1])

    // Competition ranking for tied RPIs (all 4 teams at 0 GP have identical 0.500 RPI -> all rank 1)
    const zeroGames = buildSyntheticSeason(["a", "b", "c", "d"], 1, 0)
    const snap = computePlayoffOdds({
      seasonId: "test-rpi-ties",
      seasonName: "RPI Ties",
      seasonType: "fall",
      seasonStatus: "active",
      configuredPlayoffTeams: 2,
      games: zeroGames,
      mode: "50_50",
      iterations: 1_000,
      includeTimeline: false,
    })
    expect(snap.teams.every((t) => t.rpiRank === 1)).toBe(true)
  })
})
