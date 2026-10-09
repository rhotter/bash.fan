import { describe, it, expect } from "vitest"
import {
  generateRoundRobin,
  computeScheduleEquity,
  rebalanceUpcomingGames,
  getDefaultTimeForSlot,
  type GeneratedGame,
} from "@/lib/schedule-utils"

describe("Round-Robin Schedule Generator & Equity", () => {
  it("generates perfectly balanced home/away and intra-day game slots for 7 teams, 3 cycles (18 games)", () => {
    const numTeams = 7
    const gamesPerWeek = 3
    const cycles = 3
    const slots = generateRoundRobin(numTeams, gamesPerWeek, cycles)

    expect(slots.length).toBe(63) // 21 weeks * 3 games = 63 games

    const homeCounts = new Array(numTeams).fill(0)
    const awayCounts = new Array(numTeams).fill(0)
    const gameSlotCounts = Array.from({ length: numTeams }, () => [0, 0, 0])
    const h2hMeetings: Record<string, { uHome: number; vHome: number }> = {}

    slots.forEach((s) => {
      const slotInDay = s.slotInDay ?? 0

      homeCounts[s.home]++
      awayCounts[s.away]++
      gameSlotCounts[s.home][slotInDay]++
      gameSlotCounts[s.away][slotInDay]++

      const u = Math.min(s.home, s.away)
      const v = Math.max(s.home, s.away)
      const key = `${u}-${v}`
      if (!h2hMeetings[key]) h2hMeetings[key] = { uHome: 0, vHome: 0 }
      if (s.home === u) h2hMeetings[key].uHome++
      else h2hMeetings[key].vHome++
    })

    // 1. Every single team has EXACTLY 9 Home and 9 Away games
    for (let t = 0; t < numTeams; t++) {
      expect(homeCounts[t]).toBe(9)
      expect(awayCounts[t]).toBe(9)
    }

    // 2. Intra-day game slots (Game 1, Game 2, Game 3) are perfectly balanced (6-6-6)
    for (let t = 0; t < numTeams; t++) {
      expect(gameSlotCounts[t]).toEqual([6, 6, 6])
    }

    // 3. Head-to-head pairs meet 3 times: 2-1 or 1-2, never 3-0
    for (const [, counts] of Object.entries(h2hMeetings)) {
      expect(counts.uHome + counts.vHome).toBe(3)
      expect(Math.abs(counts.uHome - counts.vHome)).toBe(1)
    }

    // 4. Max streak of consecutive home or away games is minimized (<= 3)
    for (let t = 0; t < numTeams; t++) {
      const teamGames = slots
        .filter((s) => s.home === t || s.away === t)
        .sort((a, b) => a.round - b.round)

      let streak = 1
      let maxStreak = 1
      for (let i = 1; i < teamGames.length; i++) {
        const prevHome = teamGames[i - 1].home === t
        const curHome = teamGames[i].home === t
        if (prevHome === curHome) {
          streak++
          if (streak > maxStreak) maxStreak = streak
        } else {
          streak = 1
        }
      }
      expect(maxStreak).toBeLessThanOrEqual(3)
    }
  })

  it("balances 8 teams with 4 games per day (2 cycles = 14 games)", () => {
    const numTeams = 8
    const gamesPerDay = 4
    const cycles = 2
    const slots = generateRoundRobin(numTeams, gamesPerDay, cycles)

    expect(slots.length).toBe(56) // 14 rounds * 4 games = 56 games

    const homeCounts = new Array(numTeams).fill(0)
    const awayCounts = new Array(numTeams).fill(0)
    const slotCounts = Array.from({ length: numTeams }, () => [0, 0, 0, 0])

    slots.forEach((s) => {
      const slot = s.slotInDay ?? 0
      homeCounts[s.home]++
      awayCounts[s.away]++
      slotCounts[s.home][slot]++
      slotCounts[s.away][slot]++
    })

    // 1. Exactly 7 Home and 7 Away for all 8 teams
    for (let t = 0; t < numTeams; t++) {
      expect(homeCounts[t]).toBe(7)
      expect(awayCounts[t]).toBe(7)
    }

    // 2. Intra-day game slots (Game 1, Game 2, Game 3, Game 4) are equitable (spread <= 1)
    for (let t = 0; t < numTeams; t++) {
      const max = Math.max(...slotCounts[t])
      const min = Math.min(...slotCounts[t])
      expect(max - min).toBeLessThanOrEqual(1)
    }
  })

  it("balances 4 teams with 2 games per day (summer league, 2 cycles = 6 games)", () => {
    const numTeams = 4
    const gamesPerDay = 2
    const cycles = 2
    const slots = generateRoundRobin(numTeams, gamesPerDay, cycles)

    expect(slots.length).toBe(12) // 6 rounds * 2 games = 12 games

    const homeCounts = new Array(numTeams).fill(0)
    const awayCounts = new Array(numTeams).fill(0)
    const slotCounts = Array.from({ length: numTeams }, () => [0, 0])

    slots.forEach((s) => {
      const slot = s.slotInDay ?? 0
      homeCounts[s.home]++
      awayCounts[s.away]++
      slotCounts[s.home][slot]++
      slotCounts[s.away][slot]++
    })

    // 1. Exactly 3 Home and 3 Away
    for (let t = 0; t < numTeams; t++) {
      expect(homeCounts[t]).toBe(3)
      expect(awayCounts[t]).toBe(3)
    }

    // 2. Exactly 3 times Game 1 and 3 times Game 2 (spread = 0)
    for (let t = 0; t < numTeams; t++) {
      expect(slotCounts[t]).toEqual([3, 3])
    }
  })

  it("balances home and away for even team counts (6 teams, 2 cycles = 10 games)", () => {
    const slots = generateRoundRobin(6, 3, 2)
    const homeCounts = new Array(6).fill(0)
    const awayCounts = new Array(6).fill(0)

    slots.forEach((s) => {
      homeCounts[s.home]++
      awayCounts[s.away]++
    })

    // Each team plays 10 games -> exactly 5 Home and 5 Away
    for (let t = 0; t < 6; t++) {
      expect(homeCounts[t]).toBe(5)
      expect(awayCounts[t]).toBe(5)
    }
  })

  it("handles odd game counts with difference <= 1", () => {
    // 4 teams, 1 cycle = 3 games per team
    const slots = generateRoundRobin(4, 2, 1)
    const homeCounts = new Array(4).fill(0)
    const awayCounts = new Array(4).fill(0)

    slots.forEach((s) => {
      homeCounts[s.home]++
      awayCounts[s.away]++
    })

    for (let t = 0; t < 4; t++) {
      expect(Math.abs(homeCounts[t] - awayCounts[t])).toBeLessThanOrEqual(1)
    }
  })

  it("computeScheduleEquity reports accurate intra-day game slot metrics", () => {
    const teams = [
      { teamSlug: "yetis", teamName: "Yetis" },
      { teamSlug: "seals", teamName: "Seals" },
      { teamSlug: "reign", teamName: "Reign" },
      { teamSlug: "rats", teamName: "Rink Rats" },
    ]

    const fakeGames: GeneratedGame[] = [
      { date: "2026-05-03", time: "09:00", homeTeam: "yetis", awayTeam: "seals", location: "The Lick", gameType: "regular", status: "upcoming", gameNumberInDay: 1 },
      { date: "2026-05-03", time: "11:00", homeTeam: "reign", awayTeam: "rats", location: "The Lick", gameType: "regular", status: "upcoming", gameNumberInDay: 2 },
      { date: "2026-05-10", time: "09:00", homeTeam: "seals", awayTeam: "yetis", location: "The Lick", gameType: "regular", status: "upcoming", gameNumberInDay: 1 },
      { date: "2026-05-10", time: "11:00", homeTeam: "rats", awayTeam: "reign", location: "The Lick", gameType: "regular", status: "upcoming", gameNumberInDay: 2 },
    ]

    const report = computeScheduleEquity(fakeGames, teams, 2)
    expect(report.isHomeAwayEquitable).toBe(true)
    expect(report.isGameSlotsEquitable).toBe(true)
    expect(report.numGameSlotsPerDay).toBe(2)
    expect(report.slotLabels).toHaveLength(2)
    expect(report.slotLabels[0].label).toBe("Game 1")
    expect(report.slotLabels[1].label).toBe("Game 2")
    expect(report.teams).toHaveLength(4)
    expect(report.teams[0].homeGames).toBe(1)
    expect(report.teams[0].awayGames).toBe(1)
    expect(report.teams[0].gameSlots[1]).toBe(2)
  })

  it("rebalanceUpcomingGames compensates for prior season imbalances", () => {
    // Simulate past games where Reign was away 4 times and home 0 times
    const games = [
      { id: "1", homeTeam: "yetis", awayTeam: "reign", status: "final" },
      { id: "2", homeTeam: "seals", awayTeam: "reign", status: "final" },
      { id: "3", homeTeam: "rats", awayTeam: "reign", status: "final" },
      { id: "4", homeTeam: "yetis", awayTeam: "seals", status: "final" },
      // Upcoming games
      { id: "5", homeTeam: "reign", awayTeam: "yetis", status: "upcoming" },
      { id: "6", homeTeam: "reign", awayTeam: "seals", status: "upcoming" },
      { id: "7", homeTeam: "reign", awayTeam: "rats", status: "upcoming" },
      { id: "8", homeTeam: "seals", awayTeam: "yetis", status: "upcoming" },
    ]

    const rebalanced = rebalanceUpcomingGames(games)

    // Finals should not change
    expect(rebalanced[0].homeTeam).toBe("yetis")
    expect(rebalanced[0].awayTeam).toBe("reign")

    // In upcoming games, Reign should now be home to compensate
    const reignHomeUpcoming = rebalanced.filter(
      (g) => g.status === "upcoming" && g.homeTeam === "reign"
    ).length
    expect(reignHomeUpcoming).toBe(3)
  })

  it("getDefaultTimeForSlot returns correct defaults for 4, 3, and 2 games per day", () => {
    // 4 games per day: 8:00, 10:00, 12:00, 2:00 (08:00, 10:00, 12:00, 14:00)
    expect(getDefaultTimeForSlot(0, 4)).toBe("08:00")
    expect(getDefaultTimeForSlot(1, 4)).toBe("10:00")
    expect(getDefaultTimeForSlot(2, 4)).toBe("12:00")
    expect(getDefaultTimeForSlot(3, 4)).toBe("14:00")

    // 3 games per day: 9:00, 11:00, 1:00 (09:00, 11:00, 13:00)
    expect(getDefaultTimeForSlot(0, 3)).toBe("09:00")
    expect(getDefaultTimeForSlot(1, 3)).toBe("11:00")
    expect(getDefaultTimeForSlot(2, 3)).toBe("13:00")

    // 2 games per day: 10:00, 12:00
    expect(getDefaultTimeForSlot(0, 2)).toBe("10:00")
    expect(getDefaultTimeForSlot(1, 2)).toBe("12:00")
  })

  it("generates perfectly balanced schedule with pinned Week 1", () => {
    const numTeams = 7
    const gamesPerWeek = 3
    const cycles = 3
    const pinnedSlots = [
      { round: 1, home: 1, away: 6, slotInDay: 0 },
      { round: 1, home: 5, away: 2, slotInDay: 1 },
      { round: 1, home: 3, away: 4, slotInDay: 2 },
    ]
    const slots = generateRoundRobin(numTeams, gamesPerWeek, cycles, undefined, pinnedSlots)

    const week1 = slots.filter((s) => s.round === 1)
    expect(week1).toHaveLength(3)

    // Verify Week 1 matches are preserved exactly
    expect(week1[0]).toMatchObject({ round: 1, home: 1, away: 6, slotInDay: 0 })
    expect(week1[1]).toMatchObject({ round: 1, home: 5, away: 2, slotInDay: 1 })
    expect(week1[2]).toMatchObject({ round: 1, home: 3, away: 4, slotInDay: 2 })

    // Verify overall equity across all 7 teams: exactly 9H/9A and 6-6-6 slots
    const homeCounts = new Array(numTeams).fill(0)
    const awayCounts = new Array(numTeams).fill(0)
    const gameSlotCounts = Array.from({ length: numTeams }, () => [0, 0, 0])

    slots.forEach((s) => {
      homeCounts[s.home]++
      awayCounts[s.away]++
      gameSlotCounts[s.home][s.slotInDay ?? 0]++
      gameSlotCounts[s.away][s.slotInDay ?? 0]++
    })

    for (let t = 0; t < numTeams; t++) {
      expect(homeCounts[t]).toBe(9)
      expect(awayCounts[t]).toBe(9)
      expect(gameSlotCounts[t]).toEqual([6, 6, 6])
    }
  })

  it("rebalanceUpcomingGames preserves tbd placeholder games without overwriting them", () => {
    const games = [
      { id: "g1", homeTeam: "team-a", awayTeam: "team-b", status: "final" },
      { id: "g2", homeTeam: "tbd", awayTeam: "team-a", status: "upcoming" },
      { id: "g3", homeTeam: "team-c", awayTeam: "tbd", status: "upcoming" },
      { id: "g4", homeTeam: "team-b", awayTeam: "team-c", status: "upcoming" },
    ]
    const rebalanced = rebalanceUpcomingGames(games)

    // Verify tbd placeholders are untouched
    expect(rebalanced[1].homeTeam).toBe("tbd")
    expect(rebalanced[1].awayTeam).toBe("team-a")
    expect(rebalanced[2].homeTeam).toBe("team-c")
    expect(rebalanced[2].awayTeam).toBe("tbd")
  })

  it("generateRoundRobin maintains slotInDay ordering when pinnedSlots are passed out of order", () => {
    const numTeams = 7
    const gamesPerWeek = 3
    const cycles = 3
    // Pass pinned slots intentionally out of order
    const pinnedSlots = [
      { round: 1, home: 3, away: 4, slotInDay: 2 },
      { round: 1, home: 1, away: 6, slotInDay: 0 },
      { round: 1, home: 5, away: 2, slotInDay: 1 },
    ]
    const slots = generateRoundRobin(numTeams, gamesPerWeek, cycles, undefined, pinnedSlots)
    const week1 = slots.filter((s) => s.round === 1)

    expect(week1[0].slotInDay).toBe(0)
    expect(week1[1].slotInDay).toBe(1)
    expect(week1[2].slotInDay).toBe(2)
  })

  it("rebalanceUpcomingGames maintains head-to-head pair equity with prior completed games", () => {
    // team-a was home against team-b in final game
    // There are 2 upcoming games between team-a and team-b (total 3 games)
    // Head-to-head fairness requires |home(a) - home(b)| <= 1 (i.e. 2-1 or 1-2, not 3-0)
    const games = [
      { id: "g1", homeTeam: "team-a", awayTeam: "team-b", status: "final" },
      { id: "g2", homeTeam: "team-a", awayTeam: "team-b", status: "upcoming" },
      { id: "g3", homeTeam: "team-a", awayTeam: "team-b", status: "upcoming" },
    ]
    const rebalanced = rebalanceUpcomingGames(games)

    let aHome = 0
    let bHome = 0
    for (const g of rebalanced) {
      if (g.homeTeam === "team-a") aHome++
      if (g.homeTeam === "team-b") bHome++
    }
    // Out of 3 total games, team-a cannot be home all 3 times
    expect(Math.abs(aHome - bHome)).toBeLessThanOrEqual(1)
  })

  it("rebalanceUpcomingGames never corrupts matchups into self-play (home === away)", () => {
    const games = [
      { id: "g1", homeTeam: "team-a", awayTeam: "team-b", status: "final" },
      { id: "g2", homeTeam: "team-b", awayTeam: "team-c", status: "upcoming" },
      { id: "g3", homeTeam: "team-c", awayTeam: "team-d", status: "upcoming" },
      { id: "g4", homeTeam: "team-d", awayTeam: "team-a", status: "upcoming" },
    ]
    const rebalanced = rebalanceUpcomingGames(games)
    for (const g of rebalanced) {
      expect(g.homeTeam).not.toBe(g.awayTeam)
    }
  })
})

