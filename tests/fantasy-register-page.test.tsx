import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Both stop rendering by throwing, so the stand-ins do too.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found")
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
  useRouter: () => ({ prefetch: vi.fn() }),
}))

import FantasyPage from "@/app/fantasy/page"
import FantasyRegisterPage from "@/app/fantasy/register/page"
import { POST as register } from "@/app/api/bash/fantasy/register/route"
import { DEFAULT_FANTASY_CONFIG } from "@/lib/fantasy/config"
import { saveFantasyConfig } from "@/lib/fantasy/season"
import { fetchFantasyStandings } from "@/lib/fetch-fantasy"
import { setupSeason } from "./factories/setupSeason"

// The cache needs a running Next server, so the page reads straight through.
vi.mock("@/lib/cached-page-data", async () => {
  const { fetchFantasyStandings: fetchFantasyPageData } = await import("@/lib/fetch-fantasy")
  return { fetchFantasyPageData }
})

const at = (local: string) => new Date(`${local}-08:00`)
const LAUNCH = at("2026-12-01T12:00:00")
const BETA_ACTIVE = at("2026-12-09T12:00:00")
const BETA_FINAL_WEEK = at("2026-12-20T12:00:00")

const page = async (contest?: string) =>
  renderToStaticMarkup(await FantasyRegisterPage({ searchParams: Promise.resolve({ contest }) }))

const signUp = (query = "") =>
  register(
    new Request(`http://test/api/bash/fantasy/register${query}`, {
      method: "POST",
      body: JSON.stringify({ teamName: "Puck Norris", firstName: "Ada", lastName: "Lovelace" }),
    })
  )

let seasonId: string

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: LAUNCH })
  vi.stubEnv("SESSION_SECRET", "x".repeat(32))
  seasonId = (await setupSeason({ isCurrent: true })).season.id
  await saveFantasyConfig(seasonId, "beta", { ...DEFAULT_FANTASY_CONFIG, startsOn: "2026-12-05", endsOn: "2026-12-19" }, LAUNCH)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const addMain = () =>
  saveFantasyConfig(seasonId, "main", { ...DEFAULT_FANTASY_CONFIG, startsOn: "2027-01-09" }, LAUNCH)

describe("with a running and an upcoming contest", () => {
  beforeEach(async () => {
    await addMain()
  })

  it("redirects a plain registration URL to the running contest, and offers the upcoming one", async () => {
    vi.setSystemTime(BETA_ACTIVE)

    await expect(page()).rejects.toThrow("redirect:/fantasy/register?contest=beta")
    const html = await page("beta")
    expect(html).toContain("<form")
    expect(html).toContain('href="/fantasy/register?contest=main"')
  })

  it("moves a plain registration to the upcoming contest in the running one's final Week, as the API does", async () => {
    vi.setSystemTime(BETA_FINAL_WEEK)

    await expect(page()).rejects.toThrow("redirect:/fantasy/register?contest=main")
    expect((await signUp()).status).toBe(201)
    const { db, schema } = await import("@/lib/db")
    expect((await db.select().from(schema.fantasyManagers)).map((m) => m.contest)).toEqual(["main"])
  })

  it("says when picks open for a contest that hasn't started", async () => {
    vi.setSystemTime(BETA_ACTIVE)

    expect(await page("main")).toContain("picks open Saturday, Jan 2, 8:00 AM PST")
  })

  it("shows a closed contest no form, only the way to an open one", async () => {
    vi.setSystemTime(BETA_FINAL_WEEK)

    const html = await page("beta")
    expect(html).toContain("is closed")
    expect(html).not.toContain("<form")
    expect(html).toContain('href="/fantasy/register?contest=main"')
    expect((await signUp("?contest=beta")).status).toBe(409)
  })

  it("lists the other joinable contest in the standings data", async () => {
    vi.setSystemTime(BETA_ACTIVE)

    expect((await fetchFantasyStandings("beta"))?.otherOpenContests).toEqual([
      { contest: "main", picksOpenAt: "2027-01-02T16:00:00.000Z", timeZone: "America/Los_Angeles" },
    ])
    expect((await fetchFantasyStandings("main"))?.otherOpenContests).toEqual([
      { contest: "beta", picksOpenAt: null, timeZone: "America/Los_Angeles" },
    ])
  })

  it("names the contest on a plain /fantasy, keeping the tab", async () => {
    vi.setSystemTime(BETA_ACTIVE)

    await expect(FantasyPage({ searchParams: Promise.resolve({ tab: "pickem" }) })).rejects.toThrow(
      "redirect:/fantasy?contest=beta&tab=pickem"
    )
  })
})

describe("with one contest", () => {
  it("doesn't redirect", async () => {
    vi.setSystemTime(BETA_ACTIVE)

    expect(await page()).toContain("<form")
  })

  it("says so once it's closed and nothing else is open", async () => {
    vi.setSystemTime(BETA_FINAL_WEEK)

    const html = await page()
    expect(html).toContain("No other contest is open to join")
    expect(html).not.toContain("<form")
  })

  it("is a 404 for a contest that doesn't exist", async () => {
    await expect(page("nope")).rejects.toThrow("not-found")
  })
})
