// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { PlayerSearchDialog } from "@/components/player-search-dialog"
import { TeamPageContent } from "@/components/team-page-content"
import type { TeamDetail } from "@/lib/fetch-team-detail"

const prefetch = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch }) }))
vi.mock("@/components/ui/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("@/components/team-logo", () => ({ TeamLogo: () => null }))
vi.mock("swr", () => ({ default: () => ({ data: { players: [
  { slug: "alex-muhn", name: "Alex Muhn", team: "Seals" },
  { slug: "joseph-guillemette", name: "Joseph Guillemette", team: "Yetis" },
] } }) }))

async function withUI(element: React.ReactNode, check: (container: HTMLDivElement) => Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() })
  prefetch.mockClear()
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(element))
    await check(container)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll)
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
    vi.unstubAllGlobals()
  }
}

describe("Remaining public navigation", () => {
  it("preloads the keyboard-highlighted search result before Enter selects it", async () => {
    const select = vi.fn()
    await withUI(<PlayerSearchDialog open onOpenChange={() => {}} onSelect={select} />, async () => {
      const input = document.querySelector<HTMLInputElement>('[placeholder="Search players..."]')!
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })))
      expect(prefetch).toHaveBeenCalledWith("/player/joseph-guillemette", { kind: "full" })
      expect(select).not.toHaveBeenCalled()
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
      expect(select).toHaveBeenCalledWith("joseph-guillemette")
    })
  })

  it("preloads search results on mouse and touch without selecting them", async () => {
    const select = vi.fn()
    await withUI(<PlayerSearchDialog open onOpenChange={() => {}} onSelect={select} />, async () => {
      const item = Array.from(document.querySelectorAll('[cmdk-item]')).find((el) => el.textContent?.includes("Joseph"))!
      prefetch.mockClear()
      await act(async () => item.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })))
      expect(prefetch).toHaveBeenCalledWith("/player/joseph-guillemette", { kind: "full" })
      prefetch.mockClear()
      await act(async () => item.dispatchEvent(new Event("touchstart", { bubbles: true })))
      expect(prefetch).toHaveBeenCalledWith("/player/joseph-guillemette", { kind: "full" })
      expect(select).not.toHaveBeenCalled()
    })
  })

  it("still searches by player name and preloads the matching result", async () => {
    await withUI(<PlayerSearchDialog open onOpenChange={() => {}} onSelect={() => {}} />, async () => {
      const input = document.querySelector<HTMLInputElement>('[placeholder="Search players..."]')!
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      await act(async () => {
        setValue.call(input, "Joseph Guillemette")
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })
      expect(document.querySelectorAll('[cmdk-item]')).toHaveLength(1)
      expect(document.querySelector('[cmdk-item]')?.textContent).toContain("Joseph Guillemette")
      expect(prefetch).toHaveBeenCalledWith("/player/joseph-guillemette", { kind: "full" })
    })
  })

  it("makes the entire game row a preloadable link with a separate opponent link", async () => {
    const team: TeamDetail = {
      slug: "seals", name: "Seals", seasonName: "Fall 2026–27", seasonLocation: null,
      record: { gp: 1, w: 1, otw: 0, l: 0, otl: 0, pts: 3, gf: 2, ga: 1, rank: 1, totalTeams: 2 },
      skaters: [], goalies: [], games: [{ id: "g129", date: "2026-10-01", time: "20:00", opponent: "Yetis", opponentSlug: "yetis",
        isHome: true, teamScore: 2, opponentScore: 1, status: "final", isOvertime: false, result: "W", location: null }],
    }
    await withUI(<TeamPageContent team={team} />, async (container) => {
      const game = container.querySelector<HTMLAnchorElement>('a[href="/game/g129"]')!
      const opponent = container.querySelector<HTMLAnchorElement>('a[href="/team/yetis"]')!
      expect(game.getAttribute("aria-label")).toContain("game against Yetis")
      expect(game.className).toContain("absolute inset-0")
      expect(game.contains(opponent)).toBe(false)
      expect(opponent.className).toContain("z-10")
      await act(async () => game.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })))
      expect(prefetch).toHaveBeenCalledWith("/game/g129", { kind: "full" })
    })
  })
})
