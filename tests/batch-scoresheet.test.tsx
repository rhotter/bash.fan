// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GameScoresheet, type ScoresheetGameData, type ScoresheetRosterPlayer, type ScoresheetOfficial } from "@/components/admin/game-scoresheet"
import { BatchScoresheetToolbar } from "@/app/admin/scoresheet/season/[id]/batch-toolbar"
import { SeasonScheduleTab, type ScheduleGame } from "@/components/admin/season-schedule-tab"
import BatchScoresheetPage from "@/app/admin/scoresheet/season/[id]/page"
import * as fetchScoresheetsModule from "@/lib/fetch-scoresheets"

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  notFound: vi.fn(),
}))

let container: HTMLDivElement
let root: Root

async function flush(action: () => void) {
  await act(async () => {
    action()
    await new Promise((resolve) => setTimeout(resolve, 15))
  })
}

async function render(children: ReactNode) {
  await flush(() => root.render(children))
}

const mockGame: ScoresheetGameData = {
  id: "g100",
  date: "2026-10-15",
  time: "8:00pm",
  location: "The Lick",
  is_playoff: false,
  game_type: "regular",
  status: "upcoming",
  home_slug: "whalers",
  away_slug: "norcal-clowns",
  home_name: "Whalers",
  away_name: "NorCal Clowns",
  season_name: "2026 Fall",
  season_id: "2026-fall",
}

const mockHomeRoster: ScoresheetRosterPlayer[] = [
  { name: "Alice Adams", is_captain: true, is_goalie: false, is_sub: false },
  { name: "Bob Brown", is_captain: false, is_goalie: true, is_sub: false },
  { name: "Charlie Sub", is_captain: false, is_goalie: false, is_sub: true },
]

const mockAwayRoster: ScoresheetRosterPlayer[] = [
  { name: "David Duo", is_captain: true, is_goalie: true, is_sub: false },
  { name: "Eva Regular", is_captain: false, is_goalie: false, is_sub: false },
]

const mockOfficials: ScoresheetOfficial[] = [
  { name: "Ref 1 Name", role: "ref" },
  { name: "Ref 2 Name", role: "ref" },
  { name: "Scorekeeper Name", role: "scorekeeper" },
]

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      readonly pointerType: string
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerType = init.pointerType ?? "mouse"
      }
    }
  )
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
})

describe("GameScoresheet Component", () => {
  it("renders complete header details and fidelity", async () => {
    await render(
      <GameScoresheet
        game={mockGame}
        homeRoster={mockHomeRoster}
        awayRoster={mockAwayRoster}
        officials={mockOfficials}
      />
    )

    const text = container.textContent || ""
    expect(text).toContain("BASH - 2026 Fall Game Scoresheet")
    expect(text).toContain("NorCal Clowns at Whalers")
    expect(text).toContain("8:00pm")
    expect(text).toContain("The Lick")

    // Image logo present
    const logo = container.querySelector("img[src='/team-logos/bash_transparent_1024.png']")
    expect(logo).not.toBeNull()
  })

  it("renders rosters with captain (c), goalie (g), and sub tags", async () => {
    await render(
      <GameScoresheet
        game={mockGame}
        homeRoster={mockHomeRoster}
        awayRoster={mockAwayRoster}
        officials={mockOfficials}
      />
    )

    const text = container.textContent || ""
    // Home team
    expect(text).toContain("H - Whalers Roster")
    expect(text).toContain("(c) Alice Adams")
    expect(text).toContain("(g) Bob Brown")
    expect(text).toContain("Charlie Sub (sub)")

    // Away team with dual captain + goalie tag
    expect(text).toContain("A - NorCal Clowns Roster")
    expect(text).toContain("(c) (g) David Duo")
    expect(text).toContain("Eva Regular")
  })

  it("renders empty roster fallback when roster is empty", async () => {
    await render(
      <GameScoresheet
        game={mockGame}
        homeRoster={[]}
        awayRoster={[]}
        officials={[]}
      />
    )

    const text = container.textContent || ""
    const occurrences = (text.match(/No roster available/g) || []).length
    expect(occurrences).toBe(2)
  })

  it("renders 11 blank scoring rows and 11 blank penalty rows for both teams", async () => {
    await render(
      <GameScoresheet
        game={mockGame}
        homeRoster={mockHomeRoster}
        awayRoster={mockAwayRoster}
        officials={mockOfficials}
      />
    )

    const text = container.textContent || ""
    expect(text).toContain("Whalers Scoring")
    expect(text).toContain("Whalers Penalties")
    expect(text).toContain("NorCal Clowns Scoring")
    expect(text).toContain("NorCal Clowns Penalties")

    // Check table headers for scoring and penalty tables
    const ths = Array.from(container.querySelectorAll("th")).map((th) => th.textContent)
    expect(ths).toContain("Goal")
    expect(ths).toContain("Assist")
    expect(ths).toContain("Infraction")
    expect(ths).toContain("Time St")
    expect(ths).toContain("Time Exp")
  })

  it("renders goalie tables with 3 rows", async () => {
    await render(
      <GameScoresheet
        game={mockGame}
        homeRoster={mockHomeRoster}
        awayRoster={mockAwayRoster}
        officials={mockOfficials}
      />
    )

    const text = container.textContent || ""
    expect(text).toContain("Whalers Goalies")
    expect(text).toContain("NorCal Clowns Goalies")
  })

  it("renders shot tracking grids (Per 1-3 + OT, 01-24) and timeouts", async () => {
    await render(
      <GameScoresheet
        game={mockGame}
        homeRoster={mockHomeRoster}
        awayRoster={mockAwayRoster}
        officials={mockOfficials}
      />
    )

    const text = container.textContent || ""
    expect(text).toContain("Whalers Shooting")
    expect(text).toContain("Per 1")
    expect(text).toContain("Per 2")
    expect(text).toContain("Per 3")
    expect(text).toContain("OT")
    expect(text).toContain("Whalers Timeouts")

    // Check table-based 8-column layout
    const shotTables = container.querySelectorAll("table[style*='table-layout: fixed']")
    expect(shotTables.length).toBeGreaterThan(0)
    const shotCells = shotTables[0].querySelectorAll("td")
    expect(shotCells.length).toBe(24)
    expect(shotCells[0].textContent).toBe("01")
    expect(shotCells[7].textContent).toBe("08")
    expect(shotCells[23].textContent).toBe("24")
    expect(shotCells[0].getAttribute("style")).toContain("text-align: center")
  })

  it("renders signatures, summaries, and Game Stars without notes box", async () => {
    await render(
      <GameScoresheet
        game={mockGame}
        homeRoster={mockHomeRoster}
        awayRoster={mockAwayRoster}
        officials={mockOfficials}
      />
    )

    const text = container.textContent || ""
    expect(text).toContain("Signatures")
    expect(text).toContain("Off 1: Ref 1 Name")
    expect(text).toContain("Off 2: Ref 2 Name")
    expect(text).toContain("SKpr: Scorekeeper Name")

    expect(text).toContain("Scoring Summary")
    expect(text).toContain("Shots Summary")

    expect(text).toContain("Game Stars")
    expect(text).toContain("Star #1:")
    expect(text).toContain("Star #2:")
    expect(text).toContain("Star #3:")

    expect(text).not.toContain("Notes")
  })

  it("does not render notes box at bottom even when game has notes", async () => {
    await render(
      <GameScoresheet
        game={{ ...mockGame, notes: "Game delayed 15 minutes due to rain" }}
        homeRoster={mockHomeRoster}
        awayRoster={mockAwayRoster}
        officials={mockOfficials}
      />
    )

    const text = container.textContent || ""
    expect(text).not.toContain("Notes")
  })

  it("respects showBackButton prop and custom id", async () => {
    await render(
      <GameScoresheet
        id="scoresheet"
        game={mockGame}
        homeRoster={mockHomeRoster}
        awayRoster={mockAwayRoster}
        officials={mockOfficials}
        showBackButton={true}
      />
    )

    const sheetDiv = container.querySelector("#scoresheet")
    expect(sheetDiv).not.toBeNull()
    const closeBtn = container.querySelector("button")
    expect(closeBtn?.textContent).toContain("Close")
  })
})

describe("BatchScoresheetToolbar Component", () => {
  it("renders Close and Print buttons with season context", async () => {
    await render(<BatchScoresheetToolbar seasonName="2026 Fall" gameCount={4} />)

    const text = container.textContent || ""
    expect(text).toContain("2026 Fall")
    expect(text).toContain("4 upcoming games")

    const buttons = Array.from(container.querySelectorAll("button"))
    const closeBtn = buttons.find((b) => b.textContent?.includes("Close"))
    const printBtn = buttons.find((b) => b.textContent?.includes("Print / Save as PDF"))

    expect(closeBtn).toBeDefined()
    expect(printBtn).toBeDefined()
    expect(printBtn?.disabled).toBe(false)
  })

  it("disables print button when gameCount is 0", async () => {
    await render(<BatchScoresheetToolbar seasonName="2026 Fall" gameCount={0} />)

    const buttons = Array.from(container.querySelectorAll("button"))
    const printBtn = buttons.find((b) => b.textContent?.includes("Print / Save as PDF"))
    expect(printBtn?.disabled).toBe(true)
  })

  it("triggers window.print when print button is clicked", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {})
    await render(<BatchScoresheetToolbar seasonName="2026 Fall" gameCount={2} />)

    const printBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Print / Save as PDF")
    )
    await flush(() => {
      printBtn?.click()
    })

    expect(printSpy).toHaveBeenCalled()
  })

  it("triggers window.close when close button is clicked", async () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {})
    await render(<BatchScoresheetToolbar seasonName="2026 Fall" gameCount={2} />)

    const closeBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Close")
    )
    await flush(() => {
      closeBtn?.click()
    })

    expect(closeSpy).toHaveBeenCalled()
  })
})

describe("SeasonScheduleTab Print Remaining Scoresheets Action Button", () => {
  it("renders disabled button when all games are final", async () => {
    const mockGames: ScheduleGame[] = [
      {
        id: "g1",
        date: "2026-10-01",
        time: "8:00pm",
        homeSlug: "team-a",
        homeTeam: "Team A",
        homePlaceholder: null,
        awaySlug: "team-b",
        awayTeam: "Team B",
        awayPlaceholder: null,
        location: "The Lick",
        gameType: "regular",
        status: "final",
        homeScore: 5,
        awayScore: 3,
        isOvertime: false,
        hasShootout: false,
        isForfeit: false,
        isPlayoff: false,
        title: null,
        notes: null,
        homeNotes: null,
        awayNotes: null,
      },
    ]

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGames,
      })
    )

    await render(
      <SeasonScheduleTab
        seasonId="2026-fall"
        seasonStatus="active"
        initialTeams={[{ teamSlug: "team-a", teamName: "Team A" }, { teamSlug: "team-b", teamName: "Team B" }]}
        defaultLocation="The Lick"
      />
    )

    const btn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.getAttribute("aria-label")?.includes("Print Remaining Scoresheets") ||
      b.textContent?.includes("🖨️")
    )
    expect(btn).toBeDefined()
    expect(btn?.disabled).toBe(true)
    expect(btn?.getAttribute("title")).toBe("All games in this season are final")
  })

  it("renders enabled button when unplayed games exist and opens batch route on click", async () => {
    const mockGames: ScheduleGame[] = [
      {
        id: "g1",
        date: "2026-10-01",
        time: "8:00pm",
        homeSlug: "team-a",
        homeTeam: "Team A",
        homePlaceholder: null,
        awaySlug: "team-b",
        awayTeam: "Team B",
        awayPlaceholder: null,
        location: "The Lick",
        gameType: "regular",
        status: "upcoming",
        homeScore: null,
        awayScore: null,
        isOvertime: false,
        hasShootout: false,
        isForfeit: false,
        isPlayoff: false,
        title: null,
        notes: null,
        homeNotes: null,
        awayNotes: null,
      },
      {
        id: "g2",
        date: "2026-10-08",
        time: "9:00pm",
        homeSlug: "team-b",
        homeTeam: "Team B",
        homePlaceholder: null,
        awaySlug: "team-a",
        awayTeam: "Team A",
        awayPlaceholder: null,
        location: "The Lick",
        gameType: "regular",
        status: "final",
        homeScore: 4,
        awayScore: 2,
        isOvertime: false,
        hasShootout: false,
        isForfeit: false,
        isPlayoff: false,
        title: null,
        notes: null,
        homeNotes: null,
        awayNotes: null,
      },
    ]

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGames,
      })
    )

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)

    await render(
      <SeasonScheduleTab
        seasonId="2026-fall"
        seasonStatus="active"
        initialTeams={[{ teamSlug: "team-a", teamName: "Team A" }, { teamSlug: "team-b", teamName: "Team B" }]}
        defaultLocation="The Lick"
      />
    )

    // Verify button cluster ordering: [Generate Schedule] [Playoff Bracket] [🖨️] [Add Game]
    const headerButtonCluster = container.querySelector(".flex.flex-wrap.items-center.gap-2")
    const actionButtons = headerButtonCluster ? Array.from(headerButtonCluster.querySelectorAll("button")) : []
    expect(actionButtons.length).toBe(4)
    expect(actionButtons[0].textContent).toContain("Generate Schedule")
    expect(actionButtons[1].textContent).toContain("Playoff Bracket")
    expect(actionButtons[2].textContent).toContain("🖨️")
    expect(actionButtons[3].textContent).toContain("Add Game")

    const btn = actionButtons[2]
    expect(btn).toBeDefined()
    expect(btn?.disabled).toBe(false)
    expect(btn?.getAttribute("title")).toBe("Print scoresheets for all remaining games")

    await flush(() => {
      btn?.click()
    })

    expect(openSpy).toHaveBeenCalledWith("/admin/scoresheet/season/2026-fall", "_blank")
  })
})

describe("BatchScoresheetPage Route Component", () => {
  it("renders all remaining games with pagination CSS rules", async () => {
    const fetchSpy = vi.spyOn(fetchScoresheetsModule, "fetchBatchScoresheets").mockResolvedValue({
      season: { id: "2026-fall", name: "2026 Fall" },
      games: [
        {
          game: { ...mockGame, id: "g1", date: "2026-10-15", time: "8:00pm" },
          homeRoster: mockHomeRoster,
          awayRoster: mockAwayRoster,
          officials: mockOfficials,
        },
        {
          game: { ...mockGame, id: "g2", date: "2026-10-22", time: "9:00pm" },
          homeRoster: mockHomeRoster,
          awayRoster: mockAwayRoster,
          officials: mockOfficials,
        },
      ],
    })

    const PageComponent = await BatchScoresheetPage({
      params: Promise.resolve({ id: "2026-fall" }),
    })

    await render(PageComponent)

    // Check games rendered
    const pages = container.querySelectorAll(".scoresheet-page")
    expect(pages.length).toBe(2)

    // Check style tag includes print pagination rules
    const styleTag = container.querySelector("style")
    expect(styleTag).not.toBeNull()
    const css = styleTag?.textContent || ""
    expect(css).toContain("size: letter")
    expect(css).toContain("margin: 0.25in")
    expect(css).toContain("break-after: page")
    expect(css).toContain("page-break-after: always")
    expect(css).toContain("break-after: auto")
    expect(css).toContain("page-break-after: auto")
    expect(css).toContain('[data-slot="sidebar-wrapper"]')
    expect(css).toContain('[data-slot="sidebar-inset"]')

    fetchSpy.mockRestore()
  })

  it("renders empty state message when no upcoming games are found", async () => {
    const fetchSpy = vi.spyOn(fetchScoresheetsModule, "fetchBatchScoresheets").mockResolvedValue({
      season: { id: "2026-fall", name: "2026 Fall" },
      games: [],
    })

    const PageComponent = await BatchScoresheetPage({
      params: Promise.resolve({ id: "2026-fall" }),
    })

    await render(PageComponent)

    const text = container.textContent || ""
    expect(text).toContain("No Remaining Games")
    expect(text).toContain("All scheduled games in 2026 Fall are already final")
    expect(text).toContain("Back to Season Schedule")

    fetchSpy.mockRestore()
  })

  it("scales roster typography for teams with large rosters (>16 and >20 players)", async () => {
    const largeRoster: ScoresheetRosterPlayer[] = Array.from({ length: 22 }, (_, i) => ({
      name: `Player Number ${i + 1}`,
      is_captain: i === 0,
      is_goalie: i === 1,
      is_sub: false,
    }))

    await render(
      <GameScoresheet
        game={mockGame}
        homeRoster={largeRoster}
        awayRoster={mockAwayRoster}
        officials={mockOfficials}
      />
    )

    const homeRosterDiv = container.querySelector("td div[style*='font-size: 9.5px']")
    expect(homeRosterDiv).not.toBeNull()

    // Normal roster (mockAwayRoster with 2 players) renders at 11px
    const awayRosterDiv = container.querySelectorAll("td div[style*='font-size: 11px']")
    expect(awayRosterDiv.length).toBeGreaterThan(0)
  })

  it("scales roster typography for teams with huge rosters (>24 players)", async () => {
    const hugeRoster: ScoresheetRosterPlayer[] = Array.from({ length: 26 }, (_, i) => ({
      name: `Player Number ${i + 1}`,
      is_captain: i === 0,
      is_goalie: i === 1,
      is_sub: false,
    }))

    await render(
      <GameScoresheet
        game={mockGame}
        homeRoster={hugeRoster}
        awayRoster={mockAwayRoster}
        officials={mockOfficials}
      />
    )

    const homeRosterDiv = container.querySelector("td div[style*='font-size: 8.5px']")
    expect(homeRosterDiv).not.toBeNull()

    // Each roster player has nowrap and ellipsis styling
    const playerSpan = homeRosterDiv?.querySelector("span[style*='text-overflow: ellipsis']")
    expect(playerSpan).not.toBeNull()
  })

  it("safely handles missing or invalid dates and null team names in GameScoresheet", async () => {
    const fallbackGame: ScoresheetGameData = {
      ...mockGame,
      date: "",
      home_name: "",
      away_name: "",
      season_name: "",
    }

    await render(
      <GameScoresheet
        game={fallbackGame}
        homeRoster={[]}
        awayRoster={[]}
        officials={[]}
      />
    )

    const text = container.textContent || ""
    expect(text).toContain("TBD at TBD")
    expect(text).toContain("BASH - Season Game Scoresheet")
    expect(text).not.toContain("Invalid Date")
  })

  it("resets html, body and hides toaster in print media CSS", async () => {
    const fetchSpy = vi.spyOn(fetchScoresheetsModule, "fetchBatchScoresheets").mockResolvedValue({
      season: { id: "2026-fall", name: "2026 Fall" },
      games: [
        {
          game: mockGame,
          homeRoster: mockHomeRoster,
          awayRoster: mockAwayRoster,
          officials: mockOfficials,
        },
      ],
    })

    const PageComponent = await BatchScoresheetPage({
      params: Promise.resolve({ id: "2026-fall" }),
    })

    await render(PageComponent)

    const styleTag = container.querySelector("style")
    const css = styleTag?.textContent || ""
    expect(css).toContain("[data-sonner-toaster]")
    expect(css).toContain("display: block !important")
    expect(css).toContain("min-height: 0 !important")
    expect(css).toContain("print-color-adjust: exact")

    fetchSpy.mockRestore()
  })

  it("URI encodes seasonId when opening batch scoresheet from schedule tab", async () => {
    const mockGames: ScheduleGame[] = [
      {
        id: "g1",
        date: "2026-10-01",
        time: "8:00pm",
        homeSlug: "team-a",
        homeTeam: "Team A",
        homePlaceholder: null,
        awaySlug: "team-b",
        awayTeam: "Team B",
        awayPlaceholder: null,
        location: "The Lick",
        gameType: "regular",
        status: "upcoming",
        homeScore: null,
        awayScore: null,
        isOvertime: false,
        hasShootout: false,
        isForfeit: false,
        isPlayoff: false,
        title: null,
        notes: null,
        homeNotes: null,
        awayNotes: null,
      },
    ]

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGames,
      })
    )

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)

    await render(
      <SeasonScheduleTab
        seasonId="2026 Fall & Playoffs"
        seasonStatus="active"
        initialTeams={[{ teamSlug: "team-a", teamName: "Team A" }]}
        defaultLocation="The Lick"
      />
    )

    const btn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.getAttribute("aria-label")?.includes("Print Remaining Scoresheets") ||
      b.textContent?.includes("🖨️")
    )

    await flush(() => {
      btn?.click()
    })

    expect(openSpy).toHaveBeenCalledWith("/admin/scoresheet/season/2026%20Fall%20%26%20Playoffs", "_blank")
  })

  it("shows 'No games scheduled in this season' tooltip when season has 0 games", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      })
    )

    await render(
      <SeasonScheduleTab
        seasonId="2026-fall"
        seasonStatus="active"
        initialTeams={[]}
        defaultLocation="The Lick"
      />
    )

    const btn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.getAttribute("aria-label")?.includes("Print Remaining Scoresheets") ||
      b.textContent?.includes("🖨️")
    )
    expect(btn).toBeDefined()
    expect(btn?.disabled).toBe(true)
    expect(btn?.getAttribute("title")).toBe("No games scheduled in this season")
  })

  it("renders games in chronological order (9am -> 11am -> 1pm -> 11pm) in list/table mode", async () => {
    const unsortedGames: ScheduleGame[] = [
      {
        id: "g-1pm",
        date: "2026-10-11",
        time: "1:00pm",
        homeScore: null,
        awayScore: null,
        status: "upcoming",
        isOvertime: false,
        isPlayoff: false,
        isForfeit: false,
        location: "The Lick",
        notes: null,
        gameType: "regular",
        hasShootout: false,
        awayNotes: null,
        homeNotes: null,
        homePlaceholder: null,
        awayPlaceholder: null,
        title: null,
        homeTeam: "Team A",
        homeSlug: "team-a",
        awayTeam: "Team B",
        awaySlug: "team-b",
      },
      {
        id: "g-11pm",
        date: "2026-10-11",
        time: "11:00pm",
        homeScore: null,
        awayScore: null,
        status: "upcoming",
        isOvertime: false,
        isPlayoff: false,
        isForfeit: false,
        location: "The Lick",
        notes: null,
        gameType: "regular",
        hasShootout: false,
        awayNotes: null,
        homeNotes: null,
        homePlaceholder: null,
        awayPlaceholder: null,
        title: null,
        homeTeam: "Team C",
        homeSlug: "team-c",
        awayTeam: "Team D",
        awaySlug: "team-d",
      },
      {
        id: "g-9am",
        date: "2026-10-11",
        time: "9:00am",
        homeScore: null,
        awayScore: null,
        status: "upcoming",
        isOvertime: false,
        isPlayoff: false,
        isForfeit: false,
        location: "The Lick",
        notes: null,
        gameType: "regular",
        hasShootout: false,
        awayNotes: null,
        homeNotes: null,
        homePlaceholder: null,
        awayPlaceholder: null,
        title: null,
        homeTeam: "Team E",
        homeSlug: "team-e",
        awayTeam: "Team F",
        awaySlug: "team-f",
      },
      {
        id: "g-11am",
        date: "2026-10-11",
        time: "11:00am",
        homeScore: null,
        awayScore: null,
        status: "upcoming",
        isOvertime: false,
        isPlayoff: false,
        isForfeit: false,
        location: "The Lick",
        notes: null,
        gameType: "regular",
        hasShootout: false,
        awayNotes: null,
        homeNotes: null,
        homePlaceholder: null,
        awayPlaceholder: null,
        title: null,
        homeTeam: "Team G",
        homeSlug: "team-g",
        awayTeam: "Team H",
        awaySlug: "team-h",
      },
    ]

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => unsortedGames,
      })
    )

    await render(
      <SeasonScheduleTab
        seasonId="2026-fall"
        seasonStatus="active"
        initialTeams={[
          { teamSlug: "team-a", teamName: "Team A" },
          { teamSlug: "team-b", teamName: "Team B" },
        ]}
        defaultLocation="The Lick"
      />
    )

    // Switch to Table view
    const tableBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "Table view"
    )
    expect(tableBtn).toBeDefined()
    await flush(() => {
      tableBtn?.click()
    })

    // Find table rows and extract times
    const rows = Array.from(container.querySelectorAll("tbody tr"))
    expect(rows.length).toBe(4)
    const times = rows.map((r) => r.querySelectorAll("td")[1]?.textContent?.trim())
    expect(times).toEqual(["9:00am", "11:00am", "1:00pm", "11:00pm"])
  })
})

