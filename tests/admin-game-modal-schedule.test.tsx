// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SeasonScheduleTab, type ScheduleGame } from "@/components/admin/season-schedule-tab"
import { EditGameModal, deriveBoxscoreStats, type GameFormData } from "@/components/admin/edit-game-modal"
import type { LiveGameState } from "@/lib/scorekeeper-types"

const fetchMock = vi.fn()

vi.mock("@/lib/api-errors", () => ({
  fetchApi: (...args: unknown[]) => fetchMock(...args),
  readApiJson: async (res: Response) => res.json(),
  errorMessage: (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

const mockTeams = [
  { teamSlug: "warriors", teamName: "Golden State Warriors" },
  { teamSlug: "sharks", teamName: "San Jose Sharks" },
]

const upcomingGame: ScheduleGame = {
  id: "g101",
  date: "2026-11-15",
  time: "19:00",
  homeSlug: "warriors",
  homeTeam: "Golden State Warriors",
  homePlaceholder: null,
  awaySlug: "sharks",
  awayTeam: "San Jose Sharks",
  awayPlaceholder: null,
  location: "The Lick",
  gameType: "regular",
  status: "upcoming",
  homeScore: null,
  awayScore: null,
  isOvertime: false,
  hasShootout: false,
  isForfeit: false,
  hasBoxscore: false,
  hasLiveScorekeeperData: false,
  isPlayoff: false,
  title: null,
  notes: null,
  homeNotes: null,
  awayNotes: null,
}

const finalImportedGame: ScheduleGame = {
  id: "g102",
  date: "2026-10-10",
  time: "20:00",
  homeSlug: "warriors",
  homeTeam: "Golden State Warriors",
  homePlaceholder: null,
  awaySlug: "sharks",
  awayTeam: "San Jose Sharks",
  awayPlaceholder: null,
  location: "The Lick",
  gameType: "regular",
  status: "final",
  homeScore: 5,
  awayScore: 2,
  isOvertime: false,
  hasShootout: false,
  isForfeit: false,
  hasBoxscore: true,
  hasLiveScorekeeperData: false,
  isPlayoff: false,
  title: null,
  notes: null,
  homeNotes: null,
  awayNotes: null,
}

const finalLiveGame: ScheduleGame = {
  id: "g103",
  date: "2026-10-17",
  time: "20:00",
  homeSlug: "warriors",
  homeTeam: "Golden State Warriors",
  homePlaceholder: null,
  awaySlug: "sharks",
  awayTeam: "San Jose Sharks",
  awayPlaceholder: null,
  location: "The Lick",
  gameType: "regular",
  status: "final",
  homeScore: 4,
  awayScore: 3,
  isOvertime: true,
  hasShootout: false,
  isForfeit: false,
  hasBoxscore: true,
  hasLiveScorekeeperData: true,
  isPlayoff: false,
  title: null,
  notes: null,
  homeNotes: null,
  awayNotes: null,
}

const mockLiveState: LiveGameState = {
  period: 4,
  clockSeconds: 0,
  clockRunning: false,
  clockStartedAt: null,
  homeShots: [10, 12, 8, 2],
  awayShots: [8, 9, 10, 1],
  homeTimeoutsUsed: 0,
  awayTimeoutsUsed: 0,
  homeAttendance: [1, 2],
  awayAttendance: [3, 4],
  goals: [
    { id: "g1", team: "warriors", period: 1, clock: "10:00", scorerId: 1, assist1Id: null, assist2Id: null, flags: [] },
    { id: "g2", team: "warriors", period: 2, clock: "08:00", scorerId: 1, assist1Id: null, assist2Id: null, flags: [] },
    { id: "g3", team: "sharks", period: 2, clock: "05:00", scorerId: 3, assist1Id: null, assist2Id: null, flags: [] },
    { id: "g4", team: "sharks", period: 3, clock: "12:00", scorerId: 4, assist1Id: null, assist2Id: null, flags: [] },
    { id: "g5", team: "sharks", period: 3, clock: "02:00", scorerId: 3, assist1Id: null, assist2Id: null, flags: [] },
    { id: "g6", team: "warriors", period: 3, clock: "00:30", scorerId: 2, assist1Id: null, assist2Id: null, flags: [] },
    { id: "g7", team: "warriors", period: 4, clock: "02:15", scorerId: 1, assist1Id: null, assist2Id: null, flags: [] },
  ],
  penalties: [],
  timeouts: [],
  goaliePulls: [],
  goalieChanges: [],
  shootout: null,
  threeStars: [1, 2, 3],
  homeGoalieId: 10,
  awayGoalieId: 20,
  officials: { ref1: "Ref 1", ref2: "Ref 2", scorekeeper: "Scorekeeper" },
  notes: "Great game",
  updatedAt: Date.now(),
}

describe("SeasonScheduleTab Single Edit Action & Past Season Editing Support (R2)", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    vi.clearAllMocks()
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/schedule")) {
        return Promise.resolve({
          ok: true,
          json: async () => [upcomingGame, finalImportedGame, finalLiveGame],
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      })
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("removes the separate Trophy scorekeeper icon button in card view and table view", async () => {
    await act(async () => {
      root.render(
        <SeasonScheduleTab
          seasonId="2026-summer"
          seasonStatus="active"
          initialTeams={mockTeams}
          defaultLocation="The Lick"
        />
      )
    })

    // In card view (default viewMode="cards"):
    // Check that NO link or button has href to scorekeeper /admin/games/*/edit
    const scorekeeperLinks = Array.from(container.querySelectorAll('a[href*="/admin/games/"]'))
    expect(scorekeeperLinks).toHaveLength(0)

    const trophyButtons = Array.from(container.querySelectorAll('button[title="Scorekeeper"]'))
    expect(trophyButtons).toHaveLength(0)

    // Verify "Edit Game" buttons exist as the editing action
    const editButtons = Array.from(container.querySelectorAll('button[title="Edit Game"]'))
    expect(editButtons.length).toBeGreaterThan(0)

    // Switch to table view
    const tableViewBtn = container.querySelector('button[title="Table view"]') as HTMLButtonElement
    expect(tableViewBtn).toBeTruthy()
    await act(async () => {
      tableViewBtn.click()
    })

    // In table view, verify Trophy scorekeeper buttons/links are also absent
    const tableScorekeeperLinks = Array.from(container.querySelectorAll('a[href*="/admin/games/"]'))
    expect(tableScorekeeperLinks).toHaveLength(0)
    const tableTrophyButtons = Array.from(container.querySelectorAll('button[title="Scorekeeper"]'))
    expect(tableTrophyButtons).toHaveLength(0)
    const tableEditButtons = Array.from(container.querySelectorAll('button[title="Edit Game"]'))
    expect(tableEditButtons.length).toBeGreaterThan(0)
  })

  it("allows editing games on completed seasons (seasonStatus === 'completed')", async () => {
    await act(async () => {
      root.render(
        <SeasonScheduleTab
          seasonId="2025-fall"
          seasonStatus="completed"
          initialTeams={mockTeams}
          defaultLocation="The Lick"
        />
      )
    })

    // On completed season, the "Edit Game" buttons must still be rendered and enabled
    const editButtons = Array.from(container.querySelectorAll('button[title="Edit Game"]')) as HTMLButtonElement[]
    expect(editButtons.length).toBeGreaterThan(0)
    expect(editButtons[0].disabled).toBe(false)

    // Clicking Edit Game opens the edit dialog
    await act(async () => {
      editButtons[0].click()
    })

    expect(document.body.textContent).toContain("Edit Game")
  })
})

describe("Two-Tab Wide Modal in Season Schedule Tab (R1)", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    vi.clearAllMocks()
    fetchMock.mockImplementation((url: string) => {
      if (url.includes(`/schedule/${finalLiveGame.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            hasLiveScorekeeperData: true,
            liveState: mockLiveState,
            homeRoster: [{ id: 1, name: "Home Player 1" }, { id: 2, name: "Home Player 2" }],
            awayRoster: [{ id: 3, name: "Away Player 1" }, { id: 4, name: "Away Player 2" }],
            playerNames: { 1: "Home Player 1", 2: "Home Player 2", 3: "Away Player 1", 4: "Away Player 2" },
            savedGoalies: [{ id: 10, name: "Home Goalie", team: "Golden State Warriors" }, { id: 20, name: "Away Goalie", team: "San Jose Sharks" }],
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      })
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("clicking Edit on an upcoming game opens dialog (sm:max-w-4xl) with Game Settings tab active by default", async () => {
    const gameData: GameFormData = {
      id: upcomingGame.id,
      date: upcomingGame.date,
      time: upcomingGame.time,
      homeTeam: upcomingGame.homeSlug,
      awayTeam: upcomingGame.awaySlug,
      location: upcomingGame.location,
      gameType: upcomingGame.gameType,
      status: upcomingGame.status,
      homeScore: upcomingGame.homeScore,
      awayScore: upcomingGame.awayScore,
      isOvertime: upcomingGame.isOvertime,
      hasShootout: upcomingGame.hasShootout,
      isForfeit: upcomingGame.isForfeit,
      hasBoxscore: upcomingGame.hasBoxscore,
      hasLiveScorekeeperData: false,
      title: upcomingGame.title,
      notes: upcomingGame.notes,
      homeNotes: upcomingGame.homeNotes,
      awayNotes: upcomingGame.awayNotes,
    }

    await act(async () => {
      root.render(
        <EditGameModal
          open={true}
          onOpenChange={vi.fn()}
          game={gameData}
          teams={mockTeams}
          seasonId="2026-summer"
          defaultLocation="The Lick"
          onSaved={vi.fn()}
        />
      )
    })

    // Dialog has sm:max-w-4xl
    const dialogContent = document.body.querySelector('[role="dialog"]')
    expect(dialogContent).toBeTruthy()
    expect(dialogContent?.className).toContain("sm:max-w-4xl")

    // Both tabs exist
    const tabs = Array.from(document.body.querySelectorAll('[role="tab"]'))
    const tabTexts = tabs.map((t) => t.textContent?.trim())
    expect(tabTexts).toContain("Game Settings")
    expect(tabTexts).toContain("Boxscore & Stats")

    // "Game Settings" is the active tab by default for upcoming game
    const activeTab = document.body.querySelector('[role="tab"][data-state="active"]')
    expect(activeTab?.textContent?.trim()).toBe("Game Settings")

    // Game settings form fields are visible
    expect(document.body.querySelector('input[type="date"]')).toBeTruthy()
  })

  it("clicking Edit on a final game opens dialog with Boxscore & Stats tab active by default", async () => {
    const gameData: GameFormData = {
      id: finalImportedGame.id,
      date: finalImportedGame.date,
      time: finalImportedGame.time,
      homeTeam: finalImportedGame.homeSlug,
      awayTeam: finalImportedGame.awaySlug,
      location: finalImportedGame.location,
      gameType: finalImportedGame.gameType,
      status: finalImportedGame.status,
      homeScore: finalImportedGame.homeScore,
      awayScore: finalImportedGame.awayScore,
      isOvertime: finalImportedGame.isOvertime,
      hasShootout: finalImportedGame.hasShootout,
      isForfeit: finalImportedGame.isForfeit,
      hasBoxscore: finalImportedGame.hasBoxscore,
      hasLiveScorekeeperData: false,
      title: finalImportedGame.title,
      notes: finalImportedGame.notes,
      homeNotes: finalImportedGame.homeNotes,
      awayNotes: finalImportedGame.awayNotes,
    }

    await act(async () => {
      root.render(
        <EditGameModal
          open={true}
          onOpenChange={vi.fn()}
          game={gameData}
          teams={mockTeams}
          seasonId="2026-summer"
          defaultLocation="The Lick"
          onSaved={vi.fn()}
        />
      )
    })

    // "Boxscore & Stats" is active by default for a final game
    const activeTab = document.body.querySelector('[role="tab"][data-state="active"]')
    expect(activeTab?.textContent?.trim()).toBe("Boxscore & Stats")
  })

  it("displays informational message for games without live scorekeeper data in Boxscore & Stats tab", async () => {
    const gameData: GameFormData = {
      id: finalImportedGame.id,
      date: finalImportedGame.date,
      time: finalImportedGame.time,
      homeTeam: finalImportedGame.homeSlug,
      awayTeam: finalImportedGame.awaySlug,
      location: finalImportedGame.location,
      gameType: finalImportedGame.gameType,
      status: finalImportedGame.status,
      homeScore: finalImportedGame.homeScore,
      awayScore: finalImportedGame.awayScore,
      isOvertime: finalImportedGame.isOvertime,
      hasShootout: finalImportedGame.hasShootout,
      isForfeit: finalImportedGame.isForfeit,
      hasBoxscore: true,
      hasLiveScorekeeperData: false,
      title: null,
      notes: null,
      homeNotes: null,
      awayNotes: null,
    }

    await act(async () => {
      root.render(
        <EditGameModal
          open={true}
          onOpenChange={vi.fn()}
          game={gameData}
          teams={mockTeams}
          seasonId="2026-summer"
          defaultLocation="The Lick"
          onSaved={vi.fn()}
        />
      )
    })

    expect(document.body.textContent).toContain("This game's stats were imported without live scorekeeper data")
  })

  it("displays score/OT/SO values derived from boxscore data rather than independent editable inputs when game has live scorekeeper data", async () => {
    const gameData: GameFormData = {
      id: finalLiveGame.id,
      date: finalLiveGame.date,
      time: finalLiveGame.time,
      homeTeam: finalLiveGame.homeSlug,
      awayTeam: finalLiveGame.awaySlug,
      location: finalLiveGame.location,
      gameType: finalLiveGame.gameType,
      status: finalLiveGame.status,
      homeScore: finalLiveGame.homeScore,
      awayScore: finalLiveGame.awayScore,
      isOvertime: finalLiveGame.isOvertime,
      hasShootout: finalLiveGame.hasShootout,
      isForfeit: false,
      hasBoxscore: true,
      hasLiveScorekeeperData: true,
      liveState: mockLiveState,
      title: null,
      notes: null,
      homeNotes: null,
      awayNotes: null,
    }

    await act(async () => {
      root.render(
        <EditGameModal
          open={true}
          onOpenChange={vi.fn()}
          game={gameData}
          teams={mockTeams}
          seasonId="2026-summer"
          defaultLocation="The Lick"
          onSaved={vi.fn()}
        />
      )
    })

    // Switch to Game Settings tab
    const settingsTabTrigger = Array.from(document.body.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent?.trim() === "Game Settings"
    ) as HTMLButtonElement
    expect(settingsTabTrigger).toBeTruthy()
    await act(async () => {
      settingsTabTrigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      settingsTabTrigger.click()
    })

    // Derived from boxscore annotations exist
    expect(document.body.textContent).toContain("Derived from boxscore")

    // The score inputs are disabled/readOnly with derived values (home: 4, away: 3 from mockLiveState)
    const scoreInputs = Array.from(document.body.querySelectorAll('input[placeholder="Score"]')) as HTMLInputElement[]
    expect(scoreInputs).toHaveLength(2)
    for (const input of scoreInputs) {
      expect(input.disabled).toBe(true)
    }

    // Overtime and Shootout switches are disabled
    const overtimeSwitch = document.body.querySelector("#overtime") as HTMLButtonElement
    const shootoutSwitch = document.body.querySelector("#shootout") as HTMLButtonElement
    expect(overtimeSwitch?.disabled).toBe(true)
    expect(shootoutSwitch?.disabled).toBe(true)

    // Save Game and verify PATCH payload contains derived scores (home: 4, away: 3, OT: true, SO: false)
    const saveBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Save Game"
    ) as HTMLButtonElement
    expect(saveBtn).toBeTruthy()
    await act(async () => {
      saveBtn.click()
    })

    const patchCall = fetchMock.mock.calls.find(([url]: [string]) => url.includes(`/schedule/${finalLiveGame.id}`))
    expect(patchCall).toBeDefined()
    const [, init] = patchCall!
    const payload = JSON.parse(init.body)
    expect(payload.homeScore).toBe(4)
    expect(payload.awayScore).toBe(3)
    expect(payload.isOvertime).toBe(true)
    expect(payload.hasShootout).toBe(false)
  })

  it("upcoming games without live scorekeeper data allow independent score editing and display imported info when switching to Boxscore & Stats tab", async () => {
    const gameData: GameFormData = {
      id: upcomingGame.id,
      date: upcomingGame.date,
      time: upcomingGame.time,
      homeTeam: upcomingGame.homeSlug,
      awayTeam: upcomingGame.awaySlug,
      location: upcomingGame.location,
      gameType: upcomingGame.gameType,
      status: upcomingGame.status,
      homeScore: null,
      awayScore: null,
      isOvertime: false,
      hasShootout: false,
      isForfeit: false,
      hasBoxscore: false,
      hasLiveScorekeeperData: false,
      title: null,
      notes: null,
      homeNotes: null,
      awayNotes: null,
    }

    await act(async () => {
      root.render(
        <EditGameModal
          open={true}
          onOpenChange={vi.fn()}
          game={gameData}
          teams={mockTeams}
          seasonId="2026-summer"
          defaultLocation="The Lick"
          onSaved={vi.fn()}
        />
      )
    })

    // Score inputs are editable
    const scoreInputs = Array.from(document.body.querySelectorAll('input[placeholder="Score"]')) as HTMLInputElement[]
    expect(scoreInputs).toHaveLength(2)
    for (const input of scoreInputs) {
      expect(input.disabled).toBe(false)
    }

    // Switch to Boxscore & Stats tab
    const boxscoreTabTrigger = Array.from(document.body.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent?.trim() === "Boxscore & Stats"
    ) as HTMLButtonElement
    expect(boxscoreTabTrigger).toBeTruthy()
    await act(async () => {
      boxscoreTabTrigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      boxscoreTabTrigger.click()
    })

    // Displays the informational message
    expect(document.body.textContent).toContain("This game's stats were imported without live scorekeeper data")
  })

  it("upcoming game with live scorekeeper data (no liveState in props) fetches editor data and displays derived scores on Game Settings tab", async () => {
    const liveUpcomingGameData: GameFormData = {
      id: "g103",
      date: "2026-11-20",
      time: "19:00",
      homeTeam: "warriors",
      awayTeam: "sharks",
      location: "The Lick",
      gameType: "regular",
      status: "upcoming",
      homeScore: null,
      awayScore: null,
      isOvertime: false,
      hasShootout: false,
      isForfeit: false,
      hasBoxscore: true,
      hasLiveScorekeeperData: true,
      // Note: liveState is deliberately omitted to verify eager fetch
      title: null,
      notes: null,
      homeNotes: null,
      awayNotes: null,
    }

    await act(async () => {
      root.render(
        <EditGameModal
          open={true}
          onOpenChange={vi.fn()}
          game={liveUpcomingGameData}
          teams={mockTeams}
          seasonId="2026-summer"
          defaultLocation="The Lick"
          onSaved={vi.fn()}
        />
      )
    })

    // Active tab by default is Game Settings (since status is upcoming)
    const activeTab = document.body.querySelector('[role="tab"][data-state="active"]')
    expect(activeTab?.textContent?.trim()).toBe("Game Settings")

    // The score inputs should display the derived values (home: 4, away: 3 from mockLiveState) and be disabled
    const scoreInputs = Array.from(document.body.querySelectorAll('input[placeholder="Score"]')) as HTMLInputElement[]
    expect(scoreInputs).toHaveLength(2)
    expect(scoreInputs[0].disabled).toBe(true)
    expect(scoreInputs[0].value).toBe("3") // Away score
    expect(scoreInputs[1].value).toBe("4") // Home score

    expect(document.body.textContent).toContain("Derived from boxscore")
  })

  it("forfeiting a game that has live scorekeeper data preserves the 5-0 forfeit preset and does NOT overwrite with live goals", async () => {
    const liveGameData: GameFormData = {
      id: "g103",
      date: "2026-11-20",
      time: "19:00",
      homeTeam: "warriors",
      awayTeam: "sharks",
      location: "The Lick",
      gameType: "regular",
      status: "final",
      homeScore: 4,
      awayScore: 3,
      isOvertime: true,
      hasShootout: false,
      isForfeit: false,
      hasBoxscore: true,
      hasLiveScorekeeperData: true,
      liveState: mockLiveState,
      title: null,
      notes: null,
      homeNotes: null,
      awayNotes: null,
    }

    await act(async () => {
      root.render(
        <EditGameModal
          open={true}
          onOpenChange={vi.fn()}
          game={liveGameData}
          teams={mockTeams}
          seasonId="2026-summer"
          defaultLocation="The Lick"
          onSaved={vi.fn()}
        />
      )
    })

    // Switch to Game Settings tab
    const settingsTabTrigger = Array.from(document.body.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent?.trim() === "Game Settings"
    ) as HTMLButtonElement
    expect(settingsTabTrigger).toBeTruthy()
    await act(async () => {
      settingsTabTrigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      settingsTabTrigger.click()
    })

    // Toggle Forfeit switch ON
    const forfeitSwitch = document.body.querySelector("#forfeit") as HTMLButtonElement
    expect(forfeitSwitch).toBeTruthy()
    await act(async () => {
      forfeitSwitch.click()
    })

    // Under forfeit, the scores are NOT disabled "Derived from boxscore"
    // Default away forfeit: Home wins 5-0
    const scoreInputs = Array.from(document.body.querySelectorAll('input[placeholder="Score"]')) as HTMLInputElement[]
    expect(scoreInputs).toHaveLength(2)
    expect(scoreInputs[0].value).toBe("0") // Away score
    expect(scoreInputs[1].value).toBe("5") // Home score

    // Overtime and Shootout are NOT disabled derived indicators
    const overtimeSwitch = document.body.querySelector("#overtime") as HTMLButtonElement
    expect(overtimeSwitch?.disabled).toBe(false)

    // Save Game and verify payload has 5-0 forfeit, NOT the 4-3 live state goals
    const saveBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Save Game"
    ) as HTMLButtonElement
    expect(saveBtn).toBeTruthy()
    await act(async () => {
      saveBtn.click()
    })

    const patchCall = fetchMock.mock.calls.find(([url]: [string]) => url.includes(`/schedule/${liveGameData.id}`))
    expect(patchCall).toBeDefined()
    const [, init] = patchCall!
    const payload = JSON.parse(init.body)
    expect(payload.isForfeit).toBe(true)
    expect(payload.homeScore).toBe(5)
    expect(payload.awayScore).toBe(0)
    expect(payload.isOvertime).toBe(false)
    expect(payload.hasShootout).toBe(false)
  })

  it("final game with undefined hasLiveScorekeeperData eagerly loads editor data on open", async () => {
    const finalGameWithUndefinedLive: GameFormData = {
      id: "g103",
      date: "2026-11-20",
      time: "19:00",
      homeTeam: "warriors",
      awayTeam: "sharks",
      location: "The Lick",
      gameType: "regular",
      status: "final",
      homeScore: 4,
      awayScore: 3,
      isOvertime: true,
      hasShootout: false,
      isForfeit: false,
      hasBoxscore: true,
      // hasLiveScorekeeperData deliberately omitted (undefined)
      title: null,
      notes: null,
      homeNotes: null,
      awayNotes: null,
    }

    await act(async () => {
      root.render(
        <EditGameModal
          open={true}
          onOpenChange={vi.fn()}
          game={finalGameWithUndefinedLive}
          teams={mockTeams}
          seasonId="2026-summer"
          defaultLocation="The Lick"
          onSaved={vi.fn()}
        />
      )
    })

    // Eager fetch was invoked for g103 because initialTab is boxscore
    const scheduleFetch = fetchMock.mock.calls.find(([url]: [string]) => url.includes(`/schedule/g103`))
    expect(scheduleFetch).toBeDefined()
  })

  it("upcoming game with undefined hasLiveScorekeeperData loads editor data upon switching to Boxscore & Stats tab", async () => {
    const upcomingGameWithUndefinedLive: GameFormData = {
      id: "g103",
      date: "2026-11-20",
      time: "19:00",
      homeTeam: "warriors",
      awayTeam: "sharks",
      location: "The Lick",
      gameType: "regular",
      status: "upcoming",
      homeScore: null,
      awayScore: null,
      isOvertime: false,
      hasShootout: false,
      isForfeit: false,
      hasBoxscore: false,
      // hasLiveScorekeeperData deliberately omitted (undefined)
      title: null,
      notes: null,
      homeNotes: null,
      awayNotes: null,
    }

    await act(async () => {
      root.render(
        <EditGameModal
          open={true}
          onOpenChange={vi.fn()}
          game={upcomingGameWithUndefinedLive}
          teams={mockTeams}
          seasonId="2026-summer"
          defaultLocation="The Lick"
          onSaved={vi.fn()}
        />
      )
    })

    // On open with Game Settings active, editor data is not eagerly fetched
    const initialFetch = fetchMock.mock.calls.find(([url]: [string]) => url.includes(`/schedule/g103`))
    expect(initialFetch).toBeUndefined()

    // Switch to Boxscore & Stats tab
    const boxscoreTabTrigger = Array.from(document.body.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent?.trim() === "Boxscore & Stats"
    ) as HTMLButtonElement
    expect(boxscoreTabTrigger).toBeTruthy()
    await act(async () => {
      boxscoreTabTrigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      boxscoreTabTrigger.click()
    })

    // Now editor data is fetched
    const afterTabSwitchFetch = fetchMock.mock.calls.find(([url]: [string]) => url.includes(`/schedule/g103`))
    expect(afterTabSwitchFetch).toBeDefined()
  })

  it("preserves official score when game has live attendance/shots but 0 live goals recorded and no shootout", () => {
    const emptyGoalsState: LiveGameState = {
      ...mockLiveState,
      goals: [],
      shootout: null,
    }

    const derived = deriveBoxscoreStats(
      emptyGoalsState,
      "warriors",
      "sharks",
      { homeScore: 5, awayScore: 2, isOvertime: false, hasShootout: false },
      false,
      "warriors",
      "sharks"
    )

    expect(derived.homeScore).toBe(5)
    expect(derived.awayScore).toBe(2)
    expect(derived.isOvertime).toBe(false)
    expect(derived.hasShootout).toBe(false)
  })

  it("preserves derived goals when home team is updated in Game Settings tab", () => {
    const derived = deriveBoxscoreStats(
      mockLiveState,
      "golden-state-new-slug",
      "sharks",
      { homeScore: 4, awayScore: 3, isOvertime: true, hasShootout: false },
      false,
      "warriors", // original home slug in recorded goals
      "sharks"
    )

    // Goals were recorded with team: "warriors", should still match through originalHomeSlug
    expect(derived.homeScore).toBe(4)
    expect(derived.awayScore).toBe(3)
  })

  it("correctly attributes goals when home and away teams are swapped in Game Settings", () => {
    // Original game: Home was "warriors" (4 goals), Away was "sharks" (3 goals)
    // Admin swaps them: new home is "sharks", new away is "warriors"
    const derived = deriveBoxscoreStats(
      mockLiveState,
      "sharks", // new homeTeam
      "warriors", // new awayTeam
      { homeScore: 3, awayScore: 4, isOvertime: true, hasShootout: false },
      false,
      "warriors", // originalHomeSlug
      "sharks" // originalAwaySlug
    )

    // Sharks goals (3) must be homeScore, Warriors goals (4) must be awayScore
    expect(derived.homeScore).toBe(3)
    expect(derived.awayScore).toBe(4)
  })

  it("correctly attributes shootout win when home and away teams are swapped in Game Settings", () => {
    const shootoutState: LiveGameState = {
      ...mockLiveState,
      goals: [
        { id: "g1", team: "warriors", period: 1, clock: "10:00", scorerId: 1, assist1Id: null, assist2Id: null, flags: [] },
        { id: "g2", team: "sharks", period: 2, clock: "10:00", scorerId: 3, assist1Id: null, assist2Id: null, flags: [] },
      ],
      hasShootout: true,
      shootout: {
        // Original home (warriors) scored 1, original away (sharks) scored 2
        homeAttempts: [{ playerId: 1, scored: true }, { playerId: 2, scored: false }],
        awayAttempts: [{ playerId: 3, scored: true }, { playerId: 4, scored: true }],
      },
    }

    // Normal (unswapped)
    const normal = deriveBoxscoreStats(
      shootoutState,
      "warriors",
      "sharks",
      { homeScore: 1, awayScore: 2, isOvertime: true, hasShootout: true },
      false,
      "warriors",
      "sharks"
    )
    // Warriors: 1 goal + 0 SO win = 1. Sharks: 1 goal + 1 SO win = 2.
    expect(normal.homeScore).toBe(1)
    expect(normal.awayScore).toBe(2)

    // Swapped: new home is "sharks", new away is "warriors"
    const swapped = deriveBoxscoreStats(
      shootoutState,
      "sharks",
      "warriors",
      { homeScore: 2, awayScore: 1, isOvertime: true, hasShootout: true },
      false,
      "warriors",
      "sharks"
    )
    // New home (Sharks) gets 1 goal + 1 SO win = 2. New away (Warriors) gets 1 goal + 0 SO win = 1.
    expect(swapped.homeScore).toBe(2)
    expect(swapped.awayScore).toBe(1)
  })

  it("preserves null scores when a pre-game (period 0) live state has 0 goals and fallback scores are null", () => {
    const preGameState: LiveGameState = {
      ...mockLiveState,
      period: 0,
      goals: [],
      shootout: null,
    }

    const derived = deriveBoxscoreStats(
      preGameState,
      "warriors",
      "sharks",
      { homeScore: null, awayScore: null, isOvertime: false, hasShootout: false },
      false,
      "warriors",
      "sharks"
    )

    expect(derived.homeScore).toBeNull()
    expect(derived.awayScore).toBeNull()
    expect(derived.isOvertime).toBe(false)
    expect(derived.hasShootout).toBe(false)
  })

  it("opens forfeited final games on Game Settings tab by default and disables boxscore editor on Boxscore & Stats tab", async () => {
    const forfeitedGameData: GameFormData = {
      id: "g103",
      date: "2026-11-20",
      time: "19:00",
      homeTeam: "warriors",
      awayTeam: "sharks",
      location: "The Lick",
      gameType: "regular",
      status: "final",
      homeScore: 5,
      awayScore: 0,
      isOvertime: false,
      hasShootout: false,
      isForfeit: true,
      hasBoxscore: false,
      hasLiveScorekeeperData: true,
      liveState: mockLiveState,
      title: null,
      notes: null,
      homeNotes: null,
      awayNotes: null,
    }

    await act(async () => {
      root.render(
        <EditGameModal
          open={true}
          onOpenChange={vi.fn()}
          game={forfeitedGameData}
          teams={mockTeams}
          seasonId="2026-summer"
          defaultLocation="The Lick"
          onSaved={vi.fn()}
        />
      )
    })

    // Opens on Game Settings tab even though status === "final" because isForfeit is true
    const activeTab = document.body.querySelector('[role="tab"][data-state="active"]')
    expect(activeTab?.textContent?.trim()).toBe("Game Settings")

    // Switch to Boxscore & Stats tab
    const boxscoreTabTrigger = Array.from(document.body.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent?.trim() === "Boxscore & Stats"
    ) as HTMLButtonElement
    expect(boxscoreTabTrigger).toBeTruthy()
    await act(async () => {
      boxscoreTabTrigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      boxscoreTabTrigger.click()
    })

    expect(document.body.textContent).toContain(
      "Boxscore & player stats are disabled for forfeited games. Manage forfeit settings in the Game Settings tab."
    )
  })
})

