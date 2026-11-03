import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin-session", () => ({ getSession: async () => true }))
vi.mock("next/cache", async (original) => ({ ...(await original<typeof import("next/cache")>()), revalidateTag: vi.fn() }))

import { PUT as adminPut } from "@/app/api/bash/admin/seasons/[id]/fantasy/route"
import { DELETE as adminDelete } from "@/app/api/bash/admin/seasons/[id]/fantasy/managers/[managerId]/route"
import { PUT as savePredictions } from "@/app/api/bash/fantasy/predictions/route"
import { POST as register } from "@/app/api/bash/fantasy/register/route"
import { db, schema } from "@/lib/db"
import { loadLineupForm, readManagerPredictions } from "@/lib/fantasy/lineups"
import { findManagerByToken } from "@/lib/fantasy/managers"
import { fetchFantasyStandings } from "@/lib/fetch-fantasy"
import { setupGame } from "./factories/setupGame"
import { setupSeason } from "./factories/setupSeason"
import { setupTeam } from "./factories/setupTeam"

const WEDNESDAY = new Date("2026-11-04T12:00:00-08:00")
const AFTER_LOCK = new Date("2026-11-07T08:00:00-08:00")
const OPEN_WEEK = "2026-11-07"
let seasonId: string
const season = () => ({ params: Promise.resolve({ id: seasonId }) })

const json = (url: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://test${url}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })

let ip = 0
async function registerManager(teamName: string) {
  vi.stubEnv("VERCEL", "1")
  const response = await register(
    json("/api/bash/fantasy/register", "POST", { teamName, firstName: "Ada", lastName: "Lovelace" }, {
      "x-vercel-forwarded-for": `10.0.1.${++ip}`,
    })
  )
  return String((await response.json()).managerPath).split("/").pop()!
}

const put = (token: string | null, body: unknown) =>
  savePredictions(
    json("/api/bash/fantasy/predictions", "PUT", body, token ? { authorization: `Bearer ${token}` } : {})
  )
const predict = (gameId: string, homeScore: number, awayScore: number) => ({ gameId, homeScore, awayScore })
const week = (predictions: unknown[], weekId = OPEN_WEEK) => ({ weekId, predictions })

let g1: string
let g2: string

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: WEDNESDAY })
  vi.stubEnv("SESSION_SECRET", "x".repeat(32))
  const { season: s } = await setupSeason({ isCurrent: true })
  seasonId = s.id
  const { team: seals } = await setupTeam()
  const { team: yetis } = await setupTeam()
  const upcoming = { date: OPEN_WEEK, status: "scheduled", hasBoxscore: false, homeScore: null, awayScore: null }
  g1 = (await setupGame({ season: s, homeTeam: seals, awayTeam: yetis, time: "9:00a", ...upcoming })).game.id
  g2 = (await setupGame({ season: s, homeTeam: yetis, awayTeam: seals, time: "10:00a", ...upcoming })).game.id
  await adminPut(json("/x", "PUT", {}), season())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("saving Predictions", () => {
  it("saves a Prediction per game, optional per game, and replaces them on the next save", async () => {
    const token = await registerManager("Aces")
    const manager = (await db.select().from(schema.fantasyManagers))[0]

    expect((await put(token, week([predict(g1, 4, 2)]))).status).toBe(200)
    expect(await readManagerPredictions(manager.id)).toEqual([predict(g1, 4, 2)])

    expect((await put(token, week([predict(g1, 1, 3), predict(g2, 6, 5)]))).status).toBe(200)
    expect((await readManagerPredictions(manager.id)).sort((a, b) => a.gameId.localeCompare(b.gameId))).toEqual(
      [predict(g1, 1, 3), predict(g2, 6, 5)].sort((a, b) => a.gameId.localeCompare(b.gameId))
    )
  })

  it("clears a Prediction by leaving it out, or all of them by sending none", async () => {
    const token = await registerManager("Aces")
    const manager = (await db.select().from(schema.fantasyManagers))[0]
    await put(token, week([predict(g1, 4, 2), predict(g2, 6, 5)]))

    await put(token, week([predict(g2, 6, 5)]))
    expect(await readManagerPredictions(manager.id)).toEqual([predict(g2, 6, 5)])

    expect((await put(token, week([]))).status).toBe(200)
    expect(await readManagerPredictions(manager.id)).toEqual([])
  })

  it("rejects tied scores", async () => {
    const token = await registerManager("Aces")
    const response = await put(token, week([predict(g1, 3, 3)]))

    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual(["tied-score"])
    expect(await db.select().from(schema.fantasyPredictions)).toEqual([])
  })

  it.each([[31, 2], [2, 31], [-1, 2], [2.5, 1]])("rejects the score %s-%s", async (home, away) => {
    const token = await registerManager("Aces")

    expect((await put(token, week([predict(g1, home, away)]))).status).toBe(400)
    expect(await db.select().from(schema.fantasyPredictions)).toEqual([])
  })

  it("rejects a game outside the Week and a repeated game", async () => {
    const token = await registerManager("Aces")

    const unknown = await put(token, week([predict("nope", 4, 2)]))
    const repeated = await put(token, week([predict(g1, 4, 2), predict(g1, 5, 2)]))

    expect((await unknown.json()).errors).toEqual(["unknown-game"])
    expect((await repeated.json()).errors).toEqual(["duplicate-game"])
  })

  it("keeps the old Predictions when any new one is invalid", async () => {
    const token = await registerManager("Aces")
    await put(token, week([predict(g1, 4, 2)]))

    await put(token, week([predict(g1, 5, 1), predict(g2, 2, 2)]))

    expect(await db.select().from(schema.fantasyPredictions)).toMatchObject([{ gameId: g1, homeScore: 4 }])
  })

  it("rejects an unknown or missing Manager Link", async () => {
    expect((await put("bogus", week([predict(g1, 4, 2)]))).status).toBe(401)
    expect((await put(null, week([predict(g1, 4, 2)]))).status).toBe(401)
  })

  it("rejects Predictions after the Lock, for the Week that closed", async () => {
    const token = await registerManager("Aces")
    await put(token, week([predict(g1, 4, 2)]))
    vi.setSystemTime(AFTER_LOCK)

    const response = await put(token, week([predict(g1, 1, 0)]))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: "locked" })
    expect(await db.select().from(schema.fantasyPredictions)).toMatchObject([{ homeScore: 4 }])
  })

  it("accepts a write a millisecond before the Lock and rejects one at it", async () => {
    const token = await registerManager("Aces")

    vi.setSystemTime(new Date(AFTER_LOCK.getTime() - 1))
    expect((await put(token, week([predict(g1, 4, 2)]))).status).toBe(200)

    vi.setSystemTime(AFTER_LOCK)
    expect((await put(token, week([predict(g1, 1, 0)]))).status).toBe(409)
    expect(await db.select().from(schema.fantasyPredictions)).toMatchObject([{ homeScore: 4 }])
  })

  it("won't take Predictions for a later Week before it opens", async () => {
    const token = await registerManager("Aces")

    const response = await put(token, week([predict(g1, 4, 2)], "2026-11-14"))

    expect(response.status).toBe(409)
    expect(await db.select().from(schema.fantasyPredictions)).toEqual([])
  })

  it("rejects out-of-range, fractional and malformed input", async () => {
    const token = await registerManager("Aces")

    for (const body of [
      week([predict(g1, 31, 2)]),
      week([predict(g1, -1, 2)]),
      week([predict(g1, 2.5, 1)]),
      week([predict(g1, 4, 2)], "not-a-week"),
    ]) {
      expect((await put(token, body)).status).toBe(400)
    }
    expect(await db.select().from(schema.fantasyPredictions)).toEqual([])
  })

  it("refuses a Week with no games", async () => {
    const token = await registerManager("Aces")
    await db.delete(schema.games).where(eq(schema.games.seasonId, seasonId))

    expect((await put(token, week([]))).status).toBe(409)
  })

  it("saves separately from Lineups", async () => {
    const token = await registerManager("Aces")
    await put(token, week([predict(g1, 4, 2)]))

    expect(await db.select().from(schema.fantasyLineups)).toEqual([])
  })
})

describe("Pick'em history", () => {
  it("hides the open Week's Predictions from history, and shows them once the Week locks", async () => {
    const token = await registerManager("Aces")
    await put(token, week([predict(g1, 5, 1)]))
    await db.update(schema.games).set({ status: "final", homeScore: 5, awayScore: 1, hasBoxscore: true }).where(eq(schema.games.id, g1))
    const manager = (await findManagerByToken(token))!

    const before = await loadLineupForm(manager)
    expect(before?.predictions).toEqual([predict(g1, 5, 1)])
    expect(before?.pickemHistory.weeks).toEqual([])

    vi.setSystemTime(new Date("2026-11-08T12:00:00-08:00"))
    const after = await loadLineupForm(manager)
    expect(after?.pickemHistory).toMatchObject({ correct: 1, goalError: 0 })
    expect(after?.pickemHistory.weeks[0]).toMatchObject({ id: OPEN_WEEK, predictions: [{ gameId: g1, outcome: "correct" }] })
    expect(after?.pickemHistory.weeks[0].games.map((g) => g.id)).toContain(g1)
  })
})

describe("Pick'em standings", () => {
  async function playWeek() {
    const aces = await registerManager("Aces")
    const bears = await registerManager("Bears")
    const lurker = await registerManager("Lurkers")
    await put(aces, week([predict(g1, 4, 2)]))
    await put(bears, week([predict(g1, 1, 4), predict(g2, 3, 2)]))
    return { aces, bears, lurker }
  }

  it("keeps Predictions out of the public page until the Lock", async () => {
    await playWeek()

    const before = await fetchFantasyStandings()

    expect(before?.pickem.weeks).toEqual([])
    expect(before?.pickem.season.rows).toEqual([])
    expect(JSON.stringify(before)).not.toContain('"homeScore":4')
  })

  it("publishes Predictions at the Lock and ranks them", async () => {
    await playWeek()
    await db.update(schema.games).set({ status: "final", homeScore: 5, awayScore: 1, hasBoxscore: true }).where(eq(schema.games.id, g1))
    vi.setSystemTime(AFTER_LOCK)

    const after = await fetchFantasyStandings()

    expect(after?.pickem.weeks[0].rows.map((r) => [r.teamName, r.rank, r.correct, r.goalError])).toEqual([
      ["Aces", 1, 1, 2],
      ["Bears", 2, 0, 7],
    ])
    expect(after?.pickem.weeks[0].provisional).toBe(true)
    expect(after?.pickem.season.rows.map((r) => r.teamName)).toEqual(["Aces", "Bears"])
  })

  it("never lets Fantasy standings move Pick'em, or the other way", async () => {
    await playWeek()
    vi.setSystemTime(AFTER_LOCK)

    const data = await fetchFantasyStandings()

    expect(data?.weeks.flatMap((w) => w.rows)).toEqual([])
    expect(data?.season.rows.map((r) => r.points)).toEqual([0, 0, 0])
    expect(data?.pickem.season.rows).toHaveLength(2)
  })

  it("removes a Manager's Predictions with them", async () => {
    await playWeek()
    const [aces] = await db.select().from(schema.fantasyManagers).where(eq(schema.fantasyManagers.teamName, "Aces"))

    const response = await adminDelete(new Request("http://test/x"), {
      params: Promise.resolve({ id: seasonId, managerId: String(aces.id) }),
    })

    expect(response.status).toBe(200)
    expect(await db.select().from(schema.fantasyPredictions)).toHaveLength(2)
    expect(await readManagerPredictions(aces.id)).toEqual([])
  })
})
