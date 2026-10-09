// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ScorekeeperApp } from "@/components/scorekeeper/scorekeeper-app"
import { createInitialState, type LiveGameState } from "@/lib/scorekeeper-types"

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  localStorage.clear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function recordedState(): LiveGameState {
  return {
    ...createInitialState(), period: 3, clockSeconds: 0, updatedAt: 6789,
    homeGoalieId: 1, awayGoalieId: 2, homeAttendance: [1, 10], awayAttendance: [2],
    homeShots: [3, 3, 3], awayShots: [4, 4, 4], notes: "Retained game history",
    goals: [{ id: "recorded-goal", team: "home", period: 3, clock: "2:00", scorerId: 10, assist1Id: null, assist2Id: null, flags: [] }],
  }
}

function reply(status = 200, body: Record<string, unknown> = { ok: true }) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

async function render(state: LiveGameState, { isForfeit = false, authenticated = true, status = "live" } = {}) {
  await act(async () => root.render(<ScorekeeperApp gameId="g55" date="2026-07-18" time="10:00" status={status}
    isPlayoff={false} isForfeit={isForfeit} homeSlug="home" awaySlug="away" homeTeam="Home" awayTeam="Away"
    homeRoster={[{ id: 1, name: "Goalie 1" }, { id: 10, name: "Home scorer" }]} awayRoster={[{ id: 2, name: "Goalie 2" }]}
    existingState={state} initialAuthenticated={authenticated} />))
}

function button(label: string, within: ParentNode = document) {
  const match = Array.from(within.querySelectorAll<HTMLButtonElement>("button"))
    .find((element) => element.textContent?.trim() === label)
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

async function click(label: string, within?: ParentNode) {
  await act(async () => { button(label, within).click(); await Promise.resolve() })
}

async function openFinalize() {
  await click("Finalize", container)
  await click("Continue to Finalize")
}

async function expectTerminal(fetch: ReturnType<typeof vi.fn>, expectedCalls: number) {
  expect(container.textContent).toContain("Game forfeited")
  expect(container.textContent).not.toContain("Finish saving this game")
  expect(container.textContent).not.toContain("Game save in progress")
  expect(container.textContent).not.toContain("Retry saved finalization")
  expect(container.textContent).not.toContain("Edit Game")
  expect(container.querySelector('a[href="/game/g55"]')?.textContent).toBe("View official game result")
  expect(localStorage.getItem("bash-finalize-g55")).toBeNull()
  const beacon = vi.fn()
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon })
  await act(async () => {
    window.dispatchEvent(new Event("online"))
    window.dispatchEvent(new Event("online"))
    window.dispatchEvent(new Event("beforeunload"))
    await vi.advanceTimersByTimeAsync(15000)
  })
  expect(fetch).toHaveBeenCalledTimes(expectedCalls)
  expect(beacon).not.toHaveBeenCalled()
}

describe("offline finalization after reload", () => {
  it.each([false, true])("saves the current state before retrying finalization (newer local state: %s)", async (newerLocal) => {
    const state = { ...createInitialState(), period: 3, clockSeconds: 0, updatedAt: 1234,
      homeGoalieId: 1, awayGoalieId: 2, homeAttendance: [1], awayAttendance: [2], homeShots: [3, 3, 3], awayShots: [4, 4, 4] }
    const saved = newerLocal ? { ...state, updatedAt: 1235, homeShots: [5, 5, 5] } : state
    localStorage.setItem("bash-live-g55", JSON.stringify(saved))
    localStorage.setItem("bash-finalize-g55", "1")
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal("fetch", fetch)
    await act(async () => root.render(<ScorekeeperApp gameId="g55" date="2026-07-18" time="10:00" status="live"
      isPlayoff={false} homeSlug="home" awaySlug="away" homeTeam="Home" awayTeam="Away"
      homeRoster={[{ id: 1, name: "Goalie 1" }]} awayRoster={[{ id: 2, name: "Goalie 2" }]}
      existingState={state} initialAuthenticated />))
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    const calls = fetch.mock.calls
    expect(calls.map(([url]) => url)).toEqual([
      "/api/bash/scorekeeper/g55/state", "/api/bash/scorekeeper/g55/finalize",
    ])
    expect(JSON.parse(calls[0][1].body).updatedAt).toBe(saved.updatedAt)
    expect(calls[1][1].headers["x-state-updated-at"]).toBe(String(saved.updatedAt))
    expect(localStorage.getItem("bash-finalize-g55")).toBeNull()
  })

  it.each(["live", "final"])("retries a failed saved rebuild after reload (%s) without autosaving over the claim", async (status) => {
    const state = { ...createInitialState(), period: 3, clockSeconds: 0, updatedAt: 6789,
      homeGoalieId: 1, awayGoalieId: 2, homeAttendance: [1], awayAttendance: [2], homeShots: [3, 3, 3], awayShots: [4, 4, 4],
      finalizationPending: { attemptId: "failed-attempt", phase: "failed" as const } }
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal("fetch", fetch)
    await act(async () => root.render(<ScorekeeperApp gameId="g55" date="2026-07-18" time="10:00" status={status}
      isPlayoff={false} homeSlug="home" awaySlug="away" homeTeam="Home" awayTeam="Away"
      homeRoster={[{ id: 1, name: "Goalie 1" }]} awayRoster={[{ id: 2, name: "Goalie 2" }]}
      existingState={state} initialAuthenticated />))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(fetch).not.toHaveBeenCalled()
    const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Retry saved finalization")!
    expect(retry).toBeTruthy()
    await act(async () => { retry.click(); await Promise.resolve() })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe("/api/bash/scorekeeper/g55/finalize")
    expect(fetch.mock.calls[0][1].headers["x-state-updated-at"]).toBe("6789")
    expect(container.textContent).not.toContain("Finish saving this game")
    expect(container.textContent).toContain("Final")
  })

  it("keeps running finalizations read-only instead of stealing an active claim", async () => {
    const state = { ...createInitialState(), period: 3, updatedAt: 6789,
      finalizationPending: { attemptId: "running-attempt", phase: "running" as const } }
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    await act(async () => root.render(<ScorekeeperApp gameId="g55" date="2026-07-18" time="10:00" status="final"
      isPlayoff={false} homeSlug="home" awaySlug="away" homeTeam="Home" awayTeam="Away"
      homeRoster={[]} awayRoster={[]} existingState={state} initialAuthenticated />))
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(fetch).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Game save in progress")
    expect(container.querySelectorAll("input")).toHaveLength(0)
    expect(container.textContent).not.toContain("Retry saved finalization")
  })

  it.each(["direct", "failed retry", "reconnect", "failed reconnect"])("stops finalization and all background saves after a terminal forfeit (%s)", async (mode) => {
    const retained = recordedState()
    const state = mode.includes("failed") ? { ...retained, finalizationPending: { attemptId: "failed-attempt", phase: "failed" as const } } : retained
    if (mode.includes("reconnect")) localStorage.setItem("bash-finalize-g55", "1")
    const fetch = vi.fn().mockImplementation(async (url: string) => url.endsWith("/finalize") ? reply(409, {
      code: "GAME_FORFEITED", finalizationCanceled: true, state: retained,
      error: "This game was forfeited. Live finalization has been canceled; view the official game result.",
    }) : reply())
    vi.stubGlobal("fetch", fetch)
    await render(state)
    if (mode === "direct") {
      await openFinalize()
      await click("Finalize", document.querySelector('[role="dialog"]')!)
    } else if (mode === "failed retry") {
      await click("Retry saved finalization")
    } else {
      // Repeated online signals must not leave queued retries after cancellation.
      await act(async () => {
        window.dispatchEvent(new Event("online"))
        window.dispatchEvent(new Event("online"))
        await vi.advanceTimersByTimeAsync(2500)
      })
    }

    const expectedCalls = mode.includes("failed") ? 1 : 2
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/finalize"))).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem("bash-live-g55")!)).toEqual(retained)
    if (mode.includes("failed")) expect(state.finalizationPending?.attemptId).toBe("failed-attempt")
    await expectTerminal(fetch, expectedCalls)
  })

  it.each([false, true])("preserves the local claim when a terminal response has no clean snapshot (running state returned: %s)", async (hasRunningState) => {
    const state = { ...recordedState(), finalizationPending: { attemptId: "failed-attempt", phase: "failed" as const } }
    const fetch = vi.fn().mockResolvedValue(reply(409, {
      code: "GAME_FORFEITED", finalizationCanceled: true, reloadRequired: true,
      ...(hasRunningState ? { state: { ...state, finalizationPending: { attemptId: "other-running-attempt", phase: "running" } } } : {}),
    }))
    vi.stubGlobal("fetch", fetch)
    await render(state)
    await click("Retry saved finalization")
    expect(JSON.parse(localStorage.getItem("bash-live-g55")!)).toEqual(state)
    await expectTerminal(fetch, 1)
  })

  it.each(["autosave", "direct", "reconnect"])("stops before finalization when state synchronization discovers a forfeit (%s)", async (mode) => {
    const state = recordedState()
    if (mode === "reconnect") localStorage.setItem("bash-finalize-g55", "1")
    const fetch = vi.fn().mockResolvedValue(reply(409, {
      code: "GAME_FORFEITED", error: "This game was forfeited. View the official game result.",
    }))
    vi.stubGlobal("fetch", fetch)
    await render(state)
    if (mode === "direct") {
      await openFinalize()
      await click("Finalize", document.querySelector('[role="dialog"]')!)
    } else {
      await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    }
    expect(fetch.mock.calls[0][0]).toBe("/api/bash/scorekeeper/g55/state")
    expect(JSON.parse(localStorage.getItem("bash-live-g55")!)).toEqual(state)
    await expectTerminal(fetch, 1)
  })

  it.each([
    ["clean", true], ["failed", true], ["running", true],
    ["clean", false], ["failed", false], ["running", false],
  ] as const)("shows the official forfeit result on reopen without syncing (%s state, authenticated: %s)", async (phase, authenticated) => {
    const state = recordedState()
    if (phase !== "clean") state.finalizationPending = { attemptId: "retained-claim", phase }
    const staleLocal = { ...state, updatedAt: state.updatedAt + 1, notes: "Unsynced local history" }
    localStorage.setItem("bash-live-g55", JSON.stringify(staleLocal))
    localStorage.setItem("bash-finalize-g55", "1")
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    await render(state, { status: "final", isForfeit: true, authenticated })
    expect(container.querySelectorAll("input")).toHaveLength(0)
    expect(container.textContent).not.toContain("Enter PIN")
    expect(JSON.parse(localStorage.getItem("bash-live-g55")!)).toEqual(staleLocal)
    await expectTerminal(fetch, 0)
  })

  it("stops queued writes when refreshed server props identify a forfeit", async () => {
    const state = recordedState()
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    await render(state)
    // A server refresh can update the same mounted editor before its debounce.
    await render(state, { status: "final", isForfeit: true })
    await expectTerminal(fetch, 0)
  })

  it.each([409, 503])("keeps a normal %i finalization failure retryable", async (status) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const state = { ...recordedState(), finalizationPending: { attemptId: "failed-attempt", phase: "failed" as const } }
    const fetch = vi.fn().mockResolvedValueOnce(reply(status, { error: "Please retry the saved game" })).mockResolvedValue(reply())
    vi.stubGlobal("fetch", fetch)
    await render(state)
    await click("Retry saved finalization")
    expect(container.textContent).toContain("Please retry the saved game")
    expect(container.textContent).not.toContain("Game forfeited")
    expect(button("Retry saved finalization").disabled).toBe(false)
    await click("Retry saved finalization")
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain("Edit Game")
  })

  it("keeps an ordinary reconnect failure available for manual retry", async () => {
    const state = { ...recordedState(), finalizationPending: { attemptId: "failed-attempt", phase: "failed" as const } }
    localStorage.setItem("bash-finalize-g55", "1")
    const fetch = vi.fn().mockResolvedValueOnce(reply(503, { error: "Please retry the saved game" })).mockResolvedValue(reply())
    vi.stubGlobal("fetch", fetch)
    await render(state)
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(container.textContent).toContain("Please retry the saved game")
    expect(container.textContent).not.toContain("Game forfeited")
    await click("Retry saved finalization")
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain("Edit Game")
  })

})
