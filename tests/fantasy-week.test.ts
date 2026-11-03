import { describe, expect, it } from "vitest"
import { DEFAULT_FANTASY_CONFIG } from "@/lib/fantasy/config"
import type { SeasonGame } from "@/lib/fantasy/lineups"
import { buildWeekOverview, countsForGame, gameStartsAt, gameWeekId, openWeek, weekContaining } from "@/lib/fantasy/week"

const { lock } = DEFAULT_FANTASY_CONFIG

describe("weekContaining", () => {
  it("runs a summer Week from one 8am PDT Lock to the next", () => {
    const week = weekContaining(new Date("2026-10-14T19:00:00Z"), lock)
    expect(week.lockAt.toISOString()).toBe("2026-10-10T15:00:00.000Z")
    expect(week.nextLockAt.toISOString()).toBe("2026-10-17T15:00:00.000Z")
    expect(week.id).toBe("2026-10-10")
  })

  it("keeps the Lock at 8am local when clocks fall back inside the Week", () => {
    const week = weekContaining(new Date("2026-11-03T12:00:00Z"), lock)
    expect(week.lockAt.toISOString()).toBe("2026-10-31T15:00:00.000Z")
    expect(week.nextLockAt.toISOString()).toBe("2026-11-07T16:00:00.000Z")
  })

  it("keeps the Lock at 8am local when clocks spring forward inside the Week", () => {
    const week = weekContaining(new Date("2027-03-15T12:00:00Z"), lock)
    expect(week.lockAt.toISOString()).toBe("2027-03-13T16:00:00.000Z")
    expect(week.nextLockAt.toISOString()).toBe("2027-03-20T15:00:00.000Z")
  })

  it("starts the new Week at the exact Lock instant", () => {
    expect(weekContaining(new Date("2026-11-07T16:00:00Z"), lock).id).toBe("2026-11-07")
    expect(weekContaining(new Date("2026-11-07T15:59:59Z"), lock).id).toBe("2026-10-31")
  })

  it("reads the Lock day, time and zone from config", () => {
    const week = weekContaining(new Date("2026-06-03T12:00:00Z"), {
      dayOfWeek: 1,
      time: "18:30",
      timeZone: "America/New_York",
    })
    expect(week.lockAt.toISOString()).toBe("2026-06-01T22:30:00.000Z")
    expect(week.id).toBe("2026-06-01")
  })
})

describe("countsForGame", () => {
  const launchedAt = new Date("2026-11-03T19:00:00Z")
  const game = { date: "2026-11-07", time: "9:00a" }

  it("starts at the first Lock after launch", () => {
    expect(countsForGame(game, launchedAt, lock)).toBe(true)
    expect(countsForGame({ ...game, date: "2026-10-31" }, launchedAt, lock)).toBe(false)
  })

})

describe("gameStartsAt", () => {
  it.each([
    ["9:00a", "2026-11-07T17:00:00.000Z"],
    ["12:30pm", "2026-11-07T20:30:00.000Z"],
    ["13:00", "2026-11-07T21:00:00.000Z"],
  ])("reads the stored time %s as local", (time, expected) => {
    expect(gameStartsAt("2026-11-07", time, lock.timeZone).toISOString()).toBe(expected)
  })

  it("puts Saturday and Sunday games in the Week of that Saturday's Lock", () => {
    const saturday = gameStartsAt("2026-11-07", "9:00a", lock.timeZone)
    const sunday = gameStartsAt("2026-11-08", "9:00a", lock.timeZone)
    expect(weekContaining(saturday, lock).id).toBe("2026-11-07")
    expect(weekContaining(sunday, lock).id).toBe("2026-11-07")
  })
})

describe("openWeek", () => {
  it("is the Week whose Lock is next, moving on exactly at the Lock", () => {
    expect(openWeek(new Date("2026-11-07T07:59:59-08:00"), lock).id).toBe("2026-11-07")
    expect(openWeek(new Date("2026-11-07T08:00:00-08:00"), lock).id).toBe("2026-11-14")
  })

  it("carries the right Lock across the fall daylight-saving change", () => {
    expect(openWeek(new Date("2026-10-31T12:00:00-07:00"), lock).lockAt.toISOString()).toBe(
      "2026-11-07T16:00:00.000Z"
    )
  })
})

describe("gameWeekId", () => {
  it("places a game in the Week it starts in", () => {
    expect(gameWeekId({ date: "2026-11-07", time: "9:00a" }, lock)).toBe("2026-11-07")
    expect(gameWeekId({ date: "2026-11-08", time: "9:00a" }, lock)).toBe("2026-11-07")
  })

  it("places a TBD game by its date", () => {
    expect(gameWeekId({ date: "2026-11-07", time: "TBD" }, lock)).toBe("2026-11-07")
  })
})

const LAUNCHED = new Date("2026-11-01T12:00:00-08:00")
const WEEK_1 = "2026-11-07"

const TEAMS = [
  { slug: "seals", name: "Seals" },
  { slug: "yetis", name: "Yetis" },
  { slug: "owls", name: "Owls" },
]

const game = (id: string, overrides: Partial<SeasonGame> = {}): SeasonGame => ({
  id,
  date: "2026-11-07",
  time: "9:00a",
  homeTeam: "seals",
  awayTeam: "yetis",
  gameType: "regular",
  status: "final",
  isForfeit: false,
  hasBoxscore: true,
  homeScore: 4,
  awayScore: 2,
  ...overrides,
})

const overview = (games: SeasonGame[], weekId = WEEK_1) =>
  buildWeekOverview({ weekId, games, teams: TEAMS, config: DEFAULT_FANTASY_CONFIG, launchedAt: LAUNCHED })

describe("buildWeekOverview", () => {
  it("lists the Week's games with the day and time, never the word Lock", () => {
    const { games } = overview([game("g1")])

    expect(games).toEqual([
      {
        id: "g1",
        home: { slug: "seals", name: "Seals" },
        away: { slug: "yetis", name: "Yetis" },
        startLabel: "Sat 9:00a",
        result: { homeScore: 4, awayScore: 2 },
      },
    ])
    expect(games[0].startLabel).not.toMatch(/lock/i)
  })

  it("names the team with no game as the Bye", () => {
    expect(overview([game("g1")]).byeTeams).toEqual([{ slug: "owls", name: "Owls" }])
  })

  it("has no Bye when the Week has no games", () => {
    expect(overview([]).byeTeams).toEqual([])
  })

  it("shows no result for a game that hasn't been played, and orders games by start", () => {
    const { games } = overview([
      game("late", { time: "11:00a", status: "scheduled", homeScore: null, awayScore: null }),
      game("early", { time: "9:00a" }),
    ])

    expect(games.map(({ id, result }) => [id, result])).toEqual([
      ["early", { homeScore: 4, awayScore: 2 }],
      ["late", null],
    ])
  })
})
