// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { StatsTab } from "@/components/stats-tab"
import type { SkaterStat, GoalieStat } from "@/lib/hockey-data"

const route = vi.hoisted(() => ({ view: "skaters" }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(`view=${route.view}`),
  useRouter: () => ({ replace: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock("@/components/team-logo", () => ({ TeamLogo: () => null }))
const skaters: SkaterStat[] = Array.from({ length: 30 }, (_, i) => ({
  id: i, name: i === 29 ? "Search Target" : `Player ${i}`, team: "Seals", teamSlug: "seals",
  gp: 20, points: 30 - i, goals: i, assists: 0, ptsPg: "1.00", gwg: 0, ppg: 0,
  shg: 0, eng: 0, hatTricks: 0, pen: 0, pim: 0,
}))
const goalies: GoalieStat[] = Array.from({ length: 30 }, (_, i) => ({
  id: i, name: i === 29 ? "Search Target" : `Goalie ${i}`, team: "Seals", teamSlug: "seals",
  gp: 20, seconds: 1200, goalsAgainst: 10, shotsAgainst: 100, saves: 90,
  savePercentage: 1 - i / 100, gaa: i, wins: 10, losses: 0, shutouts: 0, goalieAssists: 0,
}))
vi.mock("@/lib/hockey-data", () => ({
  usePlayerStats: () => ({ skaters, goalies, teams: [], hasPlayoffs: false, isLoading: false }),
}))

describe("Stats search rankings", () => {
  for (const view of ["skaters", "goalies"]) {
    it(`keeps a ${view} player's full-list rank when searching across pages`, async () => {
      route.view = view
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
      const container = document.createElement("div")
      document.body.append(container)
      const root = createRoot(container)
      try {
        await act(async () => root.render(<StatsTab />))
        expect(container.querySelectorAll("tbody tr")).toHaveLength(25)
        expect(container.textContent).not.toContain("Search Target")
        const input = container.querySelector<HTMLInputElement>('input[placeholder="Search players..."]')!
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        await act(async () => {
          setValue.call(input, "sEaRcH tArGeT")
          input.dispatchEvent(new Event("input", { bubbles: true }))
        })
        const rows = container.querySelectorAll("tbody tr")
        expect(rows).toHaveLength(1)
        expect(rows[0].querySelector("td span")?.textContent).toBe("30")
        expect(rows[0].textContent).toContain("Search Target")
        await act(async () => {
          setValue.call(input, "")
          input.dispatchEvent(new Event("input", { bubbles: true }))
        })
        expect(container.querySelectorAll("tbody tr")).toHaveLength(25)
        expect(container.querySelector("tbody tr td span")?.textContent).toBe("1")
      } finally {
        await act(async () => root.unmount())
        container.remove()
        vi.unstubAllGlobals()
      }
    })
  }
})
