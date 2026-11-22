// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { computePlayoffOdds } from "@/lib/playoff-odds"
import { PlayoffOddsView } from "@/components/playoff-odds-view"
import { StandingsContent } from "@/components/standings-content"
import { GET as getPlayoffOddsApi } from "@/app/api/bash/playoff-odds/route"
import type { PlayoffSimGame } from "@/lib/playoff-odds-types"
import type { BashGame, Standing } from "@/app/api/bash/route"

const mockFetchPlayoffOddsPageData = vi.hoisted(() => vi.fn())
const searchParamsState = vi.hoisted(() => ({
  season: "bash-2026-2027",
  view: null as string | null,
  team: null as string | null,
  mode: null as string | null,
}))

vi.mock("@/lib/cached-page-data", () => ({
  fetchPlayoffOddsPageData: (...args: unknown[]) => mockFetchPlayoffOddsPageData(...args),
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const params = new URLSearchParams()
    if (searchParamsState.season) params.set("season", searchParamsState.season)
    if (searchParamsState.view) params.set("view", searchParamsState.view)
    if (searchParamsState.team) params.set("team", searchParamsState.team)
    if (searchParamsState.mode) params.set("mode", searchParamsState.mode)
    return params
  },
  useRouter: () => ({ replace: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock("@/components/team-logo", () => ({
  TeamLogo: () => null,
}))

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="recharts-mock">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
}))

const sampleSimGames: PlayoffSimGame[] = [
  { id: "g1", date: "2026-10-10", time: "9:00am", location: "The Lick", awaySlug: "kings", awayName: "Kings", homeSlug: "seals", homeName: "Seals", awayScore: 5, homeScore: 2, status: "final", isOvertime: false, hasShootout: false, isForfeit: false },
  { id: "g2", date: "2026-10-10", time: "11:00am", location: "The Lick", awaySlug: "yetis", awayName: "Yetis", homeSlug: "loons", homeName: "Loons", awayScore: 4, homeScore: 3, status: "final", isOvertime: true, hasShootout: false, isForfeit: false },
  { id: "g3", date: "2026-10-17", time: "9:00am", location: "The Lick", awaySlug: "seals", awayName: "Seals", homeSlug: "yetis", homeName: "Yetis", awayScore: 2, homeScore: 4, status: "final", isOvertime: false, hasShootout: false, isForfeit: false },
  { id: "g4", date: "2026-10-17", time: "11:00am", location: "The Lick", awaySlug: "loons", awayName: "Loons", homeSlug: "kings", homeName: "Kings", awayScore: 3, homeScore: 5, status: "final", isOvertime: false, hasShootout: false, isForfeit: false },
  { id: "g5", date: "2026-10-24", time: "9:00am", location: "The Lick", awaySlug: "seals", awayName: "Seals", homeSlug: "loons", homeName: "Loons", awayScore: null, homeScore: null, status: "upcoming", isOvertime: false, hasShootout: false, isForfeit: false },
  { id: "g6", date: "2026-10-24", time: "11:00am", location: "The Lick", awaySlug: "kings", awayName: "Kings", homeSlug: "yetis", homeName: "Yetis", awayScore: null, homeScore: null, status: "upcoming", isOvertime: false, hasShootout: false, isForfeit: false },
  { id: "g7", date: "2026-10-31", time: "9:00am", location: "The Lick", awaySlug: "seals", awayName: "Seals", homeSlug: "kings", homeName: "Kings", awayScore: null, homeScore: null, status: "upcoming", isOvertime: false, hasShootout: false, isForfeit: false },
  { id: "g8", date: "2026-10-31", time: "11:00am", location: "The Lick", awaySlug: "loons", awayName: "Loons", homeSlug: "yetis", homeName: "Yetis", awayScore: null, homeScore: null, status: "upcoming", isOvertime: false, hasShootout: false, isForfeit: false },
]

const sampleSnapshot = computePlayoffOdds({
  seasonId: "bash-2026-2027",
  seasonName: "BASH 2026-2027",
  seasonType: "fall",
  seasonStatus: "active",
  configuredPlayoffTeams: 2,
  games: sampleSimGames,
  mode: "weighted",
  iterations: 5_000,
})

describe("GET /api/bash/playoff-odds", () => {
  beforeEach(() => {
    mockFetchPlayoffOddsPageData.mockReset()
  })

  it("rejects season=all and invalid mode parameters with 400", async () => {
    const resAll = await getPlayoffOddsApi(
      new Request("http://localhost/api/bash/playoff-odds?season=all")
    )
    expect(resAll.status).toBe(400)

    const resBadMode = await getPlayoffOddsApi(
      new Request("http://localhost/api/bash/playoff-odds?season=bash-2026-2027&mode=bogus")
    )
    expect(resBadMode.status).toBe(400)
  })

  it("returns cached playoff odds snapshot JSON with Cache-Control header", async () => {
    mockFetchPlayoffOddsPageData.mockResolvedValueOnce(sampleSnapshot)
    const res = await getPlayoffOddsApi(
      new Request("http://localhost/api/bash/playoff-odds?season=bash-2026-2027&mode=weighted")
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60")
    const body = await res.json()
    expect(body.seasonId).toBe("bash-2026-2027")
    expect(body.teams).toHaveLength(4)
  })
})

describe("PlayoffOddsView & StandingsContent Integration", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    searchParamsState.season = "bash-2026-2027"
    searchParamsState.view = null
    searchParamsState.team = null
    searchParamsState.mode = null
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it("renders Playoff Odds table, expands team breakdown, and runs live What-If scenario", async () => {
    await act(async () => {
      root.render(
        <PlayoffOddsView season="bash-2026-2027" initialData={sampleSnapshot} />
      )
    })

    // Signature sections present
    expect(container.textContent).toContain("Chance to make playoffs")
    expect(container.textContent).toContain("Big games — who to root for")
    expect(container.textContent).toContain("Kings")
    expect(container.textContent).toContain("Seals")
    expect(container.textContent).toContain("How playoff odds are calculated")

    // Click team expand button to open TeamOddsPanel
    const expandBtn = container.querySelector('button[aria-label="Show Seals breakdown"]') as HTMLButtonElement
    expect(expandBtn).toBeTruthy()
    await act(async () => {
      expandBtn.click()
    })
    expect(container.textContent).toContain("How Seals needs to finish")

    // Close team panel
    const closeBtn = container.querySelector('button[aria-label="Close Seals breakdown"]') as HTMLButtonElement
    await act(async () => {
      closeBtn.click()
    })
    expect(container.textContent).not.toContain("How Seals needs to finish")

    // Trigger live What-If pick on an upcoming game
    const pickBtn = container.querySelector('button[title*="in What-If mode"]') as HTMLButtonElement
    expect(pickBtn).toBeTruthy()
    await act(async () => {
      pickBtn.click()
    })
    expect(container.textContent).toContain("What-If scenario active")
    expect(container.textContent).toContain("1 game locked")

    // Reset What-If picks
    const resetBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Reset picks")
    ) as HTMLButtonElement
    expect(resetBtn).toBeTruthy()
    await act(async () => {
      resetBtn.click()
    })
    expect(container.textContent).not.toContain("What-If scenario active")
  })

  it("switches to Playoff Odds tab inside StandingsContent and updates URL with replaceState", async () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
    const mockStandings: Standing[] = [
      { team: "Kings", slug: "kings", gp: 2, w: 2, otw: 0, otl: 0, l: 0, gf: 10, ga: 5, gd: 5, pts: 6 },
      { team: "Seals", slug: "seals", gp: 2, w: 0, otw: 0, otl: 0, l: 2, gf: 4, ga: 9, gd: -5, pts: 0 },
    ]
    const mockGames: BashGame[] = []

    await act(async () => {
      root.render(
        <StandingsContent
          initialData={{ games: mockGames, standings: mockStandings, lastUpdated: new Date().toISOString() }}
          initialPlayoffOdds={sampleSnapshot}
        />
      )
    })

    const oddsTab = container.querySelector("#standings-tab-odds") as HTMLButtonElement
    expect(oddsTab).toBeTruthy()
    expect(oddsTab.getAttribute("aria-selected")).toBe("false")

    await act(async () => {
      oddsTab.click()
    })

    expect(oddsTab.getAttribute("aria-selected")).toBe("true")
    expect(replaceSpy).toHaveBeenCalled()
    const lastUrl = String(replaceSpy.mock.calls.at(-1)?.[2] ?? "")
    expect(lastUrl).toContain("view=odds")
    expect(lastUrl).toContain("season=bash-2026-2027")
    expect(container.textContent).toContain("Big games — who to root for")

    replaceSpy.mockRestore()
  })
})
