// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EditGameModal, type GameFormData } from "@/components/admin/edit-game-modal"
import { PlayerPageContent } from "@/components/player-page-content"
import type { PlayerDetail } from "@/lib/fetch-player-detail"

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
  }),
}))

const teams = [
  { teamSlug: "red", teamName: "Red Army" },
  { teamSlug: "blue", teamName: "Blue Jackets" },
]

const baseGame: GameFormData = {
  id: "g500",
  date: "2026-10-27",
  time: "19:00",
  homeTeam: "red",
  awayTeam: "blue",
  location: "The Lick",
  gameType: "regular",
  status: "upcoming",
  homeScore: null,
  awayScore: null,
  isOvertime: false,
  hasShootout: false,
  isForfeit: false,
  notes: null,
  homeNotes: null,
  awayNotes: null,
}

describe("EditGameModal forfeit automation", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    vi.clearAllMocks()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("auto-populates Final 5-0 when Forfeit is toggled ON and updates scores when switching Forfeiting Team", async () => {
    await act(async () => {
      root.render(
        <EditGameModal
          open={true}
          onOpenChange={vi.fn()}
          game={baseGame}
          teams={teams}
          seasonId="2026-2027"
          defaultLocation="The Lick"
          onSaved={vi.fn()}
        />
      )
    })

    const forfeitSwitch = document.body.querySelector("#forfeit") as HTMLButtonElement
    expect(forfeitSwitch).toBeTruthy()
    await act(async () => {
      forfeitSwitch.click()
    })

    // Default: Away Team forfeited -> Home (Red Army) wins 5-0
    expect(document.body.textContent).toContain("Forfeiting Team")
    const scoreInputs = Array.from(document.body.querySelectorAll('input[placeholder="Score"]')) as HTMLInputElement[]
    expect(scoreInputs[0].value).toBe("0")
    expect(scoreInputs[1].value).toBe("5")

    // Switch to Home Team forfeited -> Away (Blue Jackets) wins 5-0
    const homeForfeitBtn = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Red Army (Home)")
    ) as HTMLButtonElement
    expect(homeForfeitBtn).toBeTruthy()
    await act(async () => {
      homeForfeitBtn.click()
    })
    expect(scoreInputs[0].value).toBe("5")
    expect(scoreInputs[1].value).toBe("0")

    // Switch to Both Teams (Double Forfeit) -> 0-0
    const bothForfeitBtn = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Both Teams (Double Forfeit)")
    ) as HTMLButtonElement
    expect(bothForfeitBtn).toBeTruthy()
    await act(async () => {
      bothForfeitBtn.click()
    })
    expect(scoreInputs[0].value).toBe("0")
    expect(scoreInputs[1].value).toBe("0")

    // Submit and verify payload sent to PATCH endpoint
    const saveBtn = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Save Game")
    ) as HTMLButtonElement
    await act(async () => {
      saveBtn.click()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload).toMatchObject({
      isForfeit: true,
      status: "final",
      homeScore: 0,
      awayScore: 0,
      isOvertime: false,
      hasShootout: false,
    })
  })

  it("resets status to upcoming and clears scores when Forfeit is toggled OFF on an unplayed game", async () => {
    await act(async () => {
      root.render(
        <EditGameModal
          open={true}
          onOpenChange={vi.fn()}
          game={baseGame}
          teams={teams}
          seasonId="2026-2027"
          defaultLocation="The Lick"
          onSaved={vi.fn()}
        />
      )
    })

    const forfeitSwitch = document.body.querySelector("#forfeit") as HTMLButtonElement
    await act(async () => {
      forfeitSwitch.click()
    })

    const scoreInputs = Array.from(document.body.querySelectorAll('input[placeholder="Score"]')) as HTMLInputElement[]
    expect(scoreInputs[0].value).toBe("0")
    expect(scoreInputs[1].value).toBe("5")

    await act(async () => {
      forfeitSwitch.click()
    })
    expect(scoreInputs[0].value).toBe("")
    expect(scoreInputs[1].value).toBe("")
  })

  it("renders the Forfeit badge in PlayerPageContent skater and goalie game logs", async () => {
    const mockPlayer: PlayerDetail = {
      id: 7,
      name: "Alex Player",
      team: "Red Army",
      teamSlug: "red",
      isGoalie: false,
      seasonStats: null,
      allTimeStats: null,
      allTimeAllSeasonsStats: null,
      perSeasonStats: [],
      goalieSeasonStats: null,
      allTimeGoalieStats: null,
      allTimeAllSeasonsGoalieStats: null,
      perSeasonGoalieStats: [],
      games: [
        {
          gameId: "g500",
          date: "2026-10-27",
          opponent: "Blue Jackets",
          opponentSlug: "blue",
          isHome: true,
          teamScore: 5,
          opponentScore: 0,
          result: "W",
          goals: 0,
          assists: 0,
          points: 0,
          gwg: 0,
          ppg: 0,
          shg: 0,
          eng: 0,
          hatTricks: 0,
          pen: 0,
          pim: 0,
          isForfeit: true,
        },
      ],
      goalieGames: [
        {
          gameId: "g500",
          date: "2026-10-27",
          opponent: "Blue Jackets",
          opponentSlug: "blue",
          isHome: true,
          teamScore: 5,
          opponentScore: 0,
          seconds: 0,
          goalsAgainst: 0,
          shotsAgainst: 0,
          saves: 0,
          savePercentage: "0.000",
          shutouts: 0,
          goalieAssists: 0,
          result: null,
          isForfeit: true,
        },
      ],
      playoffPerSeasonStats: [],
      playoffAllTimeStats: null,
      playoffAllTimeAllSeasonsStats: null,
      playoffGames: [],
      playoffPerSeasonGoalieStats: [],
      playoffAllTimeGoalieStats: null,
      playoffAllTimeAllSeasonsGoalieStats: null,
      playoffGoalieGames: [],
      exhibitionGames: [],
      exhibitionGoalieGames: [],
      championships: [],
      awards: [],
      hallOfFame: null,
    }

    await act(async () => {
      root.render(<PlayerPageContent player={mockPlayer} />)
    })

    const forfeitBadges = Array.from(container.querySelectorAll("span")).filter(
      (s) => s.textContent?.trim() === "Forfeit"
    )
    expect(forfeitBadges).toHaveLength(2)
  })
})
