// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { it, expect, vi } from "vitest"
import { ScorekeeperApp } from "@/components/scorekeeper/scorekeeper-app"
import { createInitialState } from "@/lib/scorekeeper-types"

// Real component regression; no production calls.
it("second and third playoff OT retain scoring controls and overtime labels", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))))
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    const render = async (period: number) => {
      await act(async () => root.render(<ScorekeeperApp key={period} gameId="audit-playoff" date="2026-10-25" time="10:00" status="live"
        isPlayoff homeSlug="home" awaySlug="away" homeTeam="Home" awayTeam="Away"
        homeRoster={[]} awayRoster={[]}
        existingState={{ ...createInitialState(), period, clockSeconds: 1200, clockRunning: false }} initialAuthenticated />))
    }
    const goalButtons = () => [...container.querySelectorAll("button")].filter(b => b.textContent?.trim() === "Goal")
    await render(4)
    expect(goalButtons()).toHaveLength(2)
    await render(5)
    expect(goalButtons()).toHaveLength(2)
    expect(container.textContent).toContain("2OT")
    await render(6)
    expect(goalButtons()).toHaveLength(2)
    expect(container.textContent).toContain("3OT")
    expect(container.textContent).not.toContain("Start Shootout")
    expect(container.textContent).not.toContain("Finalize")
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
