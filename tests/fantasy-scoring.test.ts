import { describe, expect, it } from "vitest"
import { DEFAULT_FANTASY_CONFIG as config } from "@/lib/fantasy/config"
import {
  countUses,
  goalieOptions,
  playersOnBye,
  pointsPerGame,
  rankByPoints,
  remainingUses,
  scoreWeek,
  validateLineup,
  type Lineup,
  type ScoredWeek,
  type WeekGame,
  type WeekStats,
} from "@/lib/fantasy/scoring"

const allUses = (weeks: ScoredWeek[]) => {
  const { skater, goalie } = countUses(weeks)
  return new Map([...skater, ...goalie])
}

const noStats: WeekStats = { skater: [], goalie: [] }
const final = (id: string, extra: Partial<WeekGame> = {}): WeekGame => ({
  id,
  status: "final",
  isForfeit: false,
  hasBoxscore: true,
  ...extra,
})
const skater = (playerId: number, gameId = "g1", extra = {}) => ({
  playerId,
  gameId,
  goals: 0,
  assists: 0,
  ppg: 0,
  shg: 0,
  pim: 0,
  isSub: false,
  ...extra,
})
const goalie = (playerId: number, gameId = "g1", extra = {}) => ({
  playerId,
  gameId,
  saves: 0,
  goalsAgainst: 0,
  shutouts: 0,
  result: null as string | null,
  isSub: false,
  ...extra,
})
const lineup = (extra: Partial<Lineup> = {}): Lineup => ({
  skaters: [1, 2, 3],
  goalies: [10],
  skaterBackups: [],
  goalieBackups: [],
  ...extra,
})
const score = (l: Lineup, stats: WeekStats, games = [final("g1")]) =>
  scoreWeek(l, stats, games, config)

describe("scoreWeek points", () => {
  it("applies the skater weights, including PIM as a positive", () => {
    const week = score(lineup(), {
      skater: [skater(1, "g1", { goals: 2, assists: 1, ppg: 1, shg: 1, pim: 4 })],
      goalie: [],
    })
    // 20 goals + 3 assist + 2 PPG + 3 SHG + 8 PIM
    expect(week.selections.find((s) => s.playerId === 1)?.points).toBe(36)
  })

  it("applies the goalie weights", () => {
    const week = score(lineup(), {
      skater: [],
      goalie: [goalie(10, "g1", { saves: 30, goalsAgainst: 2, shutouts: 1, result: "W" })],
    })
    // 30 saves - 6 goals against + 5 win + 10 shutout
    expect(week.selections.find((s) => s.playerId === 10)?.points).toBe(39)
  })

  it("counts only goalie stats for a Player in the goalie slot", () => {
    const week = score(lineup(), {
      skater: [skater(10, "g1", { goals: 2 })],
      goalie: [goalie(10, "g1", { saves: 5 })],
    })
    expect(week.selections.find((s) => s.playerId === 10)?.points).toBe(5)
  })

  it("treats a Player in the goalie slot who only skated as absent", () => {
    const week = score(lineup({ goalieBackups: [11] }), {
      skater: [skater(1), skater(2), skater(3), skater(10, "g1", { goals: 2 })],
      goalie: [goalie(11, "g1", { saves: 20 })],
    })
    expect(week.selections.find((s) => s.playerId === 10)).toMatchObject({
      outcome: "absent",
      points: 0,
    })
    expect(week.points).toBe(20)
    expect(allUses([week]).has(10)).toBe(false)
  })

  it("adds up both games for a Selection who plays two, for one use", () => {
    const week = score(
      lineup(),
      {
        skater: [skater(1, "g1", { goals: 1 }), skater(1, "g2", { assists: 1 })],
        goalie: [],
      },
      [final("g1"), final("g2")]
    )
    expect(week.selections.find((s) => s.playerId === 1)?.points).toBe(13)
    expect(allUses([week]).get(1)).toBe(1)
  })

})

describe("scoreWeek Backups", () => {
  it("scores 0 and costs no use for an absent starter with no Backup", () => {
    const week = score(lineup(), { skater: [skater(2), skater(3)], goalie: [goalie(10)] })
    expect(week.selections.find((s) => s.playerId === 1)).toMatchObject({
      outcome: "absent",
      points: 0,
    })
    expect(allUses([week]).has(1)).toBe(false)
  })

  it("covers only one of two absent starters per Backup", () => {
    const week = score(lineup({ skaterBackups: [4] }), {
      skater: [skater(3), skater(4, "g1", { goals: 1 })],
      goalie: [goalie(10)],
    })
    expect(week.points).toBe(10)
    expect([...allUses([week]).keys()].sort((a, b) => a - b)).toEqual([3, 4, 10])
  })

  it("keeps Backups to their own kind", () => {
    const week = score(lineup({ goalieBackups: [11] }), {
      skater: [skater(2), skater(3)],
      goalie: [goalie(10), goalie(11, "g1", { saves: 20 })],
    })
    expect(week.points).toBe(0)
    expect(allUses([week]).has(11)).toBe(false)
  })

  it("brings in the goalie Backup for an absent goalie", () => {
    const week = score(lineup({ goalieBackups: [11] }), {
      skater: [skater(1), skater(2), skater(3)],
      goalie: [goalie(11, "g1", { saves: 20 })],
    })
    expect(week.points).toBe(20)
    expect(allUses([week]).get(11)).toBe(1)
    expect(allUses([week]).has(10)).toBe(false)
  })

  it("gives nothing and charges nothing for an unneeded Backup", () => {
    const week = score(lineup({ skaterBackups: [4] }), {
      skater: [skater(1), skater(2), skater(3), skater(4, "g1", { goals: 3 })],
      goalie: [goalie(10)],
    })
    expect(week.points).toBe(0)
    expect(week.selections.find((s) => s.playerId === 4)?.outcome).toBe("unused")
    expect(allUses([week]).has(4)).toBe(false)
  })

  it("does not fill an empty goalie slot from the goalie Backup", () => {
    const week = score(lineup({ goalies: [], goalieBackups: [11] }), {
      skater: [],
      goalie: [goalie(11, "g1", { saves: 20 })],
    })
    expect(week.points).toBe(0)
  })

  it("charges a starter who played with zero stats", () => {
    const week = score(lineup(), { skater: [skater(1)], goalie: [] })
    expect(week.selections.find((s) => s.playerId === 1)?.outcome).toBe("played")
    expect(allUses([week]).get(1)).toBe(1)
  })
})

describe("scoreWeek provisional and void games", () => {
  it("treats a final game with no boxscore as not yet scored, not absent", () => {
    const week = score(
      lineup({ skaterBackups: [4] }),
      { skater: [skater(4, "g1", { goals: 1 })], goalie: [] },
      [final("g1"), final("g2", { hasBoxscore: false })]
    )
    expect(week.provisional).toBe(true)
    expect(week.points).toBe(0)
    expect(week.selections.find((s) => s.playerId === 1)?.outcome).toBe("pending")
    expect(allUses([week]).size).toBe(0)
  })

  it("still scores a Selection already seen while another game is pending", () => {
    const week = score(lineup(), { skater: [skater(1, "g1", { goals: 1 })], goalie: [] }, [
      final("g1"),
      final("g2", { status: "upcoming", hasBoxscore: false }),
    ])
    expect(week.provisional).toBe(true)
    expect(week.points).toBe(10)
  })

  it("gives no Player scoring for a forfeit, and refunds the use", () => {
    const week = score(
      lineup(),
      { skater: [skater(1, "g1", { goals: 3 })], goalie: [] },
      [final("g1", { isForfeit: true })]
    )
    expect(week.provisional).toBe(false)
    expect(week.points).toBe(0)
    expect(allUses([week]).has(1)).toBe(false)
  })

  it("treats a forfeit as void, not pending, even without a boxscore", () => {
    const week = score(lineup(), noStats, [final("g1", { isForfeit: true, hasBoxscore: false })])
    expect(week.provisional).toBe(false)
  })
})

describe("countUses", () => {
  it("counts a Player's skater and goalie uses separately", () => {
    const games = [final("g1")]
    const asSkater = scoreWeek(lineup({ skaters: [1, 2, 3], goalies: [10] }), { skater: [skater(1)], goalie: [] }, games, config)
    const asGoalie = scoreWeek(lineup({ skaters: [2, 3, 4], goalies: [1] }), { skater: [], goalie: [goalie(1)] }, games, config)

    const uses = countUses([asSkater, asGoalie])

    expect(uses.skater.get(1)).toBe(1)
    expect(uses.goalie.get(1)).toBe(1)
  })

  it("changes with the stats, so a correction refunds the use", () => {
    const before = score(lineup(), { skater: [skater(1)], goalie: [] })
    const after = score(lineup(), noStats)
    expect(allUses([before]).get(1)).toBe(1)
    expect(allUses([after]).has(1)).toBe(false)
  })
})

describe("remainingUses", () => {
  it("applies the cap of the slot, and null with no cap", () => {
    const uses = new Map([[1, 1]])
    expect(remainingUses([1], "skater", uses, config).get(1)).toBe(2)
    expect(remainingUses([1], "goalie", uses, config).get(1)).toBe(3)
    const uncapped = { ...config, usageCap: { skater: null, goalie: 4 } }
    expect(remainingUses([1], "skater", uses, uncapped).get(1)).toBeNull()
  })
})

describe("goalieOptions", () => {
  const roster = [1, 2, 3].map((playerId) => ({ playerId, isGoalie: false }))

  it("defaults to Players who have played goal", () => {
    expect(goalieOptions(roster, new Set([2, 99]))).toEqual([2])
  })

  it("offers the whole pool until someone has", () => {
    expect(goalieOptions(roster, new Set())).toEqual([1, 2, 3])
  })
})

describe("validateLineup", () => {
  const roster = [
    ...[1, 2, 3, 4, 5].map((playerId) => ({ playerId, isGoalie: false })),
    ...[10, 11].map((playerId) => ({ playerId, isGoalie: true })),
  ]
  const check = (l: Lineup, uses = new Map<number, number>()) =>
    validateLineup(l, { roster, uses: { skater: uses, goalie: uses }, defaultGoalies: [10, 11], onBye: new Set<number>(), config })

  it("lets a Player at the skater cap fill a goalie slot", () => {
    const errors = validateLineup(lineup({ skaters: [2, 3, 4], goalies: [1] }), {
      roster,
      uses: { skater: new Map([[1, config.usageCap.skater!]]), goalie: new Map() },
      defaultGoalies: [10, 11],
      onBye: new Set<number>(),
      config,
    })

    expect(errors).not.toContain("at-usage-cap")
  })

  it("rejects a repeated Player, including across a Backup", () => {
    expect(check(lineup({ skaterBackups: [1] }))).toContain("duplicate-player")
  })

  it("rejects a Player who is not rostered", () => {
    expect(check(lineup({ skaters: [1, 2, 99] }))).toContain("not-rostered")
  })

  it("keeps roster goalies out of skater slots", () => {
    expect(check(lineup({ skaters: [1, 2, 10], goalies: [11] }))).toContain("wrong-kind")
  })

  it("lets any rostered Player fill the goalie slot, under the goalie cap", () => {
    expect(check(lineup({ goalies: [4] }), new Map([[4, 3]]))).toEqual([])
    expect(check(lineup({ goalies: [4] }), new Map([[4, 4]]))).toContain("at-usage-cap")
  })

  it("allows a Player one use below the cap and rejects one at it", () => {
    expect(check(lineup(), new Map([[1, 2]]))).toEqual([])
    expect(check(lineup(), new Map([[1, 3]]))).toContain("at-usage-cap")
  })

  it("applies the cap to Backups", () => {
    expect(check(lineup({ skaterBackups: [4] }), new Map([[4, 3]]))).toContain("at-usage-cap")
  })

  it("requires a goalie while any default goalie is under the cap", () => {
    expect(check(lineup({ goalies: [] }), new Map([[10, 4]]))).toContain("goalie-slot")
  })

  it("allows an empty goalie slot once every default goalie is at the cap", () => {
    expect(check(lineup({ goalies: [] }), new Map([[10, 4], [11, 4]]))).toEqual([])
  })

  it("reads slot counts from config", () => {
    const twoSkaters = { ...config, lineup: { ...config.lineup, skaters: 2 } }
    const errors = validateLineup(lineup({ skaters: [1, 2] }), {
      roster,
      uses: { skater: new Map(), goalie: new Map() },
      defaultGoalies: [10, 11],
      onBye: new Set<number>(),
      config: twoSkaters,
    })
    expect(errors).toEqual([])
  })
})

describe("rankByPoints", () => {
  it("shares a rank on ties and skips the next", () => {
    const ranked = rankByPoints([
      { managerId: "a", points: 10 },
      { managerId: "b", points: 30 },
      { managerId: "c", points: 30 },
    ])
    expect(ranked.map((r) => [r.managerId, r.rank])).toEqual([
      ["b", 1],
      ["c", 1],
      ["a", 3],
    ])
  })
})

describe("scoreWeek config", () => {
  it("reads the weights from config", () => {
    const custom = {
      ...config,
      weights: { ...config.weights, skater: { ...config.weights.skater, goal: 7 } },
    }
    const week = scoreWeek(
      lineup(),
      { skater: [skater(1, "g1", { goals: 1 })], goalie: [] },
      [final("g1")],
      custom
    )
    expect(week.points).toBe(7)
  })
})

describe("Subs", () => {
  it("scores nothing for a game played as a Sub", () => {
    const week = score(lineup(), {
      skater: [skater(1, "g1", { goals: 3, isSub: true }), skater(2), skater(3)],
      goalie: [goalie(10, "g1", { saves: 20 })],
    })
    expect(week.selections.find((s) => s.playerId === 1)).toMatchObject({ outcome: "absent", points: 0 })
  })

  it("lets a Backup cover a skater whose only game was as a Sub, at no use", () => {
    const week = score(lineup({ skaterBackups: [4] }), {
      skater: [skater(1, "g1", { isSub: true }), skater(2), skater(3), skater(4, "g1", { goals: 1 })],
      goalie: [goalie(10)],
    })
    expect(week.selections.find((s) => s.playerId === 4)).toMatchObject({ outcome: "played", points: 10 })
    expect(allUses([week]).has(1)).toBe(false)
  })

  it("treats a goalie whose only game was as a Sub as absent", () => {
    const week = score(lineup({ goalieBackups: [11] }), {
      skater: [skater(1), skater(2), skater(3)],
      goalie: [goalie(10, "g1", { saves: 30, isSub: true }), goalie(11, "g1", { saves: 12 })],
    })
    expect(week.selections.find((s) => s.playerId === 10)).toMatchObject({ outcome: "absent", points: 0 })
    expect(week.selections.find((s) => s.playerId === 11)).toMatchObject({ outcome: "played", points: 12 })
  })

  it("keeps a Player's own game when they also subbed that Week", () => {
    const week = score(
      lineup(),
      {
        skater: [skater(1, "g1", { goals: 1 }), skater(1, "g2", { goals: 5, isSub: true }), skater(2), skater(3)],
        goalie: [goalie(10)],
      },
      [final("g1"), final("g2")]
    )
    expect(week.selections.find((s) => s.playerId === 1)?.points).toBe(10)
  })
})

describe("playersOnBye", () => {
  const roster = [
    { playerId: 1, teams: ["seals"] },
    { playerId: 2, teams: ["yetis"] },
    { playerId: 3, teams: ["yetis", "seals"] },
  ]

  it("lists Players with no team playing, and a traded Player only if none of their teams play", () => {
    const onBye = playersOnBye(roster, [{ homeTeam: "seals", awayTeam: "otters" }])
    expect([...onBye]).toEqual([2])
  })

  it("puts nobody on a Bye in a Week with no games", () => {
    expect(playersOnBye(roster, []).size).toBe(0)
  })
})

describe("validateLineup and Byes", () => {
  const roster = [1, 2, 3, 4, 10, 11].map((playerId) => ({ playerId, isGoalie: false }))
  const context = (onBye: number[], usedGoalies: [number, number][] = []) => ({
    roster,
    uses: { skater: new Map<number, number>(), goalie: new Map(usedGoalies) },
    defaultGoalies: [10, 11],
    onBye: new Set(onBye),
    config,
  })

  it.each([
    ["starter", lineup()],
    ["Backup", lineup({ skaters: [2, 3, 4], skaterBackups: [1] })],
  ])("rejects a %s on a Bye", (_label, l) => {
    expect(validateLineup(l, context([1]))).toEqual(["on-bye"])
  })

  it("rejects a goalie on a Bye", () => {
    expect(validateLineup(lineup(), context([10]))).toEqual(["on-bye"])
  })

  it("lets the goalie slot stay empty once every default goalie is at the cap or on a Bye", () => {
    const empty = lineup({ goalies: [] })
    expect(validateLineup(empty, context([10], [[11, config.usageCap.goalie!]]))).toEqual([])
    expect(validateLineup(empty, context([10]))).toEqual(["goalie-slot"])
  })
})

describe("points per game", () => {
  it("averages a Player's points over the scored games they appeared in", () => {
    const games = [final("g1"), final("g2"), final("g3", { hasBoxscore: false })]
    const stats: WeekStats = {
      skater: [
        skater(1, "g1", { goals: 1 }), // 10
        skater(1, "g2", { assists: 1 }), // 3
        skater(1, "g3", { goals: 5 }), // unscored game, ignored
        skater(2, "g1", { goals: 2 }), // 20 in a single game
      ],
      goalie: [],
    }

    const average = pointsPerGame(stats, games, config)

    expect(average.get(1)).toBe(6.5)
    expect(average.get(2)).toBe(20)
    expect(average.has(3)).toBe(false)
  })
})
