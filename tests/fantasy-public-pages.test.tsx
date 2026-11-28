import { isValidElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type CacheCall = { keys: string[]; options: { revalidate: number; tags: string[] } }
const cached = vi.hoisted((): CacheCall[] => [])
// The cache needs a running Next server, so reads go straight through, and each wrapper's settings are recorded.
vi.mock("next/cache", async (original) => ({
  ...(await original<typeof import("next/cache")>()),
  revalidateTag: vi.fn(),
  unstable_cache: <T,>(fn: T, keys: string[], options: CacheCall["options"]) => {
    cached.push({ keys, options })
    return fn
  },
}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
  useRouter: () => ({ refresh: vi.fn() }),
}))

import FantasyPage from "@/app/fantasy/page"
import ManagerLinkPage from "@/app/fantasy/m/[token]/page"
import { ManagerPanel } from "@/components/fantasy/manager-panel"
import { FantasyStandingsView } from "@/components/fantasy/standings"
import { db, schema } from "@/lib/db"
import { DEFAULT_FANTASY_CONFIG } from "@/lib/fantasy/config"
import { saveLineup } from "@/lib/fantasy/lineups"
import { createManager } from "@/lib/fantasy/managers"
import { savePredictions } from "@/lib/fantasy/predictions"
import { getFantasySeason, saveFantasyConfig } from "@/lib/fantasy/season"
import { fetchFantasyManager, fetchFantasyStandings } from "@/lib/fetch-fantasy"
import "@/lib/cached-page-data"
import { setupGame } from "./factories/setupGame"
import { setupPlayer } from "./factories/setupPlayer"
import { setupSeason } from "./factories/setupSeason"
import { setupTeam } from "./factories/setupTeam"

const at = (local: string) => new Date(`${local}-08:00`)
const LAUNCH = at("2026-11-04T12:00:00")
const FIRST = "2026-11-07"
const SECOND = "2026-11-14"
const THIRD = "2026-11-21"
/** FIRST has locked, so SECOND is the open Week. */
const NOW = at("2026-11-10T12:00:00")

/** The props of the first element of `type` in a page's tree. */
function propsOf(node: unknown, type: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map((child) => propsOf(child, type)).find(Boolean)
  if (!isValidElement<Record<string, unknown>>(node)) return undefined
  return node.type === type ? node.props : propsOf(node.props.children, type)
}

async function setupLeague() {
  const { season } = await setupSeason({ isCurrent: true })
  const { team: seals } = await setupTeam()
  const { team: yetis } = await setupTeam()
  const ids: number[] = []
  for (const isGoalie of [false, false, false, true]) {
    ids.push((await setupPlayer({ roster: [{ season, team: isGoalie ? yetis : seals, isGoalie }] })).player.id)
  }
  const gameIds: Record<string, string> = {}
  for (const date of [FIRST, SECOND, THIRD]) {
    const upcoming = { status: "upcoming", homeScore: null, awayScore: null, hasBoxscore: false }
    gameIds[date] = (await setupGame({ season, homeTeam: seals, awayTeam: yetis, date, time: "9:00a", ...upcoming })).game.id
  }
  await saveFantasyConfig(season.id, "regular", DEFAULT_FANTASY_CONFIG, LAUNCH)
  const created = (await createManager(season.id, "regular", { teamName: "Puck Norris", firstName: "Ada", lastName: "Lovelace" }))!
  const [manager] = await db.select().from(schema.fantasyManagers)
  const contest = (await getFantasySeason(season.id))!
  const lineup = { skaters: ids.slice(0, 3), goalies: [ids[3]], skaterBackups: [], goalieBackups: [] }
  return { season, manager, contest, lineup, gameIds, token: created.managerPath.split("/").pop()! }
}

let league: Awaited<ReturnType<typeof setupLeague>>

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: LAUNCH })
  league = await setupLeague()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("the Manager Link page", () => {
  const open = (week?: string, token = league.token) =>
    ManagerLinkPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({ week }) })
  const formOf = (tree: unknown) => propsOf(tree, ManagerPanel)?.form as { week: { id: string }; closed: boolean }

  beforeEach(() => vi.setSystemTime(NOW))

  it("opens the Week its link names, and otherwise the one taking picks", async () => {
    expect(formOf(await open(THIRD)).week.id).toBe(THIRD)
    expect(formOf(await open()).week.id).toBe(SECOND)
  })

  it("says picks are closed on a locked Week, and gives no closing time", async () => {
    const tree = await open(FIRST)

    expect(formOf(tree)).toMatchObject({ week: { id: FIRST }, closed: true })
    // The panel needs a browser, so only the page's own header is rendered.
    expect(JSON.stringify(tree)).toContain("Picks are closed for this Week.")
  })

  it("is not found for a link that matches no Manager", async () => {
    await expect(open(undefined, "not-a-token")).rejects.toThrow("NEXT_NOT_FOUND")
  })
})

describe("the standings page's Week and contest", () => {
  const open = (params: { week?: string; contest?: string; tab?: string } = {}) =>
    FantasyPage({ searchParams: Promise.resolve(params) })
  const shown = async (params = {}) =>
    propsOf(await open(params), FantasyStandingsView) as { initialRange: string; view: { weekId: string } }

  beforeEach(async () => {
    expect(await saveLineup(league.manager, league.contest, FIRST, league.lineup, LAUNCH)).toEqual({ outcome: "saved" })
    vi.setSystemTime(NOW)
  })

  it("starts on the season, with the latest locked Week behind it", async () => {
    expect(await shown()).toMatchObject({ initialRange: "season", view: { weekId: FIRST } })
  })

  it("starts on the Week when the link names one", async () => {
    expect(await shown({ week: FIRST })).toMatchObject({ initialRange: "weekly", view: { weekId: FIRST } })
  })

  it("keeps the named Week when it adds the contest to the URL", async () => {
    await saveFantasyConfig(league.season.id, "extras", DEFAULT_FANTASY_CONFIG, LAUNCH)

    await expect(open({ week: FIRST })).rejects.toThrow(new RegExp(`redirect:.*week=${FIRST}`))
  })

  it("is not found for a contest key that can't exist, rather than showing the default", async () => {
    await expect(open({ contest: "!!" })).rejects.toThrow("NEXT_NOT_FOUND")
  })
})

describe("cached public pages", () => {
  it.each(["fantasy-page-data-v3", "fantasy-manager-page-data-v3"])(
    "%s expires within 30 seconds and when admin changes drop the fantasy tag",
    (key) => {
      const call = cached.find(({ keys }) => keys.includes(key))

      expect(call?.options.revalidate).toBe(30)
      expect(call?.options.tags).toContain("fantasy")
    }
  )

  it("hold only data that survives the cache's JSON round trip", async () => {
    await saveLineup(league.manager, league.contest, FIRST, league.lineup, LAUNCH)
    await savePredictions(
      league.manager,
      league.contest,
      FIRST,
      [{ gameId: league.gameIds[FIRST], homeScore: 3, awayScore: 1 }],
      LAUNCH
    )
    vi.setSystemTime(NOW)

    for (const data of [await fetchFantasyStandings(), await fetchFantasyManager(league.manager.id)]) {
      expect(data).not.toBeNull()
      // Strict, so a Date, Map, Set or undefined that wouldn't come back the same fails.
      expect(JSON.parse(JSON.stringify(data))).toStrictEqual(data)
    }
  })
})
