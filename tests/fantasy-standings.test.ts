import { describe, expect, it } from "vitest"
import { DEFAULT_FANTASY_CONFIG } from "@/lib/fantasy/config"
import type { SeasonGame } from "@/lib/fantasy/lineups"
import type { GoalieStatLine, Lineup, SkaterStatLine } from "@/lib/fantasy/scoring"
import { buildStandings } from "@/lib/fantasy/standings"

const LAUNCHED = new Date("2026-11-01T12:00:00-08:00")
const AFTER_FIRST_LOCK = new Date("2026-11-08T12:00:00-08:00")
const AFTER_SECOND_LOCK = new Date("2026-11-15T12:00:00-08:00")
const WEEK_1 = "2026-11-07"
const WEEK_2 = "2026-11-14"

const game = (id: string, date: string, overrides: Partial<SeasonGame> = {}): SeasonGame => ({
  id,
  date,
  time: "9:00a",
  homeTeam: "seals",
  awayTeam: "yetis",
  gameType: "regular",
  status: "final",
  isForfeit: false,
  hasBoxscore: true,
  homeScore: null,
  awayScore: null,
  ...overrides,
})

const skater = (playerId: number, gameId: string, goals = 0): SkaterStatLine => ({
  playerId,
  gameId,
  goals,
  assists: 0,
  ppg: 0,
  shg: 0,
  pim: 0,
  isSub: false,
})

const goalie = (playerId: number, gameId: string, saves: number): GoalieStatLine => ({
  playerId,
  gameId,
  saves,
  goalsAgainst: 0,
  shutouts: 0,
  result: null,
  isSub: false,
})

const lineup = (skaters: number[], overrides: Partial<Lineup> = {}): Lineup => ({
  skaters,
  goalies: [],
  skaterBackups: [],
  goalieBackups: [],
  ...overrides,
})

const managers = [
  { id: 1, teamName: "Aces" },
  { id: 2, teamName: "Bears" },
  { id: 3, teamName: "Comets" },
]

const standings = (input: Partial<Parameters<typeof buildStandings>[0]>) =>
  buildStandings({
    managers,
    lineups: [],
    games: [game("g1", WEEK_1)],
    stats: { skater: [], goalie: [] },
    playerNames: new Map(),
    teams: [
      { slug: "seals", name: "Seals" },
      { slug: "yetis", name: "Yetis" },
    ],
    config: DEFAULT_FANTASY_CONFIG,
    launchedAt: LAUNCHED,
    now: AFTER_FIRST_LOCK,
    ...input,
  })

const ranks = (rows: { teamName: string; points: number; rank: number }[]) =>
  rows.map(({ teamName, points, rank }) => [rank, teamName, points])

describe("buildStandings", () => {
  it("ranks a Week by points, listing only Managers who submitted a Lineup", () => {
    const { weeks } = standings({
      lineups: [
        { managerId: 1, weekId: WEEK_1, lineup: lineup([10]) },
        { managerId: 2, weekId: WEEK_1, lineup: lineup([11]) },
      ],
      stats: { skater: [skater(10, "g1", 1), skater(11, "g1", 2)], goalie: [] },
    })

    expect(weeks.map((w) => w.id)).toEqual([WEEK_1])
    expect(ranks(weeks[0].rows)).toEqual([
      [1, "Bears", 20],
      [2, "Aces", 10],
    ])
  })

  it("totals the season across Weeks and lists every Manager, a missed Week scoring 0", () => {
    const { season } = standings({
      now: AFTER_SECOND_LOCK,
      games: [game("g1", WEEK_1), game("g2", WEEK_2)],
      lineups: [
        { managerId: 1, weekId: WEEK_1, lineup: lineup([10]) },
        { managerId: 1, weekId: WEEK_2, lineup: lineup([10]) },
        { managerId: 2, weekId: WEEK_2, lineup: lineup([11]) },
      ],
      stats: { skater: [skater(10, "g1", 1), skater(10, "g2", 1), skater(11, "g2", 3)], goalie: [] },
    })

    expect(ranks(season.rows)).toEqual([
      [1, "Bears", 30],
      [2, "Aces", 20],
      [3, "Comets", 0],
    ])
  })

  it("shares a rank on a tie and skips the next one", () => {
    const { season } = standings({
      lineups: [
        { managerId: 3, weekId: WEEK_1, lineup: lineup([10]) },
        { managerId: 1, weekId: WEEK_1, lineup: lineup([11]) },
        { managerId: 2, weekId: WEEK_1, lineup: lineup([12]) },
      ],
      stats: { skater: [skater(10, "g1", 2), skater(11, "g1", 2), skater(12, "g1", 1)], goalie: [] },
    })

    expect(ranks(season.rows)).toEqual([
      [1, "Aces", 20],
      [1, "Comets", 20],
      [3, "Bears", 10],
    ])
  })

  it("keeps a Week and its Lineups out until the Lock", () => {
    const openWeek = [{ managerId: 1, weekId: WEEK_2, lineup: lineup([10]) }]
    const games = [game("g1", WEEK_1), game("g2", WEEK_2, { status: "upcoming", hasBoxscore: false })]

    const beforeLock = standings({
      games,
      lineups: openWeek,
      now: new Date("2026-11-14T07:59:59-08:00"),
    })
    const atLock = standings({
      games,
      lineups: openWeek,
      now: new Date("2026-11-14T08:00:00-08:00"),
    })

    expect(beforeLock.weeks.map((w) => w.id)).toEqual([WEEK_1])
    expect(JSON.stringify(beforeLock)).not.toContain("playerId")
    expect(atLock.weeks.map((w) => w.id)).toEqual([WEEK_1, WEEK_2])
    expect(atLock.weeks[1].rows).toHaveLength(1)
  })

  it("marks a Week provisional while a final game waits on its boxscore", () => {
    const { weeks, season } = standings({
      games: [game("g1", WEEK_1), game("g2", WEEK_1, { hasBoxscore: false })],
      lineups: [{ managerId: 1, weekId: WEEK_1, lineup: lineup([10]) }],
    })

    expect(weeks[0].provisional).toBe(true)
    expect(weeks[0].rows[0].selections[0]).toMatchObject({ outcome: "pending", points: 0 })
    expect(season.provisional).toBe(true)
  })

  it("stops being provisional once the only open game is forfeited", () => {
    const { weeks, season } = standings({
      games: [game("g1", WEEK_1), game("g2", WEEK_1, { hasBoxscore: false, isForfeit: true })],
    })

    expect(weeks[0].provisional).toBe(false)
    expect(season.provisional).toBe(false)
  })

  it("shows each Selection's points and name, including a Backup substitution", () => {
    const { weeks } = standings({
      lineups: [
        {
          managerId: 1,
          weekId: WEEK_1,
          lineup: lineup([10, 11], { goalies: [20], skaterBackups: [12], goalieBackups: [21] }),
        },
      ],
      stats: {
        skater: [skater(10, "g1", 1), skater(12, "g1", 2)],
        goalie: [goalie(20, "g1", 25), goalie(21, "g1", 30)],
      },
      playerNames: new Map([
        [10, "Starter"],
        [11, "Absent"],
        [12, "Backup"],
        [20, "Goalie"],
        [21, "Spare"],
      ]),
    })

    const [row] = weeks[0].rows
    expect(row.points).toBe(55)
    expect(row.selections).toEqual([
      { playerId: 10, playerName: "Starter", kind: "skater", isBackup: false, outcome: "played", points: 10, games: expect.any(Array) },
      { playerId: 11, playerName: "Absent", kind: "skater", isBackup: false, outcome: "absent", points: 0, games: expect.any(Array) },
      { playerId: 12, playerName: "Backup", kind: "skater", isBackup: true, outcome: "played", points: 20, games: expect.any(Array) },
      { playerId: 20, playerName: "Goalie", kind: "goalie", isBackup: false, outcome: "played", points: 25, games: expect.any(Array) },
      { playerId: 21, playerName: "Spare", kind: "goalie", isBackup: true, outcome: "unused", points: 0, games: expect.any(Array) },
    ])
  })

  it("derives from the stats it's given, so a correction changes the result", () => {
    const lineups = [{ managerId: 1, weekId: WEEK_1, lineup: lineup([10]) }]

    const before = standings({ lineups, stats: { skater: [skater(10, "g1", 1)], goalie: [] } })
    const after = standings({ lineups, stats: { skater: [skater(10, "g1", 3)], goalie: [] } })

    expect(before.season.rows[0].points).toBe(10)
    expect(after.season.rows[0].points).toBe(30)
  })

  it("ignores games before the first Lock after launch", () => {
    const { weeks } = standings({ games: [game("early", "2026-10-31")] })

    expect(weeks).toEqual([])
  })

  it("exposes Team Names and Manager ids, nothing else about a Manager", () => {
    const result = standings({
      lineups: [{ managerId: 1, weekId: WEEK_1, lineup: lineup([10]) }],
    })

    expect(Object.keys(result.season.rows[0]).sort()).toEqual(["managerId", "points", "rank", "teamName"])
  })

  describe("game lines", () => {
    const withLines = (overrides: Parameters<typeof standings>[0]) =>
      standings({ lineups: [{ managerId: 1, weekId: WEEK_1, lineup: lineup([10], { goalies: [20] }) }], ...overrides })
    const selection = (result: ReturnType<typeof standings>, playerId: number) =>
      result.weeks[0].rows[0].selections.find((s) => s.playerId === playerId)!

    it("lists each scored game a Selection played, with its stats and points", () => {
      const result = withLines({
        games: [game("g1", WEEK_1), game("g2", WEEK_1, { homeTeam: "yetis", awayTeam: "seals" })],
        stats: {
          skater: [{ ...skater(10, "g1", 1), assists: 2 }, skater(10, "g2", 1)],
          goalie: [{ ...goalie(20, "g1", 12), goalsAgainst: 2, result: "W" }],
        },
      })

      expect(selection(result, 10).games).toEqual([
        {
          gameId: "g1",
          matchup: "Seals vs Yetis",
          points: 16,
          stats: [
            { label: "G", value: 1 },
            { label: "A", value: 2 },
            { label: "PPG", value: 0 },
            { label: "SHG", value: 0 },
            { label: "PIM", value: 0 },
          ],
        },
        expect.objectContaining({ gameId: "g2", matchup: "Yetis vs Seals", points: 10 }),
      ])
      expect(selection(result, 20).games).toEqual([
        {
          gameId: "g1",
          matchup: "Seals vs Yetis",
          points: 11,
          stats: [
            { label: "SV", value: 12 },
            { label: "GA", value: 2 },
            { label: "W", value: 1 },
            { label: "SO", value: 0 },
          ],
        },
      ])
    })

    it("has no lines for a Selection that didn't play, or only subbed", () => {
      const result = withLines({
        stats: { skater: [{ ...skater(10, "g1", 3), isSub: true }], goalie: [] },
      })

      expect(selection(result, 10).games).toEqual([])
      expect(selection(result, 20).games).toEqual([])
    })

    it("has no lines for a Backup who wasn't needed", () => {
      const result = standings({
        lineups: [{ managerId: 1, weekId: WEEK_1, lineup: lineup([10], { skaterBackups: [11] }) }],
        stats: { skater: [skater(10, "g1", 1), skater(11, "g1", 5)], goalie: [] },
      })

      expect(selection(result, 11).outcome).toBe("unused")
      expect(selection(result, 11).games).toEqual([])
    })

    it("leaves out a game that isn't scored yet", () => {
      const result = withLines({
        games: [game("g1", WEEK_1), game("g2", WEEK_1, { status: "scheduled", hasBoxscore: false })],
        stats: { skater: [skater(10, "g1", 1), skater(10, "g2", 9)], goalie: [] },
      })

      expect(selection(result, 10).games.map((g) => g.gameId)).toEqual(["g1"])
    })

    it("adds up to the Selection's points", () => {
      const result = withLines({
        games: [game("g1", WEEK_1), game("g2", WEEK_1)],
        stats: { skater: [skater(10, "g1", 1), skater(10, "g2", 2)], goalie: [] },
      })

      const picked = selection(result, 10)
      expect(picked.games.reduce((total, g) => total + g.points, 0)).toBe(picked.points)
    })
  })
})
