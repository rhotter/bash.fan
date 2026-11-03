import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const isAdmin = vi.hoisted(() => ({ value: true }))
vi.mock("@/lib/admin-session", () => ({ getSession: async () => isAdmin.value }))
const revalidateTag = vi.hoisted(() => vi.fn())
vi.mock("next/cache", async (original) => ({ ...(await original<typeof import("next/cache")>()), revalidateTag }))

import { GET as adminGet, PUT as adminPut } from "@/app/api/bash/admin/seasons/[id]/fantasy/route"
import {
  DELETE as adminDelete,
  PATCH as adminPatch,
} from "@/app/api/bash/admin/seasons/[id]/fantasy/managers/[managerId]/route"
import { POST as adminReissue } from "@/app/api/bash/admin/seasons/[id]/fantasy/managers/[managerId]/reissue/route"
import { PUT as saveLineup } from "@/app/api/bash/fantasy/lineup/route"
import { POST as register } from "@/app/api/bash/fantasy/register/route"
import { db, schema } from "@/lib/db"
import { DEFAULT_FANTASY_CONFIG, type FantasyConfig } from "@/lib/fantasy/config"
import { loadLineupForm, reassignLineupPlayer } from "@/lib/fantasy/lineups"
import { findManagerByToken } from "@/lib/fantasy/managers"
import { fetchFantasyStandings } from "@/lib/fetch-fantasy"
import { setupGame, type GameOverrides } from "./factories/setupGame"
import { setupGoalieGame } from "./factories/setupGoalieGame"
import { setupPlayer } from "./factories/setupPlayer"
import { setupPlayerGame } from "./factories/setupPlayerGame"
import { setupSeason } from "./factories/setupSeason"
import { setupTeam } from "./factories/setupTeam"

const WEDNESDAY = new Date("2026-11-04T12:00:00-08:00")
const LOCK = new Date("2026-11-07T08:00:00-08:00")
const OPEN_WEEK = "2026-11-07"
const seasonParams = () => ({ params: Promise.resolve({ id: league.season.id }) })
const managerParams = (managerId: number | string) => ({
  params: Promise.resolve({ id: league.season.id, managerId: String(managerId) }),
})

const json = (url: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://test${url}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })

let ipCounter = 0
async function postRegistration(body: Record<string, unknown>, ip = `10.0.0.${++ipCounter}`) {
  vi.stubEnv("VERCEL", "1")
  return register(json("/api/bash/fantasy/register", "POST", body, { "x-vercel-forwarded-for": ip }))
}

async function registerManager(teamName = "Puck Norris", firstName = "Ada", lastName = "Lovelace") {
  const response = await postRegistration({ teamName, firstName, lastName })
  const body = await response.json()
  return { token: String(body.managerPath).split("/").pop()!, body, response }
}

const putLineup = (token: string, lineup: unknown = league.lineup(), weekId = OPEN_WEEK) =>
  saveLineup(
    json("/api/bash/fantasy/lineup", "PUT", { weekId, lineup }, { authorization: `Bearer ${token}` })
  )

const turnOn = (config?: FantasyConfig) =>
  adminPut(json("/x", "PUT", config ? { config } : {}), seasonParams())

const adminList = async () => (await adminGet(new Request("http://test/x"), seasonParams())).json()

let league: Awaited<ReturnType<typeof setupLeague>>

/**
 * Players are named by label: 1-5 skate, 7 and 8 are flagged goalies, 5 was traded, and 9 is off the roster.
 * `id(n)` is the generated database id of player n.
 */
async function setupLeague() {
  const { season } = await setupSeason({ isCurrent: true })
  const { team: seals } = await setupTeam()
  const { team: yetis } = await setupTeam()
  const onSeals = { season, team: seals }
  const onYetis = { season, team: yetis }

  const players = {
    1: await setupPlayer({ roster: [onSeals] }),
    2: await setupPlayer({ roster: [onSeals] }),
    3: await setupPlayer({ roster: [onYetis] }),
    4: await setupPlayer({ roster: [onYetis] }),
    5: await setupPlayer({ roster: [onSeals, onYetis] }),
    7: await setupPlayer({ roster: [{ ...onSeals, isGoalie: true }] }),
    8: await setupPlayer({ roster: [{ ...onYetis, isGoalie: true }] }),
    9: await setupPlayer(),
  }
  const game = (overrides: GameOverrides = {}) =>
    setupGame({ season, homeTeam: seals, awayTeam: yetis, time: "9:00a", ...overrides })
  const id = (label: keyof typeof players) => players[label].player.id
  const ids = (...labels: (keyof typeof players)[]) => labels.map(id)
  const lineup = (overrides: object = {}) => ({
    skaters: ids(1, 2, 3),
    goalies: ids(7),
    skaterBackups: ids(4),
    goalieBackups: ids(8),
    ...overrides,
  })
  return { season, seals, yetis, players, game, id, ids, lineup }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: WEDNESDAY })
  vi.stubEnv("SESSION_SECRET", "x".repeat(32))
  isAdmin.value = true
  league = await setupLeague()
  // A Week needs a game to take Lineups. A forfeit leaves results and provisional flags alone.
  await league.game({ isForfeit: true, date: OPEN_WEEK })
  await league.game({ isForfeit: true, date: "2026-11-14" })
  await turnOn()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("registration", () => {
  it("issues a Manager Link and stores only a hash of its token", async () => {
    const { token, response } = await registerManager()

    expect(response.status).toBe(201)
    expect(token.length).toBeGreaterThanOrEqual(40)
    const rows = await db.select().from(schema.fantasyManagers)
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toContain(token)
    expect(await findManagerByToken(token)).toMatchObject({ teamName: "Puck Norris" })
  })

  it("rejects a Team Name that differs only by case", async () => {
    await registerManager("Puck Norris")

    const { response } = await registerManager("PUCK  norris", "Grace", "Hopper")

    expect(response.status).toBe(409)
  })

  it.each([
    [{ teamName: " ", firstName: "A", lastName: "B" }],
    [{ teamName: "Team", firstName: "", lastName: "B" }],
    [{ teamName: "Team", firstName: "A" }],
    [{ teamName: "x".repeat(41), firstName: "A", lastName: "B" }],
  ])("requires a Team Name and real name: %j", async (body) => {
    expect((await postRegistration(body)).status).toBe(400)
  })

  it("is rate limited per client without touching the operator login throttle", async () => {
    const body = (n: number) => ({ teamName: `Team ${n}`, firstName: "A", lastName: "B" })
    for (let n = 0; n < 10; n++) expect((await postRegistration(body(n), "1.2.3.4")).status).toBe(201)

    expect((await postRegistration(body(10), "1.2.3.4")).status).toBe(429)
    expect((await postRegistration(body(11), "5.6.7.8")).status).toBe(201)
    const rows = await db
      .select()
      .from(schema.operatorAuthAttempts)
      .where(eq(schema.operatorAuthAttempts.bucket, "global"))
    expect(rows).toEqual([])
  })

  it("starts counting again once the window has passed", async () => {
    const body = (n: number) => ({ teamName: `Team ${n}`, firstName: "A", lastName: "B" })
    for (let n = 0; n < 11; n++) await postRegistration(body(n), "1.2.3.4")

    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 3601 * 1000))

    expect((await postRegistration(body(11), "1.2.3.4")).status).toBe(201)
  })

  it("is closed until the game is on", async () => {
    await db.delete(schema.fantasySeasons).where(eq(schema.fantasySeasons.seasonId, league.season.id))

    expect((await postRegistration({ teamName: "T", firstName: "A", lastName: "B" })).status).toBe(404)
  })
})

describe("Subs and Byes", () => {
  const scheduled = { date: OPEN_WEEK, status: "scheduled", hasBoxscore: false }

  it("refuses a Lineup and closes the form in a Week with no games", async () => {
    await db.delete(schema.games).where(eq(schema.games.seasonId, league.season.id))
    const { token } = await registerManager()

    const response = await putLineup(token)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: "no-games" })
    expect((await loadLineupForm((await findManagerByToken(token))!))?.noGames).toBe(true)
  })

  it("rejects a Player on a Bye, but not a traded Player with a team playing", async () => {
    const { team: otters } = await setupTeam()
    await db.delete(schema.games).where(eq(schema.games.seasonId, league.season.id))
    await league.game(scheduled)
    await db.update(schema.games).set({ awayTeam: otters.slug }).where(eq(schema.games.seasonId, league.season.id))
    const { token } = await registerManager()

    const onBye = await putLineup(token, league.lineup({ goalieBackups: [] }))
    const traded = await putLineup(token, league.lineup({ skaters: league.ids(1, 2, 5), skaterBackups: [], goalieBackups: [] }))

    expect(onBye.status).toBe(422)
    expect((await onBye.json()).errors).toEqual(["on-bye"])
    expect(traded.status).toBe(200)
    const form = await loadLineupForm((await findManagerByToken(token))!)
    expect(form?.players.filter((p) => p.onBye).map((p) => p.id).sort()).toEqual(league.ids(3, 4, 8).sort())
  })

  it("doesn't offer a Player as a default goalie for a game they only subbed in", async () => {
    const { game } = await league.game({ date: "2026-10-31" })
    await setupGoalieGame({ game, player: league.players[7].player })
    await setupGoalieGame({ game, player: league.players[2].player, isSub: true })
    const { token } = await registerManager()

    const form = await loadLineupForm((await findManagerByToken(token))!)

    expect(form?.defaultGoalieIds).not.toContain(league.id(2))
  })
})

describe("the Lineup form's Week overview and Selection options data", () => {
  it("carries the open Week's games and each Player's points per game this season", async () => {
    const { game } = await league.game({ date: "2026-10-31" })
    await setupPlayerGame({ player: league.players[1].player, game, goals: 1 })
    const { token } = await registerManager()

    const form = await loadLineupForm((await findManagerByToken(token))!)

    expect(form?.overview.weekId).toBe(OPEN_WEEK)
    expect(form?.overview.games).toMatchObject([{ home: { slug: league.seals.slug }, away: { slug: league.yetis.slug }, startLabel: "Sat 9:00a" }])
    expect(form?.players.find((p) => p.id === league.id(1))?.pointsPerGame).toBe(10)
    expect(form?.players.find((p) => p.id === league.id(2))?.pointsPerGame).toBe(0)
  })
})

describe("saving a Lineup", () => {
  it("saves and edits until the Lock, visible through the Manager Link", async () => {
    const { token } = await registerManager()

    expect((await putLineup(token)).status).toBe(200)
    expect((await putLineup(token, league.lineup({ skaterBackups: [] }))).status).toBe(200)

    const manager = await findManagerByToken(token)
    const form = await loadLineupForm(manager!)
    expect(form?.lineup).toEqual(league.lineup({ skaterBackups: [] }))
    expect(form?.week.id).toBe(OPEN_WEEK)
  })

  it("rejects a write at the Lock rather than moving it to the next Week", async () => {
    const { token } = await registerManager()
    vi.setSystemTime(LOCK)

    const response = await putLineup(token)

    expect(response.status).toBe(409)
    expect((await response.json()).error).not.toMatch(/lock/i)
    expect(await db.select().from(schema.fantasyLineups)).toEqual([])
  })

  it.each(["", "Bearer nope"])("rejects an invalid token: %j", async (authorization) => {
    const response = await saveLineup(
      json("/x", "PUT", { weekId: OPEN_WEEK, lineup: league.lineup() }, { authorization })
    )

    expect(response.status).toBe(401)
  })

  it.each([
    ["missing skater", () => league.lineup({ skaters: league.ids(1, 2) }), "skater-slots"],
    ["empty goalie slot", () => league.lineup({ goalies: [] }), "goalie-slot"],
    ["repeated Player", () => league.lineup({ skaterBackups: league.ids(1) }), "duplicate-player"],
    ["unrostered Player", () => league.lineup({ skaters: league.ids(1, 2, 9) }), "not-rostered"],
    ["flagged goalie as skater", () => league.lineup({ skaters: league.ids(1, 2, 7) }), "wrong-kind"],
  ])("rejects a %s", async (_label, lineup, error) => {
    const { token } = await registerManager()

    const response = await putLineup(token, lineup())

    expect(response.status).toBe(422)
    expect((await response.json()).errors).toContain(error)
  })

  it("rejects a malformed body", async () => {
    const { token } = await registerManager()

    expect((await putLineup(token, { skaters: "all" })).status).toBe(400)
  })

  async function playLastWeek(token: string, lineup = league.lineup()) {
    const { game } = await league.game({ date: "2026-11-07" })
    await setupPlayerGame({ player: league.players[1].player, game, goals: 1 })
    await setupGoalieGame({ player: league.players[7].player, game, saves: 20 })
    expect((await putLineup(token, lineup)).status).toBe(200)
    vi.setSystemTime(new Date("2026-11-10T12:00:00-08:00"))
  }

  it("enforces the Usage Cap from Selections that scored, and shows remaining uses", async () => {
    await turnOn({ ...DEFAULT_FANTASY_CONFIG, usageCap: { skater: 1, goalie: 1 } })
    const { token } = await registerManager()
    await playLastWeek(token)

    const atCap = await putLineup(token, league.lineup({ goalies: league.ids(8), goalieBackups: [] }), "2026-11-14")
    expect(atCap.status).toBe(422)
    expect((await atCap.json()).errors).toContain("at-usage-cap")

    const absentLastWeek = await putLineup(token, league.lineup({ skaters: league.ids(2, 3, 4), goalies: league.ids(8), skaterBackups: [], goalieBackups: [] }), "2026-11-14")
    expect(absentLastWeek.status).toBe(200)

    const form = await loadLineupForm((await findManagerByToken(token))!)
    const usesLeft = (label: 1 | 2 | 7) => form?.players.find((p) => p.id === league.id(label))
    expect(usesLeft(1)).toMatchObject({ skaterUsesLeft: 0, goalieUsesLeft: 1 })
    expect(usesLeft(2)).toMatchObject({ skaterUsesLeft: 1 })
    expect(usesLeft(7)).toMatchObject({ goalieUsesLeft: 0 })
  })

  it("never counts a game with a TBD time as unreadable", async () => {
    const { token } = await registerManager()
    await league.game({ date: "2026-11-14", time: "TBD", status: "upcoming", hasBoxscore: false })

    expect((await putLineup(token)).status).toBe(200)
  })

  it("offers Players who played goal, or the whole pool until someone has", async () => {
    const { token } = await registerManager()
    const manager = (await findManagerByToken(token))!

    expect((await loadLineupForm(manager))?.defaultGoalieIds.sort()).toEqual(league.ids(1, 2, 3, 4, 5, 7, 8).sort())

    const { game } = await league.game({ date: "2026-10-31" })
    await setupGoalieGame({ player: league.players[3].player, game, saves: 10 })

    expect((await loadLineupForm(manager))?.defaultGoalieIds).toEqual(league.ids(3))
  })

  it("follows a merged Player into saved Lineups", async () => {
    const { token } = await registerManager()
    await putLineup(token)

    await reassignLineupPlayer(league.id(4), league.id(5))

    const form = await loadLineupForm((await findManagerByToken(token))!)
    expect(form?.lineup?.skaterBackups).toEqual(league.ids(5))
  })

  it("drops the merged Player when a Lineup already holds the one they merge into", async () => {
    const { token } = await registerManager()
    await putLineup(token)

    await reassignLineupPlayer(league.id(4), league.id(1))

    const form = await loadLineupForm((await findManagerByToken(token))!)
    expect(form?.lineup).toEqual(league.lineup({ skaterBackups: [] }))
  })

  it("holds a use for a Selection in a locked Week awaiting its boxscore, until it resolves", async () => {
    await turnOn({ ...DEFAULT_FANTASY_CONFIG, usageCap: { skater: 1, goalie: 1 } })
    const { token } = await registerManager()
    const { game } = await league.game({ date: "2026-11-07", hasBoxscore: false })
    await putLineup(token)
    vi.setSystemTime(new Date("2026-11-07T09:00:00-08:00"))

    const nextWeek = league.lineup({ skaters: league.ids(1, 4, 5), goalies: league.ids(8), skaterBackups: [], goalieBackups: [] })
    const whilePending = await putLineup(token, nextWeek, "2026-11-14")
    expect(whilePending.status).toBe(422)
    expect((await whilePending.json()).errors).toContain("at-usage-cap")

    await db.update(schema.games).set({ hasBoxscore: true }).where(eq(schema.games.id, game.id))
    await setupGoalieGame({ player: league.players[7].player, game, saves: 20 })

    expect((await putLineup(token, nextWeek, "2026-11-14")).status).toBe(200)
  })

  it("lists a traded Player once", async () => {
    const { token } = await registerManager()

    const form = await loadLineupForm((await findManagerByToken(token))!)

    expect(form?.players.filter((p) => p.id === league.id(5))).toHaveLength(1)
  })
})

describe("the season config", () => {
  it("can still be changed after the first Lineup, and reports that Lineups exist", async () => {
    expect((await adminList()).hasLineups).toBe(false)
    const { token } = await registerManager()
    await putLineup(token)
    expect((await adminList()).hasLineups).toBe(true)

    const changed = { ...DEFAULT_FANTASY_CONFIG, usageCap: { skater: 9, goalie: 9 } }
    expect((await turnOn(changed)).status).toBe(200)
    expect((await adminList()).config.usageCap).toEqual({ skater: 9, goalie: 9 })
  })

  it("rejects unreadable JSON rather than resetting the config to the defaults", async () => {
    await turnOn({ ...DEFAULT_FANTASY_CONFIG, usageCap: { skater: 9, goalie: 9 } })

    const response = await adminPut(new Request("http://test/x", { method: "PUT", body: "{oops" }), seasonParams())

    expect(response.status).toBe(400)
    expect((await adminList()).config.usageCap).toEqual({ skater: 9, goalie: 9 })
  })

  it("rejects an invalid config", async () => {
    const response = await adminPut(json("/x", "PUT", { config: { lineup: {} } }), seasonParams())

    expect(response.status).toBe(400)
  })

  it("says which fields are wrong", async () => {
    const config = { ...DEFAULT_FANTASY_CONFIG, lineup: { ...DEFAULT_FANTASY_CONFIG.lineup, skaters: 0 } }

    const response = await turnOn(config)

    expect(response.status).toBe(400)
    expect((await response.json()).issues).toEqual(["lineup.skaters: A Lineup needs at least one skater"])
  })

  it("won't reset a contest that is already on when no config is sent", async () => {
    await turnOn({ ...DEFAULT_FANTASY_CONFIG, usageCap: { skater: 9, goalie: 9 } })

    expect((await turnOn()).status).toBe(400)
    expect((await adminList()).config.usageCap).toEqual({ skater: 9, goalie: 9 })
  })

  it("turns a new contest on with the defaults when no config is sent", async () => {
    const response = await adminPut(json("/x", "PUT", { contest: "extras" }), seasonParams())

    expect(response.status).toBe(200)
    expect((await response.json()).config).toEqual(DEFAULT_FANTASY_CONFIG)
  })
})

describe("managing Managers", () => {
  it("shows real names and flags duplicates, ignoring case", async () => {
    await registerManager("One", "Ada", "Lovelace")
    await registerManager("Two", "ADA", "lovelace ")
    await registerManager("Three", "Grace", "Hopper")

    const { managers } = await adminList()

    const flags = Object.fromEntries(managers.map((m: { teamName: string; duplicate: boolean }) => [m.teamName, m.duplicate]))
    expect(flags).toEqual({ One: true, Two: true, Three: false })
    expect(managers[0].firstName).toBeTruthy()
  })

  it("renames, refusing a Team Name already taken", async () => {
    await registerManager("One")
    await registerManager("Two")
    const { managers } = await adminList()
    const one = managers.find((m: { teamName: string }) => m.teamName === "One")

    expect((await adminPatch(json("/x", "PATCH", { teamName: "TWO" }), managerParams(one.id))).status).toBe(409)
    expect((await adminPatch(json("/x", "PATCH", { teamName: "Uno" }), managerParams(one.id))).status).toBe(200)
  })

  it("reissuing invalidates the old link", async () => {
    const { token } = await registerManager()
    const [{ id }] = (await adminList()).managers

    const response = await adminReissue(new Request("http://test/x", { method: "POST" }), managerParams(id))
    const newToken = String((await response.json()).managerPath).split("/").pop()!

    expect(newToken).not.toBe(token)
    expect((await putLineup(token)).status).toBe(401)
    expect((await putLineup(newToken)).status).toBe(200)
  })

  it("removing a Manager deletes their Lineups", async () => {
    const { token } = await registerManager()
    await putLineup(token)
    const [{ id }] = (await adminList()).managers

    expect((await adminDelete(new Request("http://test/x"), managerParams(id))).status).toBe(200)

    expect(await db.select().from(schema.fantasyLineups)).toEqual([])
    expect(await findManagerByToken(token)).toBeNull()
  })

  it("treats an unreadable Manager id as not found", async () => {
    const params = managerParams("abc")

    expect((await adminDelete(new Request("http://test/x"), params)).status).toBe(404)
    expect((await adminReissue(new Request("http://test/x"), params)).status).toBe(404)
  })

  it("only touches Managers of the season in the URL", async () => {
    await registerManager("One")
    const [{ id }] = (await adminList()).managers
    const { season: other } = await setupSeason()
    const otherParams = { params: Promise.resolve({ id: other.id, managerId: String(id) }) }
    const before = await db.select().from(schema.fantasyManagers)

    const responses = await Promise.all([
      adminPatch(json("/x", "PATCH", { teamName: "Renamed" }), otherParams),
      adminReissue(new Request("http://test/x", { method: "POST" }), otherParams),
      adminDelete(new Request("http://test/x"), otherParams),
    ])

    expect(responses.map((r) => r.status)).toEqual([404, 404, 404])
    expect(await db.select().from(schema.fantasyManagers)).toEqual(before)
  })

  it("rejects the old link of a reissued or removed Manager on every write route", async () => {
    const { token } = await registerManager()
    const [{ id }] = (await adminList()).managers

    await adminDelete(new Request("http://test/x"), managerParams(id))

    expect((await putLineup(token)).status).toBe(401)
  })

  it("still reports a committed write as done when the cache can't be refreshed", async () => {
    await registerManager("One")
    const [{ id }] = (await adminList()).managers
    revalidateTag.mockImplementationOnce(() => {
      throw new Error("cache down")
    })
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await adminPatch(json("/x", "PATCH", { teamName: "Uno" }), managerParams(id))

    expect(response.status).toBe(200)
    expect((await adminList()).managers[0].teamName).toBe("Uno")
  })

  it("answers 404 for a season that doesn't exist", async () => {
    const params = { params: Promise.resolve({ id: "no-such-season" }) }

    expect((await adminPut(json("/x", "PUT", {}), params)).status).toBe(404)
  })

  it("rejects a config body that isn't an object", async () => {
    expect((await adminPut(json("/x", "PUT", [1, 2]), seasonParams())).status).toBe(400)
    expect((await adminPut(json("/x", "PUT", 5), seasonParams())).status).toBe(400)
  })

  it("requires an admin on every route", async () => {
    isAdmin.value = false

    const responses = await Promise.all([
      adminGet(new Request("http://test/x"), seasonParams()),
      adminPut(json("/x", "PUT", {}), seasonParams()),
      adminPatch(json("/x", "PATCH", { teamName: "X" }), managerParams(1)),
      adminDelete(new Request("http://test/x"), managerParams(1)),
      adminReissue(new Request("http://test/x"), managerParams(1)),
    ])

    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401])
  })
})

describe("public standings", () => {
  const AFTER_LOCK = new Date("2026-11-08T12:00:00-08:00")

  it("are absent until the game is on", async () => {
    await db.delete(schema.fantasySeasons).where(eq(schema.fantasySeasons.seasonId, league.season.id))

    expect(await fetchFantasyStandings()).toBeNull()
  })

  it("show nothing of a Lineup before the Lock and all of it after", async () => {
    const { token } = await registerManager()
    const { game } = await league.game({ date: OPEN_WEEK, status: "upcoming", hasBoxscore: false })
    await putLineup(token)

    const before = await fetchFantasyStandings()
    expect(before?.weeks).toEqual([])
    expect(before?.nextLockAt).toBe(LOCK.toISOString())
    expect(before?.season.rows).toEqual([{ rank: 1, managerId: expect.any(Number), teamName: "Puck Norris", points: 0 }])

    await db.update(schema.games).set({ status: "final", hasBoxscore: true }).where(eq(schema.games.id, game.id))
    await setupPlayerGame({ player: league.players[1].player, game, goals: 2 })
    vi.setSystemTime(AFTER_LOCK)

    const after = await fetchFantasyStandings()
    expect(after?.weeks).toHaveLength(1)
    expect(after?.weeks[0].rows[0]).toMatchObject({ rank: 1, teamName: "Puck Norris", points: 20 })
    expect(after?.weeks[0].rows[0].selections[0]).toMatchObject({
      playerName: league.players[1].player.name,
      outcome: "played",
      points: 20,
    })
  })

  it("also carry the open Week's games and Bye before it closes, so Managers can see who plays", async () => {
    await db.delete(schema.games).where(eq(schema.games.seasonId, league.season.id))
    await league.game({ date: OPEN_WEEK, status: "upcoming", hasBoxscore: false })

    const standings = await fetchFantasyStandings()

    expect(standings?.weeks).toEqual([])
    expect(standings?.openWeekId).toBe(OPEN_WEEK)
    expect(standings?.overviews[OPEN_WEEK].games).toHaveLength(1)
  })

  it("carry each locked Week's games, results and Bye for the Week picker", async () => {
    const { team: otters } = await setupTeam()
    await setupPlayer({ roster: [{ season: league.season, team: otters }] })
    await db.delete(schema.games).where(eq(schema.games.seasonId, league.season.id))
    await league.game({ date: OPEN_WEEK, homeScore: 4, awayScore: 2 })
    vi.setSystemTime(AFTER_LOCK)

    const overview = (await fetchFantasyStandings())?.overviews[OPEN_WEEK]

    expect(overview?.games).toMatchObject([
      { home: { slug: league.seals.slug }, away: { slug: league.yetis.slug }, startLabel: "Sat 9:00a", result: { homeScore: 4, awayScore: 2 } },
    ])
    expect(overview?.byeTeams.map((t) => t.slug)).toEqual([otters.slug])
  })

  it("pick up a late boxscore without any write to the Lineup", async () => {
    const { token } = await registerManager()
    const { game } = await league.game({ date: OPEN_WEEK, hasBoxscore: false })
    await putLineup(token)
    vi.setSystemTime(AFTER_LOCK)

    expect((await fetchFantasyStandings())?.weeks[0]).toMatchObject({ provisional: true })

    await db.update(schema.games).set({ hasBoxscore: true }).where(eq(schema.games.id, game.id))
    await setupPlayerGame({ player: league.players[2].player, game, goals: 1 })

    const week = (await fetchFantasyStandings())?.weeks[0]
    expect(week?.provisional).toBe(false)
    expect(week?.rows[0].points).toBe(10)
  })

  it("only count stats from this season", async () => {
    const { token } = await registerManager()
    const { game } = await league.game({ date: OPEN_WEEK })
    await putLineup(token)
    const { season: other } = await setupSeason()
    const { game: elsewhere } = await setupGame({ season: other, homeTeam: league.seals, awayTeam: league.yetis })
    await setupPlayerGame({ player: league.players[1].player, game: elsewhere, goals: 9 })
    await setupPlayerGame({ player: league.players[1].player, game, goals: 1 })
    vi.setSystemTime(AFTER_LOCK)

    expect((await fetchFantasyStandings())?.season.rows[0].points).toBe(10)
  })
})

describe("a Manager's previous Weeks", () => {
  const AFTER_LOCK = new Date("2026-11-08T12:00:00-08:00")

  it("shows locked Weeks with each Selection's points, but not the open Week", async () => {
    const { token } = await registerManager()
    const { game } = await league.game({ date: OPEN_WEEK })
    await setupPlayerGame({ player: league.players[1].player, game, goals: 2 })
    await putLineup(token)
    const manager = (await findManagerByToken(token))!

    expect((await loadLineupForm(manager))?.history).toEqual({ points: 0, weeks: [] })

    vi.setSystemTime(AFTER_LOCK)
    await putLineup(token, league.lineup(), "2026-11-14")

    const history = (await loadLineupForm(manager))?.history
    expect(history?.points).toBe(20)
    expect(history?.weeks.map((week) => week.id)).toEqual([OPEN_WEEK])
    expect(history?.weeks[0].selections[0]).toMatchObject({
      playerName: league.players[1].player.name,
      points: 20,
    })
  })

  it("leaves out other Managers and Weeks this Manager missed", async () => {
    const { token } = await registerManager("Mine")
    const { token: other } = await registerManager("Theirs", "Grace", "Hopper")
    await league.game({ date: OPEN_WEEK })
    await league.game({ date: "2026-11-14" })
    await putLineup(other)
    vi.setSystemTime(AFTER_LOCK)
    await putLineup(token, league.lineup(), "2026-11-14")
    vi.setSystemTime(new Date("2026-11-15T12:00:00-08:00"))

    const history = (await loadLineupForm((await findManagerByToken(token))!))?.history

    expect(history?.weeks.map((week) => week.id)).toEqual(["2026-11-14"])
  })
})

describe("the admin overview", () => {
  it("is empty until the game is on", async () => {
    await db.delete(schema.fantasySeasons).where(eq(schema.fantasySeasons.seasonId, league.season.id))

    expect((await adminList()).overview).toBeNull()
  })

  it("shows each Manager's Weeks, uses against the cap and whether the open Week is in", async () => {
    await turnOn({ ...DEFAULT_FANTASY_CONFIG, usageCap: { skater: 1, goalie: 4 } })
    const { token } = await registerManager("Mine")
    await registerManager("Idle", "Grace", "Hopper")
    const { game } = await league.game({ date: OPEN_WEEK })
    await setupPlayerGame({ player: league.players[1].player, game, goals: 1 })
    await putLineup(token)
    vi.setSystemTime(new Date("2026-11-08T12:00:00-08:00"))
    await putLineup(token, league.lineup({ skaters: league.ids(2, 3, 4), skaterBackups: [] }), "2026-11-14")

    const { overview } = await adminList()

    expect(overview.weeks).toEqual([{ id: OPEN_WEEK, provisional: false }])
    const [mine, idle] = overview.managers
    expect(mine).toMatchObject({ rank: 1, teamName: "Mine", points: 10, openWeekSubmitted: true })
    expect(mine.weeks).toHaveLength(1)
    expect(mine.uses).toContainEqual({
      playerId: league.id(1),
      playerName: league.players[1].player.name,
      kind: "skater",
      used: 1,
      cap: 1,
    })
    expect(idle).toMatchObject({ teamName: "Idle", points: 0, openWeekSubmitted: false, weeks: [], uses: [] })
  })
})

describe("real names", () => {
  it("never appear in a public response", async () => {
    const first = "Zebulon"
    const last = "Quixote"
    const { token, body } = await registerManager("Public Name", first, last)
    const taken = await (await postRegistration({ teamName: "public name", firstName: first, lastName: last })).text()
    const saved = await (await putLineup(token)).text()
    const invalid = await (await putLineup(token, league.lineup({ skaters: [] }))).text()
    const form = await loadLineupForm((await findManagerByToken(token))!)
    await league.game({ date: OPEN_WEEK })
    vi.setSystemTime(new Date("2026-11-08T12:00:00-08:00"))
    const standings = await fetchFantasyStandings()
    expect(standings?.weeks[0].rows[0].teamName).toBe("Public Name")

    const everything = JSON.stringify([body, taken, saved, invalid, form, standings])
    expect(everything).not.toContain(first)
    expect(everything).not.toContain(last)
    expect(JSON.stringify(form)).not.toContain("token")
  })
})

describe("contests", () => {
  const playoffs = { ...DEFAULT_FANTASY_CONFIG, gameTypes: ["playoff"] }
  const turnOnPlayoffs = () => {
    // Launched after the regular contest, which is what makes the regular one the default.
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 60 * 60 * 1000))
    return adminPut(json("/x", "PUT", { contest: "playoffs", config: playoffs }), seasonParams())
  }

  async function registerIn(contest: string, teamName: string) {
    vi.stubEnv("VERCEL", "1")
    const response = await register(
      json(`/api/bash/fantasy/register?contest=${contest}`, "POST", { teamName, firstName: "Ada", lastName: "Lovelace" }, {
        "x-vercel-forwarded-for": `10.1.0.${++ipCounter}`,
      })
    )
    const body = await response.json()
    return { response, token: String(body.managerPath ?? "").split("/").pop()! }
  }

  it("turns on beside the regular contest, which stays the default", async () => {
    expect((await turnOnPlayoffs()).status).toBe(200)

    const list = await adminGet(new Request("http://test/x?contest=playoffs"), seasonParams())
    const body = await list.json()
    expect(body.contests).toEqual(["regular", "playoffs"])
    expect(body.config.gameTypes).toEqual(["playoff"])
    expect((await fetchFantasyStandings())?.contest).toBe("regular")
    expect((await fetchFantasyStandings("playoffs"))?.contest).toBe("playoffs")
  })

  it("refuses to register for a contest that isn't on", async () => {
    expect((await registerIn("playoffs", "Nobody")).response.status).toBe(404)
  })

  it("keeps Managers and Team Names apart, so a name can be used again in each", async () => {
    await turnOnPlayoffs()

    expect((await registerIn("regular", "Puck Norris")).response.status).toBe(201)
    expect((await registerIn("playoffs", "Puck Norris")).response.status).toBe(201)
    expect((await registerIn("playoffs", "puck norris")).response.status).toBe(409)

    const rows = (contest: string) => fetchFantasyStandings(contest).then((s) => s?.season.rows.map((r) => r.teamName))
    expect(await rows("regular")).toEqual(["Puck Norris"])
    expect(await rows("playoffs")).toEqual(["Puck Norris"])
  })

  it("scores only the game types a contest names", async () => {
    await turnOnPlayoffs()
    const regular = await registerIn("regular", "Regulars")
    const post = await registerIn("playoffs", "Playoff Team")
    const { game } = await league.game({ gameType: "playoff", date: "2026-11-07" })
    await setupPlayerGame({ player: league.players[1].player, game, goals: 2 })
    expect((await putLineup(regular.token)).status).toBe(200)
    expect((await putLineup(post.token)).status).toBe(200)
    vi.setSystemTime(new Date("2026-11-10T12:00:00-08:00"))

    const points = async (contest: string) => (await fetchFantasyStandings(contest))?.season.rows[0].points
    expect(await points("regular")).toBe(0)
    expect(await points("playoffs")).toBe(20)
  })

  it("rejects a contest name that can't go in a URL", async () => {
    const response = await adminPut(json("/x", "PUT", { contest: "Play offs!" }), seasonParams())
    expect(response.status).toBe(400)
  })
})
