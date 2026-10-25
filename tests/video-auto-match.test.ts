import { describe, expect, it } from "vitest"
import { gameWindows, liveGame, matchedGame } from "@/lib/video/auto-match"
const start = Date.parse("2026-10-24T16:00:00Z")
const minute = 60000
const completed = (id: string, at = start) => ({ id, status: "final", firstStart: at, observations: [at, at + 90 * minute] })
describe("automatic recording attribution", () => {
  it("splits a continuous rink recording across consecutive games", () => {
    const windows = gameWindows([completed("a"), completed("b", start + 120 * minute)], start + 240 * minute)
    expect(matchedGame(windows, start + minute, start + 2 * minute)).toBe("a")
    expect(matchedGame(windows, start + 121 * minute, start + 122 * minute)).toBe("b")
    expect(matchedGame(windows, start + 100 * minute, start + 101 * minute)).toBeNull()
  })
  it("does not infer games from schedules or missing timing", () => {
    expect(gameWindows([{ id: "scheduled", status: "live", observations: [] }], start)).toEqual([])
  })
  it("withholds ambiguous overlaps and clips crossing game boundaries", () => {
    const windows = gameWindows([completed("a"), completed("b", start + 89 * minute)], start + 240 * minute)
    expect(matchedGame(windows, start + 88.5 * minute, start + 89.5 * minute)).toBeNull()
    expect(liveGame(windows, start + 89.5 * minute)).toBeNull()
    expect(matchedGame(windows, start - 1, start + minute)).toBeNull()
  })
  it("does not keep stale live games streaming indefinitely", () => {
    const now = start + 120 * minute
    const windows = gameWindows([{ ...completed("a"), status: "live" }], now)
    expect(liveGame(windows, now)).toBeNull()
  })
  it("keeps live coverage through a running clock and a short pause", () => {
    const now = start + 18 * minute
    const running = gameWindows([{ id: "a", status: "live", firstStart: start, observations: [start], clockRunning: true, clockStartedAt: start, clockSeconds: 1200 }], now)
    expect(liveGame(running, now)).toBe("a")
    expect(liveGame(gameWindows([{ ...completed("a"), status: "live" }], start + 95 * minute), start + 95 * minute)).toBe("a")
  })
  it("supports delayed scorekeeper sync without using receipt/upload time", () => {
    const windows = gameWindows([completed("a")], start + 24 * 60 * minute)
    expect(matchedGame(windows, start + 10 * minute, start + 11 * minute)).toBe("a")
  })
  it("ignores non-finite and future timestamps", () => {
    expect(gameWindows([{ id: "a", status: "live", firstStart: NaN, observations: [start] }], start)).toEqual([])
    expect(gameWindows([{ id: "a", status: "live", firstStart: start + 1, observations: [] }], start)).toEqual([])
    expect(matchedGame([], NaN, start)).toBeNull()
  })
})
