import { describe, expect, it } from "vitest"
import { compareSkaterStats, compareGoalieStats } from "@/lib/stats-sort"
import type { SkaterStat, GoalieStat } from "@/lib/fetch-player-stats"

const skater = (id: number, name: string, values: Partial<SkaterStat> = {}): SkaterStat => ({
  id, name, team: "A", teamSlug: "a", gp: 10, goals: 2, assists: 6, points: 8,
  ptsPg: "0.80", gwg: 0, ppg: 0, shg: 0, eng: 0, hatTricks: 0, pen: 0, pim: 0, ...values,
})
const goalie = (id: number, name: string, values: Partial<GoalieStat> = {}): GoalieStat => ({
  id, name, team: "A", teamSlug: "a", gp: 10, seconds: 1200, goalsAgainst: 10,
  shotsAgainst: 100, saves: 90, savePercentage: .9, gaa: 1, wins: 5, losses: 2,
  shutouts: 0, goalieAssists: 0, ...values,
})

describe("cross-platform stats ordering", () => {
  it("uses NHL summary tiebreakers for points and ID for other columns", () => {
    const players = [skater(1, "Alice"), skater(3, "Bob", { goals: 5 }), skater(2, "Bob", { goals: 5 })]
    for (const key of ["points", "gp"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        expect(players.toSorted((a, b) => compareSkaterStats(a, b, key, dir)).map(p => p.id)).toEqual(key === "points" ? [2, 3, 1] : [1, 2, 3])
      }
    }
  })
  it("sorts full-precision points per game, handling zero games", () => {
    const players = [skater(4, "Aaron", { gp: 200, points: 201, ptsPg: "1.01" }), skater(5, "Zoe", { gp: 199, points: 200, ptsPg: "1.01" }), skater(6, "Zero", { gp: 0 })]
    expect(players.toSorted((a, b) => compareSkaterStats(a, b, "ptsPg", "desc")).map(p => p.id)).toEqual([5, 4, 6])
    expect(players.toSorted((a, b) => compareSkaterStats(a, b, "ptsPg", "asc")).map(p => p.id)).toEqual([6, 4, 5])
  })
  it("breaks goalie ties by ID and supports ascending GAA", () => {
    const players = [goalie(3, "Bob"), goalie(2, "Alice"), goalie(1, "Alice"), goalie(4, "Zoe", { gaa: .5, savePercentage: .95 })]
    expect(players.toSorted((a, b) => compareGoalieStats(a, b, "gaa", "asc")).map(p => p.id)).toEqual([4, 1, 2, 3])
    expect(players.toSorted((a, b) => compareGoalieStats(a, b, "savePercentage", "desc")).map(p => p.id)).toEqual([4, 1, 2, 3])
  })
  it("uses save percentage to break goalie wins ties, never alphabetical order", () => {
    const players = [goalie(1, "Zoe"), goalie(2, "Alice"), goalie(3, "Bob", { savePercentage: .95 })]
    expect(players.toSorted((a, b) => compareGoalieStats(a, b, "wins", "desc")).map(p => p.id)).toEqual([3, 1, 2])
    expect(players.toSorted((a, b) => compareGoalieStats(a, b, "gp", "desc")).map(p => p.id)).toEqual([1, 2, 3])
  })

})
