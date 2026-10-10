// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { GameDetail } from "@/components/game-detail"
import { createInitialState } from "@/lib/scorekeeper-types"
import type { BashGame } from "@/lib/hockey-data"

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({}) }))
vi.mock("@/lib/admin-context", () => ({ useAdmin: () => ({ isAdmin: false }) }))
vi.mock("@/lib/hockey-data", () => ({
  useGameDetail: () => ({ detail: undefined, isLoading: false, isError: false }),
  useLiveGame: (_id: string, initialLiveData: unknown) => ({ liveData: initialLiveData }),
}))
vi.mock("@/components/team-logo", () => ({ TeamLogo: () => null }))

const game = {
  id: "spacing", date: "2026-10-10", time: "9:00am", homeSlug: "home", awaySlug: "away",
  homeTeam: "Home", awayTeam: "Away", homeScore: 1, awayScore: 0, location: "The Lick",
  gameType: "regular", isOvertime: false, isPlayoff: false, isForfeit: false,
} as BashGame

describe("goal assist spacing", () => {
  for (const status of ["live", "final"] as const) {
    it.each([
      [2, null, "Scorer (First Assist)"],
      [2, 3, "Scorer (First Assist, Second Assist)"],
      [null, null, "Scorer (unassisted)"],
    ] as const)(`${status}: keeps spacing with assists %s / %s`, (assist1Id, assist2Id, text) => {
      const state = createInitialState()
      state.goals = [{ id: "goal", team: "home", period: 1, clock: "12:00", scorerId: 1, assist1Id, assist2Id, flags: [] }]
      const container = document.createElement("div")
      container.innerHTML = renderToStaticMarkup(<GameDetail game={{ ...game, status }} initialLiveData={{
        state, homeScore: 1, awayScore: 0,
        playerNames: { 1: "Scorer", 2: "First Assist", 3: "Second Assist" }, goalieIds: [],
      }} />)
      const scorer = [...container.querySelectorAll("span")].find((span) => span.textContent === "Scorer" && span.classList.contains("font-semibold"))!
      const line = scorer.parentElement!
      expect(line.textContent).toBe(text)
      // Flex formatting trims whitespace at the edges of anonymous flex items.
      // The parentheses and comma must stay in ordinary inline text flow.
      const assists = scorer.nextElementSibling!
      expect(assists.classList.contains("inline-flex")).toBe(false)
      expect(assists.classList.contains("flex")).toBe(false)
    })
  }
})
