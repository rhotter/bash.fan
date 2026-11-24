// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { BashApiData, BashGame } from "@/lib/hockey-data"

const mockSearchParams = new URLSearchParams("season=2026-fall")

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...props }: { href: string; children: ReactNode; prefetch?: unknown; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

import { ScheduleContent } from "@/components/schedule-content"
import { ScoresTab } from "@/components/scores-tab"

function makeGame(overrides: Partial<BashGame> = {}): BashGame {
  return {
    id: "g1",
    date: "2026-10-10",
    time: "9:00am",
    homeTeam: "No ReGretzkys",
    homeSlug: "no-regretzkys",
    awayTeam: "Seals",
    awaySlug: "seals",
    homeScore: 4,
    awayScore: 3,
    status: "final",
    isOvertime: false,
    isPlayoff: false,
    isForfeit: false,
    location: "The Lick",
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
    title: null,
    ...overrides,
  }
}

const SAMPLE_GAMES: BashGame[] = [
  makeGame({
    id: "g-tryout",
    date: "2026-09-06",
    time: "10:00am",
    gameType: "tryout",
    title: "Tryout Scrimmage",
    awayTeam: "Blue",
    awaySlug: "blue",
    homeTeam: "Gold",
    homeSlug: "gold",
    awayScore: 3,
    homeScore: 2,
    status: "final",
  }),
  makeGame({
    id: "g-so",
    date: "2026-10-10",
    time: "9:00am",
    awayTeam: "Seals",
    awaySlug: "seals",
    homeTeam: "No ReGretzkys",
    homeSlug: "no-regretzkys",
    awayScore: 3,
    homeScore: 4,
    status: "final",
    isOvertime: true,
    hasShootout: true,
  }),
  makeGame({
    id: "g-ot",
    date: "2026-10-17",
    time: "11:00am",
    awayTeam: "Landsharks",
    awaySlug: "landsharks",
    homeTeam: "No ReGretzkys",
    homeSlug: "no-regretzkys",
    awayScore: 2,
    homeScore: 3,
    status: "final",
    isOvertime: true,
    hasShootout: false,
  }),
  makeGame({
    id: "g-forfeit",
    date: "2026-10-24",
    time: "1:00pm",
    awayTeam: "Reign",
    awaySlug: "reign",
    homeTeam: "Loons",
    homeSlug: "loons",
    awayScore: 0,
    homeScore: 1,
    status: "final",
    isForfeit: true,
  }),
  makeGame({
    id: "g-upcoming",
    date: "2026-12-05",
    time: "1:00pm",
    awayTeam: "No ReGretzkys",
    awaySlug: "no-regretzkys",
    homeTeam: "Seals",
    homeSlug: "seals",
    awayScore: null,
    homeScore: null,
    status: "upcoming",
  }),
  makeGame({
    id: "g-playoff-tbd",
    date: "2027-01-10",
    time: "11:00am",
    gameType: "playoff",
    isPlayoff: true,
    title: "BASH Cup Final",
    awayTeam: "TBD",
    awaySlug: null as unknown as string,
    awayPlaceholder: "Winner SF-A",
    homeTeam: "TBD",
    homeSlug: "tbd",
    homePlaceholder: "Winner SF-B",
    awayScore: null,
    homeScore: null,
    status: "upcoming",
  }),
]

const SAMPLE_DATA: BashApiData = {
  games: SAMPLE_GAMES,
  standings: [],
  lastUpdated: "2026-11-23T00:00:00Z",
}

describe("ScheduleContent & ScoresTab Full Schedule link", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    Element.prototype.scrollIntoView = vi.fn()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("renders all game types, Final/SO vs Final/OT vs Final/Forfeit labels, TBD/null slugs, Next up, and no ADD TO CAL", async () => {
    await act(async () => {
      root.render(<ScheduleContent initialData={SAMPLE_DATA} />)
    })

    const text = container.textContent ?? ""
    expect(text).toContain("Season Schedule")
    expect(text).toContain("Tryout Scrimmage")
    expect(text).toContain("BASH Cup Final")
    expect(text).toContain("Winner SF-A")
    expect(text).toContain("Winner SF-B")
    expect(text).toContain("Final/SO")
    expect(text).toContain("Final/OT")
    expect(text).toContain("Final/Forfeit")
    expect(text).toContain("Next up")
    expect(text).toContain("Next game")
    expect(text).not.toContain("ADD TO CAL")

    // Scores back link preserves ?season=
    const scoresLink = container.querySelector('a[href="/?season=2026-fall"]')
    expect(scoresLink).toBeTruthy()
    expect(scoresLink?.textContent).toContain("Scores")
  })

  it("filters by team and game type", async () => {
    await act(async () => {
      root.render(<ScheduleContent initialData={SAMPLE_DATA} />)
    })

    const teamSelect = container.querySelector('select[aria-label="Filter by team"]') as HTMLSelectElement
    expect(teamSelect).toBeTruthy()
    await act(async () => {
      teamSelect.value = "reign"
      teamSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(container.textContent).toContain("Reign")
    expect(container.textContent).toContain("Loons")
    expect(container.textContent).not.toContain("Tryout Scrimmage")

    // Reset team filter and filter by Playoff game type
    await act(async () => {
      teamSelect.value = "all"
      teamSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const typeSelect = container.querySelector('select[aria-label="Filter by game type"]') as HTMLSelectElement
    expect(typeSelect).toBeTruthy()
    await act(async () => {
      typeSelect.value = "playoff"
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(container.textContent).toContain("BASH Cup Final")
    expect(container.textContent).not.toContain("Tryout Scrimmage")
  })

  it("renders Full schedule link opposite the first date on ScoresTab with season preserved", async () => {
    await act(async () => {
      root.render(<ScoresTab games={SAMPLE_GAMES} isLoading={false} season="2026-fall" />)
    })

    const fullScheduleLink = container.querySelector('a[href="/schedule?season=2026-fall"]')
    expect(fullScheduleLink).toBeTruthy()
    expect(fullScheduleLink?.textContent).toContain("Full schedule")
  })
})
