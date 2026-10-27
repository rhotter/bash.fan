// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StandingsContent } from "@/components/standings-content"
import { HeadToHeadTab } from "@/components/head-to-head-tab"
import type { BashGame, Standing } from "@/app/api/bash/route"

const searchParamsState = vi.hoisted(() => ({
  season: "bash-2026-2027",
  view: null as string | null,
  team: null as string | null,
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const params = new URLSearchParams()
    if (searchParamsState.season) params.set("season", searchParamsState.season)
    if (searchParamsState.view) params.set("view", searchParamsState.view)
    if (searchParamsState.team) params.set("team", searchParamsState.team)
    return params
  },
  useRouter: () => ({ replace: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock("@/components/team-logo", () => ({
  TeamLogo: () => null,
}))

const mockStandings: Standing[] = [
  { team: "Seals", slug: "seals", gp: 4, w: 3, otw: 0, otl: 0, l: 1, gf: 14, ga: 8, gd: 6, pts: 9 },
  { team: "Reign", slug: "reign", gp: 4, w: 1, otw: 0, otl: 0, l: 3, gf: 8, ga: 14, gd: -6, pts: 3 },
  { team: "Yetis", slug: "yetis", gp: 0, w: 0, otw: 0, otl: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
]

const mockGames: BashGame[] = [
  {
    id: "g101",
    date: "2026-10-01",
    time: "8:00 PM",
    homeTeam: "Seals",
    homeSlug: "seals",
    awayTeam: "Reign",
    awaySlug: "reign",
    homeScore: 5,
    awayScore: 2,
    status: "final",
    isOvertime: false,
    isPlayoff: false,
    isForfeit: false,
    location: "Silver Creek",
    hasBoxscore: true,
    hasLiveStats: false,
    livePeriod: null,
    liveClockSeconds: null,
    liveClockRunning: null,
    liveClockStartedAt: null,
    gameType: "regular",
    hasShootout: false,
    homePlaceholder: null,
    awayPlaceholder: null,
    seriesId: null,
    seriesGameNumber: null,
    bracketRound: null,
  },
  {
    id: "g102",
    date: "2026-10-08",
    time: "8:00 PM",
    homeTeam: "Reign",
    homeSlug: "reign",
    awayTeam: "Seals",
    awaySlug: "seals",
    homeScore: 1,
    awayScore: 3,
    status: "final",
    isOvertime: false,
    isPlayoff: false,
    isForfeit: false,
    location: "Silver Creek",
    hasBoxscore: true,
    hasLiveStats: false,
    livePeriod: null,
    liveClockSeconds: null,
    liveClockRunning: null,
    liveClockStartedAt: null,
    gameType: "regular",
    hasShootout: false,
    homePlaceholder: null,
    awayPlaceholder: null,
    seriesId: null,
    seriesGameNumber: null,
    bracketRound: null,
  },
  {
    id: "g103",
    date: "2026-10-15",
    time: "8:00 PM",
    homeTeam: "Seals",
    homeSlug: "seals",
    awayTeam: "Reign",
    awaySlug: "reign",
    homeScore: 4,
    awayScore: 1,
    status: "final",
    isOvertime: false,
    isPlayoff: false,
    isForfeit: false,
    location: "Silver Creek",
    hasBoxscore: true,
    hasLiveStats: false,
    livePeriod: null,
    liveClockSeconds: null,
    liveClockRunning: null,
    liveClockStartedAt: null,
    gameType: "regular",
    hasShootout: false,
    homePlaceholder: null,
    awayPlaceholder: null,
    seriesId: null,
    seriesGameNumber: null,
    bracketRound: null,
  },
  {
    id: "g104",
    date: "2026-10-22",
    time: "8:00 PM",
    homeTeam: "Seals",
    homeSlug: "seals",
    awayTeam: "Reign",
    awaySlug: "reign",
    homeScore: 2,
    awayScore: 4,
    status: "final",
    isOvertime: false,
    isPlayoff: false,
    isForfeit: false,
    location: "Silver Creek",
    hasBoxscore: true,
    hasLiveStats: false,
    livePeriod: null,
    liveClockSeconds: null,
    liveClockRunning: null,
    liveClockStartedAt: null,
    gameType: "regular",
    hasShootout: false,
    homePlaceholder: null,
    awayPlaceholder: null,
    seriesId: null,
    seriesGameNumber: null,
    bracketRound: null,
  },
  {
    id: "g105",
    date: "2026-10-29",
    time: "9:00 PM",
    homeTeam: "Seals",
    homeSlug: "seals",
    awayTeam: "Reign",
    awaySlug: "reign",
    homeScore: null,
    awayScore: null,
    status: "upcoming",
    isOvertime: false,
    isPlayoff: false,
    isForfeit: false,
    location: "Silver Creek",
    hasBoxscore: false,
    hasLiveStats: false,
    livePeriod: null,
    liveClockSeconds: null,
    liveClockRunning: null,
    liveClockStartedAt: null,
    gameType: "regular",
    hasShootout: false,
    homePlaceholder: null,
    awayPlaceholder: null,
    seriesId: null,
    seriesGameNumber: null,
    bracketRound: null,
  },
]

vi.mock("@/lib/hockey-data", () => ({
  useBashData: () => ({
    games: mockGames,
    standings: mockStandings,
    isLoading: false,
    isError: false,
    errorMessage: undefined,
    refresh: vi.fn(),
  }),
}))

let container: HTMLDivElement
let root: Root
let replaceStateSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  replaceStateSpy = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
  searchParamsState.season = "bash-2026-2027"
  searchParamsState.view = null
  searchParamsState.team = null
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("Standings and Head-to-Head UI Integration", () => {
  it("renders top-level Standings and Head to Head selector buttons and defaults to Standings", async () => {
    await act(async () => {
      root.render(<StandingsContent />)
    })

    const buttons = Array.from(container.querySelectorAll("button"))
    const standingsBtn = buttons.find((b) => b.textContent?.trim() === "Standings")
    const h2hBtn = buttons.find((b) => b.textContent?.trim() === "Head to Head")

    expect(standingsBtn).toBeDefined()
    expect(h2hBtn).toBeDefined()

    // Standings button is active
    expect(standingsBtn?.className).toContain("bg-card text-foreground")
    expect(h2hBtn?.className).toContain("text-muted-foreground/60")

    // Standings table is shown with 3 teams
    const rows = container.querySelectorAll<HTMLTableRowElement>("tbody tr")
    expect(rows).toHaveLength(3)
  })

  it("switches to Head to Head view client-side and syncs URL with replaceState", async () => {
    await act(async () => {
      root.render(<StandingsContent />)
    })

    const h2hBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Head to Head")!

    await act(async () => {
      h2hBtn.click()
    })

    expect(replaceStateSpy).toHaveBeenCalledTimes(1)
    const callUrl = replaceStateSpy.mock.calls[0][2] as string
    expect(callUrl).toContain("view=h2h")
    expect(callUrl).toContain("team=seals")
    expect(callUrl).toContain("season=bash-2026-2027")

    // Now in Head to Head mode
    expect(container.textContent).toContain("Team")
    expect(container.querySelector("th")?.textContent).toContain("Opponent")
  })

  it("switches teams in the TEAM selector bar and updates stats with inverse symmetry", async () => {
    searchParamsState.view = "h2h"
    searchParamsState.team = "seals"

    await act(async () => {
      root.render(<StandingsContent />)
    })

    // Initially Seals is selected
    // Seals vs Reign: 3-0-0-1, 9 pts, 14 GF, 8 GA, +6 GD
    expect(container.textContent).toContain("Reign")
    const initialRows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"))
    const reignRow = initialRows.find((r) => r.textContent?.includes("Reign"))!
    expect(reignRow.textContent).toContain("3-0-0-1")
    expect(reignRow.textContent).toContain("+6")

    // Footer summary row shows Seals overall regular season totals
    const footer = container.querySelector("tfoot tr")!
    expect(footer.textContent).toContain("Total")
    expect(footer.textContent).toContain("3-0-0-1")
    expect(footer.textContent).toContain("+6")

    // Now click the "Reign" button in the TEAM selector
    const reignSelectorBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Reign" && b.closest(".overflow-x-auto")
    )!
    expect(reignSelectorBtn).toBeDefined()

    await act(async () => {
      reignSelectorBtn.click()
    })

    expect(replaceStateSpy).toHaveBeenCalled()
    const lastCallUrl = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1][2] as string
    expect(lastCallUrl).toContain("team=reign")

    // From Reign's perspective vs Seals:
    // 1-0-0-3, 3 pts, 8 GF, 14 GA, -6 GD
    const updatedRows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"))
    const sealsRow = updatedRows.find((r) => r.textContent?.includes("Seals"))!
    expect(sealsRow.textContent).toContain("1-0-0-3")
    expect(sealsRow.textContent).toContain("-6")
  })

  it("expands an opponent row on click to show season series games with result badges and IntentLinks to /game/[id]", async () => {
    searchParamsState.view = "h2h"
    searchParamsState.team = "seals"

    await act(async () => {
      root.render(<StandingsContent />)
    })

    // Click on the Reign opponent row
    const reignRow = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr")).find((r) => r.textContent?.includes("Reign"))!

    // Initially no game breakdown is rendered
    expect(container.textContent).not.toContain("Season Series")

    await act(async () => {
      reignRow.click()
    })

    // Now expanded!
    expect(container.textContent).toContain("Season Series (5 games)")

    // Contains IntentLinks to /game/g101 through /game/g105
    const gameLinks = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="/game/"]'))
    expect(gameLinks.length).toBe(5)
    expect(gameLinks[0].getAttribute("href")).toBe("/game/g101")
    expect(gameLinks[1].getAttribute("href")).toBe("/game/g102")
    expect(gameLinks[4].getAttribute("href")).toBe("/game/g105")

    // Contains result badges and "-" for upcoming game
    expect(container.textContent).toContain("W")
    expect(container.textContent).toContain("L")
    expect(gameLinks[4].textContent).toContain("-")

    // Clicking again collapses
    await act(async () => {
      reignRow.click()
    })
    expect(container.textContent).not.toContain("Season Series")
  })

  it("switches back from Head to Head to Standings view cleanly", async () => {
    searchParamsState.view = "h2h"
    searchParamsState.team = "seals"

    await act(async () => {
      root.render(<StandingsContent />)
    })

    const standingsBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Standings")!

    await act(async () => {
      standingsBtn.click()
    })

    expect(replaceStateSpy).toHaveBeenCalled()
    const lastCallUrl = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1][2] as string
    expect(lastCallUrl).not.toContain("view=h2h")
    expect(lastCallUrl).not.toContain("team=seals")
    expect(lastCallUrl).toContain("/standings?season=bash-2026-2027")

    // Standings table is restored
    expect(container.textContent).not.toContain("Opponent")
    expect(container.textContent).toContain("PTS")
  })

  it("sorts columns by PTS, GD, and Opponent name when clicking header th", async () => {
    searchParamsState.view = "h2h"
    searchParamsState.team = "seals"

    await act(async () => {
      root.render(<StandingsContent />)
    })

    // By default, sorted by PTS descending (Reign 9pts first, Yetis 0pts second)
    let tbodyRows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"))
    expect(tbodyRows[0].textContent).toContain("Reign")
    expect(tbodyRows[1].textContent).toContain("Yetis")

    // Click Opponent to sort by name ascending
    const opponentTh = Array.from(container.querySelectorAll("th")).find((th) => th.textContent?.includes("Opponent"))!
    await act(async () => {
      opponentTh.click()
    })

    tbodyRows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"))
    expect(tbodyRows[0].textContent).toContain("Reign")
    expect(tbodyRows[1].textContent).toContain("Yetis")

    // Click Opponent again to sort descending
    await act(async () => {
      opponentTh.click()
    })
    tbodyRows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"))
    expect(tbodyRows[0].textContent).toContain("Yetis")
    expect(tbodyRows[1].textContent).toContain("Reign")
  })

  it("supports keyboard expansion with Enter and Space on opponent row", async () => {
    searchParamsState.view = "h2h"
    searchParamsState.team = "seals"

    await act(async () => {
      root.render(<StandingsContent />)
    })

    const reignRow = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr")).find((r) => r.textContent?.includes("Reign"))!
    expect(container.textContent).not.toContain("Season Series")

    await act(async () => {
      reignRow.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    expect(container.textContent).toContain("Season Series")

    await act(async () => {
      reignRow.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    })
    expect(container.textContent).not.toContain("Season Series")
  })

  it("does not trigger row expansion when pressing Enter on the opponent team Link", async () => {
    searchParamsState.view = "h2h"
    searchParamsState.team = "seals"

    await act(async () => {
      root.render(<StandingsContent />)
    })

    const teamLink = container.querySelector<HTMLAnchorElement>('a[href="/team/reign"]')!
    expect(teamLink).toBeDefined()
    expect(container.textContent).not.toContain("Season Series")

    await act(async () => {
      teamLink.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    // Row should NOT expand because focus was on the Link
    expect(container.textContent).not.toContain("Season Series")
  })

  it("falls back to 1st place team and syncs URL when visiting ?view=h2h&team=nonexistent-slug", async () => {
    searchParamsState.view = "h2h"
    searchParamsState.team = "nonexistent-slug"

    await act(async () => {
      root.render(<StandingsContent />)
    })

    expect(replaceStateSpy).toHaveBeenCalled()
    const lastCallUrl = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1][2] as string
    expect(lastCallUrl).toContain("view=h2h")
    expect(lastCallUrl).toContain("team=seals")
    expect(lastCallUrl).not.toContain("team=nonexistent-slug")

    // The rendered team is Seals
    expect(container.textContent).toContain("Reign")
  })

  it("shows empty series message when expanding an opponent with 0 GP and 0 games", async () => {
    searchParamsState.view = "h2h"
    searchParamsState.team = "seals"

    await act(async () => {
      root.render(<StandingsContent />)
    })

    const yetisRow = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr")).find((r) => r.textContent?.includes("Yetis"))!

    await act(async () => {
      yetisRow.click()
    })

    expect(container.textContent).toContain("Season Series (0 games)")
    expect(container.textContent).toContain("No games scheduled or played this season.")
  })

  it("renders All Time view notice when season is all", async () => {
    searchParamsState.season = "all"

    await act(async () => {
      root.render(<StandingsContent />)
    })

    expect(container.textContent).toContain("Standings are not available for All Time view")
  })

  it("breaks ties in PTS sort using secondary tiebreakers (gd, alphabetical) without NaN errors", async () => {
    const tiedStandings: Standing[] = [
      { team: "Seals", slug: "seals", gp: 3, w: 3, otw: 0, otl: 0, l: 0, gf: 10, ga: 3, gd: 7, pts: 9 },
      { team: "Zeta", slug: "zeta", gp: 1, w: 0, otw: 0, otl: 0, l: 1, gf: 1, ga: 2, gd: -1, pts: 0 },
      { team: "Alpha", slug: "alpha", gp: 1, w: 0, otw: 0, otl: 0, l: 1, gf: 1, ga: 3, gd: -2, pts: 0 },
      { team: "Beta", slug: "beta", gp: 1, w: 0, otw: 0, otl: 0, l: 1, gf: 1, ga: 5, gd: -4, pts: 0 },
    ]

    // From Seals perspective:
    // Seals beat Zeta 2-1 (Seals 3 pts, +1 GD)
    // Seals beat Alpha 3-1 (Seals 3 pts, +2 GD)
    // Seals beat Beta 5-1 (Seals 3 pts, +4 GD)
    const games: BashGame[] = [
      { ...mockGames[0], id: "gZ", homeSlug: "seals", awaySlug: "zeta", homeScore: 2, awayScore: 1, status: "final" },
      { ...mockGames[0], id: "gA", homeSlug: "seals", awaySlug: "alpha", homeScore: 3, awayScore: 1, status: "final" },
      { ...mockGames[0], id: "gB", homeSlug: "seals", awaySlug: "beta", homeScore: 5, awayScore: 1, status: "final" },
    ]

    await act(async () => {
      root.render(
        <HeadToHeadTab
          games={games}
          standings={tiedStandings}
          isLoading={false}
          selectedTeamSlug="seals"
          onSelectTeam={() => {}}
        />
      )
    })

    // All three have 3 PTS. Ties are broken by GD (Beta +4 > Alpha +2 > Zeta +1)
    const tbodyRows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"))
    expect(tbodyRows[0].textContent).toContain("Beta")
    expect(tbodyRows[1].textContent).toContain("Alpha")
    expect(tbodyRows[2].textContent).toContain("Zeta")
  })

  it("breaks ties in Record sort alphabetically by opponent name when records and GD are identical", async () => {
    const standings: Standing[] = [
      { team: "Seals", slug: "seals", gp: 0, w: 0, otw: 0, otl: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
      { team: "Zulu", slug: "zulu", gp: 0, w: 0, otw: 0, otl: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
      { team: "Bravo", slug: "bravo", gp: 0, w: 0, otw: 0, otl: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
      { team: "Alpha", slug: "alpha", gp: 0, w: 0, otw: 0, otl: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
    ]

    await act(async () => {
      root.render(
        <HeadToHeadTab
          games={[]}
          standings={standings}
          isLoading={false}
          selectedTeamSlug="seals"
          onSelectTeam={() => {}}
        />
      )
    })

    const recordTh = Array.from(container.querySelectorAll("th")).find((th) => th.textContent?.includes("Record"))!
    await act(async () => {
      recordTh.click()
    })

    // All 3 opponents have 0-0-0-0 record, 0 pts, 0 GD. Ties broken alphabetically: Alpha, Bravo, Zulu
    const tbodyRows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"))
    expect(tbodyRows[0].textContent).toContain("Alpha")
    expect(tbodyRows[1].textContent).toContain("Bravo")
    expect(tbodyRows[2].textContent).toContain("Zulu")
  })

  it("handles browser popstate events (Back / Forward) cleanly", async () => {
    searchParamsState.view = null
    searchParamsState.team = null

    await act(async () => {
      root.render(<StandingsContent />)
    })

    expect(container.textContent).not.toContain("Opponent")

    // Simulate browser navigating Forward to ?view=h2h&team=reign
    window.history.pushState({}, "", "/standings?view=h2h&team=reign")

    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"))
    })

    // View should now be Head to Head and team should be Reign
    expect(container.textContent).toContain("Opponent")
    expect(container.textContent).toContain("Seals")

    // Simulate browser navigating Back to /standings
    window.history.pushState({}, "", "/standings")

    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"))
    })

    // View restored to Standings
    expect(container.textContent).not.toContain("Opponent")
  })

  it("renders correctly on narrow mobile viewport (320px) and supports the mobile Team dropdown", async () => {
    searchParamsState.view = "h2h"
    searchParamsState.team = "seals"

    container.style.width = "320px"

    await act(async () => {
      root.render(<StandingsContent />)
    })

    // Table and mobile team dropdown are rendered
    const table = container.querySelector("table")
    expect(table).toBeDefined()
    expect(table?.className).toContain("min-w-[500px]")

    const mobileSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Team"]')
    expect(mobileSelect).not.toBeNull()
    expect(mobileSelect?.value).toBe("seals")

    //Expanding opponent row renders series breakdown
    const reignRow = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr")).find((r) => r.textContent?.includes("Reign"))!
    await act(async () => {
      reignRow.click()
    })

    expect(container.textContent).toContain("Season Series")
    expect(container.textContent).toContain("-")

    // Changing the mobile select updates the selected team
    await act(async () => {
      mobileSelect!.value = "reign"
      mobileSelect!.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(replaceStateSpy).toHaveBeenCalled()
    const updatedRows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"))
    const sealsRow = updatedRows.find((r) => r.textContent?.includes("Seals"))!
    expect(sealsRow.textContent).toContain("1-0-0-3")
  })

  it("renders FINAL badge and 'Final' score for completed games with null scores", async () => {
    const gamesWithNullFinalScore: BashGame[] = [
      {
        ...mockGames[0],
        id: "gNullScore",
        homeScore: null,
        awayScore: null,
        status: "final",
      },
    ]

    await act(async () => {
      root.render(
        <HeadToHeadTab
          games={gamesWithNullFinalScore}
          standings={mockStandings}
          isLoading={false}
          selectedTeamSlug="seals"
          onSelectTeam={() => {}}
        />
      )
    })

    const reignRow = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr")).find((r) => r.textContent?.includes("Reign"))!
    await act(async () => {
      reignRow.click()
    })

    expect(container.textContent).toContain("FINAL")
    expect(container.textContent).toContain("Final")
    expect(container.textContent).not.toContain("0 - 0")
  })

  it("resets to Standings view when Next.js soft navigation updates searchParams", async () => {
    searchParamsState.view = "h2h"
    searchParamsState.team = "seals"

    await act(async () => {
      root.render(<StandingsContent />)
    })

    expect(container.textContent).toContain("Opponent")

    // Simulate clicking SiteHeader "Standings" link (soft navigation clears view/team searchParams)
    searchParamsState.view = null
    searchParamsState.team = null

    await act(async () => {
      root.render(<StandingsContent />)
    })

    expect(container.textContent).not.toContain("Opponent")
    expect(container.textContent).toContain("OTW")
  })
})

