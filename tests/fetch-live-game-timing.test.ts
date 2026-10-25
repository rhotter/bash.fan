import { expect, it, vi } from "vitest"
import { createInitialState } from "@/lib/scorekeeper-types"
const mocks = vi.hoisted(() => ({ rawSql: vi.fn() }))
vi.mock("@/lib/db", () => mocks)
import { fetchLiveGameData } from "@/lib/fetch-live-game"

it("omits private timing from the public game payload without changing the stored snapshot", async () => {
  const state = { ...createInitialState(), timing: { version: 1, firstPlayStartedAt: 123, entries: [] } }
  mocks.rawSql.mockResolvedValueOnce([{ state, status: "live", home_team: "home", away_team: "away" }]).mockResolvedValueOnce([])
  const result = await fetchLiveGameData("g1")
  expect(result?.state).not.toHaveProperty("timing")
  expect(result?.state).toHaveProperty("clockStartedAt")
  expect(state.timing.firstPlayStartedAt).toBe(123)
})
