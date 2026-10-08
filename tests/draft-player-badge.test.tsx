// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DraftPlayerBadge } from "@/components/draft-player-badge"
import { PublicDraftBoard } from "@/components/public-draft-board"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

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
  return document.querySelector('[data-slot="tooltip-content"][data-state="instant-open"]')
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
  it.each(["rookie", "captain"] as const)("toggles the %s explanation on repeated taps without clicking the parent", async (kind) => {
    const parentClick = vi.fn()
    const label = kind === "rookie" ? "Rookie" : "Captain"
    await render(<div onClick={parentClick}><DraftPlayerBadge kind={kind} /></div>)
    const trigger = badge(label)
    expect(trigger.tagName).toBe("BUTTON")
    expect(trigger.className).toContain("text-foreground")
    expect(trigger.className).toContain("focus-visible:ring-foreground")
    expect(trigger.className).not.toContain("text-primary")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    for (let i = 0; i < 3; i++) {
      await tap(trigger)
      expect(tooltip()?.textContent).toContain(label)
      expect(trigger.getAttribute("aria-expanded")).toBe("true")
      expect(document.getElementById(trigger.getAttribute("aria-describedby")!)?.textContent).toContain(label)
      await tap(trigger)
      expect(tooltip()).toBeNull()
      expect(trigger.getAttribute("aria-expanded")).toBe("false")
    }
    expect(parentClick).not.toHaveBeenCalled()
  })

  it("dismisses on an outside tap and allows reopening", async () => {
    await render(<><DraftPlayerBadge kind="rookie" /><button>Outside</button></>)
    await tap(badge("Rookie"))
    await tap(container.querySelectorAll("button")[1])
    expect(tooltip()).toBeNull()
    await tap(badge("Rookie"))
    expect(tooltip()).not.toBeNull()
  })

  it("dismisses on scrolling the badge's container", async () => {
    await render(<DraftPlayerBadge kind="rookie" />)
    await tap(badge("Rookie"))
    await flush(() => container.dispatchEvent(new Event("scroll")))
    expect(tooltip()).toBeNull()
  })

  it("shows only the latest badge when switching between explanations", async () => {
    await render(<><DraftPlayerBadge kind="rookie" /><DraftPlayerBadge kind="captain" /></>)
    await tap(badge("Rookie"))
    await tap(badge("Captain"))
    expect(badge("Rookie").getAttribute("aria-expanded")).toBe("false")
    expect(badge("Captain").getAttribute("aria-expanded")).toBe("true")
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
  })

  it("preserves mouse hover and keyboard focus explanations", async () => {
    await render(<><DraftPlayerBadge kind="rookie" /><button>Outside</button></>)
    const trigger = badge("Rookie")
    await flush(() => trigger.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" })))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Rookie")
    await flush(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(tooltip()).toBeNull()
    await flush(() => trigger.focus())
    expect(tooltip()).not.toBeNull()
    await flush(() => container.querySelectorAll("button")[1].focus())
    expect(tooltip()).toBeNull()
  })

  it("ignores touch movement until a click, so a scroll gesture does not open it", async () => {
    await render(<DraftPlayerBadge kind="rookie" />)
    await flush(() => badge("Rookie").dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "touch" })))
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

  it("keeps team-row badge and player actions separate with no nested buttons", async () => {
    await render(<PublicDraftBoard seasonSlug="badge-test" initialData={{
      draft: { id: "test", name: "Test", status: "completed", rounds: 1, draftDate: null, location: null, timerSeconds: 60, timerCountdown: null, timerRunning: false, timerStartedAt: null, updatedAt: null },
      season: { id: "test", name: "Test", slug: "badge-test" },
      teams: [{ teamSlug: "test", teamName: "Test team", position: 1, color: null }],
      picks: [{ id: "test", round: 1, pickNumber: 1, teamSlug: "test", originalTeamSlug: "test", playerId: 1, playerName: "Sample Player", isKeeper: false, pickedAt: null }],
      pool: [{ playerId: 1, playerName: "Sample Player", registrationMeta: { isRookie: true, positions: "Forward" } }],
      trades: [],
    }} />)
    expect(document.querySelector("button button")).toBeNull()
    await tap(badge("Rookie"))
    expect(tooltip()).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await tap(tooltip() as HTMLElement)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await tap(container.querySelector('button[aria-label="View Sample Player"]')!)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
})
