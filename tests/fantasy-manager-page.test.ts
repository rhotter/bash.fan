import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin-session", () => ({ getSession: async () => true }))
vi.mock("next/cache", async (original) => ({
  ...(await original<typeof import("next/cache")>()),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}))

import { PUT as adminPut } from "@/app/api/bash/admin/seasons/[id]/fantasy/route"
import { PATCH as adminRename } from "@/app/api/bash/admin/seasons/[id]/fantasy/managers/[managerId]/route"
import ManagerPage, { generateMetadata } from "@/app/fantasy/manager/[id]/page"
import { PUT as saveLineup } from "@/app/api/bash/fantasy/lineup/route"
import { PUT as savePredictions } from "@/app/api/bash/fantasy/predictions/route"
import { POST as register } from "@/app/api/bash/fantasy/register/route"
import { db, schema } from "@/lib/db"
import { fetchFantasyStandings } from "@/lib/fetch-fantasy"
import { setupGame } from "./factories/setupGame"
import { setupPlayer } from "./factories/setupPlayer"
import { setupPlayerGame } from "./factories/setupPlayerGame"
import { setupSeason } from "./factories/setupSeason"
import { setupTeam } from "./factories/setupTeam"

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))

const WEDNESDAY = new Date("2026-11-04T12:00:00-08:00")
const AFTER_LOCK = new Date("2026-11-08T12:00:00-08:00")
const OPEN_WEEK = "2026-11-07"
const NEXT_WEEK = "2026-11-14"
let seasonId: string
const season = () => ({ params: Promise.resolve({ id: seasonId }) })
let lineup: { skaters: number[]; goalies: number[]; skaterBackups: number[]; goalieBackups: number[] }

const json = (url: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://test${url}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })

let ip = 0
async function registerManager(teamName: string, lastName = "Lovelace") {
  vi.stubEnv("VERCEL", "1")
  const response = await register(
    json("/api/bash/fantasy/register", "POST", { teamName, firstName: "Ada", lastName }, {
      "x-vercel-forwarded-for": `10.0.2.${++ip}`,
    })
  )
  const token = String((await response.json()).managerPath).split("/").pop()!
  const [row] = await db.select().from(schema.fantasyManagers).where(eq(schema.fantasyManagers.teamName, teamName))
  return { token, id: row.id }
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })
const putLineup = (token: string, weekId: string) =>
  saveLineup(json("/api/bash/fantasy/lineup", "PUT", { weekId, lineup }, auth(token)))
const putPrediction = (token: string, weekId: string, gameId: string) =>
  savePredictions(
    json("/api/bash/fantasy/predictions", "PUT", { weekId, predictions: [{ gameId, homeScore: 4, awayScore: 2 }] }, auth(token))
  )

const page = (id: string) => ({ params: Promise.resolve({ id }) })
const loadPage = (id: string) => ManagerPage(page(id))
const flatten = (node: unknown): string => JSON.stringify(node, (_key, value) => (typeof value === "function" ? undefined : value))

let openGame: string
let nextGame: string

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: WEDNESDAY })
  vi.stubEnv("SESSION_SECRET", "x".repeat(32))
  const { season: s } = await setupSeason({ isCurrent: true })
  seasonId = s.id
  const { team: seals } = await setupTeam()
  const { team: yetis } = await setupTeam()
  const onSeals = { season: s, team: seals }
  const onYetis = { season: s, team: yetis }
  const { player: scorer } = await setupPlayer({ roster: [onSeals] })
  const { player: second } = await setupPlayer({ roster: [onSeals] })
  const { player: third } = await setupPlayer({ roster: [onYetis] })
  const { player: goalie } = await setupPlayer({ roster: [{ ...onSeals, isGoalie: true }] })
  lineup = { skaters: [scorer.id, second.id, third.id], goalies: [goalie.id], skaterBackups: [], goalieBackups: [] }
  const upcoming = { time: "9:00a", status: "scheduled", hasBoxscore: false, homeScore: null, awayScore: null }
  const first = await setupGame({
    season: s,
    homeTeam: seals,
    awayTeam: yetis,
    date: OPEN_WEEK,
    time: "9:00a",
    status: "final",
    hasBoxscore: true,
    homeScore: 5,
    awayScore: 1,
  })
  nextGame = (await setupGame({ season: s, homeTeam: seals, awayTeam: yetis, date: NEXT_WEEK, ...upcoming })).game.id
  openGame = first.game.id
  await setupPlayerGame({ player: scorer, game: first.game, goals: 2 })
  await adminPut(json("/x", "PUT", {}), season())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("/fantasy/manager/[id]", () => {
  it("links every Team Name on /fantasy by Manager id", async () => {
    const { id } = await registerManager("Aces")
    await putLineup((await registerManager("Bears")).token, OPEN_WEEK)
    vi.setSystemTime(AFTER_LOCK)

    const data = await fetchFantasyStandings()

    expect(data?.season.rows.find((row) => row.teamName === "Aces")?.managerId).toBe(id)
    expect(data?.weeks[0].rows[0].managerId).toBeTypeOf("number")
  })

  it("shows season totals and locked Weeks for both games", async () => {
    const { token, id } = await registerManager("Aces")
    await putLineup(token, OPEN_WEEK)
    await putPrediction(token, OPEN_WEEK, openGame)
    vi.setSystemTime(AFTER_LOCK)

    const html = flatten(await loadPage(String(id)))

    expect(html).toContain("Aces")
    expect(html).toContain(OPEN_WEEK)
    expect(html).toContain('"points":20')
    expect(html).toContain('"outcome":"correct"')
  })

  it("never exposes the open Week", async () => {
    const { token, id } = await registerManager("Aces")
    await putLineup(token, OPEN_WEEK)
    await putPrediction(token, OPEN_WEEK, openGame)
    vi.setSystemTime(AFTER_LOCK)
    await putLineup(token, NEXT_WEEK)
    await putPrediction(token, NEXT_WEEK, nextGame)

    const html = flatten(await loadPage(String(id)))

    expect(html).toContain(OPEN_WEEK)
    expect(html).not.toContain(NEXT_WEEK)
    expect(html).not.toContain(nextGame)
  })

  it("shows nothing before the first Lock", async () => {
    const { token, id } = await registerManager("Aces")
    await putLineup(token, OPEN_WEEK)
    await putPrediction(token, OPEN_WEEK, openGame)

    const html = flatten(await loadPage(String(id)))

    expect(html).not.toContain(OPEN_WEEK)
    expect(html).not.toContain(openGame)
  })

  it("never exposes a real name", async () => {
    const { token, id } = await registerManager("Aces", "Zzyzx")
    await putLineup(token, OPEN_WEEK)
    vi.setSystemTime(AFTER_LOCK)

    const rendered = flatten(await loadPage(String(id)))
    const metadata = JSON.stringify(await generateMetadata(page(String(id))))
    const standings = JSON.stringify(await fetchFantasyStandings())

    for (const text of [rendered, metadata, standings]) {
      expect(text).not.toContain("Zzyzx")
      expect(text).not.toContain("Ada")
    }
  })

  it("follows a rename, because the URL uses the id", async () => {
    const { id } = await registerManager("Aces")
    await adminRename(
      json("/x", "PATCH", { teamName: "Ice Aces" }),
      { params: Promise.resolve({ id: seasonId, managerId: String(id) }) }
    )

    expect(flatten(await loadPage(String(id)))).toContain("Ice Aces")
  })

  it.each(["999", "abc", "1.5", "-1", "0x10"])("is not found for id %s", async (id) => {
    await registerManager("Aces")

    await expect(loadPage(id)).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("is not found while the game is off", async () => {
    const { id } = await registerManager("Aces")
    await db.delete(schema.fantasySeasons).where(eq(schema.fantasySeasons.seasonId, seasonId))

    await expect(loadPage(String(id))).rejects.toThrow("NEXT_NOT_FOUND")
  })
})

describe("Manager Link pages", () => {
  it("aren't indexed and send no referrer", async () => {
    const { default: config } = await import("../next.config.mjs")

    const rules = await config.headers!()
    const rule = rules.find((r: { source: string }) => r.source === "/fantasy/m/:path*")

    expect(rule?.headers).toEqual(
      expect.arrayContaining([
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ])
    )
  })
})
