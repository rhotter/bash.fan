import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const isAdmin = vi.hoisted(() => ({ value: true }))
vi.mock("@/lib/admin-session", () => ({ getSession: async () => isAdmin.value }))
const revalidateTag = vi.hoisted(() => vi.fn())
vi.mock("next/cache", async (original) => ({ ...(await original<typeof import("next/cache")>()), revalidateTag }))

import { PUT as adminLineup } from "@/app/api/bash/admin/seasons/[id]/fantasy/managers/[managerId]/lineup/route"
import { PUT as adminPredictions } from "@/app/api/bash/admin/seasons/[id]/fantasy/managers/[managerId]/predictions/route"
import { db, schema } from "@/lib/db"
import { DEFAULT_FANTASY_CONFIG, type FantasyConfig } from "@/lib/fantasy/config"
import { loadAdminPicks, saveLineup } from "@/lib/fantasy/lineups"
import { createManager } from "@/lib/fantasy/managers"
import { savePredictions } from "@/lib/fantasy/predictions"
import { getFantasySeason, saveFantasyConfig } from "@/lib/fantasy/season"
import { fetchFantasyStandings } from "@/lib/fetch-fantasy"
import { setupGame } from "./factories/setupGame"
import { setupPlayer } from "./factories/setupPlayer"
import { setupPlayerGame } from "./factories/setupPlayerGame"
import { setupSeason } from "./factories/setupSeason"
import { setupTeam } from "./factories/setupTeam"

const LAUNCH = new Date("2026-11-04T12:00:00-08:00")
/** After the Nov 7 Lock, so that Week is closed and Nov 14 is open. */
const NOW = new Date("2026-11-11T12:00:00-08:00")
const PAST_WEEK = "2026-11-07"
const OPEN_WEEK = "2026-11-14"
const FUTURE_WEEK = "2026-11-21"

async function setupLeague(config: FantasyConfig = DEFAULT_FANTASY_CONFIG) {
  const { season } = await setupSeason({ isCurrent: true })
  const { team: seals } = await setupTeam()
  const { team: yetis } = await setupTeam()
  const skaters = []
  for (const team of [seals, seals, yetis, yetis]) {
    skaters.push((await setupPlayer({ roster: [{ season, team }] })).player)
  }
  const { player: goalie } = await setupPlayer({ roster: [{ season, team: seals, isGoalie: true }] })

  const game = async (date: string) =>
    (await setupGame({ season, homeTeam: seals, awayTeam: yetis, date, time: "9:00a", homeScore: 4, awayScore: 2 })).game
  const games = { past: await game(PAST_WEEK), open: await game(OPEN_WEEK), future: await game(FUTURE_WEEK) }
  await saveFantasyConfig(season.id, "regular", config, LAUNCH)

  await createManager(season.id, "regular", { teamName: "Puck Norris", firstName: "Ada", lastName: "Lovelace" })
  const [manager] = await db.select().from(schema.fantasyManagers)

  const ids = skaters.map((player) => player.id)
  const lineup = (overrides: object = {}) => ({
    skaters: ids.slice(0, 3),
    goalies: [goalie.id],
    skaterBackups: [ids[3]],
    goalieBackups: [],
    ...overrides,
  })
  return { season, manager, games, ids, goalie, lineup, contest: (await getFantasySeason(season.id))! }
}

let league: Awaited<ReturnType<typeof setupLeague>>

const put = (
  route: typeof adminLineup,
  body: unknown,
  params: { id?: string; managerId?: number | string } = {}
) =>
  route(new Request("http://test/x", { method: "PUT", body: JSON.stringify(body) }), {
    params: Promise.resolve({
      id: params.id ?? league.season.id,
      managerId: String(params.managerId ?? league.manager.id),
    }),
  })

const putLineup = (weekId: string, lineup: unknown = league.lineup(), extra: object = {}) =>
  put(adminLineup, { weekId, lineup, ...extra })

const putPredictions = (weekId: string, predictions: unknown[]) => put(adminPredictions, { weekId, predictions })

const storedLineups = () => db.select().from(schema.fantasyLineups)
const storedPredictions = () => db.select().from(schema.fantasyPredictions)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW })
  isAdmin.value = true
  revalidateTag.mockClear()
  league = await setupLeague()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("admin Lineup entry", () => {
  it("saves a Lineup for a closed Week, which the standings then score", async () => {
    await setupPlayerGame({ player: { id: league.ids[0] } as never, game: league.games.past, goals: 2 })

    const response = await putLineup(PAST_WEEK)

    expect(response.status).toBe(200)
    expect(await storedLineups()).toMatchObject([{ weekId: PAST_WEEK, skaters: league.ids.slice(0, 3) }])
    expect((await fetchFantasyStandings())?.season.rows).toMatchObject([{ teamName: "Puck Norris", points: 20 }])
    expect(revalidateTag).toHaveBeenCalledWith("fantasy", { expire: 0 })
  })

  it("leaves the Manager's own save locked for that Week", async () => {
    const result = await saveLineup(league.manager, league.contest, PAST_WEEK, league.lineup())

    expect(result).toEqual({ outcome: "locked", openWeekId: OPEN_WEEK })
  })

  it("replaces a Lineup that's already saved, including the open Week's", async () => {
    await putLineup(OPEN_WEEK)
    const swapped = [league.ids[0], league.ids[1], league.ids[3]]

    const response = await putLineup(OPEN_WEEK, league.lineup({ skaters: swapped, skaterBackups: [] }))

    expect(response.status).toBe(200)
    expect(await storedLineups()).toMatchObject([{ weekId: OPEN_WEEK, skaters: swapped }])
  })

  it.each([
    ["a Week that isn't open yet", FUTURE_WEEK],
    ["a Week with no counting games", "2026-10-31"],
  ])("refuses %s", async (_name, weekId) => {
    const response = await putLineup(weekId)

    expect(response.status).toBe(409)
    expect(await storedLineups()).toEqual([])
  })

  it("holds the Usage Cap unless the admin overrides it", async () => {
    const config = { ...DEFAULT_FANTASY_CONFIG, usageCap: { skater: 1, goalie: null } }
    await saveFantasyConfig(league.season.id, "regular", config, LAUNCH)
    // The open Week's game hasn't been played, so its starters each hold a use.
    await db.update(schema.games).set({ status: "upcoming", hasBoxscore: false }).where(eq(schema.games.id, league.games.open.id))
    await putLineup(OPEN_WEEK)

    const refused = await putLineup(PAST_WEEK)

    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ errors: ["at-usage-cap"], canOverride: true })
    expect(await storedLineups()).toHaveLength(1)

    expect((await putLineup(PAST_WEEK, league.lineup(), { overrideCap: true })).status).toBe(200)
    expect(await storedLineups()).toHaveLength(2)
  })

  it("never overrides the other Lineup rules", async () => {
    const repeated = league.lineup({ skaters: [league.ids[0], league.ids[0], league.ids[1]] })

    const response = await putLineup(PAST_WEEK, repeated, { overrideCap: true })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ errors: ["duplicate-player"], canOverride: false })
    expect(await storedLineups()).toEqual([])
  })
})

describe("correcting a closed Week after rosters change", () => {
  const rosterRow = (playerId: number) => eq(schema.playerSeasons.playerId, playerId)

  /** A saved past Week whose first skater has since moved to a team with no game that Week. */
  async function savedThenTraded() {
    await putLineup(PAST_WEEK)
    const { team: idle } = await setupTeam()
    await db.update(schema.playerSeasons).set({ teamSlug: idle.slug }).where(rosterRow(league.ids[0]))
  }

  /** The saved Lineup with its Backup swapped into the third skater slot. */
  const corrected = () => league.lineup({ skaters: [league.ids[0], league.ids[1], league.ids[3]], skaterBackups: [league.ids[2]] })

  it("keeps a saved Player who now has a Bye", async () => {
    await savedThenTraded()

    expect((await putLineup(PAST_WEEK, corrected())).status).toBe(200)
    expect((await storedLineups())[0].skaters).toEqual(corrected().skaters)
  })

  it("keeps a saved Player who has left the rosters", async () => {
    await putLineup(PAST_WEEK)
    await db.delete(schema.playerSeasons).where(rosterRow(league.ids[0]))

    expect((await putLineup(PAST_WEEK, corrected())).status).toBe(200)
  })

  it("still refuses to add a Player who has a Bye or isn't rostered", async () => {
    expect((await putLineup(PAST_WEEK, league.lineup({ skaterBackups: [] }))).status).toBe(200)
    const { team: idle } = await setupTeam()
    const { player: newcomer } = await setupPlayer({ roster: [{ season: league.season, team: idle }] })
    await db.delete(schema.playerSeasons).where(rosterRow(league.ids[3]))

    const response = await putLineup(
      PAST_WEEK,
      league.lineup({ skaters: [newcomer.id, league.ids[1], league.ids[2]], skaterBackups: [league.ids[3]] })
    )

    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual(expect.arrayContaining(["on-bye", "not-rostered"]))
  })

  it("doesn't carry a saved goalie over into a skater slot", async () => {
    await putLineup(PAST_WEEK)
    await db.delete(schema.playerSeasons).where(rosterRow(league.goalie.id))

    const response = await putLineup(
      PAST_WEEK,
      league.lineup({ skaters: [league.goalie.id, league.ids[1], league.ids[2]], goalies: [] })
    )

    expect((await response.json()).errors).toContain("not-rostered")
  })

  it("makes no exception for the open Week, which the Manager can still change", async () => {
    await putLineup(OPEN_WEEK)
    await db.delete(schema.playerSeasons).where(rosterRow(league.ids[0]))

    expect((await putLineup(OPEN_WEEK, corrected())).status).toBe(422)
  })
})

describe("admin Prediction entry", () => {
  const predict = (gameId: string, homeScore = 3, awayScore = 1) => ({ gameId, homeScore, awayScore })

  it("saves and then clears Predictions for a closed Week", async () => {
    expect((await putPredictions(PAST_WEEK, [predict(league.games.past.id)])).status).toBe(200)
    expect((await fetchFantasyStandings())?.pickem.season.rows).toMatchObject([{ teamName: "Puck Norris", correct: 1 }])

    expect((await putPredictions(PAST_WEEK, [])).status).toBe(200)
    expect(await storedPredictions()).toEqual([])
  })

  it("leaves the Manager's own save locked for that Week", async () => {
    const result = await savePredictions(league.manager, league.contest, PAST_WEEK, [predict(league.games.past.id)])

    expect(result).toEqual({ outcome: "locked", openWeekId: OPEN_WEEK })
  })

  it("still refuses a tie or another Week's game", async () => {
    const tie = await putPredictions(PAST_WEEK, [predict(league.games.past.id, 2, 2)])
    const elsewhere = await putPredictions(PAST_WEEK, [predict(league.games.open.id)])

    expect(await tie.json()).toMatchObject({ errors: ["tied-score"] })
    expect(await elsewhere.json()).toMatchObject({ errors: ["unknown-game"] })
    expect(await storedPredictions()).toEqual([])
  })

  it("refuses a Week that isn't open yet", async () => {
    expect((await putPredictions(FUTURE_WEEK, [predict(league.games.future.id)])).status).toBe(409)
  })
})

describe("admin pick routes", () => {
  it.each([
    ["Lineup", adminLineup],
    ["Predictions", adminPredictions],
  ])("need an admin session to save %s", async (_name, route) => {
    isAdmin.value = false

    expect((await put(route, { weekId: PAST_WEEK, lineup: league.lineup(), predictions: [] })).status).toBe(401)
    expect(await storedLineups()).toEqual([])
  })

  it.each([
    ["Lineup", adminLineup],
    ["Predictions", adminPredictions],
  ])("don't find a Manager under another season when saving %s", async (_name, route) => {
    const body = { weekId: PAST_WEEK, lineup: league.lineup(), predictions: [] }

    expect((await put(route, body, { id: "another-season" })).status).toBe(404)
    expect((await put(route, body, { managerId: "abc" })).status).toBe(404)
  })

  it.each([
    ["Lineup", adminLineup],
    ["Predictions", adminPredictions],
  ])("reject an unreadable %s", async (_name, route) => {
    expect((await put(route, { weekId: "soon" })).status).toBe(400)
  })
})

describe("loadAdminPicks", () => {
  it("offers every Week up to the open one and starts on the open Week", async () => {
    const picks = await loadAdminPicks(league.manager)

    expect(picks?.weekIds).toEqual([PAST_WEEK, OPEN_WEEK])
    expect(picks?.form.week.id).toBe(OPEN_WEEK)
    expect(picks?.closed).toBe(false)
  })

  it("shows a chosen Week's saved picks and games", async () => {
    await putLineup(PAST_WEEK)
    await putPredictions(PAST_WEEK, [{ gameId: league.games.past.id, homeScore: 3, awayScore: 1 }])

    const picks = await loadAdminPicks(league.manager, PAST_WEEK)

    expect(picks?.closed).toBe(true)
    expect(picks?.form.lineup).toEqual(league.lineup())
    expect(picks?.form.predictions).toEqual([{ gameId: league.games.past.id, homeScore: 3, awayScore: 1 }])
    expect(picks?.form.overview.games.map((g) => g.id)).toEqual([league.games.past.id])
  })

  it("falls back to the open Week for one that can't be edited", async () => {
    expect((await loadAdminPicks(league.manager, FUTURE_WEEK))?.form.week.id).toBe(OPEN_WEEK)
  })
})
