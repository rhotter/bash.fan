// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { computePlayoffOdds } from "@/lib/playoff-odds"
import { BigGamesSection } from "@/components/big-games-section"
import { PlayoffOddsView } from "@/components/playoff-odds-view"
import { StandingsContent } from "@/components/standings-content"
import { GET as getPlayoffOddsApi } from "@/app/api/bash/playoff-odds/route"
import type { BigGameImpact, BigGameOutcomeCell, PlayoffOddsSnapshot, PlayoffSimGame } from "@/lib/playoff-odds-types"
import type { BashGame, Standing } from "@/app/api/bash/route"

const mockFetchPlayoffOddsPageData = vi.hoisted(() => vi.fn())
const mockGetSeasonById = vi.hoisted(() => vi.fn())
const mockGetCurrentSeason = vi.hoisted(() => vi.fn())
const searchParamsState = vi.hoisted(() => ({
  season: "bash-2026-2027",
  view: null as string | null,
  team: null as string | null,
  mode: null as string | null,
}))

vi.mock("@/lib/cached-page-data", () => ({
  fetchPlayoffOddsPageData: (...args: unknown[]) => mockFetchPlayoffOddsPageData(...args),
}))

vi.mock("@/lib/seasons", () => ({
  getSeasonById: (...args: unknown[]) => mockGetSeasonById(...args),
  getCurrentSeason: (...args: unknown[]) => mockGetCurrentSeason(...args),
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
    mockGetSeasonById.mockReset()
    mockGetCurrentSeason.mockReset()
    mockGetCurrentSeason.mockResolvedValue({
      id: "bash-2026-2027",
      name: "BASH 2026-2027",
      seasonType: "fall",
      status: "active",
      playoffTeams: 5,
    })
  })

  it("rejects season=all, invalid mode (400), and unknown season (404 without computing)", async () => {
    const resAll = await getPlayoffOddsApi(
      new Request("http://localhost/api/bash/playoff-odds?season=all")
    )
    expect(resAll.status).toBe(400)

    const resBadMode = await getPlayoffOddsApi(
      new Request("http://localhost/api/bash/playoff-odds?season=bash-2026-2027&mode=bogus")
    )
    expect(resBadMode.status).toBe(400)

    mockGetSeasonById.mockResolvedValueOnce(undefined)
    const resUnknown = await getPlayoffOddsApi(
      new Request("http://localhost/api/bash/playoff-odds?season=arbitrary-dos-probe")
    )
    expect(resUnknown.status).toBe(404)
    expect(mockFetchPlayoffOddsPageData).not.toHaveBeenCalled()
  })

  it("returns cached playoff odds snapshot JSON with appropriate Cache-Control header", async () => {
    mockGetSeasonById.mockResolvedValueOnce({
      id: "bash-2026-2027",
      name: "BASH 2026-2027",
      seasonType: "fall",
      status: "active",
      playoffTeams: 5,
    })
    mockFetchPlayoffOddsPageData.mockResolvedValueOnce(sampleSnapshot)
    const res = await getPlayoffOddsApi(
      new Request("http://localhost/api/bash/playoff-odds?season=bash-2026-2027&mode=weighted")
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60")
    const body = await res.json()
    expect(body.seasonId).toBe("bash-2026-2027")
    expect(body.teams).toHaveLength(4)

    // Completed season gets longer 3600s edge cache
    mockGetSeasonById.mockResolvedValueOnce({
      id: "2018-2019",
      name: "Fall 2018-19",
      seasonType: "fall",
      status: "completed",
      playoffTeams: 5,
    })
    mockFetchPlayoffOddsPageData.mockResolvedValueOnce({
      ...sampleSnapshot,
      seasonId: "2018-2019",
      seasonStatus: "completed",
    })
    const resDone = await getPlayoffOddsApi(
      new Request("http://localhost/api/bash/playoff-odds?season=2018-2019")
    )
    expect(resDone.status).toBe(200)
    expect(resDone.headers.get("Cache-Control")).toContain("s-maxage=3600")
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

    // Signature sections present in "All teams" view (SCS-style trend charts + odds table + this week's games)
    expect(container.textContent).toContain("BASH 2026-2027 playoff odds")
    expect(container.textContent).toContain("We ran 5,000 Monte Carlo simulations with 3 different models.")
    expect(container.textContent).toContain("BASH Weighted: Goal-based team strength calibrated on 2,100+ past BASH games")
    expect(container.textContent).toContain("Chance will make playoffs")
    expect(container.textContent).toContain("Chance to make playoffs")
    expect(container.textContent).toContain("This week's games")
    expect(container.textContent).toContain("Kings")
    expect(container.textContent).toContain("Seals")
    expect(container.textContent).toContain("How playoff odds are calculated")

    // Odds table rows no longer carry a chevron expand button
    expect(container.querySelector('button[aria-label="Show Seals breakdown"]')).toBeNull()

    // Pick "Seals" from the Teams selector (desktop button row) to open the team view
    const teamsGroup = container.querySelector('[role="group"][aria-label="Teams"]') as HTMLElement
    expect(teamsGroup).toBeTruthy()
    const sealsBtn = Array.from(teamsGroup.querySelectorAll("button")).find(
      (b) => b.textContent === "Seals"
    ) as HTMLButtonElement
    await act(async () => {
      sealsBtn.click()
    })
    expect(sealsBtn.getAttribute("aria-pressed")).toBe("true")
    expect(container.textContent).toContain("How Seals needs to finish")
    // League overview (charts + odds table) is replaced by the team view
    expect(container.textContent).not.toContain("Chance will make playoffs")
    expect(container.textContent).not.toContain("Chance to make playoffs & finish at each seed")
    // Season header stays visible in team view
    expect(container.textContent).toContain("BASH 2026-2027 playoff odds")
    // This week's games is locked to Seals (no in-section team dropdown)
    expect(container.querySelector("#big-games-team-filter")).toBeNull()

    // Mobile select stays in sync
    const mobileSelect = container.querySelector('select[aria-label="Team"]') as HTMLSelectElement
    expect(mobileSelect.value).toBe("seals")

    // Return to "All teams"
    const allTeamsBtn = Array.from(teamsGroup.querySelectorAll("button")).find(
      (b) => b.textContent === "All teams"
    ) as HTMLButtonElement
    await act(async () => {
      allTeamsBtn.click()
    })
    expect(container.textContent).not.toContain("How Seals needs to finish")
    expect(container.textContent).toContain("Chance will make playoffs")

    // Tapping a table row also opens that team's view
    const sealsRowBtn = container.querySelector('button[aria-label="View Seals playoff outlook"]') as HTMLButtonElement
    expect(sealsRowBtn).toBeTruthy()
    await act(async () => {
      sealsRowBtn.click()
    })
    expect(container.textContent).toContain("How Seals needs to finish")

    // "Back to all teams" (X) closes the team view
    const backBtn = container.querySelector('button[aria-label="Back to all teams"]') as HTMLButtonElement
    await act(async () => {
      backBtn.click()
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
    expect(container.textContent).toContain("This week's games")

    replaceSpy.mockRestore()
  })

  it("resets table sort, chart metric, and team filter cleanly when switching between Fall and Summer seasons", async () => {
    const summerSnapshot = computePlayoffOdds({
      seasonId: "2026-summer",
      seasonName: "Summer 2026",
      seasonType: "summer",
      seasonStatus: "active",
      configuredPlayoffTeams: 4,
      games: sampleSimGames.map((g) => ({
        ...g,
        awaySlug: g.awaySlug === "seals" ? "sharks" : g.awaySlug,
        awayName: g.awaySlug === "seals" ? "Sharks" : g.awayName,
        homeSlug: g.homeSlug === "seals" ? "sharks" : g.homeSlug,
        homeName: g.homeSlug === "seals" ? "Sharks" : g.homeName,
      })),
      mode: "weighted",
      iterations: 2_000,
    })

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      const payload = url.includes("2026-summer") ? summerSnapshot : sampleSnapshot
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })

    try {
      // Start in Fall "All teams" view, then open the Seals team view
      await act(async () => {
        root.render(
          <PlayoffOddsView season="bash-2026-2027" initialTeam="seals" initialData={sampleSnapshot} />
        )
      })
      expect(container.textContent).toContain("How Seals needs to finish")

      // Switch to Summer (where "seals" does not exist and all teams qualify): falls back to All teams
      await act(async () => {
        root.render(<PlayoffOddsView season="2026-summer" initialTeam="seals" initialData={summerSnapshot} />)
      })
      expect(container.textContent).not.toContain("How Seals needs to finish")
      expect(container.textContent).toContain("Summer 2026 playoff odds")
      const mobileTeamSelect = container.querySelector('select[aria-label="Team"]') as HTMLSelectElement
      expect(mobileTeamSelect.value).toBe("all")

      // Summer "#1 %" header must sort independently from "Avg" (no duplicate aria-sort)
      const sortedHeaders = Array.from(container.querySelectorAll('th[aria-sort]:not([aria-sort="none"])'))
      expect(sortedHeaders).toHaveLength(1)

      // League trend chart switches its second chart to "Projected seed" when every team qualifies
      expect(container.textContent).toContain("Projected seed")
      expect(container.textContent).not.toContain("Chance will make playoffs")

      // Open Kings team view in Fall, then switch to Summer: TeamOddsPanel must fall back
      // from the hidden "Playoff %" tab to the "Avg seed" tab
      await act(async () => {
        root.render(
          <PlayoffOddsView season="bash-2026-2027" initialTeam="kings" initialData={sampleSnapshot} />
        )
      })
      await act(async () => {
        root.render(<PlayoffOddsView season="2026-summer" initialTeam="kings" initialData={summerSnapshot} />)
      })
      const activeChartTab = container.querySelector(
        '[aria-label="Trajectory chart metric"] [role="tab"][aria-selected="true"]'
      )
      expect(activeChartTab?.textContent).toBe("Avg seed")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("surfaces ErrorNotice when a mode switch fetch fails instead of hiding behind stale keepPreviousData", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Mode fetch failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    )

    try {
      await act(async () => {
        root.render(<PlayoffOddsView season="bash-2026-2027" initialData={sampleSnapshot} />)
      })

      const modelSelect = container.querySelector("#playoff-odds-stats-model") as HTMLSelectElement
      expect(modelSelect).toBeTruthy()
      expect(container.textContent).toContain("BASH Weighted:")

      await act(async () => {
        modelSelect.value = "50_50"
        modelSelect.dispatchEvent(new Event("change", { bubbles: true }))
      })
      // Allow SWR promise rejection to flush
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20))
      })

      const alert = container.querySelector('[role="alert"]')
      expect(alert).toBeTruthy()
      expect(alert?.textContent).toContain("The request couldn't finish")

      // Stats Model dropdown must remain mounted so user can recover by switching back to Weighted
      const recoverSelect = container.querySelector("#playoff-odds-stats-model") as HTMLSelectElement
      expect(recoverSelect).toBeTruthy()
      expect(recoverSelect.value).toBe("50_50")
      expect(container.textContent).toContain("50/50:")

      await act(async () => {
        recoverSelect.value = "weighted"
        recoverSelect.dispatchEvent(new Event("change", { bubbles: true }))
      })
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(container.textContent).toContain("Chance to make playoffs")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("prefers fresh SSR fallback when returning from a past season to default Current Season (season=undefined)", async () => {
    const pastSnapshot = computePlayoffOdds({
      seasonId: "2024-2025",
      seasonName: "Fall 2024-25",
      seasonType: "fall",
      seasonStatus: "completed",
      configuredPlayoffTeams: 2,
      games: sampleSimGames.map((g) => ({ ...g, status: "final", awayScore: 3, homeScore: 2 })),
      mode: "weighted",
      iterations: 1_000,
    })

    // Hold fetch open so SWR relies on keepPreviousData vs fresh matchingFallback
    let resolveFetch!: (res: Response) => void
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((res) => { resolveFetch = res })
    )

    try {
      await act(async () => {
        root.render(<PlayoffOddsView season="2024-2025" initialData={pastSnapshot} />)
      })
      expect(container.textContent).toContain("Fall 2024-25")

      // Return to default Current Season (season=undefined) with fresh SSR initialData
      await act(async () => {
        root.render(<PlayoffOddsView season={undefined} initialData={sampleSnapshot} />)
      })
      expect(container.textContent).toContain("BASH 2026-2027")
      expect(container.textContent).not.toContain("Fall 2024-25")

      resolveFetch?.(
        new Response(JSON.stringify(sampleSnapshot), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("renders ErrorNotice instead of empty-schedule message when switching from an empty season to a failing season", async () => {
    const emptySnapshot = computePlayoffOdds({
      seasonId: "unsynced-season",
      seasonName: "Unsynced Season",
      seasonType: "fall",
      seasonStatus: "draft",
      configuredPlayoffTeams: 4,
      games: [],
      mode: "weighted",
      iterations: 1_000,
    })

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    )

    try {
      await act(async () => {
        root.render(<PlayoffOddsView season="unsynced-season" initialData={emptySnapshot} />)
      })
      expect(container.textContent).toContain("No regular-season schedule data available")

      // Switch to another season whose fetch fails
      await act(async () => {
        root.render(<PlayoffOddsView season="failing-season" />)
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20))
      })

      const alert = container.querySelector('[role="alert"]')
      expect(alert).toBeTruthy()
      expect(container.textContent).not.toContain("No regular-season schedule data available")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("does not show previous populated season metadata bar when switching to a failing season", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Season unavailable" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    )

    try {
      await act(async () => {
        root.render(<PlayoffOddsView season="bash-2026-2027" initialData={sampleSnapshot} />)
      })
      expect(container.textContent).toContain("BASH 2026-2027")

      // Switch to a different season whose fetch fails
      await act(async () => {
        root.render(<PlayoffOddsView season="broken-season-2099" />)
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20))
      })

      const alert = container.querySelector('[role="alert"]')
      expect(alert).toBeTruthy()
      expect(container.textContent).not.toContain("BASH 2026-2027")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("does not show previous season metadata bar when switching from past season (50/50) to failing default Current Season (weighted)", async () => {
    const past5050Snapshot = computePlayoffOdds({
      seasonId: "2024-2025",
      seasonName: "Fall 2024-25",
      seasonType: "fall",
      seasonStatus: "completed",
      configuredPlayoffTeams: 2,
      games: sampleSimGames.map((g) => ({ ...g, status: "final", awayScore: 3, homeScore: 2 })),
      mode: "50_50",
      iterations: 1_000,
    })

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Current season unavailable" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    )

    try {
      await act(async () => {
        root.render(
          <PlayoffOddsView
            season="2024-2025"
            initialMode="50_50"
            initialData={past5050Snapshot}
          />
        )
      })
      expect(container.textContent).toContain("Fall 2024-25")

      // Switch to default Current Season (season=undefined) in weighted mode while fetch fails
      await act(async () => {
        root.render(<PlayoffOddsView season={undefined} initialMode="weighted" />)
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20))
      })

      const alert = container.querySelector('[role="alert"]')
      expect(alert).toBeTruthy()
      expect(container.textContent).not.toContain("Fall 2024-25")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("switches BigGamesSection into Team Rooting View (re-sorts by team swing, collapses rows, updates badge, and shows tooltip)", async () => {
    const mkCell = (playoffPct: number, playoffDelta: number): BigGameOutcomeCell => ({
      playoffPct,
      playoffDelta,
      avgSeed: 2.5,
      seedDelta: 0,
      lowSample: false,
    })

    const mkOutcomes = (vals: [number, number, number, number], cur: number) => ({
      away_reg: mkCell(vals[0], Number((vals[0] - cur).toFixed(1))),
      away_ot: mkCell(vals[1], Number((vals[1] - cur).toFixed(1))),
      home_ot: mkCell(vals[2], Number((vals[2] - cur).toFixed(1))),
      home_reg: mkCell(vals[3], Number((vals[3] - cur).toFixed(1))),
    })

    const watchGame: BigGameImpact = {
      gameId: "g-watch",
      date: "2026-11-14",
      time: "9:00am",
      location: "The Lick",
      isNextMatchday: true,
      awaySlug: "seals",
      awayName: "Seals",
      homeSlug: "loons",
      homeName: "Loons",
      awayWinProb: 45,
      homeWinProb: 55,
      totalPlayoffSwing: 40.6,
      totalSeedSwing: 1.2,
      outcomeSampleCounts: { away_reg: 3000, away_ot: 1500, home_ot: 1500, home_reg: 4000 },
      affectedTeams: [
        {
          slug: "seals",
          name: "Seals",
          isParticipant: true,
          currentPlayoffPct: 13.2,
          currentAvgSeed: 5.5,
          playoffSwing: 20.0,
          seedSwing: 0.5,
          bestOutcome: "away_reg",
          outcomes: mkOutcomes([25.2, 16.0, 10.0, 5.2], 13.2),
        },
        {
          slug: "loons",
          name: "Loons",
          isParticipant: true,
          currentPlayoffPct: 42.6,
          currentAvgSeed: 4.5,
          playoffSwing: 19.5,
          seedSwing: 0.5,
          bestOutcome: "home_reg",
          outcomes: mkOutcomes([32.1, 38.0, 46.1, 51.6], 42.6),
        },
        {
          slug: "landsharks",
          name: "Landsharks",
          isParticipant: false,
          currentPlayoffPct: 93.2,
          currentAvgSeed: 2.8,
          playoffSwing: 1.1,
          seedSwing: 0.12,
          bestOutcome: "away_reg",
          outcomes: mkOutcomes([93.7, 93.5, 93.5, 92.6], 93.2),
        },
      ],
    }

    const ownGame: BigGameImpact = {
      gameId: "g-own",
      date: "2026-11-14",
      time: "1:00pm",
      location: "The Lick",
      isNextMatchday: true,
      awaySlug: "loons",
      awayName: "Loons",
      homeSlug: "landsharks",
      homeName: "Landsharks",
      awayWinProb: 40,
      homeWinProb: 60,
      totalPlayoffSwing: 25.0,
      totalSeedSwing: 0.9,
      outcomeSampleCounts: { away_reg: 2800, away_ot: 1200, home_ot: 1500, home_reg: 4500 },
      affectedTeams: [
        {
          slug: "loons",
          name: "Loons",
          isParticipant: true,
          currentPlayoffPct: 42.6,
          currentAvgSeed: 4.5,
          playoffSwing: 16.2,
          seedSwing: 0.4,
          bestOutcome: "away_reg",
          outcomes: mkOutcomes([52.4, 47.0, 40.6, 36.2], 42.6),
        },
        {
          slug: "landsharks",
          name: "Landsharks",
          isParticipant: true,
          currentPlayoffPct: 93.2,
          currentAvgSeed: 2.8,
          playoffSwing: 8.8,
          seedSwing: 0.35,
          bestOutcome: "home_reg",
          outcomes: mkOutcomes([88.2, 90.4, 94.8, 97.0], 93.2),
        },
      ],
    }

    const rootingSnapshot: PlayoffOddsSnapshot = {
      ...sampleSnapshot,
      nextMatchdayDate: "2026-11-14",
      teams: [
        ...sampleSnapshot.teams.slice(0, 2),
        { ...sampleSnapshot.teams[0], slug: "landsharks", name: "Landsharks" },
      ],
      bigGames: [
        watchGame,
        ownGame,
        { ...ownGame, gameId: "g-later", date: "2026-11-21", isNextMatchday: false, totalPlayoffSwing: 99 },
      ],
    }

    await act(async () => {
      root.render(
        <BigGamesSection
          snapshot={rootingSnapshot}
          lockedOutcomes={{}}
          onToggleOutcome={() => {}}
          onClearLocked={() => {}}
          allUpcomingGames={[]}
        />
      )
    })

    // Only this week's matchday is shown — no "Next 2 matchdays" toggle or in-section team dropdown
    expect(container.querySelector('button[data-scope="two_weeks"]')).toBeNull()
    expect(container.querySelector("#big-games-team-filter")).toBeNull()
    expect(container.querySelector('a[href="/game/g-later"]')).toBeNull()

    // In "All teams" mode: subtitle explains league-wide probability swing, and g-watch (40.6pp) comes before g-own (25.0pp)
    expect(container.textContent).toContain("Ranked by league-wide probability swing.")
    let cards = Array.from(container.querySelectorAll("article"))
    expect(cards).toHaveLength(2)
    // Matchup team names link directly to the game page without date/time/Matchup clutter
    const matchupLink = cards[0].querySelector('a[href="/game/g-watch"]')
    expect(matchupLink?.textContent).toContain("Seals")
    expect(matchupLink?.textContent).toContain("Loons")
    expect(cards[0].textContent).not.toContain("Matchup")
    expect(cards[0].textContent).not.toContain("9:00am")
    expect(cards[0].textContent).toContain("League Playoff impact: 40.6pp")
    // Watching team (Landsharks) is collapsed by default behind "Impact to other teams (1)" zippy
    expect(cards[0].querySelectorAll("tbody th")).toHaveLength(2)
    const impactToggle = Array.from(cards[0].querySelectorAll("tbody button")).find((b) =>
      b.textContent?.includes("Impact to other teams (1)")
    ) as HTMLButtonElement
    expect(impactToggle).toBeTruthy()
    expect(impactToggle.getAttribute("aria-expanded")).toBe("false")
    expect(cards[1].textContent).toContain("League Playoff impact: 25.0pp")
    expect(cards[1].querySelectorAll("tbody th")).toHaveLength(2)
    expect(cards[1].textContent).not.toContain("Impact to other teams")

    // Clicking "Impact to other teams (1)" expands the watching team row, and clicking again collapses it
    await act(async () => {
      impactToggle.click()
    })
    expect(impactToggle.getAttribute("aria-expanded")).toBe("true")
    expect(cards[0].querySelectorAll("tbody th")).toHaveLength(3)
    expect(cards[0].querySelectorAll("tbody th")[2]?.textContent).toContain("Landsharks")
    expect(cards[0].querySelectorAll("tbody th")[2]?.textContent).toContain("Watching")
    await act(async () => {
      impactToggle.click()
    })
    expect(impactToggle.getAttribute("aria-expanded")).toBe("false")
    expect(cards[0].querySelectorAll("tbody th")).toHaveLength(2)

    // Focusing the League Playoff impact badge opens the "League-wide probability swing" tooltip
    const originalResizeObserverForBadge = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    try {
      const impactBadge = Array.from(cards[0].querySelectorAll("span[tabindex='0']")).find((el) =>
        el.textContent?.includes("League Playoff impact: 40.6pp")
      ) as HTMLElement
      expect(impactBadge).toBeTruthy()
      await act(async () => {
        impactBadge.focus()
      })
      const impactTooltip = Array.from(document.body.querySelectorAll('[role="tooltip"]')).find((el) =>
        el.textContent?.includes("League-wide probability swing")
      )
      expect(impactTooltip).toBeTruthy()
      expect(impactTooltip?.textContent).toContain("exceed 100pp")
      await act(async () => {
        impactBadge.blur()
      })
    } finally {
      globalThis.ResizeObserver = originalResizeObserverForBadge
    }

    // Team view (Landsharks picked in the top Teams filter) -> Team Rooting View
    await act(async () => {
      root.render(
        <BigGamesSection
          snapshot={rootingSnapshot}
          lockedOutcomes={{}}
          onToggleOutcome={() => {}}
          onClearLocked={() => {}}
          allUpcomingGames={[]}
          lockedTeamSlug="landsharks"
        />
      )
    })

    expect(container.textContent).toContain(
      "Ranked by playoff swing for Landsharks — includes their own games and scoreboard-watching matchups that move their odds."
    )

    cards = Array.from(container.querySelectorAll("article"))
    expect(cards).toHaveLength(2)

    // Re-sorted: Landsharks' own game (8.8%) jumps to #1 ahead of scoreboard-watching game (1.1%)
    expect(cards[0].textContent).toContain("8.8% swing for Landsharks")
    expect(cards[0].querySelectorAll("tbody tr")).toHaveLength(1)
    expect(cards[0].querySelector("tbody th")?.textContent).toContain("Landsharks")
    expect(cards[0].querySelector("tbody th")?.textContent).not.toContain("Watching")

    expect(cards[1].textContent).toContain("1.1% swing for Landsharks")
    expect(cards[1].querySelectorAll("tbody tr")).toHaveLength(1)
    expect(cards[1].querySelector("tbody th")?.textContent).toContain("Landsharks")
    expect(cards[1].querySelector("tbody th")?.textContent).toContain("Watching")
    expect(cards[1].textContent).not.toContain("Impact to other teams")

    // Focusing the "Current" header opens its explainer tooltip
    const originalResizeObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    try {
      // Focusing the "Current" column header opens its baseline explainer tooltip
      const currentTrigger = Array.from(cards[0].querySelectorAll("thead th span")).find(
        (el) => el.textContent === "Current"
      ) as HTMLElement
      expect(currentTrigger).toBeTruthy()
      await act(async () => {
        currentTrigger.focus()
      })
      const currentTooltip = Array.from(document.body.querySelectorAll('[role="tooltip"]')).find((el) =>
        el.textContent?.includes("current chance to make the playoffs before this game is played")
      )
      expect(currentTooltip).toBeTruthy()
      await act(async () => {
        currentTrigger.blur()
      })
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }

    // Back to "All teams" restores participant rows + collapsed zippy
    await act(async () => {
      root.render(
        <BigGamesSection
          snapshot={rootingSnapshot}
          lockedOutcomes={{}}
          onToggleOutcome={() => {}}
          onClearLocked={() => {}}
          allUpcomingGames={[]}
        />
      )
    })
    cards = Array.from(container.querySelectorAll("article"))
    expect(cards[0].textContent).toContain("League Playoff impact: 40.6pp")
    expect(cards[0].querySelectorAll("tbody th")).toHaveLength(2)
    expect(cards[0].textContent).toContain("Impact to other teams (1)")

    // Seed-focus fallback (Summer allTeamsQualify) renders "League seed impact: X.XX"
    const seedOnlySnapshot: PlayoffOddsSnapshot = {
      ...rootingSnapshot,
      format: { ...rootingSnapshot.format, allTeamsQualify: true },
    }
    await act(async () => {
      root.render(
        <BigGamesSection
          snapshot={seedOnlySnapshot}
          lockedOutcomes={{}}
          onToggleOutcome={() => {}}
          onClearLocked={() => {}}
          allUpcomingGames={[]}
        />
      )
    })
    expect(container.textContent).toContain("Ranked by league-wide seed swing.")
    expect(container.textContent).toContain("League seed impact: 1.20")
  })

  it("displays rounded seed percentages in the matrix and honest 1-decimal probability with MC margin on hover/focus", async () => {
    // Unique season id avoids reusing SWR cache entries populated by earlier tests
    const customSnapshot: PlayoffOddsSnapshot = {
      ...sampleSnapshot,
      seasonId: "seed-tooltip-season",
      teams: sampleSnapshot.teams.map((t, idx) =>
        idx === 0
          ? { ...t, seedPcts: [55.791, 24.104, 15.605, 4.5] }
          : t
      ),
    }

    const originalResizeObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver

    try {
      await act(async () => {
        root.render(<PlayoffOddsView season="seed-tooltip-season" initialData={customSnapshot} />)
      })

      // First team's Seed 1 cell displays rounded "56"
      const seedCell = Array.from(container.querySelectorAll("tbody tr:first-child td")).find(
        (td) => td.textContent === "56"
      ) as HTMLElement
      expect(seedCell).toBeTruthy()

      // Hovering (pointerMove) opens tooltip with honest 1-decimal precision ("55.8%") and ± MC margin
      await act(async () => {
        seedCell.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }))
        await new Promise((r) => setTimeout(r, 150))
      })
      const tooltip = Array.from(document.body.querySelectorAll('[role="tooltip"]')).find((el) =>
        el.textContent?.includes("55.8%")
      )
      expect(tooltip).toBeTruthy()
      expect(tooltip?.textContent).toContain("±")
      expect(tooltip?.textContent).toContain("Seed #1")
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
  })

  it("renders completed seasons as historical replays with charts and final table while hiding Big Games and Team What-If", async () => {
    const completedSnapshot: PlayoffOddsSnapshot = {
      ...sampleSnapshot,
      seasonId: "2019-2020",
      seasonName: "Fall 2019-2020",
      seasonStatus: "completed",
      endedEarly: true,
      gamesRemaining: 0,
      bigGames: [],
      teams: sampleSnapshot.teams.map((t) => ({
        ...t,
        gamesRemaining: 0,
        nextGame: null,
        whatIfRows: [],
      })),
    }

    await act(async () => {
      root.render(<PlayoffOddsView season="2019-2020" initialData={completedSnapshot} />)
    })

    // Archival indicator + truncated-season note visible
    expect(container.textContent).toContain("Fall 2019-2020 playoff odds")
    expect(container.textContent).toContain("Final regular season")
    expect(container.textContent).toContain("Season ended early.")

    // League charts and final odds table stay visible
    expect(container.textContent).toContain("Chance will make playoffs")
    expect(container.textContent).toContain("Chance to make playoffs")

    // Big Games section is hidden in All Teams view (no empty-state card)
    expect(container.textContent).not.toContain("This week's games")
    expect(container.textContent).not.toContain("Regular season complete — no remaining games")

    // Switch to Team View for Seals
    const teamsGroup = container.querySelector('[role="group"][aria-label="Teams"]') as HTMLElement
    const sealsBtn = Array.from(teamsGroup.querySelectorAll("button")).find(
      (b) => b.textContent === "Seals"
    ) as HTMLButtonElement
    await act(async () => {
      sealsBtn.click()
    })

    // Team View scorecards & trajectory chart render, while What-If finish & Big Games stay hidden
    expect(container.textContent).toContain("Season trajectory")
    expect(container.textContent).not.toContain("How Seals needs to finish")
    expect(container.textContent).not.toContain("This week's games")
  })
})
