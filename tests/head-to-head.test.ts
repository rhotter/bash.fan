import { describe, expect, it } from "vitest"
import {
  computeHeadToHead,
  parseGameTimeMinutes,
  compareGamesChronological,
  formatGameDate,
  getStreakSortScore,
} from "@/lib/head-to-head"
import { computeStandings } from "@/lib/standings"
import type { BashGame } from "@/app/api/bash/route"

function createMockGame(overrides: Partial<BashGame>): BashGame {
  return {
    id: "g1",
    date: "2026-10-12",
    time: "8:00 PM",
    homeTeam: "Seals",
    homeSlug: "seals",
    awayTeam: "Reign",
    awaySlug: "reign",
    homeScore: 5,
    awayScore: 3,
    status: "final",
    isOvertime: false,
    isPlayoff: false,
    isForfeit: false,
    location: "Silver Creek",
    hasBoxscore: true,
    hasLiveStats: false,
    livePeriod: null,
    liveClockSeconds: null,
    liveClockRunning: null,
    liveClockStartedAt: null,
    gameType: "regular",
    hasShootout: false,
    homePlaceholder: null,
    awayPlaceholder: null,
    seriesId: null,
    seriesGameNumber: null,
    bracketRound: null,
    ...overrides,
  }
}

describe("Head-to-Head helper functions", () => {
  it("formats dates safely without UTC day shift including ISO timestamps", () => {
    expect(formatGameDate("2026-10-12")).toBe("Oct 12")
    expect(formatGameDate("2026-01-05")).toBe("Jan 5")
    expect(formatGameDate("2026-10-12T00:00:00.000Z")).toBe("Oct 12")
    expect(formatGameDate("invalid")).toBe("invalid")
    expect(formatGameDate("")).toBe("")
  })

  it("parses game time strings to minutes correctly with or without minutes", () => {
    expect(parseGameTimeMinutes("8:00 PM")).toBe(20 * 60)
    expect(parseGameTimeMinutes("8:00:00 PM")).toBe(20 * 60)
    expect(parseGameTimeMinutes("8:00p")).toBe(20 * 60)
    expect(parseGameTimeMinutes("8 PM")).toBe(20 * 60)
    expect(parseGameTimeMinutes("8pm")).toBe(20 * 60)
    expect(parseGameTimeMinutes("9:15 AM")).toBe(9 * 60 + 15)
    expect(parseGameTimeMinutes("9:15a")).toBe(9 * 60 + 15)
    expect(parseGameTimeMinutes("12:00 PM")).toBe(12 * 60)
    expect(parseGameTimeMinutes("12:00 AM")).toBe(0)
    expect(parseGameTimeMinutes("TBD")).toBe(23 * 60 + 59)
    expect(parseGameTimeMinutes(" tbd ")).toBe(23 * 60 + 59)
    expect(parseGameTimeMinutes("TBA")).toBe(23 * 60 + 59)
    expect(parseGameTimeMinutes("")).toBe(23 * 60 + 59)
    expect(parseGameTimeMinutes(null)).toBe(23 * 60 + 59)
    expect(parseGameTimeMinutes("unknown")).toBe(23 * 60 + 59)
  })

  it("scores streaks numerically for correct sports ranking", () => {
    expect(getStreakSortScore("W10")).toBeGreaterThan(getStreakSortScore("W2"))
    expect(getStreakSortScore("W2")).toBeGreaterThan(getStreakSortScore("W1"))
    expect(getStreakSortScore("W1")).toBeGreaterThan(getStreakSortScore("OTW1"))
    expect(getStreakSortScore("OTW1")).toBeGreaterThan(getStreakSortScore("—"))
    expect(getStreakSortScore("—")).toBe(0)
    expect(getStreakSortScore("—")).toBeGreaterThan(getStreakSortScore("OTL1"))
    expect(getStreakSortScore("OTL1")).toBeGreaterThan(getStreakSortScore("L1"))
    expect(getStreakSortScore("L1")).toBeGreaterThan(getStreakSortScore("L5"))
  })

  it("chronologically orders games by date, then time, then id", () => {
    const g1 = { date: "2026-10-12", time: "8:00 PM", id: "g1" }
    const g2 = { date: "2026-10-12", time: "9:00 PM", id: "g2" }
    const g3 = { date: "2026-10-13", time: "7:00 PM", id: "g3" }
    const gTbd = { date: "2026-10-12", time: "TBD", id: "g4" }

    expect(compareGamesChronological(g1, g2)).toBeLessThan(0)
    expect(compareGamesChronological(g2, g3)).toBeLessThan(0)
    expect(compareGamesChronological(g2, gTbd)).toBeLessThan(0)
  })
})

describe("computeHeadToHead calculations", () => {
  it("calculates regulation wins (3 pts) and regulation losses (0 pts)", () => {
    const games = [
      createMockGame({
        id: "g1",
        homeSlug: "seals",
        awaySlug: "reign",
        homeScore: 5,
        awayScore: 2,
        status: "final",
        isOvertime: false,
      }),
    ]

    const sealsH2h = computeHeadToHead(games, "seals")
    expect(sealsH2h).not.toBeNull()
    const vsReign = sealsH2h!.opponents.find((o) => o.opponentSlug === "reign")!
    expect(vsReign.gp).toBe(1)
    expect(vsReign.w).toBe(1)
    expect(vsReign.otw).toBe(0)
    expect(vsReign.otl).toBe(0)
    expect(vsReign.l).toBe(0)
    expect(vsReign.pts).toBe(3)
    expect(vsReign.gf).toBe(5)
    expect(vsReign.ga).toBe(2)
    expect(vsReign.gd).toBe(3)
    expect(vsReign.streak).toBe("W1")
  })

  it("calculates overtime wins (2 pts) and overtime losses (1 pt)", () => {
    const games = [
      createMockGame({
        id: "g1",
        homeSlug: "seals",
        awaySlug: "reign",
        homeScore: 4,
        awayScore: 3,
        status: "final",
        isOvertime: true,
      }),
    ]

    const sealsH2h = computeHeadToHead(games, "seals")!
    const sealsVsReign = sealsH2h.opponents.find((o) => o.opponentSlug === "reign")!
    expect(sealsVsReign.w).toBe(0)
    expect(sealsVsReign.otw).toBe(1)
    expect(sealsVsReign.otl).toBe(0)
    expect(sealsVsReign.l).toBe(0)
    expect(sealsVsReign.pts).toBe(2)

    const reignH2h = computeHeadToHead(games, "reign")!
    const reignVsSeals = reignH2h.opponents.find((o) => o.opponentSlug === "seals")!
    expect(reignVsSeals.w).toBe(0)
    expect(reignVsSeals.otw).toBe(0)
    expect(reignVsSeals.otl).toBe(1)
    expect(reignVsSeals.l).toBe(0)
    expect(reignVsSeals.pts).toBe(1)
  })

  it("calculates shootout wins and losses as overtime wins and losses", () => {
    const games = [
      createMockGame({
        id: "g1",
        homeSlug: "seals",
        awaySlug: "reign",
        homeScore: 2,
        awayScore: 3,
        status: "final",
        isOvertime: false,
        hasShootout: true,
      }),
    ]

    const sealsH2h = computeHeadToHead(games, "seals")!
    const vsReign = sealsH2h.opponents.find((o) => o.opponentSlug === "reign")!
    expect(vsReign.otl).toBe(1)
    expect(vsReign.pts).toBe(1)

    const reignH2h = computeHeadToHead(games, "reign")!
    const vsSeals = reignH2h.opponents.find((o) => o.opponentSlug === "seals")!
    expect(vsSeals.otw).toBe(1)
    expect(vsSeals.pts).toBe(2)
  })

  it("verifies inverse symmetry between Team A and Team B (3-0-0-1 vs 1-0-0-3 with +6 / -6 GD)", () => {
    // Team A (Seals) plays Team B (Reign) 4 times:
    // Game 1: Seals 5, Reign 2 (Seals W)
    // Game 2: Reign 1, Seals 3 (Seals W)
    // Game 3: Seals 4, Reign 1 (Seals W)
    // Game 4: Seals 2, Reign 4 (Reign W)
    // Total Seals GF = 5 + 3 + 4 + 2 = 14, GA = 2 + 1 + 1 + 4 = 8 => GD = +6
    // Total Reign GF = 8, GA = 14 => GD = -6
    const games = [
      createMockGame({ id: "g1", date: "2026-10-01", homeSlug: "seals", awaySlug: "reign", homeScore: 5, awayScore: 2 }),
      createMockGame({ id: "g2", date: "2026-10-08", homeSlug: "reign", awaySlug: "seals", homeScore: 1, awayScore: 3 }),
      createMockGame({ id: "g3", date: "2026-10-15", homeSlug: "seals", awaySlug: "reign", homeScore: 4, awayScore: 1 }),
      createMockGame({ id: "g4", date: "2026-10-22", homeSlug: "seals", awaySlug: "reign", homeScore: 2, awayScore: 4 }),
    ]

    const sealsH2h = computeHeadToHead(games, "seals")!
    const reignH2h = computeHeadToHead(games, "reign")!

    const sealsVsReign = sealsH2h.opponents.find((o) => o.opponentSlug === "reign")!
    const reignVsSeals = reignH2h.opponents.find((o) => o.opponentSlug === "seals")!

    expect(sealsVsReign.gp).toBe(4)
    expect(reignVsSeals.gp).toBe(4)

    // Seals: 3-0-0-1
    expect(sealsVsReign.w).toBe(3)
    expect(sealsVsReign.otw).toBe(0)
    expect(sealsVsReign.otl).toBe(0)
    expect(sealsVsReign.l).toBe(1)
    expect(sealsVsReign.pts).toBe(9)
    expect(sealsVsReign.gf).toBe(14)
    expect(sealsVsReign.ga).toBe(8)
    expect(sealsVsReign.gd).toBe(6)

    // Reign: 1-0-0-3
    expect(reignVsSeals.w).toBe(1)
    expect(reignVsSeals.otw).toBe(0)
    expect(reignVsSeals.otl).toBe(0)
    expect(reignVsSeals.l).toBe(3)
    expect(reignVsSeals.pts).toBe(3)
    expect(reignVsSeals.gf).toBe(8)
    expect(reignVsSeals.ga).toBe(14)
    expect(reignVsSeals.gd).toBe(-6)

    // Exact inverse symmetry checks
    expect(sealsVsReign.w).toBe(reignVsSeals.l)
    expect(sealsVsReign.l).toBe(reignVsSeals.w)
    expect(sealsVsReign.gf).toBe(reignVsSeals.ga)
    expect(sealsVsReign.ga).toBe(reignVsSeals.gf)
    expect(sealsVsReign.gd).toBe(-reignVsSeals.gd)
    expect(sealsVsReign.pts + reignVsSeals.pts).toBe(3 * 4) // 3 pts per completed game
  })

  it("calculates streaks accurately across regulation and overtime results", () => {
    // Matchup with consecutive wins including OT win
    const games = [
      createMockGame({ id: "g1", date: "2026-10-01", homeSlug: "seals", awaySlug: "reign", homeScore: 3, awayScore: 1 }),
      createMockGame({ id: "g2", date: "2026-10-08", homeSlug: "reign", awaySlug: "seals", homeScore: 2, awayScore: 3, isOvertime: true }),
    ]

    const sealsH2h = computeHeadToHead(games, "seals")!
    const sealsVsReign = sealsH2h.opponents.find((o) => o.opponentSlug === "reign")!
    expect(sealsVsReign.streak).toBe("W2")

    const reignH2h = computeHeadToHead(games, "reign")!
    const reignVsSeals = reignH2h.opponents.find((o) => o.opponentSlug === "seals")!
    expect(reignVsSeals.streak).toBe("OTL1")

    // If Reign loses the next game in regulation
    const gamesWithL = [
      ...games,
      createMockGame({ id: "g3", date: "2026-10-15", homeSlug: "seals", awaySlug: "reign", homeScore: 4, awayScore: 1 }),
    ]
    const reignH2hAfterL = computeHeadToHead(gamesWithL, "reign")!
    expect(reignH2hAfterL.opponents.find((o) => o.opponentSlug === "seals")!.streak).toBe("L1")
  })

  it("handles 0-GP matchups cleanly with — streak and 0 stats", () => {
    const teams = [
      { slug: "seals", name: "Seals" },
      { slug: "reign", name: "Reign" },
      { slug: "yetis", name: "Yetis" },
    ]
    // Seals have only played Reign; Yetis have not played Seals
    const games = [
      createMockGame({ id: "g1", homeSlug: "seals", awaySlug: "reign", homeScore: 3, awayScore: 2 }),
    ]

    const sealsH2h = computeHeadToHead(games, "seals", teams)!
    const vsYetis = sealsH2h.opponents.find((o) => o.opponentSlug === "yetis")!
    expect(vsYetis).toBeDefined()
    expect(vsYetis.gp).toBe(0)
    expect(vsYetis.w).toBe(0)
    expect(vsYetis.otw).toBe(0)
    expect(vsYetis.otl).toBe(0)
    expect(vsYetis.l).toBe(0)
    expect(vsYetis.pts).toBe(0)
    expect(vsYetis.gf).toBe(0)
    expect(vsYetis.ga).toBe(0)
    expect(vsYetis.gd).toBe(0)
    expect(vsYetis.streak).toBe("—")
    expect(vsYetis.games).toHaveLength(0)
  })

  it("includes upcoming and live games in game breakdown without inflating GP or stats", () => {
    const games = [
      createMockGame({ id: "g1", date: "2026-10-01", homeSlug: "seals", awaySlug: "reign", homeScore: 4, awayScore: 2, status: "final" }),
      createMockGame({ id: "g2", date: "2026-10-08", homeSlug: "seals", awaySlug: "reign", homeScore: 1, awayScore: 1, status: "live" }),
      createMockGame({ id: "g3", date: "2026-10-15", homeSlug: "reign", awaySlug: "seals", homeScore: null, awayScore: null, status: "upcoming" }),
    ]

    const sealsH2h = computeHeadToHead(games, "seals")!
    const vsReign = sealsH2h.opponents.find((o) => o.opponentSlug === "reign")!

    // Only 1 completed game
    expect(vsReign.gp).toBe(1)
    expect(vsReign.pts).toBe(3)
    expect(vsReign.gf).toBe(4)
    expect(vsReign.ga).toBe(2)

    // But all 3 games appear in the season series breakdown
    expect(vsReign.games).toHaveLength(3)
    expect(vsReign.games[0].result).toBe("W")
    expect(vsReign.games[1].result).toBe("LIVE")
    expect(vsReign.games[2].result).toBe("UPCOMING")
  })

  it("marks final games with unrecorded/null scores as FINAL result rather than UPCOMING", () => {
    const games = [
      createMockGame({ id: "g1", date: "2026-10-01", homeSlug: "seals", awaySlug: "reign", homeScore: null, awayScore: null, status: "final" }),
    ]

    const sealsH2h = computeHeadToHead(games, "seals")!
    const vsReign = sealsH2h.opponents.find((o) => o.opponentSlug === "reign")!
    expect(vsReign.gp).toBe(0) // Does not inflate GP
    expect(vsReign.games).toHaveLength(1)
    expect(vsReign.games[0].status).toBe("final")
    expect(vsReign.games[0].result).toBe("FINAL")
  })

  it("filters out playoff games and legacy teams", () => {
    const games = [
      createMockGame({ id: "g1", homeSlug: "seals", awaySlug: "reign", homeScore: 3, awayScore: 1, isPlayoff: false, gameType: "regular" }),
      // Playoff game should be ignored
      createMockGame({ id: "g2", homeSlug: "seals", awaySlug: "reign", homeScore: 10, awayScore: 0, isPlayoff: true, gameType: "playoff" }),
      // Legacy team game should be ignored
      createMockGame({ id: "g3", homeSlug: "seals", awaySlug: "seed-1", homeScore: 5, awayScore: 0, isPlayoff: false, gameType: "regular" }),
      createMockGame({ id: "g4", homeSlug: "tbd", awaySlug: "reign", homeScore: 2, awayScore: 2, isPlayoff: false, gameType: "regular" }),
    ]

    const sealsH2h = computeHeadToHead(games, "seals")!
    expect(sealsH2h.opponents).toHaveLength(1) // only Reign, no seed-1 or tbd
    const vsReign = sealsH2h.opponents[0]
    expect(vsReign.gp).toBe(1)
    expect(vsReign.gf).toBe(3) // does NOT include 10 from playoff game
  })

  it("aggregates overall regular-season summary totals across all opponents", () => {
    const games = [
      createMockGame({ id: "g1", homeSlug: "seals", awaySlug: "reign", homeScore: 4, awayScore: 1, status: "final" }),
      createMockGame({ id: "g2", homeSlug: "seals", awaySlug: "yetis", homeScore: 3, awayScore: 2, status: "final", isOvertime: true }),
      createMockGame({ id: "g3", homeSlug: "loons", awaySlug: "seals", homeScore: 4, awayScore: 2, status: "final" }),
    ]

    const sealsH2h = computeHeadToHead(games, "seals")!
    const summary = sealsH2h.summary

    expect(summary.gp).toBe(3)
    expect(summary.w).toBe(1)
    expect(summary.otw).toBe(1)
    expect(summary.otl).toBe(0)
    expect(summary.l).toBe(1)
    expect(summary.pts).toBe(5) // 3 + 2 = 5
    expect(summary.gf).toBe(9) // 4 + 3 + 2 = 9
    expect(summary.ga).toBe(7) // 1 + 2 + 4 = 7
    expect(summary.gd).toBe(2) // 9 - 7 = 2
  })

  it("maintains 100% mathematical parity with computeStandings even when games involve legacy team slugs", () => {
    const games = [
      createMockGame({ id: "g1", homeSlug: "seals", awaySlug: "reign", homeScore: 4, awayScore: 1, status: "final" }),
      createMockGame({ id: "g2", homeSlug: "seals", awaySlug: "yetis", homeScore: 3, awayScore: 2, status: "final", isOvertime: true }),
      createMockGame({ id: "g3", homeSlug: "loons", awaySlug: "seals", homeScore: 4, awayScore: 2, status: "final" }),
      // Legacy game that should not count in standings or head-to-head
      createMockGame({ id: "g4", homeSlug: "seals", awaySlug: "seed-1", homeScore: 10, awayScore: 0, status: "final" }),
      createMockGame({ id: "g5", homeSlug: "tbd", awaySlug: "seals", homeScore: 2, awayScore: 5, status: "final" }),
    ]

    const standings = computeStandings(games)
    const sealsStanding = standings.find((s) => s.slug === "seals")!

    const sealsH2h = computeHeadToHead(games, "seals")!
    const summary = sealsH2h.summary

    expect(summary.gp).toBe(sealsStanding.gp)
    expect(summary.w).toBe(sealsStanding.w)
    expect(summary.otw).toBe(sealsStanding.otw)
    expect(summary.otl).toBe(sealsStanding.otl)
    expect(summary.l).toBe(sealsStanding.l)
    expect(summary.pts).toBe(sealsStanding.pts)
    expect(summary.gf).toBe(sealsStanding.gf)
    expect(summary.ga).toBe(sealsStanding.ga)
    expect(summary.gd).toBe(sealsStanding.gd)
  })
})
