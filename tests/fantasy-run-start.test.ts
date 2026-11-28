import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin-session", () => ({ getSession: async () => true }))
vi.mock("next/cache", async (original) => ({ ...(await original<typeof import("next/cache")>()), revalidateTag: vi.fn() }))

import { GET as adminGet, PUT as adminPut } from "@/app/api/bash/admin/seasons/[id]/fantasy/route"
import { POST as register } from "@/app/api/bash/fantasy/register/route"
import { db, schema } from "@/lib/db"
import { checkFantasyConfig, DEFAULT_FANTASY_CONFIG, type FantasyConfig } from "@/lib/fantasy/config"
import { adminSaveLineup, loadAdminPicks, loadLineupForm, saveLineup } from "@/lib/fantasy/lineups"
import { createManager } from "@/lib/fantasy/managers"
import { getCurrentFantasySeason, getFantasySeason, listFantasyContests, saveFantasyConfig } from "@/lib/fantasy/season"
import { countsForGame, picksOpenAt, runStatus } from "@/lib/fantasy/week"
import { fetchFantasyStandings } from "@/lib/fetch-fantasy"
import { setupGame } from "./factories/setupGame"
import { setupPlayer } from "./factories/setupPlayer"
import { setupSeason } from "./factories/setupSeason"
import { setupTeam } from "./factories/setupTeam"

const at = (local: string) => new Date(`${local}-08:00`)
/** Set up well ahead of the January run. */
const CREATED = at("2026-12-01T12:00:00")
/** The Saturday before the first Week's, when its picks open. */
const PICKS_OPEN = at("2027-01-02T08:00:00")
const BEFORE_OPEN = at("2027-01-02T07:59:00")
const AFTER_OPEN = at("2027-01-02T08:01:00")
const FIRST_WEEK = "2027-01-09"

const dated = (startsOn: string | null, endsOn: string | null = null): FantasyConfig => ({
  ...DEFAULT_FANTASY_CONFIG,
  startsOn,
  endsOn,
})

describe("which games count from a start date", () => {
  const counts = (date: string, startsOn: string | null, launched = CREATED) =>
    countsForGame({ date, time: "9:00a" }, launched, dated(startsOn))

  it("starts with the first Week closing on or after the date, with all its games", () => {
    expect(counts(FIRST_WEEK, FIRST_WEEK)).toBe(true)
    expect(counts("2027-01-10", FIRST_WEEK)).toBe(true)
    expect(counts("2027-01-02", FIRST_WEEK)).toBe(false)
    expect(counts("2027-01-08", FIRST_WEEK)).toBe(false)
    // A start date between closing days skips to the next one.
    expect(counts("2027-01-02", "2027-01-03")).toBe(false)
    expect(counts(FIRST_WEEK, "2027-01-03")).toBe(true)
  })

  it("can reach back before the run was turned on", () => {
    const late = at("2026-12-16T12:00:00")

    expect(counts("2026-12-05", null, late)).toBe(false)
    expect(counts("2026-12-05", "2026-12-05", late)).toBe(true)
  })

  it("starts after the run is turned on when there's no date", () => {
    expect(counts("2026-12-05", null)).toBe(true)
    expect(counts("2026-11-28", null)).toBe(false)
  })
})

describe("an upcoming run's status", () => {
  it.each([
    ["is upcoming until its first picks open", BEFORE_OPEN, "upcoming"],
    ["is active from the weekly close before its first Week", AFTER_OPEN, "active"],
  ])("%s", (_name, now, status) => {
    expect(runStatus(dated(FIRST_WEEK), now)).toBe(status)
  })

  it("says when picks open, also for a date between closing days", () => {
    expect(picksOpenAt(dated(FIRST_WEEK))?.toISOString()).toBe(PICKS_OPEN.toISOString())
    expect(picksOpenAt(dated("2027-01-05"))?.toISOString()).toBe(PICKS_OPEN.toISOString())
    expect(picksOpenAt(dated(null))).toBeNull()
  })
})

describe("the start date in a config", () => {
  it("is optional, so a config stored without one still loads", () => {
    const { startsOn: _, ...stored } = DEFAULT_FANTASY_CONFIG
    expect(checkFantasyConfig(stored)).toEqual({ ok: true, config: dated(null) })
  })

  it("must be a real date", () => {
    const checked = checkFantasyConfig(dated("2027-02-30"))
    expect(checked.ok === false && checked.issues[0]).toMatch(/^startsOn: /)
  })

  it.each([
    ["an end before the start", "2027-01-16", "2027-01-09"],
    ["a range between two closing days", "2027-01-10", "2027-01-15"],
  ])("rejects %s, which holds no Week", (_name, startsOn, endsOn) => {
    const checked = checkFantasyConfig(dated(startsOn, endsOn))
    expect(checked.ok === false && checked.issues).toEqual(["endsOn: No Week closes between the start and end dates"])
  })

  it("allows a run of one Week", () => {
    expect(checkFantasyConfig(dated(FIRST_WEEK, FIRST_WEEK)).ok).toBe(true)
  })
})

describe("a run set up ahead of time", () => {
  let seasonId: string
  let ids: number[]
  let gameDates: string[]

  const lineup = () => ({ skaters: ids.slice(0, 3), goalies: [ids[3]], skaterBackups: [], goalieBackups: [] })
  const managers = () => db.select().from(schema.fantasyManagers)
  const january = async () => (await getFantasySeason(seasonId, "january"))!
  const signUp = (contest: string | null, teamName: string) =>
    register(
      new Request(`http://test/x${contest ? `?contest=${contest}` : ""}`, {
        method: "POST",
        body: JSON.stringify({ teamName, firstName: "Ada", lastName: "Lovelace" }),
      })
    )
  const context = () => ({ params: Promise.resolve({ id: seasonId }) })
  const put = (contest: string, config: FantasyConfig) =>
    adminPut(new Request("http://test/x", { method: "PUT", body: JSON.stringify({ contest, config }) }), context())

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: CREATED })
    vi.stubEnv("SESSION_SECRET", "x".repeat(32))
    const { season } = await setupSeason({ isCurrent: true })
    seasonId = season.id
    const { team: seals } = await setupTeam()
    const { team: yetis } = await setupTeam()
    ids = []
    for (const isGoalie of [false, false, false, true]) {
      ids.push((await setupPlayer({ roster: [{ season, team: isGoalie ? yetis : seals, isGoalie }] })).player.id)
    }
    gameDates = ["2026-12-05", "2027-01-02", FIRST_WEEK]
    for (const date of gameDates) await setupGame({ season, homeTeam: seals, awayTeam: yetis, date, time: "9:00a" })
    await saveFantasyConfig(seasonId, "january", dated(FIRST_WEEK), CREATED)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it("accepts sign-ups early, but no picks", async () => {
    expect((await signUp("january", "Early Bird")).status).toBe(201)
    const [manager] = await managers()

    expect(await loadLineupForm(manager, BEFORE_OPEN)).toMatchObject({
      status: "upcoming",
      noGames: true,
      picksOpenAt: PICKS_OPEN.toISOString(),
    })
    // The Week open before the start isn't part of the run.
    expect(await saveLineup(manager, await january(), "2026-12-05", lineup(), CREATED)).toEqual({ outcome: "no-games" })
    expect(await adminSaveLineup(manager, await january(), "2026-12-05", lineup(), {}, CREATED)).toEqual({ outcome: "no-games" })
    expect((await loadAdminPicks(manager, undefined, CREATED))?.form).toMatchObject({ status: "upcoming", noGames: true })
  })

  it("opens picks for its first Week at the close before it", async () => {
    await createManager(seasonId, "january", { teamName: "Early Bird", firstName: "Ada", lastName: "Lovelace" })
    const [manager] = await managers()

    expect(await saveLineup(manager, await january(), FIRST_WEEK, lineup(), AFTER_OPEN)).toEqual({ outcome: "saved" })
  })

  it("shows as upcoming to the public, with who has joined and no Week yet", async () => {
    await signUp("january", "Early Bird")

    const standings = await fetchFantasyStandings("january")

    expect(standings).toMatchObject({ status: "upcoming", picksOpenAt: PICKS_OPEN.toISOString(), overviews: {} })
    expect(standings?.season.rows).toMatchObject([{ teamName: "Early Bird", points: 0 }])
  })

  it("tells the admin it's upcoming", async () => {
    const response = await adminGet(new Request("http://test/x?contest=january"), context())

    expect(await response.json()).toMatchObject({ status: "upcoming", picksOpenAt: PICKS_OPEN.toISOString() })
  })

  it("counts earlier Weeks once the start date is moved back", async () => {
    vi.setSystemTime(AFTER_OPEN)
    await createManager(seasonId, "january", { teamName: "Early Bird", firstName: "Ada", lastName: "Lovelace" })
    await saveFantasyConfig(seasonId, "january", dated("2026-12-05"), CREATED)

    const picks = await loadAdminPicks((await managers())[0], undefined, AFTER_OPEN)

    expect(picks?.weekIds).toEqual(["2026-12-05", "2027-01-02", FIRST_WEEK])
  })

  it("rejects an end date before the Week a run with no start date begins", async () => {
    const response = await put("december", dated(null, "2026-11-28"))

    expect(response.status).toBe(400)
    expect((await response.json()).issues[0]).toMatch(/^endsOn: /)
    expect(await getFantasySeason(seasonId, "december")).toBeNull()
  })

  describe("beside other runs", () => {
    // Created after January's, but starting first.
    const startBeta = () => saveFantasyConfig(seasonId, "december-beta", dated("2026-12-05", "2026-12-19"), at("2026-12-01T13:00:00"))
    const defaultAt = async (now: Date) => (await getCurrentFantasySeason(undefined, now))?.contest

    it("lists runs in the order they start, not the order they were set up", async () => {
      await startBeta()

      expect((await listFantasyContests(seasonId)).map((c) => c.contest)).toEqual(["december-beta", "january"])
    })

    it("defaults to a current run, then the next upcoming one", async () => {
      await startBeta()

      expect(await defaultAt(CREATED)).toBe("december-beta")
      // The beta's last Week is still being played.
      expect(await defaultAt(at("2026-12-22T12:00:00"))).toBe("december-beta")
      expect(await defaultAt(at("2026-12-28T12:00:00"))).toBe("january")
      expect(await defaultAt(AFTER_OPEN)).toBe("january")
    })

    it("prefers the next upcoming run over a later one", async () => {
      await saveFantasyConfig(seasonId, "spring", dated("2027-03-06"), at("2026-11-30T12:00:00"))

      expect(await defaultAt(CREATED)).toBe("january")
    })

    it("signs up an unnamed registration to a current run before an upcoming one", async () => {
      await startBeta()

      await signUp(null, "Walk In")

      expect((await managers())[0].contest).toBe("december-beta")
    })

    it("signs it up to the upcoming run once the current one takes no more", async () => {
      await startBeta()
      vi.setSystemTime(at("2026-12-22T12:00:00"))

      expect((await signUp(null, "Walk In")).status).toBe(201)

      expect((await managers())[0].contest).toBe("january")
    })
  })
})
