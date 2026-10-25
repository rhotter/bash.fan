// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialState, type LiveGameState } from "@/lib/scorekeeper-types"

// Only replace overlay plumbing; exercise real scorekeeper edits, goalie inputs,
// local storage, sync manager, and finalization request/error handling.
vi.mock("@/components/ui/dialog", () => {
  const Content = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return { Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <section role="dialog">{children}</section> : null,
    DialogContent: Content, DialogHeader: Content, DialogTitle: Content, DialogFooter: Content, DialogDescription: Content }
})
vi.mock("@/components/ui/drawer", () => {
  const Content = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return { Drawer: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <section role="dialog">{children}</section> : null,
    DrawerContent: Content, DrawerHeader: Content, DrawerTitle: Content, DrawerClose: Content }
})

vi.mock("@/components/scorekeeper/shared/goalie-select", () => ({
  GoalieSelect: ({ label, onChange }: { label: string; onChange: (value: string) => void }) =>
    <button onClick={() => onChange("3")}>Replace {label} goalie</button>,
}))

import { ScorekeeperApp } from "@/components/scorekeeper/scorekeeper-app"

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()
const beacon = vi.fn()
function fixture(): LiveGameState {
  return { ...createInitialState(), period: 3, clockSeconds: 0, updatedAt: 1234,
    homeGoalieId: 1, awayGoalieId: 2, homeAttendance: [1, 10], awayAttendance: [2, 20],
    homeShots: [5, 5, 5], awayShots: [4, 4, 4], goals: [{ id: "goal-1", team: "home", period: 3,
      clock: "0:30", scorerId: 10, assist1Id: null, assist2Id: null, flags: [] }] }
}
function reply(status = 200, body: object = { ok: true }) {
  return new Response(JSON.stringify(body), { status })
}
async function render(state = fixture(), status = "final") {
  await act(async () => root.render(<ScorekeeperApp gameId="test-correction" date="2026-10-25" time="10:00" status={status}
    isPlayoff={false} homeSlug="home" awaySlug="away" homeTeam="Home" awayTeam="Away"
    homeRoster={[{ id: 1, name: "Home goalie" }, { id: 3, name: "Relief goalie" }, { id: 10, name: "Home scorer" }]}
    awayRoster={[{ id: 2, name: "Away goalie" }, { id: 20, name: "Away scorer" }]}
    existingState={state} initialAuthenticated />))
}
async function click(text: string, scope: ParentNode = container) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === text)
  expect(button, `Button: ${text}`).toBeTruthy()
  await act(async () => button!.click())
}
async function emptyNetEdit() {
  const row = [...container.querySelectorAll("span")].find(el => el.textContent === "GOAL")!.parentElement!
  await act(async () => row.click())
  const label = [...container.querySelectorAll("label")].find(el => el.textContent === "Empty Net")!
  await act(async () => label.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click())
  await click("Save")
}
async function openFinalization() {
  await click("Finalize")
  await click("Continue to Finalize")
}
async function finalize() {
  await click("Finalize", container.querySelector('[role="dialog"]')!)
}
async function advance(ms = 6000) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}
function body(index = 0) { return JSON.parse(fetchMock.mock.calls[index][1].body) }
function draft() { return JSON.parse(localStorage.getItem("bash-live-test-correction")!) }

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  const storage: Record<string, string> = {}
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { storage[key] = value }),
    removeItem: vi.fn((key: string) => { delete storage[key] }),
  })
  fetchMock.mockReset().mockImplementation(async () => reply())
  beacon.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("completed-game scorekeeper corrections", () => {
  it("edits an empty-net goal locally and posts the original snapshot with the correction without live autosave or beacons", async () => {
    const original = fixture()
    await render(original)
    await click("Edit Game")
    await emptyNetEdit()
    await advance()
    window.dispatchEvent(new Event("beforeunload"))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(beacon).not.toHaveBeenCalled()
    expect(draft().expectedState).toEqual(original)
    expect(draft().state.goals[0].flags).toEqual(["ENG"])
    await openFinalization()
    await finalize()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/bash/scorekeeper/test-correction/finalize")
    expect(body().expectedState).toEqual(original)
    expect(body().state.goals[0].flags).toEqual(["ENG"])
    expect(localStorage.getItem("bash-live-test-correction")).toBeNull()
    expect(container.textContent).toContain("View game page")
  })

  it.each([400, 409, 500])("keeps the correction and original snapshot after HTTP %i and does not retry it as offline", async (status) => {
    const original = fixture()
    fetchMock.mockImplementation(async () => reply(status, { error: "Correction rejected" }))
    await render(original)
    await click("Edit Game")
    await emptyNetEdit()
    await openFinalization()
    await finalize()
    expect(container.textContent).toContain("Error:")
    expect(container.textContent).not.toContain("automatically finalize")
    expect(draft().expectedState).toEqual(original)
    expect(draft().state.goals[0].flags).toEqual(["ENG"])
    expect(localStorage.getItem("bash-finalize-test-correction")).toBeNull()
    await advance(12000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("automatically corrects stale single-goalie shots after an empty-net edit with no manual finalization fields", async () => {
    const original = { ...fixture(), goalieShotsAgainst: { "2": 15 } }
    await render(original)
    await click("Edit Game")
    await emptyNetEdit()
    await openFinalization()
    expect(container.textContent).not.toContain("Goalie shots against")
    expect(container.querySelector('[aria-label^="Shots against for"]')).toBeNull()
    await finalize()
    expect(body().expectedState).toEqual(original)
    expect(body().state.goalieShotsAgainst).toEqual({})
    expect(body().state.goals[0].flags).toEqual(["ENG"])
  })

  it("restores the original conflict snapshot across reload even when the server has changed", async () => {
    const original = fixture()
    await render(original)
    await click("Edit Game")
    await emptyNetEdit()
    await act(async () => root.unmount())
    root = createRoot(container)
    const changedServer = { ...original, notes: "Another scorer's change", updatedAt: Date.now() + 100 }
    await render(changedServer)
    await advance()
    expect(fetchMock).not.toHaveBeenCalled()
    await openFinalization()
    await finalize()
    expect(body().expectedState).toEqual(original)
    expect(body().state.goals[0].flags).toEqual(["ENG"])
  })

  it("retries an offline correction after reload using POST and the saved original snapshot", async () => {
    const original = fixture()
    fetchMock.mockRejectedValueOnce(new Error("offline"))
    await render(original)
    await click("Edit Game")
    await emptyNetEdit()
    await openFinalization()
    await finalize()
    expect(localStorage.getItem("bash-finalize-test-correction")).toBe("1")
    await act(async () => root.unmount())
    root = createRoot(container)
    await render(original)
    await advance(2500)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([url]) => url.endsWith("/finalize"))).toBe(true)
    expect(body(1)).toEqual(body(0))
    expect(container.textContent).toContain("View game page")
    expect(localStorage.getItem("bash-finalize-test-correction")).toBeNull()
  })

  it("uses the new server snapshot when editing immediately after first finalization", async () => {
    const original = fixture()
    const saved = { ...original, updatedAt: 5678 }
    fetchMock.mockImplementation(async (url) => reply(200, url.endsWith("/finalize") ? { ok: true, state: saved } : { ok: true }))
    await render(original, "live")
    await openFinalization()
    await finalize()
    await click("Edit Game")
    await emptyNetEdit()
    await openFinalization()
    await finalize()
    expect(fetchMock.mock.calls.map(([url]) => url.split("/").at(-1))).toEqual(["state", "finalize", "finalize"])
    expect(body(2).expectedState).toEqual(saved)
  })

  it("retries an accepted correction whose statistics rebuild failed without sending the old proposal again", async () => {
    const original = fixture()
    const failedState = { ...original, updatedAt: 5678, goals: [{ ...original.goals[0], flags: ["ENG"] }],
      finalizationPending: { attemptId: "failed", phase: "failed" as const } }
    fetchMock.mockImplementationOnce(async () => reply(500, { error: "Rebuild failed", stateSaved: true, state: failedState }))
    await render(original)
    await click("Edit Game")
    await emptyNetEdit()
    await openFinalization()
    await finalize()
    expect(draft()).toEqual(failedState)
    await click("Retry saved finalization")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined()
    expect(fetchMock.mock.calls[1][1].headers["x-state-updated-at"]).toBe("5678")
    expect(container.textContent).toContain("View game page")
  })

  it("records the opposing counters on an actual live substitution", async () => {
    const original = { ...fixture(), period: 2, clockSeconds: 480, awayShots: [4, 2, 0], homeAttendance: [1, 3, 10] }
    await render(original, "live")
    await click("Replace Home goalie")
    await click("Substitution — replacing now")
    await advance(600)
    expect(body().goalieChanges[0]).toMatchObject({ team: "home", outGoalieId: 1, inGoalieId: 3,
      shotSnapshot: { period: 2, clock: "8:00", opponentShots: [4, 2, 0] } })
  })

  it("explains missing legacy shot evidence without restoring manual finalization fields", async () => {
    fetchMock.mockImplementation(async () => reply(400, { error: "Home needs an explicit shots-against total for every goalie; shots cannot be split from time played" }))
    await render()
    await click("Edit Game")
    await emptyNetEdit()
    await openFinalization()
    await finalize()
    expect(container.textContent).toContain("Ask an administrator to supply the recorded goalie shot split")
    expect(container.querySelector('[aria-label^="Shots against for"]')).toBeNull()
    expect(draft().state.goals[0].flags).toEqual(["ENG"])
  })

  it("keeps rejected live autosaves visible instead of marking finalization offline", async () => {
    fetchMock.mockImplementation(async () => reply(409, { error: "Use shot-only correction or validated finalization to edit a completed game." }))
    await render(fixture(), "live")
    await openFinalization()
    await finalize()
    expect(container.textContent).toContain("Error: Use shot-only correction")
    expect(container.textContent).not.toContain("automatically finalize")
    expect(localStorage.getItem("bash-finalize-test-correction")).toBeNull()
    await advance()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain("/state")
  })
})
