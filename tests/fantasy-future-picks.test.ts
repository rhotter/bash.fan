import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { db, schema } from "@/lib/db"
import { DEFAULT_FANTASY_CONFIG } from "@/lib/fantasy/config"
import { loadLineupForm, loadPublicManager, saveLineup } from "@/lib/fantasy/lineups"
import { createManager } from "@/lib/fantasy/managers"
import { savePredictions } from "@/lib/fantasy/predictions"
import { getFantasySeason, saveFantasyConfig } from "@/lib/fantasy/season"
import { fetchFantasyStandings } from "@/lib/fetch-fantasy"
import { setupGame } from "./factories/setupGame"
import { setupPlayer } from "./factories/setupPlayer"
import { setupSeason } from "./factories/setupSeason"
import { setupTeam } from "./factories/setupTeam"

const at = (local: string) => new Date(`${local}-08:00`)
const LAUNCH = at("2026-11-18T12:00:00")
/** A holiday: the Week closing Nov 28 has no games. */
const HOLIDAY = at("2026-11-27T12:00:00")
const HOLIDAY_WEEK = "2026-11-28"
const WEEKS = ["2026-12-05", "2026-12-12", "2026-12-19"]
const [FIRST, SECOND, THIRD] = WEEKS

async function setupLeague() {
  const { season } = await setupSeason({ isCurrent: true })
  const { team: seals } = await setupTeam()
  const { team: yetis } = await setupTeam()
  const ids: number[] = []
  for (const isGoalie of [false, false, false, false, true]) {
    ids.push((await setupPlayer({ roster: [{ season, team: isGoalie ? yetis : seals, isGoalie }] })).player.id)
  }
  const gameIds: Record<string, string> = {}
  for (const date of WEEKS) {
    const upcoming = { status: "upcoming", homeScore: null, awayScore: null, hasBoxscore: false }
    gameIds[date] = (await setupGame({ season, homeTeam: seals, awayTeam: yetis, date, time: "9:00a", ...upcoming })).game.id
  }
  await saveFantasyConfig(season.id, "regular", { ...DEFAULT_FANTASY_CONFIG, usageCap: { skater: 2, goalie: null } }, LAUNCH)
  await createManager(season.id, "regular", { teamName: "Puck Norris", firstName: "Ada", lastName: "Lovelace" })
  const [manager] = await db.select().from(schema.fantasyManagers)
  const [a, b, c, d, goalie] = ids
  return {
    manager,
    gameIds,
    contest: (await getFantasySeason(season.id))!,
    star: a,
    lineup: (skaters = [a, b, c]) => ({ skaters, goalies: [goalie], skaterBackups: [], goalieBackups: [] }),
    others: [b, c, d],
  }
}

let league: Awaited<ReturnType<typeof setupLeague>>
const save = (weekId: string, lineup = league.lineup(), now = HOLIDAY) => saveLineup(league.manager, league.contest, weekId, lineup, now)
const predict = (weekId: string, now = HOLIDAY) =>
  savePredictions(league.manager, league.contest, weekId, [{ gameId: league.gameIds[weekId], homeScore: 3, awayScore: 1 }], now)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: HOLIDAY })
  league = await setupLeague()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("picking ahead", () => {
  it("opens on the next Week with games when the open Week has none", async () => {
    const form = await loadLineupForm(league.manager, HOLIDAY)

    expect(form).toMatchObject({ noGames: false, week: { id: FIRST }, weekIds: WEEKS })
  })

  it("saves a Lineup and Predictions for any later Week, each shown only on its own", async () => {
    expect(await save(THIRD)).toEqual({ outcome: "saved" })
    expect(await predict(THIRD)).toEqual({ outcome: "saved" })

    const third = await loadLineupForm(league.manager, HOLIDAY, THIRD)
    expect(third?.lineup).toEqual(league.lineup())
    expect(third?.predictions).toMatchObject([{ gameId: league.gameIds[THIRD] }])
    expect(await loadLineupForm(league.manager, HOLIDAY, SECOND)).toMatchObject({ lineup: null, predictions: [] })
  })

  it("has nothing to save in a Week with no games", async () => {
    expect(await save(HOLIDAY_WEEK)).toEqual({ outcome: "no-games" })
  })

  it.each([
    ["the open Week until it closes", "2026-12-05T07:59:00", FIRST, false],
    ["the Week that just closed on its Saturday", "2026-12-05T08:00:00", FIRST, true],
    ["that Week through Sunday night", "2026-12-06T23:59:00", FIRST, true],
    ["the next Week from Monday", "2026-12-07T00:00:00", SECOND, false],
    ["the latest Week once none are left to pick", "2026-12-28T12:00:00", THIRD, true],
  ])("opens on %s", async (_name, now, week, closed) => {
    expect(await loadLineupForm(league.manager, at(now))).toMatchObject({ week: { id: week }, closed, weekIds: WEEKS })
  })

  it("opens a closed Week by its link, and takes no more picks for it", async () => {
    const locked = at("2026-12-08T12:00:00")

    expect(await loadLineupForm(league.manager, locked, FIRST)).toMatchObject({ week: { id: FIRST }, closed: true, weekIds: WEEKS })
    expect(await save(FIRST, league.lineup(), locked)).toMatchObject({ outcome: "locked" })
    expect(await predict(FIRST, locked)).toMatchObject({ outcome: "locked" })
  })

  it("holds a use for each starter in a saved Week, in every direction", async () => {
    await save(SECOND)
    await save(THIRD)

    // Both of the star's two uses are held by later Weeks, so an earlier one can't take them.
    expect(await save(FIRST)).toEqual({ outcome: "invalid", errors: ["at-usage-cap"] })
    const first = await loadLineupForm(league.manager, HOLIDAY, FIRST)
    expect(first?.players.find((p) => p.id === league.star)?.skaterUsesLeft).toBe(0)
    // A saved Week can still be saved again, and dropping the star there frees a use.
    expect(await save(THIRD)).toEqual({ outcome: "saved" })
    expect(await save(THIRD, league.lineup(league.others))).toEqual({ outcome: "saved" })
    const again = await loadLineupForm(league.manager, HOLIDAY, FIRST)
    expect(again?.players.find((p) => p.id === league.star)?.skaterUsesLeft).toBe(1)
  })

  it("keeps later picks off every public page", async () => {
    await save(SECOND)
    await predict(SECOND)

    const standings = await fetchFantasyStandings()
    expect(standings).toMatchObject({ openWeekId: FIRST, weeks: [], pickem: { weeks: [] } })
    expect(Object.keys(standings!.overviews)).toEqual([FIRST])
    expect(await loadPublicManager(league.manager, HOLIDAY)).toMatchObject({ history: { weeks: [] }, pickemHistory: { weeks: [] } })
  })
})
