// @vitest-environment jsdom
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { StatsTab } from "@/components/stats-tab"
import { SeasonSelector } from "@/components/season-selector"
import type { SkaterStat, GoalieStat, TeamSkaterStat, TeamGoalieStat } from "@/lib/fetch-player-stats"

const route = vi.hoisted(() => ({
  season: null as string | null,
  view: "teams",
  seasonType: "fall",
  gameType: "regular",
}))

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  prefetch: vi.fn(),
  push: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const params = new URLSearchParams()
    if (route.season) params.set("season", route.season)
    if (route.view) params.set("view", route.view)
    if (route.seasonType) params.set("seasonType", route.seasonType)
    if (route.gameType) params.set("gameType", route.gameType)
    return params
  },
  useRouter: () => routerMock,
  usePathname: () => "/stats",
}))

vi.mock("@/components/team-logo", () => ({
  TeamLogo: ({ slug, name }: { slug: string; name: string }) => (
    <span data-testid={`logo-${slug}`}>{name}</span>
  ),
}))

vi.mock("next/link", () => ({
  default: ({ href, prefetch, children }: { href: string; prefetch?: boolean; children: ReactNode }) => (
    <a href={href} data-prefetch={String(prefetch)}>{children}</a>
  ),
}))

const mockTeamSkaters: TeamSkaterStat[] = [
  {
    team: "Yetis",
    teamSlug: "yetis",
    seasonId: "2026-summer",
    gp: 4,
    pgp: 40,
    goals: 25,
    assists: 20,
    points: 45,
    ptsPg: "11.25",
    gwg: 3,
    ppg: 2,
    shg: 0,
    eng: 1,
    hatTricks: 2,
    pen: 2,
    pim: 4,
  },
  {
    team: "Seals",
    teamSlug: "seals",
    seasonId: "2026-summer",
    gp: 4,
    pgp: 38,
    goals: 15,
    assists: 15,
    points: 30,
    ptsPg: "7.50",
    gwg: 2,
    ppg: 1,
    shg: 1,
    eng: 0,
    hatTricks: 1,
    pen: 3,
    pim: 6,
  },
  {
    team: "Narwhals",
    teamSlug: "narwhals",
    seasonId: "2026-summer",
    gp: 4,
    pgp: 36,
    goals: 10,
    assists: 10,
    points: 20,
    ptsPg: "5.00",
    gwg: 1,
    ppg: 0,
    shg: 0,
    eng: 0,
    hatTricks: 0,
    pen: 1,
    pim: 2,
  },
]

const mockTeamGoalies: TeamGoalieStat[] = [
  {
    team: "Seals",
    teamSlug: "seals",
    seasonId: "2026-summer",
    gp: 4,
    pgp: 4,
    seconds: 2400,
    wins: 3,
    losses: 1,
    saves: 95,
    shotsAgainst: 100,
    goalsAgainst: 5,
    savePercentage: 0.950,
    gaa: 1.25,
    shutouts: 1,
    goalieAssists: 0,
  },
  {
    team: "Yetis",
    teamSlug: "yetis",
    seasonId: "2026-summer",
    gp: 4,
    pgp: 5,
    seconds: 2400,
    wins: 4,
    losses: 0,
    saves: 85,
    shotsAgainst: 95,
    goalsAgainst: 10,
    savePercentage: 0.895,
    gaa: 2.50,
    shutouts: 0,
    goalieAssists: 1,
  },
]

// 30 items for All-Time pagination testing
const mockAllTimeTeamSkaters: TeamSkaterStat[] = Array.from({ length: 30 }, (_, i) => ({
  team: i === 29 ? "Historical Sharks" : `Team ${i}`,
  teamSlug: i === 29 ? "historical-sharks" : `team-${i}`,
  seasonId: `season-${2000 + i}`,
  seasonName: i === 29 ? "2024 Fall" : `Season ${2000 + i}`,
  isChampion: i === 29,
  isFinalist: i === 28,
  franchiseSlug: i === 29 ? "blue" : i === 28 ? "red" : undefined,
  franchiseName: i === 29 ? "Blue" : i === 28 ? "Red" : undefined,
  gp: 12,
  pgp: 100,
  goals: 50 - i,
  assists: 40 - i,
  points: 90 - (i * 2),
  ptsPg: (9.0 - i * 0.2).toFixed(2),
  gwg: 5,
  ppg: 3,
  shg: 1,
  eng: 1,
  hatTricks: 1,
  pen: 5,
  pim: 10,
}))

const mockAllTimeTeamGoalies: TeamGoalieStat[] = Array.from({ length: 30 }, (_, i) => ({
  team: i === 29 ? "Historical Sharks" : `Team ${i}`,
  teamSlug: i === 29 ? "historical-sharks" : `team-${i}`,
  seasonId: `season-${2000 + i}`,
  seasonName: i === 29 ? "2024 Fall" : `Season ${2000 + i}`,
  isChampion: i === 29,
  isFinalist: i === 28,
  franchiseSlug: i === 29 ? "blue" : i === 28 ? "red" : undefined,
  franchiseName: i === 29 ? "Blue" : i === 28 ? "Red" : undefined,
  gp: 12,
  pgp: 12,
  seconds: 6000,
  wins: 8,
  losses: 2,
  saves: 180,
  shotsAgainst: 200,
  goalsAgainst: 20 + i,
  savePercentage: +(0.900 - i * 0.005).toFixed(3),
  gaa: +(2.0 + i * 0.1).toFixed(2),
  shutouts: 2,
  goalieAssists: 0,
}))

const currentMockStats = {
  skaters: [] as SkaterStat[],
  goalies: [] as GoalieStat[],
  skatersByTeam: [] as SkaterStat[],
  goaliesByTeam: [] as GoalieStat[],
  teamSkaters: mockTeamSkaters,
  teamGoalies: mockTeamGoalies,
  teams: [
    { slug: "yetis", name: "Yetis" },
    { slug: "seals", name: "Seals" },
    { slug: "narwhals", name: "Narwhals" },
  ],
  hasPlayoffs: true,
  isLoading: false,
  isError: false,
  errorMessage: null,
}

vi.mock("@/lib/hockey-data", () => ({
  usePlayerStats: () => currentMockStats,
  useSeasons: () => ({
    seasons: [
      { id: "2026-summer", name: "Summer 2026", isCurrent: true, hasGames: true },
      { id: "2025-fall", name: "Fall 2025", isCurrent: false, hasGames: true },
    ],
  }),
}))

describe("StatsTab - Teams View UI", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    route.season = "2026-summer"
    route.view = "teams"
    currentMockStats.teamSkaters = mockTeamSkaters
    currentMockStats.teamGoalies = mockTeamGoalies
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("renders top-level view toggles and highlights Teams", async () => {
    await act(async () => root.render(<StatsTab />))
    const buttons = Array.from(container.querySelectorAll("button"))
    const skatersBtn = buttons.find((b) => b.textContent?.trim() === "Skaters")
    const goaliesBtn = buttons.find((b) => b.textContent?.trim() === "Goalies")
    const teamsBtn = buttons.find((b) => b.textContent?.trim() === "Teams")

    expect(skatersBtn).toBeDefined()
    expect(goaliesBtn).toBeDefined()
    expect(teamsBtn).toBeDefined()
    expect(teamsBtn?.className).toContain("bg-card")
    expect(skatersBtn?.className).not.toContain("bg-card")
  })

  it("calls window.history.replaceState when clicking view toggles", async () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
    await act(async () => root.render(<StatsTab />))

    const buttons = Array.from(container.querySelectorAll("button"))
    const skatersBtn = buttons.find((b) => b.textContent?.trim() === "Skaters")!
    const goaliesBtn = buttons.find((b) => b.textContent?.trim() === "Goalies")!

    await act(async () => {
      skatersBtn.click()
    })
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", expect.not.stringContaining("view=teams"))

    await act(async () => {
      goaliesBtn.click()
    })
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", expect.stringContaining("view=goalies"))

    replaceStateSpy.mockRestore()
  })

  it("hides the filter control bar completely in single-season Teams view", async () => {
    route.season = "2026-summer"
    await act(async () => root.render(<StatsTab />))

    expect(container.querySelector('input[placeholder="Search players..."]')).toBeNull()
    expect(container.querySelector('input[placeholder="Search teams or seasons..."]')).toBeNull()
    expect(container.textContent).not.toContain("All Teams")
    expect(container.textContent).not.toContain("Min Games")
  })

  it("defaults to goals for rather than points and sorts goals against with missing values last", async () => {
    route.season = "2026-summer"
    currentMockStats.teamSkaters = [
      { ...mockTeamSkaters[0], goals: 10, points: 100, goalsAgainst: null },
      { ...mockTeamSkaters[1], goals: 30, points: 40, goalsAgainst: 8 },
      { ...mockTeamSkaters[2], goals: 20, points: 30, goalsAgainst: 12 },
    ]
    await act(async () => root.render(<StatsTab />))
    const table = container.querySelector("table")!
    const names = () => Array.from(table.querySelectorAll("tbody tr td:first-child")).map((td) => td.textContent)
    expect(names()[0]).toContain("Seals")
    const ga = Array.from(table.querySelectorAll("th")).find((th) => th.textContent === "GA")!
    await act(async () => ga.click())
    expect(names()[0]).toContain("Narwhals")
    expect(names()[2]).toContain("Yetis")
    await act(async () => ga.click())
    expect(names()[0]).toContain("Seals")
    expect(names()[2]).toContain("Yetis")
  })

  it("renders stacked Skaters table on top and Goalies table below with proper headers and default sorts", async () => {
    route.season = "2026-summer"
    await act(async () => root.render(<StatsTab />))

    const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent?.trim())
    expect(headings).toEqual(["Skater Stats", "Goalie Stats"])

    const tables = container.querySelectorAll("table")
    expect(tables).toHaveLength(2)

    // Skaters Table checks
    const skaterThs = Array.from(tables[0].querySelectorAll("th")).map((th) => th.textContent?.trim())
    expect(skaterThs).toEqual(["Team", "GP", "PGP", "GF", "GA", "A", "PTS", "PTS/G", "PPG", "SHG", "ENG", "HAT", "PIM"])

    const skaterRows = tables[0].querySelectorAll("tbody tr")
    expect(skaterRows).toHaveLength(3)
    // Default sorted by GF desc: Yetis (25), Seals (15), Narwhals (10)
    expect(skaterRows[0].textContent).toContain("Yetis")
    expect(skaterRows[0].textContent).toContain("45")
    expect(skaterRows[1].textContent).toContain("Seals")
    expect(skaterRows[2].textContent).toContain("Narwhals")

    // Goalie Table checks
    const goalieThs = Array.from(tables[1].querySelectorAll("th")).map((th) => th.textContent?.trim())
    expect(goalieThs).toEqual(["Team", "GP", "PGP", "SV%", "GAA", "SO", "SV", "GA", "SA", "SA/G", "A"])

    const goalieRows = tables[1].querySelectorAll("tbody tr")
    expect(goalieRows).toHaveLength(2)
    // Default sorted by SV% desc: Seals (.950), Yetis (.895)
    expect(goalieRows[0].textContent).toContain("Seals")
    expect(goalieRows[0].textContent).toContain("0.950")
    expect(goalieRows[1].textContent).toContain("Yetis")
    expect(goalieRows[1].textContent).toContain("0.895")

    // Check IntentLink href and prefetch
    const yetisLink = skaterRows[0].querySelector('a[href^="/team/"]')
    expect(yetisLink?.getAttribute("href")).toBe("/team/yetis?season=2026-summer")
    expect(yetisLink?.getAttribute("data-prefetch")).toBe("true")
  })

  it("sorts GAA ascending on first click in Goalie table and breaks ties with higher SV%", async () => {
    route.season = "2026-summer"
    // Add two teams with the identical GAA: 2.00, but different save percentages: Team A .920, Team B .900
    currentMockStats.teamGoalies = [
      {
        team: "Tied Low SV",
        teamSlug: "tied-low",
        seasonId: "2026-summer",
        gp: 2,
        pgp: 2,
        seconds: 3600,
        wins: 1,
        losses: 1,
        saves: 45,
        shotsAgainst: 50,
        goalsAgainst: 2,
        savePercentage: 0.900,
        gaa: 2.00,
        shutouts: 0,
        goalieAssists: 0,
      },
      {
        team: "Tied High SV",
        teamSlug: "tied-high",
        seasonId: "2026-summer",
        gp: 2,
        pgp: 2,
        seconds: 3600,
        wins: 1,
        losses: 1,
        saves: 46,
        shotsAgainst: 50,
        goalsAgainst: 2,
        savePercentage: 0.920,
        gaa: 2.00,
        shutouts: 0,
        goalieAssists: 0,
      },
    ]

    await act(async () => root.render(<StatsTab />))

    const tables = container.querySelectorAll("table")
    const goalieThs = Array.from(tables[1].querySelectorAll("th"))
    const gaaTh = goalieThs.find((th) => th.textContent?.includes("GAA"))!

    // Click GAA to sort ascending
    await act(async () => {
      gaaTh.click()
    })

    const goalieRows = tables[1].querySelectorAll("tbody tr")
    // Tied High SV (.920) should rank ahead of Tied Low SV (.900) even when sorting GAA ascending
    expect(goalieRows[0].textContent).toContain("Tied High SV")
    expect(goalieRows[1].textContent).toContain("Tied Low SV")
  })

  it("does not filter single-season Teams tables when switching tabs with existing search text", async () => {
    route.season = "2026-summer"
    route.view = "skaters"
    currentMockStats.skaters = [
      { id: 1, name: "Alexander Ovechkin", team: "Yetis", teamSlug: "yetis", gp: 4, goals: 5, assists: 5, points: 10, ptsPg: "2.50", gwg: 1, ppg: 0, shg: 0, eng: 0, hatTricks: 0, pen: 0, pim: 0 }
    ]
    currentMockStats.teamSkaters = mockTeamSkaters
    currentMockStats.teamGoalies = mockTeamGoalies

    await act(async () => root.render(<StatsTab />))

    // Type "alexander" into search box while on Skaters view
    const searchInput = container.querySelector<HTMLInputElement>('input[placeholder="Search players..."]')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
      setValue.call(searchInput, "alexander")
      searchInput.dispatchEvent(new Event("input", { bubbles: true }))
    })

    // Now switch to Teams view
    const teamsBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Teams")!
    await act(async () => {
      teamsBtn.click()
    })

    // Single-season Teams view hides search bar, and must display all 3 teams without filtering by "alexander"
    const tables = container.querySelectorAll("table")
    expect(tables).toHaveLength(2)
    const skaterRows = tables[0].querySelectorAll("tbody tr")
    expect(skaterRows).toHaveLength(3) // Yetis, Seals, Narwhals all visible
  })

  it("supports All-Time mode with Game Type, Season Type, Search, Season column, and pagination", async () => {
    route.season = "all"
    currentMockStats.teamSkaters = mockAllTimeTeamSkaters
    currentMockStats.teamGoalies = mockAllTimeTeamGoalies

    await act(async () => root.render(<StatsTab />))

    // Filter control bar is visible in All-Time mode
    const searchInput = container.querySelector<HTMLInputElement>('input[placeholder="Search teams or seasons..."]')
    expect(searchInput).not.toBeNull()

    // Game Type, Season Type, and Min GP controls are rendered
    expect(container.textContent).toContain("Game Type")
    expect(container.textContent).toContain("Season Type")
    expect(container.textContent).toContain("Min GP")
    const minTgpInput = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(minTgpInput?.value).toBe("12")
    // Team filter and player Min Games are omitted in Teams view
    expect(container.textContent).not.toContain("Min Games")
    expect(container.textContent).not.toContain("All Teams")

    const tables = container.querySelectorAll("table")
    // Season column should be in headers
    const skaterThs = Array.from(tables[0].querySelectorAll("th")).map((th) => th.textContent?.trim())
    expect(skaterThs).toContain("Season")
    const goalieThs = Array.from(tables[1].querySelectorAll("th")).map((th) => th.textContent?.trim())
    expect(goalieThs).toContain("Season")

    // Pagination: 25 rows on page 1
    const skaterRows = tables[0].querySelectorAll("tbody tr")
    expect(skaterRows).toHaveLength(25)
    expect(container.textContent).not.toContain("Historical Sharks")

    // Search filter filters rows without losing full ranking
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
      setValue.call(searchInput, "historical")
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const filteredRows = tables[0].querySelectorAll("tbody tr")
    expect(filteredRows).toHaveLength(1)
    expect(filteredRows[0].textContent).toContain("Historical Sharks")
    expect(filteredRows[0].querySelector("td span")?.textContent).toBe("30") // Rank 30 preserved
    const seasonLink = filteredRows[0].querySelector('a[href="/stats?season=season-2029&view=teams"]')
    expect(seasonLink).not.toBeNull()
    expect(seasonLink?.querySelector(".sm\\:hidden")?.textContent).toBe("F 24-25")
    expect(seasonLink?.querySelector(".hidden.sm\\:inline")?.textContent).toBe("Fall 2024–25")
    expect(filteredRows[0].querySelector('[aria-label="Season Champion"]')).not.toBeNull()

    // Clear search and test Finish (Champions / Champs + Finalists) and Franchise filters
    await act(async () => {
      setValue.call(searchInput, "")
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const selects = container.querySelectorAll("select")
    const finishSelect = selects[2]
    const franchiseSelect = selects[3]

    // Select Champions
    await act(async () => {
      finishSelect.value = "champions"
      finishSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(tables[0].querySelectorAll("tbody tr")).toHaveLength(1)
    expect(tables[0].textContent).toContain("Historical Sharks")

    // Select Champs + Finalists
    await act(async () => {
      finishSelect.value = "finalists"
      finishSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(tables[0].querySelectorAll("tbody tr")).toHaveLength(2)

    // Filter by Franchise "red" (Team 28)
    await act(async () => {
      franchiseSelect.value = "red"
      franchiseSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(tables[0].querySelectorAll("tbody tr")).toHaveLength(1)
    expect(tables[0].textContent).toContain("Team 28")

    // When Season Type is "summer", Franchise filter is hidden
    route.seasonType = "summer"
    await act(async () => root.render(<StatsTab />))
    expect(container.textContent).not.toContain("Franchise")
    route.seasonType = "fall"
  })

  it("renders Game Type dropdown in the filter bar in single-season Teams view when playoffs exist and allows switching", async () => {
    route.season = "2026-summer"
    currentMockStats.hasPlayoffs = true

    await act(async () => root.render(<StatsTab />))

    // Top row should not have Regular Season / Playoffs buttons
    const buttons = Array.from(container.querySelectorAll("button"))
    expect(buttons.find((b) => b.textContent?.trim() === "Regular Season")).toBeUndefined()
    expect(buttons.find((b) => b.textContent?.trim() === "Playoffs")).toBeUndefined()

    // Filter bar should have Game Type dropdown
    expect(container.textContent).toContain("Game Type")
    const gameTypeSelect = container.querySelector<HTMLSelectElement>("select")!
    expect(gameTypeSelect).not.toBeNull()
    expect(gameTypeSelect.value).toBe("regular")

    // Switch dropdown to playoffs
    await act(async () => {
      gameTypeSelect.value = "playoffs"
      gameTypeSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(gameTypeSelect.value).toBe("playoffs")
  })

  it("sorts PIM ascending in Skater table and breaks ties with higher points and goals", async () => {
    route.season = "2026-summer"
    currentMockStats.teamSkaters = [
      {
        team: "Tied Low Points",
        teamSlug: "tied-low-pts",
        seasonId: "2026-summer",
        gp: 4,
        pgp: 40,
        goals: 5,
        assists: 5,
        points: 10,
        ptsPg: "2.50",
        gwg: 1,
        ppg: 0,
        shg: 0,
        eng: 0,
        hatTricks: 0,
        pen: 1,
        pim: 2,
      },
      {
        team: "Tied High Points",
        teamSlug: "tied-high-pts",
        seasonId: "2026-summer",
        gp: 4,
        pgp: 40,
        goals: 15,
        assists: 15,
        points: 30,
        ptsPg: "7.50",
        gwg: 2,
        ppg: 1,
        shg: 0,
        eng: 0,
        hatTricks: 1,
        pen: 1,
        pim: 2,
      },
    ]

    await act(async () => root.render(<StatsTab />))

    const tables = container.querySelectorAll("table")
    const pimTh = Array.from(tables[0].querySelectorAll("th")).find((th) => th.textContent?.includes("PIM"))!

    // Click PIM to toggle sort
    await act(async () => {
      pimTh.click() // First click on PIM -> desc
    })
    await act(async () => {
      pimTh.click() // Second click on PIM -> asc (fewest PIM)
    })

    const skaterRows = tables[0].querySelectorAll("tbody tr")
    // Both teams have 2 PIM; Tied High Points (30 pts) should break tie over Tied Low Points (10 pts)
    expect(skaterRows[0].textContent).toContain("Tied High Points")
    expect(skaterRows[1].textContent).toContain("Tied Low Points")
  })

  it("matches seasons with regular hyphens against en-dash season names and season IDs in All-Time search", async () => {
    route.season = "all"
    currentMockStats.teamSkaters = [
      {
        team: "Summer Seals",
        teamSlug: "summer-seals",
        seasonId: "2024-summer",
        seasonName: "Summer 2024–25",
        gp: 12,
        pgp: 100,
        goals: 40,
        assists: 40,
        points: 80,
        ptsPg: "8.00",
        gwg: 4,
        ppg: 2,
        shg: 0,
        eng: 0,
        hatTricks: 1,
        pen: 2,
        pim: 4,
      },
    ]
    currentMockStats.teamGoalies = [
      {
        team: "Summer Seals",
        teamSlug: "summer-seals",
        seasonId: "2024-summer",
        seasonName: "Summer 2024–25",
        gp: 12,
        pgp: 12,
        seconds: 6000,
        wins: 8,
        losses: 2,
        saves: 180,
        shotsAgainst: 200,
        goalsAgainst: 20,
        savePercentage: 0.900,
        gaa: 2.00,
        shutouts: 2,
        goalieAssists: 0,
      },
    ]

    await act(async () => root.render(<StatsTab />))

    const searchInput = container.querySelector<HTMLInputElement>('input[placeholder="Search teams or seasons..."]')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!

    // Search using regular hyphen "2024-25" (while seasonName has en-dash "2024–25")
    await act(async () => {
      setValue.call(searchInput, "2024-25")
      searchInput.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const tables = container.querySelectorAll("table")
    const skaterRows = tables[0].querySelectorAll("tbody tr")
    expect(skaterRows).toHaveLength(1)
    expect(skaterRows[0].textContent).toContain("Summer Seals")

    // Search using seasonId "2024-summer"
    await act(async () => {
      setValue.call(searchInput, "2024-summer")
      searchInput.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const skaterRowsById = tables[0].querySelectorAll("tbody tr")
    expect(skaterRowsById).toHaveLength(1)
    expect(skaterRowsById[0].textContent).toContain("Summer Seals")
  })

  it("displays empty feedback message when search matches zero teams", async () => {
    route.season = "all"
    currentMockStats.teamSkaters = mockTeamSkaters
    currentMockStats.teamGoalies = mockTeamGoalies

    await act(async () => root.render(<StatsTab />))

    const searchInput = container.querySelector<HTMLInputElement>('input[placeholder="Search teams or seasons..."]')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!

    await act(async () => {
      setValue.call(searchInput, "NonexistentTeamQueryXYZ")
      searchInput.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(container.textContent).toContain("No skater stats found.")
    expect(container.textContent).toContain("No goalie stats found.")
  })

  it("preserves view=teams when selecting Game Type or Season Type in All-Time Teams view", async () => {
    route.season = "all"
    route.view = "teams"
    currentMockStats.teamSkaters = mockAllTimeTeamSkaters
    currentMockStats.teamGoalies = mockAllTimeTeamGoalies

    await act(async () => root.render(<StatsTab />))

    const selects = container.querySelectorAll("select")
    // In All-Time mode with tab=teams: Game Type (first select) and Season Type (second select)
    expect(selects.length).toBeGreaterThanOrEqual(2)
    const gameTypeSelect = selects[0]
    const seasonTypeSelect = selects[1]

    // Change game type to playoffs -> updates URL and sets Min GP to 2
    await act(async () => {
      gameTypeSelect.value = "playoffs"
      gameTypeSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const minTgpInput = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(minTgpInput?.value).toBe("2")

    expect(routerMock.replace).toHaveBeenCalledWith(
      expect.stringContaining("view=teams"),
      { scroll: false }
    )
    expect(routerMock.replace).toHaveBeenCalledWith(
      expect.stringContaining("gameType=playoffs"),
      { scroll: false }
    )

    // Change season type to summer -> updates URL and sets Min GP to 8
    await act(async () => {
      seasonTypeSelect.value = "summer"
      seasonTypeSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(minTgpInput?.value).toBe("8")

    expect(routerMock.replace).toHaveBeenCalledWith(
      expect.stringContaining("view=teams"),
      { scroll: false }
    )
    expect(routerMock.replace).toHaveBeenCalledWith(
      expect.stringContaining("seasonType=summer"),
      { scroll: false }
    )
  })

  it("matches teams by teamSlug and handles queries with leading/trailing whitespace", async () => {
    route.season = "all"
    route.view = "teams"
    currentMockStats.teamSkaters = [
      {
        team: "The No ReGretzkys",
        teamSlug: "no-regretzkys",
        seasonId: "2026-summer",
        seasonName: "Summer 2026",
        gp: 12,
        pgp: 40,
        goals: 12,
        assists: 14,
        points: 26,
        ptsPg: "6.50",
        gwg: 2,
        ppg: 1,
        shg: 0,
        eng: 0,
        hatTricks: 0,
        pen: 2,
        pim: 4,
      },
    ]
    currentMockStats.teamGoalies = [
      {
        team: "The No ReGretzkys",
        teamSlug: "no-regretzkys",
        seasonId: "2026-summer",
        seasonName: "Summer 2026",
        gp: 12,
        pgp: 12,
        seconds: 2400,
        wins: 3,
        losses: 1,
        saves: 80,
        shotsAgainst: 88,
        goalsAgainst: 8,
        savePercentage: 0.909,
        gaa: 2.00,
        shutouts: 1,
        goalieAssists: 0,
      },
    ]

    await act(async () => root.render(<StatsTab />))

    const searchInput = container.querySelector<HTMLInputElement>('input[placeholder="Search teams or seasons..."]')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!

    // Search by hyphenated slug "no-regretzkys"
    await act(async () => {
      setValue.call(searchInput, "no-regretzkys")
      searchInput.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const tables = container.querySelectorAll("table")
    expect(tables[0].querySelectorAll("tbody tr")).toHaveLength(1)
    expect(tables[0].textContent).toContain("The No ReGretzkys")
    expect(tables[1].querySelectorAll("tbody tr")).toHaveLength(1)
    expect(tables[1].textContent).toContain("The No ReGretzkys")

    // Search with surrounding whitespace "  regretzkys  "
    await act(async () => {
      setValue.call(searchInput, "  regretzkys  ")
      searchInput.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(tables[0].querySelectorAll("tbody tr")).toHaveLength(1)
    expect(tables[0].textContent).toContain("The No ReGretzkys")
  })

  it("synchronizes activeTab when a window popstate event occurs", async () => {
    route.season = "2026-summer"
    route.view = "teams"
    currentMockStats.teamSkaters = mockTeamSkaters
    currentMockStats.teamGoalies = mockTeamGoalies

    await act(async () => root.render(<StatsTab />))

    const buttons = Array.from(container.querySelectorAll("button"))
    const teamsBtn = buttons.find((b) => b.textContent?.trim() === "Teams")
    expect(teamsBtn?.className).toContain("bg-card")

    // Simulate browser navigation popstate to view=goalies
    await act(async () => {
      window.history.replaceState(null, "", "/stats?season=2026-summer&view=goalies")
      window.dispatchEvent(new PopStateEvent("popstate"))
    })

    const updatedButtons = Array.from(container.querySelectorAll("button"))
    const goaliesBtn = updatedButtons.find((b) => b.textContent?.trim() === "Goalies")
    expect(goaliesBtn?.className).toContain("bg-card")
  })

  it("preserves view=teams in SeasonSelector when changing season in header", async () => {
    window.history.replaceState(null, "", "/stats?view=teams&season=2026-summer")

    await act(async () => root.render(<SeasonSelector />))

    const select = container.querySelector("select")!
    expect(select).not.toBeNull()

    await act(async () => {
      select.value = "2025-fall"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(routerMock.push).toHaveBeenCalledWith(
      expect.stringContaining("view=teams"),
      { scroll: false }
    )
    expect(routerMock.push).toHaveBeenCalledWith(
      expect.stringContaining("season=2025-fall"),
      { scroll: false }
    )
  })

  it("sorts Season column chronologically (Fall 2025–26 ahead of Summer 2025 ahead of Summer 2014)", async () => {
    route.season = "all"
    route.view = "teams"
    currentMockStats.teamSkaters = [
      {
        team: "Summer 14 Team",
        teamSlug: "s14",
        seasonId: "2014-summer",
        seasonName: "Summer 2014",
        gp: 12,
        pgp: 100,
        goals: 50,
        assists: 50,
        points: 100,
        ptsPg: "8.33",
        gwg: 5,
        ppg: 2,
        shg: 0,
        eng: 0,
        hatTricks: 1,
        pen: 2,
        pim: 4,
      },
      {
        team: "Fall 25 Team",
        teamSlug: "f25",
        seasonId: "2025-2026",
        seasonName: "Fall 2025–26",
        gp: 12,
        pgp: 100,
        goals: 40,
        assists: 40,
        points: 80,
        ptsPg: "6.67",
        gwg: 4,
        ppg: 2,
        shg: 0,
        eng: 0,
        hatTricks: 1,
        pen: 2,
        pim: 4,
      },
      {
        team: "Summer 25 Team",
        teamSlug: "s25",
        seasonId: "2025-summer",
        seasonName: "Summer 2025",
        gp: 12,
        pgp: 100,
        goals: 45,
        assists: 45,
        points: 90,
        ptsPg: "7.50",
        gwg: 4,
        ppg: 2,
        shg: 0,
        eng: 0,
        hatTricks: 1,
        pen: 2,
        pim: 4,
      },
    ]

    await act(async () => root.render(<StatsTab />))

    const tables = container.querySelectorAll("table")
    const seasonTh = Array.from(tables[0].querySelectorAll("th")).find((th) => th.textContent?.includes("Season"))!

    // Click Season header -> sort desc (newest season first)
    await act(async () => {
      seasonTh.click()
    })

    const descRows = tables[0].querySelectorAll("tbody tr")
    expect(descRows[0].textContent).toContain("Fall 25 Team")
    expect(descRows[1].textContent).toContain("Summer 25 Team")
    expect(descRows[2].textContent).toContain("Summer 14 Team")

    // Click Season header again -> sort asc (oldest season first)
    await act(async () => {
      seasonTh.click()
    })

    const ascRows = tables[0].querySelectorAll("tbody tr")
    expect(ascRows[0].textContent).toContain("Summer 14 Team")
    expect(ascRows[1].textContent).toContain("Summer 25 Team")
    expect(ascRows[2].textContent).toContain("Fall 25 Team")
  })

  it("renders empty state when a season has active teams with 0 GP and 0 points", async () => {
    route.season = "2026-summer"
    route.view = "skaters"
    currentMockStats.skaters = []
    currentMockStats.goalies = []
    currentMockStats.teamSkaters = [
      {
        team: "Yetis",
        teamSlug: "yetis",
        seasonId: "2026-summer",
        gp: 0,
        pgp: 0,
        goals: 0,
        assists: 0,
        points: 0,
        ptsPg: "0.00",
        gwg: 0,
        ppg: 0,
        shg: 0,
        eng: 0,
        hatTricks: 0,
        pen: 0,
        pim: 0,
      },
    ]
    currentMockStats.teamGoalies = []

    await act(async () => root.render(<StatsTab />))
    expect(container.textContent).toContain("No stats available yet. Stats will appear after games are synced.")
  })
})
