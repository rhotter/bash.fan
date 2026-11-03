import { describe, expect, it } from "vitest"
import { checkFantasyConfig, DEFAULT_FANTASY_CONFIG, parseFantasyConfig } from "@/lib/fantasy/config"
import {
  buildPickemStandings,
  isValidPrediction,
  rankPickem,
  scorePickem,
  type PickemGame,
} from "@/lib/fantasy/pickem"

const game = (id: string, homeScore: number | null, awayScore: number | null, extra = {}): PickemGame => ({
  id,
  status: "final",
  isForfeit: false,
  hasBoxscore: true,
  homeScore,
  awayScore,
  ...extra,
})
const predict = (gameId: string, homeScore: number, awayScore: number) => ({
  gameId,
  homeScore,
  awayScore,
})

describe("isValidPrediction", () => {
  it("requires a whole, non-negative score with a winner", () => {
    expect(isValidPrediction(predict("g1", 4, 2))).toBe(true)
    expect(isValidPrediction(predict("g1", 3, 3))).toBe(false)
    expect(isValidPrediction(predict("g1", -1, 2))).toBe(false)
    expect(isValidPrediction(predict("g1", 2.5, 1))).toBe(false)
  })

  it("limits scores to 0-30", () => {
    expect(isValidPrediction(predict("g1", 30, 0))).toBe(true)
    expect(isValidPrediction(predict("g1", 31, 0))).toBe(false)
    expect(isValidPrediction(predict("g1", 1, 31))).toBe(false)
  })
})

describe("the Fantasy config", () => {
  it("has no skipped-game penalty", () => {
    expect(DEFAULT_FANTASY_CONFIG).not.toHaveProperty("pickem")
  })

  it("rejects unknown keys", () => {
    expect(parseFantasyConfig({ ...DEFAULT_FANTASY_CONFIG, pickem: { skippedGameError: 20 } })).toBeNull()
    expect(parseFantasyConfig({ ...DEFAULT_FANTASY_CONFIG, extra: 1 })).toBeNull()
  })

  const issues = (change: object) => {
    const checked = checkFantasyConfig({ ...DEFAULT_FANTASY_CONFIG, ...change })
    return checked.ok ? [] : checked.issues
  }

  it("accepts the defaults", () => {
    expect(checkFantasyConfig(DEFAULT_FANTASY_CONFIG)).toEqual({ ok: true, config: DEFAULT_FANTASY_CONFIG })
  })

  it.each([
    ["no skater slots", { lineup: { ...DEFAULT_FANTASY_CONFIG.lineup, skaters: 0 } }, "lineup.skaters"],
    ["a Lock after midday", { lock: { ...DEFAULT_FANTASY_CONFIG.lock, time: "13:00" } }, "lock.time"],
    ["a time that isn't HH:MM", { lock: { ...DEFAULT_FANTASY_CONFIG.lock, time: "8:00" } }, "lock.time"],
    ["a made-up time zone", { lock: { ...DEFAULT_FANTASY_CONFIG.lock, timeZone: "Mars/Base" } }, "lock.timeZone"],
    ["a day past Saturday", { lock: { ...DEFAULT_FANTASY_CONFIG.lock, dayOfWeek: 7 } }, "lock.dayOfWeek"],
    ["a cap of zero", { usageCap: { skater: 0, goalie: 4 } }, "usageCap.skater"],
    ["a repeated game type", { gameTypes: ["regular", "regular"] }, "gameTypes"],
    ["no game types", { gameTypes: [] }, "gameTypes"],
  ])("rejects %s", (_name, change, path) => {
    expect(issues(change).some((issue) => issue.startsWith(path))).toBe(true)
  })

  it("allows no cap, and a Lock right at midday", () => {
    expect(
      checkFantasyConfig({
        ...DEFAULT_FANTASY_CONFIG,
        usageCap: { skater: null, goalie: null },
        lock: { ...DEFAULT_FANTASY_CONFIG.lock, time: "12:00" },
      }).ok
    ).toBe(true)
  })
})

describe("scorePickem", () => {
  it("counts a correct winner and sums home and away differences", () => {
    expect(scorePickem([game("g1", 5, 2)], [predict("g1", 4, 3)])).toEqual({
      correct: 1,
      goalError: 2,
      provisional: false,
    })
    expect(scorePickem([game("g1", 5, 2)], [predict("g1", 2, 5)])).toMatchObject({
      correct: 0,
      goalError: 6,
    })
  })

  it("charges nothing for a skipped game: error counts only predicted games", () => {
    const result = scorePickem([game("g1", 5, 2), game("g2", 1, 0)], [predict("g1", 5, 2)])
    expect(result).toMatchObject({ correct: 1, goalError: 0 })
    expect(scorePickem([game("g1", 5, 2)], [])).toMatchObject({ correct: 0, goalError: 0 })
  })

  it("voids forfeited games for everybody", () => {
    const games = [game("g1", 5, 0, { isForfeit: true })]
    expect(scorePickem(games, [predict("g1", 5, 0)])).toMatchObject({ correct: 0, goalError: 0 })
    expect(scorePickem(games, [])).toMatchObject({ correct: 0, goalError: 0 })
  })

  it("scores a final game without a boxscore, since only the final score matters", () => {
    expect(scorePickem([game("g1", 5, 2, { hasBoxscore: false })], [predict("g1", 5, 2)])).toMatchObject({
      correct: 1,
      provisional: false,
    })
  })

  it("leaves a game with no final score out, and marks the result provisional", () => {
    const games = [game("g1", null, null, { status: "upcoming", hasBoxscore: false })]
    expect(scorePickem(games, [])).toEqual({ correct: 0, goalError: 0, provisional: true })
  })
})

describe("rankPickem", () => {
  it("ranks by correct winners, then lowest goal error, then shares the rank", () => {
    const ranked = rankPickem([
      { managerId: "a", correct: 2, goalError: 30 },
      { managerId: "b", correct: 3, goalError: 50 },
      { managerId: "c", correct: 2, goalError: 10 },
      { managerId: "d", correct: 2, goalError: 10 },
    ])
    expect(ranked.map((r) => [r.managerId, r.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["d", 2],
      ["a", 4],
    ])
  })
})

describe("buildPickemStandings", () => {
  const LAUNCHED = new Date("2026-11-01T12:00:00-08:00")
  const AFTER_WEEK_1 = new Date("2026-11-08T12:00:00-08:00")
  const BEFORE_LOCK = new Date("2026-11-05T12:00:00-08:00")
  const seasonGame = (id: string, date: string, homeScore: number | null, awayScore: number | null, extra = {}) => ({
    ...game(id, homeScore, awayScore),
    date,
    time: "9:00a",
    gameType: "regular",
    homeTeam: "seals",
    awayTeam: "yetis",
    ...extra,
  })
  const managers = [
    { id: 1, teamName: "Aces" },
    { id: 2, teamName: "Bears" },
    { id: 3, teamName: "Cats" },
  ]
  const build = (predictions: ({ managerId: number } & ReturnType<typeof predict>)[], games = [seasonGame("g1", "2026-11-07", 5, 2)], now = AFTER_WEEK_1) =>
    buildPickemStandings({ managers, predictions, games, config: DEFAULT_FANTASY_CONFIG, launchedAt: LAUNCHED, now })
  const p = (managerId: number, gameId: string, home: number, away: number) => ({ managerId, ...predict(gameId, home, away) })

  it("lists only Managers with a Prediction, ranked by correct winners then goal error", () => {
    const { weeks, season } = build([p(1, "g1", 2, 5), p(2, "g1", 5, 2)])
    expect(weeks[0].rows.map((r) => [r.teamName, r.rank, r.correct, r.goalError])).toEqual([
      ["Bears", 1, 1, 0],
      ["Aces", 2, 0, 6],
    ])
    expect(season.rows.map((r) => r.teamName)).toEqual(["Bears", "Aces"])
  })

  it("keeps predictions private until the Lock", () => {
    const early = build([p(1, "g1", 2, 5)], undefined, BEFORE_LOCK)
    expect(early.weeks).toEqual([])
    expect(early.season.rows).toEqual([])
  })

  it("shows each prediction's outcome on a weekly row", () => {
    const games = [seasonGame("g1", "2026-11-07", 5, 2), seasonGame("g2", "2026-11-07", null, null, { status: "upcoming" }), seasonGame("g3", "2026-11-07", 3, 0, { isForfeit: true })]
    const { weeks } = build([p(1, "g1", 5, 2), p(1, "g2", 1, 0), p(1, "g3", 3, 0)], games)
    expect(weeks[0].provisional).toBe(true)
    expect(weeks[0].rows[0].predictions.map((x) => [x.gameId, x.outcome])).toEqual([
      ["g1", "correct"],
      ["g2", "pending"],
      ["g3", "void"],
    ])
  })

  it("sums the season across Weeks, listing a Manager who skipped a Week only where they predicted", () => {
    const games = [seasonGame("g1", "2026-11-07", 5, 2), seasonGame("g2", "2026-11-14", 1, 4)]
    const { weeks, season } = build([p(1, "g1", 5, 2), p(1, "g2", 0, 3), p(2, "g2", 0, 3)], games, new Date("2026-11-15T12:00:00-08:00"))
    expect(weeks.map((w) => [w.id, w.rows.map((r) => r.teamName)])).toEqual([
      ["2026-11-07", ["Aces"]],
      ["2026-11-14", ["Aces", "Bears"]],
    ])
    expect(season.rows.map((r) => [r.teamName, r.rank, r.correct, r.goalError])).toEqual([
      ["Aces", 1, 2, 2],
      ["Bears", 2, 1, 2],
    ])
  })

  it("never lists a Manager whose Predictions are for a Week that hasn't locked", () => {
    const games = [seasonGame("g1", "2026-11-07", 5, 2), seasonGame("g2", "2026-11-14", null, null, { status: "upcoming" })]
    const { season } = build([p(3, "g2", 4, 1)], games)
    expect(season.rows).toEqual([])
  })
})
