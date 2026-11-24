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

  it("renders PlayoffBracket automatically only when All Teams + Playoff is selected and bracket metadata exists", async () => {
    const bracketGames: BashGame[] = [
      makeGame({
        id: "sf-1",
        date: "2027-01-03",
        time: "9:00am",
        gameType: "playoff",
        isPlayoff: true,
        bracketRound: "semifinal",
        seriesId: "sf-a",
        seriesGameNumber: 1,
        awayTeam: "Seals",
        awaySlug: "seals",
        homeTeam: "No ReGretzkys",
        homeSlug: "no-regretzkys",
        awayScore: 2,
        homeScore: 4,
        status: "final",
      }),
      makeGame({
        id: "sf-2",
        date: "2027-01-04",
        time: "9:00am",
        gameType: "playoff",
        isPlayoff: true,
        bracketRound: "semifinal",
        seriesId: "sf-a",
        seriesGameNumber: 2,
        awayTeam: "No ReGretzkys",
        awaySlug: "no-regretzkys",
        homeTeam: "Seals",
        homeSlug: "seals",
        awayScore: 5,
        homeScore: 1,
        status: "final",
      }),
      makeGame({
        id: "sf-3",
        date: "2027-01-05",
        time: "9:00am",
        gameType: "playoff",
        isPlayoff: true,
        bracketRound: "semifinal",
        seriesId: "sf-a",
        seriesGameNumber: 3,
        awayTeam: "Seals",
        awaySlug: "seals",
        homeTeam: "No ReGretzkys",
        homeSlug: "no-regretzkys",
        awayScore: null,
        homeScore: null,
        status: "upcoming",
      }),
      ...SAMPLE_GAMES.map((g) =>
        g.id === "g-playoff-tbd" ? { ...g, bracketRound: "final", seriesId: "final", seriesGameNumber: 1 } : g,
      ),
    ]

    await act(async () => {
      root.render(<ScheduleContent initialData={{ ...SAMPLE_DATA, games: bracketGames }} />)
    })

    // Not shown while Game Type = All
    expect(container.querySelector('section[aria-label="Playoff Bracket"]')).toBeNull()

    const typeSelect = container.querySelector('select[aria-label="Filter by game type"]') as HTMLSelectElement
    await act(async () => {
      typeSelect.value = "playoff"
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const bracket = container.querySelector('section[aria-label="Playoff Bracket"]')
    expect(bracket).toBeTruthy()
    expect(bracket?.textContent).toContain("Semifinals")
    expect(bracket?.textContent).toContain("Finals")
    expect(bracket?.textContent).toContain("SER")
    // Played games show inline scores on team rows and have no date chips; unplayed G3 keeps its date chip
    expect(bracket?.textContent).not.toContain("G1: Jan 3")
    expect(bracket?.textContent).not.toContain("G2: Jan 4")
    expect(bracket?.textContent).toContain("G3: Jan 5")
    expect(bracket?.querySelector('a[href="/game/sf-1"]')?.textContent).toContain("G1")
    expect(bracket?.querySelector('a[href="/game/sf-2"]')?.textContent).toContain("G2")

    // Selecting a specific team hides the bracket
    const teamSelect = container.querySelector('select[aria-label="Filter by team"]') as HTMLSelectElement
    await act(async () => {
      teamSelect.value = "seals"
      teamSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(container.querySelector('section[aria-label="Playoff Bracket"]')).toBeNull()
  })
})
