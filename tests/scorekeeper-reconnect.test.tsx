// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ScorekeeperApp } from "@/components/scorekeeper/scorekeeper-app"
import { createInitialState } from "@/lib/scorekeeper-types"

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  const storage: Record<string, string> = {}
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { storage[key] = String(val) }),
    removeItem: vi.fn((key: string) => { delete storage[key] }),
    clear: vi.fn(() => { Object.keys(storage).forEach((k) => delete storage[k]) }),
    length: 0,
    key: vi.fn(),
  })
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
})

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

})
