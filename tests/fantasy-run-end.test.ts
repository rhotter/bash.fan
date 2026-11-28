import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin-session", () => ({ getSession: async () => true }))
vi.mock("next/cache", async (original) => ({ ...(await original<typeof import("next/cache")>()), revalidateTag: vi.fn() }))

import { GET as adminGet } from "@/app/api/bash/admin/seasons/[id]/fantasy/route"
import { POST as register } from "@/app/api/bash/fantasy/register/route"
import { db, schema } from "@/lib/db"
import { checkFantasyConfig, DEFAULT_FANTASY_CONFIG, type FantasyConfig } from "@/lib/fantasy/config"
import { adminSaveLineup, loadAdminPicks, loadLineupForm, saveLineup } from "@/lib/fantasy/lineups"
import { createManager } from "@/lib/fantasy/managers"
import { adminSavePredictions, savePredictions } from "@/lib/fantasy/predictions"
import { getCurrentFantasySeason, getFantasySeason, saveFantasyConfig } from "@/lib/fantasy/season"
import { countsForGame, runStatus } from "@/lib/fantasy/week"
import { fetchFantasyStandings } from "@/lib/fetch-fantasy"
import { setupGame } from "./factories/setupGame"
import { setupPlayer } from "./factories/setupPlayer"
import { setupPlayerGame } from "./factories/setupPlayerGame"
import { setupSeason } from "./factories/setupSeason"
import { setupTeam } from "./factories/setupTeam"

const at = (local: string) => new Date(`${local}-08:00`)
const LAUNCH = at("2026-12-01T12:00:00")
/** Weeks are named for their closing Saturday. The beta's last is Dec 12. */
const FIRST_WEEK = "2026-12-05"
const LAST_WEEK = "2026-12-12"
const AFTER_WEEK = "2026-12-19"
const BEFORE_FINAL_CLOSE = at("2026-12-09T12:00:00")
const FINAL_WEEK_PLAYING = at("2026-12-13T12:00:00")
const ENDED = at("2026-12-20T12:00:00")

const ending = (endsOn: string | null): FantasyConfig => ({ ...DEFAULT_FANTASY_CONFIG, endsOn })

describe("which games count", () => {
  const counts = (date: string, endsOn: string | null) =>
    countsForGame({ date, time: "9:00a" }, LAUNCH, ending(endsOn))

  it("counts every game of the last Week, including the day after the end date", () => {
    expect(counts(LAST_WEEK, LAST_WEEK)).toBe(true)
    expect(counts("2026-12-13", LAST_WEEK)).toBe(true)
    expect(counts(AFTER_WEEK, LAST_WEEK)).toBe(false)
  })

  it("includes the Weeks closing on or before a date that isn't a closing day", () => {
    expect(counts("2026-12-13", "2026-12-15")).toBe(true)
    expect(counts(LAST_WEEK, "2026-12-11")).toBe(false)
  })

  it("keeps counting with no end date", () => {
    expect(counts("2027-03-06", null)).toBe(true)
  })
})

describe("runStatus", () => {
  it.each([
    ["is active until the last Week closes", BEFORE_FINAL_CLOSE, "active"],
    ["is in its final Week once no more picks can be made", FINAL_WEEK_PLAYING, "final-week"],
    ["has ended once the last Week is over", ENDED, "ended"],
  ])("%s", (_name, now, status) => {
    expect(runStatus(ending(LAST_WEEK), now)).toBe(status)
  })

  it("stays active with no end date", () => {
    expect(runStatus(ending(null), ENDED)).toBe("active")
  })
})

describe("the end date in a config", () => {
  it("is optional, so a config stored without one still loads", () => {
    const { endsOn: _, ...stored } = DEFAULT_FANTASY_CONFIG
    expect(checkFantasyConfig(stored)).toEqual({ ok: true, config: ending(null) })
  })

  it.each(["soon", "2026-02-30", "12/19/2026", ""])("rejects %j", (endsOn) => {
    const checked = checkFantasyConfig({ ...DEFAULT_FANTASY_CONFIG, endsOn })
    expect(checked.ok === false && checked.issues[0]).toMatch(/^endsOn: /)
  })
})

describe("an ending run", () => {
  let seasonId: string
  let skaters: number[]
  let goalie: number
  let gameIds: Record<string, string>

  const lineup = () => ({ skaters: skaters.slice(0, 3), goalies: [goalie], skaterBackups: [], goalieBackups: [] })
  const managerIn = async (contest: string) => {
    const [row] = (await db.select().from(schema.fantasyManagers)).filter((m) => m.contest === contest)
    return row
  }
  const signUp = (contest: string | null, teamName: string) =>
    register(
      new Request(`http://test/x${contest ? `?contest=${contest}` : ""}`, {
        method: "POST",
        body: JSON.stringify({ teamName, firstName: "Ada", lastName: "Lovelace" }),
      })
    )

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: LAUNCH })
    vi.stubEnv("SESSION_SECRET", "x".repeat(32))
    const { season } = await setupSeason({ isCurrent: true })
    seasonId = season.id
    const { team: seals } = await setupTeam()
    const { team: yetis } = await setupTeam()
    skaters = []
    for (const team of [seals, seals, yetis]) skaters.push((await setupPlayer({ roster: [{ season, team }] })).player.id)
    goalie = (await setupPlayer({ roster: [{ season, team: seals, isGoalie: true }] })).player.id
    gameIds = {}
    for (const date of [FIRST_WEEK, LAST_WEEK, AFTER_WEEK]) {
      const { game } = await setupGame({ season, homeTeam: seals, awayTeam: yetis, date, time: "9:00a", homeScore: 4, awayScore: 2 })
      gameIds[date] = game.id
      await setupPlayerGame({ player: { id: skaters[0] } as never, game, goals: 1 })
    }
    await saveFantasyConfig(seasonId, "december-beta", ending(LAST_WEEK), LAUNCH)
    await createManager(seasonId, "december-beta", { teamName: "Puck Norris", firstName: "Ada", lastName: "Lovelace" })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  const season = async () => (await getFantasySeason(seasonId, "december-beta"))!
  const pickEveryWeek = async () => {
    const manager = await managerIn("december-beta")
    for (const week of [FIRST_WEEK, LAST_WEEK]) {
      await adminSaveLineup(manager, await season(), week, lineup(), {}, ENDED)
      await adminSavePredictions(manager, await season(), week, [{ gameId: gameIds[week], homeScore: 3, awayScore: 1 }], ENDED)
    }
  }

  it("takes picks for its last Week", async () => {
    const result = await saveLineup(await managerIn("december-beta"), await season(), LAST_WEEK, lineup(), BEFORE_FINAL_CLOSE)

    expect(result).toEqual({ outcome: "saved" })
  })

  it("takes no picks for a later Week, from the Manager or an admin", async () => {
    const manager = await managerIn("december-beta")
    const prediction = [{ gameId: gameIds[AFTER_WEEK], homeScore: 3, awayScore: 1 }]

    expect(await saveLineup(manager, await season(), AFTER_WEEK, lineup(), FINAL_WEEK_PLAYING)).toEqual({ outcome: "no-games" })
    expect(await savePredictions(manager, await season(), AFTER_WEEK, prediction, FINAL_WEEK_PLAYING)).toEqual({ outcome: "no-games" })
    expect(await adminSaveLineup(manager, await season(), AFTER_WEEK, lineup(), {}, ENDED)).toEqual({ outcome: "no-games" })
    expect(await adminSavePredictions(manager, await season(), AFTER_WEEK, prediction, ENDED)).toEqual({ outcome: "no-games" })
  })

  it("scores nothing after the last Week, and keeps its standings viewable", async () => {
    await pickEveryWeek()
    vi.setSystemTime(ENDED)

    const standings = await fetchFantasyStandings("december-beta")

    expect(standings?.status).toBe("ended")
    expect(standings?.weeks.map((w) => w.id)).toEqual([FIRST_WEEK, LAST_WEEK])
    expect(Object.keys(standings!.overviews)).toEqual([FIRST_WEEK, LAST_WEEK])
    expect(standings?.season.rows).toMatchObject([{ teamName: "Puck Norris", points: 20 }])
    expect(standings?.pickem.season.rows).toMatchObject([{ correct: 2 }])
  })

  it("tells the Manager page that picks are closed", async () => {
    const manager = await managerIn("december-beta")

    expect((await loadLineupForm(manager, BEFORE_FINAL_CLOSE))?.status).toBe("active")
    expect(await loadLineupForm(manager, FINAL_WEEK_PLAYING)).toMatchObject({ status: "final-week", noGames: true })
    expect((await loadLineupForm(manager, ENDED))?.status).toBe("ended")
  })

  it("opens admin entry on the last Week, offering nothing later", async () => {
    const picks = await loadAdminPicks(await managerIn("december-beta"), undefined, ENDED)

    expect(picks?.weekIds).toEqual([FIRST_WEEK, LAST_WEEK])
    expect(picks?.form.week.id).toBe(LAST_WEEK)
    expect(picks?.closed).toBe(true)
  })

  it("reopens when the end date is removed", async () => {
    await saveFantasyConfig(seasonId, "december-beta", ending(null), LAUNCH)
    vi.setSystemTime(ENDED)

    const standings = await fetchFantasyStandings("december-beta")

    expect(standings?.status).toBe("active")
    expect(standings?.weeks.map((w) => w.id)).toEqual([FIRST_WEEK, LAST_WEEK, AFTER_WEEK])
  })

  it("closes registration once no more picks can be made", async () => {
    vi.setSystemTime(BEFORE_FINAL_CLOSE)
    expect((await signUp("december-beta", "In Time")).status).toBe(201)

    vi.setSystemTime(FINAL_WEEK_PLAYING)
    const late = await signUp("december-beta", "Too Late")

    expect(late.status).toBe(409)
    expect((await late.json()).error).toContain("closed")
  })

  it("tells the admin its status", async () => {
    vi.setSystemTime(ENDED)

    const response = await adminGet(new Request("http://test/x?contest=december-beta"), {
      params: Promise.resolve({ id: seasonId }),
    })

    expect((await response.json()).status).toBe("ended")
  })

  describe("the default run", () => {
    const defaultAt = async (now: Date) => {
      vi.setSystemTime(now)
      return (await getCurrentFantasySeason())?.contest
    }
    const startMain = () => saveFantasyConfig(seasonId, "regular", ending(null), at("2026-12-10T12:00:00"))

    it("is the earliest run until it ends, then one that's still going", async () => {
      await startMain()

      expect(await defaultAt(FINAL_WEEK_PLAYING)).toBe("december-beta")
      expect(await defaultAt(ENDED)).toBe("regular")
      expect((await fetchFantasyStandings())?.contest).toBe("regular")
      expect((await getCurrentFantasySeason("december-beta"))?.contest).toBe("december-beta")
    })

    it("is the latest run when they've all ended", async () => {
      await saveFantasyConfig(seasonId, "mini", ending(LAST_WEEK), at("2026-12-02T12:00:00"))

      expect(await defaultAt(ENDED)).toBe("mini")
    })

    it("registers into a run still taking picks when none is named", async () => {
      await startMain()
      vi.setSystemTime(FINAL_WEEK_PLAYING)

      expect((await signUp(null, "New Team")).status).toBe(201)

      expect((await managerIn("regular")).teamName).toBe("New Team")
    })
  })
})
