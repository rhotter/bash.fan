// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DraftPlayerBadge, DraftTradeBadge } from "@/components/draft-player-badge"
import { PublicDraftBoard } from "@/components/public-draft-board"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

const badgeKinds = ["rookie", "captain", "keeper"] as const
const badgeLabels = { rookie: "Rookie", captain: "Captain", keeper: "Keeper" }

let container: HTMLDivElement
let root: Root

async function flush(action: () => void) {
  await act(async () => {
    action()
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

async function render(children: ReactNode) {
  await flush(() => root.render(children))
}

function badge(label: string) {
  const element = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-slot="tooltip-trigger"]'))
    .find((button) => button.textContent?.endsWith(label))
  if (!element) throw new Error(`Missing badge: ${label}`)
  return element
}

function tooltip() {
  return document.querySelector('[data-slot="tooltip-content"]:not([data-state="closed"])')
}

async function tap(element: HTMLElement, pointerType = "touch") {
  await flush(() => {
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType })
    element.dispatchEvent(down)
    if (!down.defaultPrevented) element.focus()
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType }))
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  // jsdom does not yet expose PointerEvent; preserve the event type Radix uses
  // to distinguish touch scrolling from mouse hover.
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    readonly pointerType: string
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerType = init.pointerType ?? "mouse"
    }
  })
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })))
  const storage: Record<string, string> = {}
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { storage[key] = String(val) }),
    removeItem: vi.fn((key: string) => { delete storage[key] }),
    clear: vi.fn(() => { Object.keys(storage).forEach((k) => delete storage[k]) }),
    length: 0,
    key: vi.fn(),
  })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await flush(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("Draft player badge explanations", () => {
  it.each(badgeKinds)("toggles the %s explanation on repeated taps without clicking the parent", async (kind) => {
    const parentClick = vi.fn()
    const label = badgeLabels[kind]
    await render(<div onClick={parentClick}><DraftPlayerBadge kind={kind} /></div>)
    const trigger = badge(label)
    expect(trigger.tagName).toBe("BUTTON")
    expect(trigger.className).toContain("text-foreground")
    expect(trigger.className).toContain("focus-visible:ring-foreground")
    expect(trigger.className).not.toContain("text-primary")
    expect(trigger.className).toContain("cursor-pointer")
    expect(trigger.className).not.toContain("cursor-help")
    expect(trigger.className).toContain("max-sm:min-w-6")
    expect(trigger.querySelector('[aria-hidden="true"]')?.className).toContain("max-sm:h-3")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    for (let i = 0; i < 3; i++) {
      await tap(trigger)
      expect(tooltip()?.textContent).toContain(label)
      if (kind === "rookie") expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Rookie")
      expect(trigger.getAttribute("aria-expanded")).toBe("true")
      expect(document.getElementById(trigger.getAttribute("aria-describedby")!)?.textContent).toContain(label)
      await tap(trigger)
      expect(tooltip()).toBeNull()
      expect(trigger.getAttribute("aria-expanded")).toBe("false")
    }
    expect(parentClick).not.toHaveBeenCalled()
  })

  it.each(badgeKinds)("dismisses %s on an outside tap and allows reopening", async (kind) => {
    const label = badgeLabels[kind]
    await render(<><DraftPlayerBadge kind={kind} /><button>Outside</button></>)
    await tap(badge(label))
    await tap(container.querySelectorAll("button")[1])
    expect(tooltip()).toBeNull()
    await tap(badge(label))
    expect(tooltip()).not.toBeNull()
  })

  it.each(badgeKinds)("dismisses %s on scrolling its container", async (kind) => {
    const label = badgeLabels[kind]
    await render(<DraftPlayerBadge kind={kind} />)
    await tap(badge(label))
    await flush(() => container.dispatchEvent(new Event("scroll")))
    expect(tooltip()).toBeNull()
  })

  it("shows only the latest badge when switching between explanations", async () => {
    await render(<><DraftPlayerBadge kind="rookie" /><DraftPlayerBadge kind="captain" /><DraftPlayerBadge kind="keeper" /></>)
    await tap(badge("Rookie"))
    await tap(badge("Captain"))
    expect(badge("Rookie").getAttribute("aria-expanded")).toBe("false")
    expect(badge("Captain").getAttribute("aria-expanded")).toBe("true")
    await tap(badge("Keeper"))
    expect(badge("Captain").getAttribute("aria-expanded")).toBe("false")
    expect(badge("Keeper").getAttribute("aria-expanded")).toBe("true")
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
  })

  it.each(badgeKinds)("preserves %s mouse hover and keyboard focus explanations", async (kind) => {
    const label = badgeLabels[kind]
    await render(<><DraftPlayerBadge kind={kind} /><button>Outside</button></>)
    const trigger = badge(label)
    await flush(() => trigger.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" })))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(label)
    await flush(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(tooltip()).toBeNull()
    await flush(() => trigger.focus())
    expect(tooltip()).not.toBeNull()
    await flush(() => container.querySelectorAll("button")[1].focus())
    expect(tooltip()).toBeNull()
  })

  it.each(badgeKinds)("ignores %s touch movement until a click, so scrolling does not open it", async (kind) => {
    await render(<DraftPlayerBadge kind={kind} />)
    await flush(() => badge(badgeLabels[kind]).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "touch" })))
    expect(tooltip()).toBeNull()
  })

  it("dismisses the explanation with Escape without closing its player dialog", async () => {
    const onOpenChange = vi.fn()
    await render(<Dialog open onOpenChange={onOpenChange}><DialogContent><DialogTitle>Player <DraftPlayerBadge kind="rookie" /></DialogTitle><DialogDescription>Player details</DialogDescription></DialogContent></Dialog>)
    // The dialog can initially focus the badge; close that explanation first.
    await flush(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    await tap(badge("Rookie"))
    expect(tooltip()).not.toBeNull()
    await flush(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(tooltip()).toBeNull()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it.each(
    (["team", "completed board", "live board"] as const).flatMap((layout) =>
      badgeKinds.map((kind) => ({ layout, kind }))
    )
  )("keeps $kind and player actions separate in the $layout layout", async ({ layout, kind }) => {
    const label = badgeLabels[kind]
    await render(<PublicDraftBoard seasonSlug="badge-test" initialData={{
      draft: { id: "test", name: "Test", status: layout === "live board" ? "live" : "completed", rounds: 1, draftDate: null, location: null, timerSeconds: 60, timerCountdown: null, timerRunning: false, timerStartedAt: null, updatedAt: null },
      season: { id: "test", name: "Test", slug: "badge-test" },
      teams: [{ teamSlug: "test", teamName: "Test team", position: 1, color: null }],
      picks: [{ id: "test", round: 1, pickNumber: 1, teamSlug: "test", originalTeamSlug: "test", playerId: 1, playerName: "Sample Player", isKeeper: kind !== "rookie", pickedAt: null }],
      pool: [{ playerId: 1, playerName: "Sample Player", registrationMeta: { isRookie: kind === "rookie", positions: "Forward" } }],
      trades: [],
      captainPlayerIds: kind === "captain" ? [1] : [],
    }} />)
    if (layout === "completed board") {
      const fullBoard = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
        .find((button) => button.textContent?.includes("Full Board"))!
      await tap(fullBoard)
    }
    expect(document.querySelector("button button")).toBeNull()
    const trigger = badge(label)
    expect(trigger.className).toContain("pointer-events-auto")
    const badgeGroup = trigger.closest('[data-slot="draft-player-badges"]')!
    expect(badgeGroup.className).toContain("absolute")
    expect(badgeGroup.className).toContain("top-0")
    expect(badgeGroup.className).toContain("sm:static")
    const playerRow = layout === "team"
      ? container.querySelector('button[aria-label="View Sample Player"]')!.parentElement!
      : trigger.closest("td")!
    expect(playerRow.className).toContain("max-sm:pt-6")
    await flush(() => trigger.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" })))
    expect(tooltip()?.textContent).toContain(label)
    // The explanation is portalled beyond the board's horizontal scroll container.
    expect(container.contains(tooltip())).toBe(false)
    await flush(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(tooltip()).toBeNull()
    await tap(trigger)
    expect(tooltip()).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await tap(tooltip() as HTMLElement)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    const playerButton = layout === "team"
      ? container.querySelector<HTMLButtonElement>('button[aria-label="View Sample Player"]')!
      : container.querySelector<HTMLButtonElement>('button[title="Sample Player"]')!
    await tap(playerButton)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
})


describe("Traded draft picks and consistent player names", () => {
  it("explains the original team with hover, tap, and keyboard focus", async () => {
    const parentClick = vi.fn()
    await render(<div onClick={parentClick}><DraftTradeBadge originalTeamName="Original Team Name" /><button>Outside</button></div>)
    const trigger = badge("Traded pick")
    expect(trigger.querySelector('[aria-hidden="true"]')?.textContent).toBe("Traded pick")
    expect(trigger.className).toContain("cursor-pointer")
    await flush(() => trigger.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" })))
    expect(tooltip()?.textContent).toContain("Pick acquired from Original Team Name.")
    await flush(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    await flush(() => trigger.focus())
    expect(tooltip()).not.toBeNull()
    await flush(() => container.querySelectorAll("button")[1].focus())
    expect(tooltip()).toBeNull()
    for (let i = 0; i < 2; i++) {
      await tap(trigger)
      expect(tooltip()).not.toBeNull()
      await tap(tooltip() as HTMLElement)
      expect(parentClick).not.toHaveBeenCalled()
      await tap(trigger)
      expect(tooltip()).toBeNull()
    }
    await tap(trigger)
    await tap(container.querySelectorAll("button")[1])
    expect(tooltip()).toBeNull()
    await tap(trigger)
    await flush(() => container.dispatchEvent(new Event("scroll")))
    expect(tooltip()).toBeNull()
  })

  it.each([
    { layout: "team", filled: true },
    { layout: "completed board", filled: true },
    { layout: "completed board", filled: false },
    { layout: "live board", filled: true },
    { layout: "live board", filled: false },
  ])("labels a traded pick in the $layout layout (filled: $filled)", async ({ layout, filled }) => {
    await render(<PublicDraftBoard seasonSlug={`trade-${layout}-${filled}`} initialData={{
      draft: { id: "test", name: "Test", status: layout === "live board" ? "live" : "completed", rounds: 1, draftDate: null, location: null, timerSeconds: 60, timerCountdown: null, timerRunning: false, timerStartedAt: null, updatedAt: null },
      season: { id: "test", name: "Test", slug: "trade-test" },
      teams: [
        { teamSlug: "original-team", teamName: "Original Team Name", position: 1, color: null },
        { teamSlug: "current-team", teamName: "Current Team Name", position: 2, color: null },
      ],
      picks: [{ id: "test", round: 1, pickNumber: 1, teamSlug: "current-team", originalTeamSlug: "original-team", playerId: filled ? 1 : null, playerName: filled ? "Sample Player" : null, isKeeper: false, pickedAt: null }],
      pool: [],
      trades: [],
    }} />)
    if (layout === "completed board") {
      await tap(Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find((button) => button.textContent?.includes("Full Board"))!)
    }
    expect(container.textContent).not.toContain("↔")
    expect(document.querySelector("button button")).toBeNull()
    const trigger = badge("Traded pick")
    await tap(trigger)
    expect(tooltip()?.textContent).toContain("Pick acquired from Original Team Name.")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await tap(tooltip() as HTMLElement)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it.each(
    ["team", "completed board", "live board"].flatMap((layout) =>
      ["Sam Smith", "Christopher Smith"].map((name) => ({ layout, name }))
    )
  )("formats $name consistently for captains, keepers, and other players in $layout", async ({ layout, name }) => {
    await render(<PublicDraftBoard seasonSlug={`names-${layout}-${name}`} initialData={{
      draft: { id: "test", name: "Test", status: layout === "live board" ? "live" : "completed", rounds: 3, draftDate: null, location: null, timerSeconds: 60, timerCountdown: null, timerRunning: false, timerStartedAt: null, updatedAt: null },
      season: { id: "test", name: "Test", slug: "name-test" },
      teams: [{ teamSlug: "test", teamName: "Test team", position: 1, color: null }],
      picks: [1, 2, 3].map((id) => ({ id: String(id), round: id, pickNumber: id, teamSlug: "test", originalTeamSlug: "test", playerId: id, playerName: name, isKeeper: id < 3, pickedAt: null })),
      pool: [],
      trades: [],
      captainPlayerIds: [1],
    }} />)
    if (layout === "completed board") {
      await tap(Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find((button) => button.textContent?.includes("Full Board"))!)
    }
    if (layout === "team") {
      const playerButtons = container.querySelectorAll(`button[aria-label="View ${name}"]`)
      expect(playerButtons).toHaveLength(3)
      playerButtons.forEach((button) => expect(button.parentElement?.textContent).toContain(name))
    } else {
      const playerButtons = container.querySelectorAll(`button[title="${name}"]`)
      expect(playerButtons).toHaveLength(3)
      playerButtons.forEach((button) => expect(button.textContent).toBe(name.length <= 13 ? name : "C. Smith"))
    }
  })
})


describe("Playoff availability styling", () => {
  it.each(["Yes", "No", "Maybe", ""])("keeps %s availability neutral", async (playoffAvail) => {
    await render(<PublicDraftBoard seasonSlug={`po-${playoffAvail}`} initialData={{
      draft: { id: "test", name: "Test", status: "completed", rounds: 1, draftDate: null, location: null, timerSeconds: 60, timerCountdown: null, timerRunning: false, timerStartedAt: null, updatedAt: null },
      season: { id: "test", name: "Test", slug: "po-test" },
      teams: [{ teamSlug: "test", teamName: "Test team", position: 1, color: null }],
      picks: [{ id: "test", round: 1, pickNumber: 1, teamSlug: "test", originalTeamSlug: "test", playerId: 1, playerName: "Sample Player", isKeeper: false, pickedAt: null }],
      pool: [{ playerId: 1, playerName: "Sample Player", registrationMeta: { playoffAvail } }],
      trades: [],
    }} />)
    const status = Array.from(container.querySelectorAll('span[title]')).find((span) =>
      span.getAttribute("title") === playoffAvail && span.className.includes("text-center")
    )!
    expect(status).toBeDefined()
    expect(status.textContent).toBe(playoffAvail === "Yes" ? "Y" : playoffAvail === "No" ? "N" : "?")
    expect(status.className).toContain("text-foreground")
    expect(status.className).not.toMatch(/text-(green|red)-/)
  })
})


describe("Mobile status badge placement", () => {
  it.each(
    ["team", "completed board", "live board"].flatMap((layout) =>
      ["captain", "keeper"].map((kind) => ({ layout, kind }))
    )
  )("reserves the corner for multiple $kind/rookie badges in $layout", async ({ layout, kind }) => {
    const name = "Alexandria Montgomery-Smith"
    await render(<PublicDraftBoard seasonSlug={`mobile-${layout}-${kind}`} initialData={{
      draft: { id: "test", name: "Test", status: layout === "live board" ? "live" : "completed", rounds: 1, draftDate: null, location: null, timerSeconds: 60, timerCountdown: null, timerRunning: false, timerStartedAt: null, updatedAt: null },
      season: { id: "test", name: "Test", slug: "mobile-test" },
      teams: [
        { teamSlug: "original", teamName: "Original Team", position: 1, color: null },
        { teamSlug: "current", teamName: "Current Team", position: 2, color: null },
      ],
      picks: [{ id: "test", round: 1, pickNumber: 1, teamSlug: "current", originalTeamSlug: "original", playerId: 1, playerName: name, isKeeper: true, pickedAt: null }],
      pool: [{ playerId: 1, playerName: name, registrationMeta: { isRookie: true, positions: "Goalie" } }],
      trades: [],
      captainPlayerIds: kind === "captain" ? [1] : [],
    }} />)
    if (layout === "completed board") {
      await tap(Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find((button) => button.textContent?.includes("Full Board"))!)
    }
    const statusGroup = badge("Rookie").closest('[data-slot="draft-player-badges"]')!
    expect(statusGroup.querySelectorAll("button")).toHaveLength(2)
    expect(statusGroup.textContent).toContain(kind === "captain" ? "Captain" : "Keeper")
    expect(statusGroup.textContent).not.toContain(name)
    expect(statusGroup.textContent).not.toContain("Traded pick")
    expect(statusGroup.className).toContain("top-0")
    expect(statusGroup.className).toContain("sm:static")
    if (layout === "live board") expect(statusGroup.querySelector('[title="Goalie"]')).not.toBeNull()
    expect(badge("Traded pick").closest('[data-slot="draft-player-badges"]')).toBeNull()
    for (const label of [kind === "captain" ? "Captain" : "Keeper", "Rookie", "Traded pick"]) {
      await tap(badge(label))
      expect(tooltip()).not.toBeNull()
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      await tap(badge(label))
      expect(tooltip()).toBeNull()
    }
    expect(document.querySelector("button button")).toBeNull()
  })
})
