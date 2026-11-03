// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RegistrationForm } from "@/components/fantasy/registration-form"
import { ManagerHistory } from "@/components/fantasy/manager-history"
import { ManagerPanel } from "@/components/fantasy/manager-panel"
import { LineupFormPanel, SelectionSheet } from "@/components/fantasy/lineup-form"
import { PredictionsFormPanel } from "@/components/fantasy/predictions-form"
import type { LineupForm } from "@/lib/fantasy/lineups"
import type { SelectionOption } from "@/lib/fantasy/selection-options"
import { FantasyStandingsView } from "@/components/fantasy/standings"
import { WeekOverviewPanel } from "@/components/fantasy/week-overview"
import type { FantasyPageData } from "@/lib/fetch-fantasy"
import type { WeekOverview } from "@/lib/fantasy/week"

// PGlite can't start under jsdom, and these components never touch the database.
vi.mock("@/lib/db", () => ({ db: {}, schema: {}, rawSql: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/fantasy",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/components/team-logo", () => ({ TeamLogo: ({ name }: { name: string }) => <span role="img" aria-label={name} /> }))

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)

let container: HTMLDivElement
let root: Root

const render = (node: ReactNode) => act(async () => root.render(node))

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const overview: WeekOverview = {
  weekId: "2026-11-07",
  games: [
    {
      id: "g1",
      home: { slug: "seals", name: "Seals" },
      away: { slug: "yetis", name: "Yetis" },
      startLabel: "Sat 9:00a",
      result: { homeScore: 4, awayScore: 2 },
    },
    {
      id: "g2",
      home: { slug: "owls", name: "Owls" },
      away: { slug: "otters", name: "Otters" },
      startLabel: "Sat 10:00a",
      result: null,
    },
  ],
  byeTeams: [{ slug: "bears", name: "Bears" }],
}

describe("WeekOverviewPanel", () => {
  it("shows each game's day and time or result, and the Bye team, without the word Lock", async () => {
    await render(<WeekOverviewPanel overview={overview} />)

    const text = container.textContent ?? ""
    expect(text).toContain("Seals")
    expect(text).toContain("4 – 2")
    expect(text).toContain("Sat 10:00a")
    expect(text).toMatch(/Bye:\s*Bears/)
    expect(text).not.toMatch(/lock/i)
  })
})

const pageData: FantasyPageData = {
  contest: "regular",
  contests: ["regular"],
  nextLockAt: "2026-11-21T16:00:00.000Z",
  timeZone: "America/Los_Angeles",
  openWeekId: "2026-11-14",
  overviews: {
    "2026-11-07": overview,
    "2026-11-14": { weekId: "2026-11-14", games: [], byeTeams: [] },
  },
  weeks: [
    {
      id: "2026-11-07",
      provisional: false,
      rows: [
        {
          rank: 1,
          managerId: 7,
          teamName: "Puck Norris",
          points: 20,
          selections: [
            {
              playerId: 1,
              playerName: "Ada Lovelace",
              kind: "skater",
              isBackup: false,
              outcome: "played",
              points: 20,
              games: [
                {
                  gameId: "g1",
                  matchup: "Seals vs Yetis",
                  points: 20,
                  stats: [
                    { label: "G", value: 2 },
                    { label: "A", value: 0 },
                  ],
                },
              ],
            },
            {
              playerId: 2,
              playerName: "Grace Hopper",
              kind: "skater",
              isBackup: false,
              outcome: "absent",
              points: 0,
              games: [],
            },
          ],
        },
      ],
    },
    { id: "2026-11-14", provisional: true, rows: [] },
  ],
  season: { provisional: false, rows: [{ rank: 1, managerId: 7, teamName: "Puck Norris", points: 20 }] },
  pickem: {
    weeks: [
      {
        id: "2026-11-07",
        provisional: true,
        rows: [
          {
            rank: 1,
            managerId: 9,
            teamName: "Oracle",
            correct: 1,
            goalError: 3,
            predictions: [
              { gameId: "g1", homeScore: 5, awayScore: 1, outcome: "correct" },
              { gameId: "g2", homeScore: 2, awayScore: 1, outcome: "pending" },
            ],
          },
        ],
      },
    ],
    season: { provisional: true, rows: [{ rank: 1, managerId: 9, teamName: "Oracle", correct: 1, goalError: 3 }] },
  },
}

async function showSeason() {
  await act(async () => [...container.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Season")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false })))
}

describe("FantasyStandingsView", () => {
  it("shows the chosen Week's overview with Weekly standings, and Season standings behind a toggle", async () => {
    await render(<FantasyStandingsView data={pageData} view={{ tab: "fantasy", weekId: "2026-11-07" }} />)

    expect(container.querySelector('[aria-label="Week overview"]')?.textContent).toContain("Seals")
    expect(container.querySelector('[aria-label="Weekly standings"]')?.textContent).toContain("Puck Norris")
    expect(container.querySelector('[aria-label="Season standings"]')).toBeNull()

    await showSeason()
    expect(container.querySelector('[aria-label="Season standings"]')?.textContent).toContain("Puck Norris")
    expect(container.querySelector('[aria-label="Weekly standings"]')).toBeNull()
  })

  it("only shows the contest switcher when there is more than one, with the first as the plain /fantasy", async () => {
    await render(<FantasyStandingsView data={pageData} view={{ tab: "fantasy", weekId: "2026-11-07" }} />)
    expect(container.querySelector('[aria-label="Contests"]')).toBeNull()

    await render(
      <FantasyStandingsView
        data={{ ...pageData, contest: "playoffs", contests: ["regular", "playoffs"] }}
        view={{ tab: "fantasy", weekId: "2026-11-07", contest: "playoffs" }}
      />
    )
    const links = [...container.querySelectorAll('[aria-label="Contests"] a')]
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/fantasy", "/fantasy?contest=playoffs"])
    expect(links[1].getAttribute("aria-current")).toBe("page")
    expect([...container.querySelectorAll("a")].find((a) => a.textContent === "Join Fantasy")?.getAttribute("href")).toBe(
      "/fantasy/register?contest=playoffs"
    )
  })

  it("links the tabs and Weeks through the URL and marks the current ones", async () => {
    await render(<FantasyStandingsView data={pageData} view={{ tab: "fantasy", weekId: "2026-11-07" }} />)

    const link = (name: string) => [...container.querySelectorAll("a")].find((a) => a.textContent === name)
    expect(link("Pick'em")?.getAttribute("href")).toBe("/fantasy?tab=pickem&week=2026-11-07")
    expect(link("Fantasy")?.getAttribute("aria-current")).toBe("page")
    expect(link("Nov 14")?.getAttribute("href")).toBe("/fantasy?week=2026-11-14")
    expect(link("Nov 7")?.getAttribute("aria-current")).toBe("page")
  })

  it("links each Team Name to its Manager page by id", async () => {
    await render(<FantasyStandingsView data={pageData} view={{ tab: "fantasy", weekId: "2026-11-07" }} />)
    const hrefs = (label: string) =>
      [...container.querySelectorAll(`[aria-label="${label}"] a[href^="/fantasy/manager/"]`)].map((a) => a.getAttribute("href"))
    expect(hrefs("Weekly standings")).toEqual(["/fantasy/manager/7"])
    await showSeason()
    expect(hrefs("Season standings")).toEqual(["/fantasy/manager/7"])

    await act(async () => [...container.querySelectorAll("a")].find((a) => a.textContent === "Pick'em")!.click())
    expect(hrefs("Weekly standings")).toEqual(["/fantasy/manager/9"])
    await showSeason()
    expect(hrefs("Season standings")).toEqual(["/fantasy/manager/9"])
  })

  it("links each Selection to the Player's page, with their game stats inline", async () => {
    await render(<FantasyStandingsView data={pageData} view={{ tab: "fantasy", weekId: "2026-11-07" }} />)

    const link = container.querySelector('a[href="/player/ada-lovelace"]')
    expect(link?.textContent).toBe("Ada Lovelace")
    expect(container.querySelector('a[href="/player/grace-hopper"]')).not.toBeNull()
    expect(container.textContent).toContain("G 2  A 0")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("says why a Selection has no game stats", async () => {
    await render(<FantasyStandingsView data={pageData} view={{ tab: "fantasy", weekId: "2026-11-07" }} />)

    expect(container.textContent).toContain("Absent")
  })

  it("never says Lock, showing the day and time instead", async () => {
    await render(<FantasyStandingsView data={pageData} view={{ tab: "fantasy", weekId: "2026-11-07" }} />)

    expect(container.textContent).not.toMatch(/lock/i)
    expect(container.textContent).toMatch(/Sat, Nov 21, 8:00 AM/)
  })

  it("lists the open Week in the sheet with its games, but no standings until it closes", async () => {
    const data = {
      ...pageData,
      openWeekId: "2026-11-14",
      weeks: [pageData.weeks[0]],
    }
    await render(<FantasyStandingsView data={data} view={{ tab: "fantasy", weekId: "2026-11-14" }} />)

    const link = [...container.querySelectorAll("a")].find((a) => a.textContent === "Nov 14")
    expect(link?.getAttribute("aria-current")).toBe("page")
    expect(container.querySelector('[aria-label="Week overview"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Weekly standings"]')?.textContent).toMatch(/after .* closes/i)
  })

  it("switches tab and Week in place, rewriting the URL without navigating", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState")
    await render(<FantasyStandingsView data={pageData} view={{ tab: "fantasy", weekId: "2026-11-07" }} />)
    const link = (name: string) => [...container.querySelectorAll("a")].find((a) => a.textContent === name)!

    await act(async () => link("Pick'em").click())
    expect(link("Pick'em").getAttribute("aria-current")).toBe("page")
    expect(container.querySelector('[aria-label="Weekly standings"]')?.textContent).toContain("Oracle")
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/fantasy?tab=pickem&week=2026-11-07")

    await act(async () => link("Nov 14").click())
    expect(link("Nov 14").getAttribute("aria-current")).toBe("page")
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/fantasy?tab=pickem&week=2026-11-14")
    replaceState.mockRestore()
  })

  it("shows Pick'em standings apart from Fantasy, with each Manager's Predictions", async () => {
    await render(<FantasyStandingsView data={pageData} view={{ tab: "pickem", weekId: "2026-11-07" }} />)

    const weekly = container.querySelector('[aria-label="Weekly standings"]')!.textContent ?? ""
    expect(weekly).toContain("Oracle")
    expect(weekly).toContain("Seals vs Yetis")
    expect(weekly).toContain("5 – 1")
    expect(weekly).toContain("Correct winner")
    await showSeason()
    expect(container.querySelector('[aria-label="Season standings"]')?.textContent).toContain("Oracle")
    expect(container.textContent).not.toContain("Puck Norris")
  })

  it("says so when nobody predicted a Week or the Week hasn't closed", async () => {
    await render(<FantasyStandingsView data={pageData} view={{ tab: "pickem", weekId: "2026-11-14" }} />)

    expect(container.querySelector('[aria-label="Weekly standings"]')?.textContent).toContain("after this Week closes")
  })
})

describe("RegistrationForm", () => {
  it("asks for a real name, since it's the only way to reissue a lost link", async () => {
    await render(<RegistrationForm contest="regular" />)

    expect(container.textContent).toMatch(/real name/i)
    expect(container.textContent).toMatch(/only way .* reissue/i)
  })
})

describe("SelectionSheet", () => {
  const options = (): SelectionOption[] =>
    [
      { id: 1, name: "Ada Lovelace", teams: ["seals"], usesLeft: 2, pointsPerGame: 4.5 },
      { id: 2, name: "Bo Jackson", teams: ["yetis"], usesLeft: 0, pointsPerGame: 6 },
    ].map((p) => ({ isGoalie: false, onBye: false, ...p }))

  const body = () => document.body
  const type = (input: HTMLInputElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

  it("groups Players by game then team, with uses left and points per game", async () => {
    await render(
      <SelectionSheet open onOpenChange={() => {}} title="Skater 1" overview={overview} players={options()} onSelect={() => {}} />
    )

    expect(body().textContent).toContain("Seals vs Yetis · Sat 9:00a")
    const ada = [...body().querySelectorAll("button")].find((b) => b.textContent?.includes("Ada Lovelace"))!
    expect(ada.textContent).toContain("2 uses left")
    expect(ada.textContent).toContain("4.5 pts/g")
  })

  it("shows Players with no uses left but disables them", async () => {
    const onSelect = vi.fn()
    await render(
      <SelectionSheet open onOpenChange={() => {}} title="Skater 1" overview={overview} players={options()} onSelect={onSelect} />
    )

    const bo = [...body().querySelectorAll("button")].find((b) => b.textContent?.includes("Bo Jackson"))!
    expect(bo.disabled).toBe(true)
    expect(bo.textContent).toContain("0 uses left")
  })

  it("searches by name and reports the chosen Player", async () => {
    const onSelect = vi.fn()
    await render(
      <SelectionSheet open onOpenChange={() => {}} title="Skater 1" overview={overview} players={options()} onSelect={onSelect} />
    )

    await type(body().querySelector<HTMLInputElement>('input[type="search"]')!, "love")
    expect(body().textContent).not.toContain("Bo Jackson")
    await act(async () => {
      ;[...body().querySelectorAll("button")].find((b) => b.textContent?.includes("Ada Lovelace"))!.click()
    })

    expect(onSelect).toHaveBeenCalledWith(1)
  })
})

function formFixture(): LineupForm {
  return {
    teamName: "Puck Norris",
    overview,
    week: { id: "2026-11-07", lockAt: "2026-11-07T16:00:00.000Z", timeZone: "America/Los_Angeles" },
    noGames: false,
    slots: { skaters: 2, goalies: 1, skaterBackups: 1, goalieBackups: 0 },
    players: [
      { id: 1, name: "Ada Lovelace", team: "Seals", teams: ["seals"], isGoalie: false, onBye: false, skaterUsesLeft: 2, goalieUsesLeft: null, pointsPerGame: 4.5 },
      { id: 2, name: "Bo Jackson", team: "Yetis", teams: ["yetis"], isGoalie: false, onBye: false, skaterUsesLeft: 0, goalieUsesLeft: null, pointsPerGame: 6 },
      { id: 3, name: "Cy Clark", team: "Yetis", teams: ["yetis"], isGoalie: false, onBye: false, skaterUsesLeft: 1, goalieUsesLeft: null, pointsPerGame: 3 },
      { id: 7, name: "Gus Goalie", team: "Seals", teams: ["seals"], isGoalie: true, onBye: false, skaterUsesLeft: null, goalieUsesLeft: 3, pointsPerGame: 8 },
    ],
    defaultGoalieIds: [7],
    goalieSlotOptional: false,
    lineup: { skaters: [1], goalies: [7], skaterBackups: [], goalieBackups: [] },
    history: { points: 0, weeks: [] },
    predictions: [],
    pickemHistory: { correct: 0, goalError: 0, weeks: [] },
  }
}

describe("LineupFormPanel", () => {
  const form = formFixture()
  const button = (name: string) =>
    [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.includes(name) || b.getAttribute("aria-label")?.includes(name)
    )!

  it("shows the saved Lineup in its slots and the closing day and time, not the word Lock", async () => {
    await render(<LineupFormPanel form={form} token="t" />)

    expect(button("Ada Lovelace")).toBeDefined()
    expect(button("Gus Goalie")).toBeDefined()
    expect(container.textContent).toContain("Saturday, Nov 7, 8:00 AM")
    expect(container.textContent).not.toMatch(/lock/i)
  })

  it("fills a slot from the sheet, listing a Player with no uses left as disabled", async () => {
    await render(<LineupFormPanel form={form} token="t" />)

    await act(async () => button("Skater 2").click())
    expect(button("Bo Jackson").disabled).toBe(true)
    await act(async () => button("Cy Clark").click())

    expect(container.textContent).toContain("Cy Clark")
    expect(document.body.textContent).not.toContain("Seals vs Yetis")
  })
})

describe("ManagerPanel", () => {
  const form = formFixture()
  const tab = (name: string) => [...container.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name)!
  const activate = (el: Element) =>
    act(async () => {
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false }))
    })

  it("shows the Week overview above Lineup, Predictions and History tabs", async () => {
    await render(<ManagerPanel form={form} token="t" />)

    expect(container.querySelector('[aria-label="Week overview"]')?.textContent).toContain("Seals")
    expect([...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual([
      "Lineup",
      "Predictions",
      "History",
    ])
    expect(tab("Lineup").getAttribute("aria-selected")).toBe("true")
    expect(container.textContent).toContain("Skater 2")
  })

  it("switches to the History tab", async () => {
    await render(<ManagerPanel form={form} token="t" />)

    await activate(tab("History"))

    expect(container.textContent).toContain("Previous Weeks")
  })
})

describe("PredictionsFormPanel", () => {
  const week = { id: "2026-11-07", lockAt: "2026-11-07T16:00:00.000Z", timeZone: "America/Los_Angeles" }
  const box = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label^="${label}"]`)!
  const setValue = (input: HTMLInputElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  const submit = () => act(async () => container.querySelector("form")!.requestSubmit())
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("lists every game with two score boxes, filled from saved Predictions", async () => {
    await render(
      <PredictionsFormPanel overview={overview} saved={[{ gameId: "g1", homeScore: 4, awayScore: 1 }]} week={week} token="t" />
    )

    expect(container.querySelectorAll("input")).toHaveLength(4)
    expect(box("Seals score").value).toBe("4")
    expect(box("Yetis score").value).toBe("1")
    expect(box("Owls score").value).toBe("")
    expect(container.textContent).toContain("Saturday, Nov 7, 8:00 AM")
    expect(container.textContent).not.toMatch(/lock/i)
  })

  it("leads with picking the winner, shows who the scores pick, and calls scores a tiebreaker", async () => {
    await render(<PredictionsFormPanel overview={overview} saved={[]} week={week} token="t" />)
    expect(container.textContent).toContain("Pick the winner of each game")
    expect(container.textContent).toContain("only break ties")
    expect(container.textContent).toContain("No pick yet")

    await setValue(box("Seals score"), "2")
    await setValue(box("Yetis score"), "5")

    expect(container.textContent).toContain("Your pick: Yetis wins")
  })

  it("refuses ties, half a game and out-of-range scores before sending", async () => {
    await render(<PredictionsFormPanel overview={overview} saved={[]} week={week} token="t" />)

    await setValue(box("Seals score"), "3")
    await setValue(box("Yetis score"), "3")
    await submit()
    expect(container.textContent).toContain("can't end tied")

    await setValue(box("Yetis score"), "")
    await submit()
    expect(container.textContent).toContain("enter both scores")

    await setValue(box("Yetis score"), "31")
    await submit()
    expect(container.textContent).toContain("0 to 30")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends only the games with scores, as one save for the Week", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ saved: true }), { status: 200 }))
    await render(<PredictionsFormPanel overview={overview} saved={[]} week={week} token="secret" />)

    await setValue(box("Seals score"), "4")
    await setValue(box("Yetis score"), "2")
    await submit()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain("/api/bash/fantasy/predictions")
    expect(JSON.parse(init.body)).toEqual({ weekId: "2026-11-07", predictions: [{ gameId: "g1", homeScore: 4, awayScore: 2 }] })
    expect(init.headers.Authorization).toBe("Bearer secret")
    expect(container.textContent).toContain("Saved")
  })
})

describe("ManagerHistory", () => {
  it("lists the Manager's locked Weeks of Predictions with each game's outcome", async () => {
    const pickem = {
      correct: 1,
      goalError: 3,
      weeks: [
        {
          id: "2026-11-07",
          provisional: false,
          correct: 1,
          goalError: 3,
          predictions: [{ gameId: "g1", homeScore: 5, awayScore: 1, outcome: "correct" as const }],
          games: overview.games,
        },
      ],
    }
    await render(<ManagerHistory history={{ points: 0, weeks: [] }} pickem={pickem} />)

    const text = container.textContent ?? ""
    expect(text).toContain("Pick'em")
    expect(text).toContain("1 correct, 3 goals off")
    expect(text).toContain("Seals vs Yetis")
    expect(text).toContain("Correct winner")
  })

  it("never says Lock in its empty state", async () => {
    await render(<ManagerHistory history={{ points: 0, weeks: [] }} pickem={{ correct: 0, goalError: 0, weeks: [] }} />)

    expect(container.textContent).not.toMatch(/lock/i)
  })
})
