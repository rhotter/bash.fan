// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialState, type GoalEvent, type GoalieChangeEvent, type LiveGameState } from "@/lib/scorekeeper-types"
import type { ShotAllocationGoalie } from "@/components/scorekeeper/shared/goalie-shot-allocation"

// Keep the real editor state, edit-mode detection, Save/Cancel controls, and
// request sequencing. Child controls only provide deterministic user edits.
vi.mock("@/components/admin-editor/shots-editor", () => ({
  ShotsEditor: ({ state, onChange }: { state: LiveGameState; onChange: (patch: Partial<LiveGameState>) => void }) => (
    <section>
      <output aria-label="Home shots">{state.homeShots.join(",")}</output>
      <button onClick={() => onChange({ homeShots: state.homeShots.map((shots, index) => shots + Number(index === 0)) })}>
        Increase home shots
      </button>
    </section>
  ),
}))
vi.mock("@/components/admin-editor/goals-editor", () => ({
  GoalsEditor: ({ state, onChange }: { state: LiveGameState; onChange: (goals: GoalEvent[]) => void }) => (
    <section>
      <output aria-label="Goal count">{state.goals.length}</output>
      <button onClick={() => onChange([...state.goals, {
        id: "corrected-goal", team: "home", period: 3, clock: "2:00", scorerId: 10,
        assist1Id: null, assist2Id: null, flags: [],
      }])}>Add home goal</button>
    </section>
  ),
}))
vi.mock("@/components/scorekeeper/shared/goalie-shot-allocation", () => ({
  GoalieShotAllocation: ({ goalies, onChange }: { goalies: ShotAllocationGoalie[]; onChange: (allocation: Record<string, number>) => void }) => (
    <section>
      <output aria-label="Allocation goalies">{goalies.map((goalie) => `${goalie.id}:${goalie.name}`).join(",")}</output>
      <button onClick={() => onChange({ "2": 15 })}>Set goalie allocation</button>
      <button onClick={() => onChange({ "1": 6, "3": 6, "2": 15 })}>Allocate relief goalie shots</button>
    </section>
  ),
}))
vi.mock("@/components/admin-editor/penalties-editor", () => ({ PenaltiesEditor: () => null }))
vi.mock("@/components/admin-editor/attendance-editor", () => ({
  AttendanceEditor: ({ state, onChange }: { state: LiveGameState; onChange: (patch: Partial<LiveGameState>) => void }) => (
    <button onClick={() => onChange({ homeGoalieId: 3, homeAttendance: [...new Set([...state.homeAttendance, 3])] })}>Assign relief goalie</button>
  ),
}))
vi.mock("@/components/admin-editor/goalie-pulls-editor", () => ({ GoaliePullsEditor: () => null }))
vi.mock("@/components/admin-editor/goalie-changes-editor", () => ({
  GoalieChangesEditor: ({ state, onChange }: { state: LiveGameState; onChange: (changes: GoalieChangeEvent[]) => void }) => (
    <button onClick={() => onChange([...(state.goalieChanges ?? []), {
      id: "relief", team: "home", period: 2, clock: "10:00", outGoalieId: 1, inGoalieId: 3,
    }])}>Add goalie change</button>
  ),
}))
vi.mock("@/components/admin-editor/officials-editor", () => ({ OfficialsEditor: () => null }))
vi.mock("@/components/admin-editor/notes-editor", () => ({ NotesEditor: () => null }))
vi.mock("@/components/admin-editor/three-stars-editor", () => ({ ThreeStarsEditor: () => null }))
vi.mock("@/components/admin-editor/shootout-editor", () => ({ ShootoutEditor: () => null }))

import { AdminGameEditor } from "@/components/admin-editor/admin-game-editor"

const fetchMock = vi.fn()
const onSaved = vi.fn()
const onClose = vi.fn()
const NOW = 1_800_000_000_000
let container: HTMLDivElement
let root: Root

function initialState(): LiveGameState {
  return {
    ...createInitialState(),
    period: 3, updatedAt: 12345,
    homeAttendance: [1, 10], awayAttendance: [2, 20],
    homeGoalieId: 1, awayGoalieId: 2,
    homeShots: [5, 5, 5], awayShots: [4, 4, 4],
  }
}

function reply(status = 200, body: Record<string, unknown> = { ok: true }) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function deferredReply() {
  let resolve!: (response: ReturnType<typeof reply>) => void
  const promise = new Promise<ReturnType<typeof reply>>((done) => { resolve = done })
  return { promise, resolve }
}

async function flush(action: () => void) {
  await act(async () => {
    action()
    await Promise.resolve()
  })
}

async function render(state = initialState()) {
  await flush(() => root.render(<AdminGameEditor
    gameId="g55" state={state} pin="1234"
    homeSlug="home" awaySlug="away" homeTeam="Home team" awayTeam="Away team"
    homeRoster={[{ id: 1, name: "Home goalie" }, { id: 3, name: "Relief goalie" }, { id: 10, name: "Home scorer" }]}
    awayRoster={[{ id: 2, name: "Away goalie" }, { id: 20, name: "Away scorer" }]}
    playerNames={{}} savedGoalies={[
      { id: 1, name: "Home goalie", team: "Home team" },
      { id: 2, name: "Away goalie", team: "Away team" },
    ]}
    onClose={onClose} onSaved={onSaved}
  />))
}

function button(label: string) {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((element) => element.textContent?.trim() === label)
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

async function click(label: string) {
  await flush(() => button(label).click())
}

function requestBody(index = 0) {
  return JSON.parse(fetchMock.mock.calls[index][1].body as string)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(Date, "now").mockReturnValue(NOW)
  fetchMock.mockReset().mockResolvedValue(reply())
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

describe("AdminGameEditor saving", () => {
  it("saves a shot-only edit with PATCH and the original snapshot, without finalizing", async () => {
    const state = initialState()
    const before = structuredClone(state)
    await render(state)
    await click("Increase home shots")
    await click("Save")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/bash/scorekeeper/g55/state")
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "PATCH", headers: { "Content-Type": "application/json", "x-pin": "1234" },
    })
    expect(requestBody()).toEqual({ expectedState: before, homeShots: [6, 5, 5], awayShots: [4, 4, 4] })
    expect(state).toEqual(before)
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it("routes an explicit goalie allocation through PATCH without finalization", async () => {
    await render()
    await click("Set goalie allocation")
    await click("Save")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH")
    expect(requestBody().goalieShotsAgainst).toEqual({ "2": 15 })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it("submits a full edit for validation and finalization in one request", async () => {
    const state = initialState()
    const before = structuredClone(state)
    const finalize = deferredReply()
    fetchMock.mockReturnValueOnce(finalize.promise)
    await render(state)
    await click("Add home goal")
    await click("Save")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/bash/scorekeeper/g55/finalize")
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST", headers: { "Content-Type": "application/json", "x-pin": "1234" },
    })
    expect(requestBody().expectedState).toEqual(before)
    expect(requestBody().state).toMatchObject({ updatedAt: NOW, homeShots: state.homeShots, awayShots: state.awayShots })
    expect(requestBody().state.goals).toEqual([expect.objectContaining({ id: "corrected-goal", team: "home" })])
    expect(state).toEqual(before)
    expect(onSaved).not.toHaveBeenCalled()
    expect(button("Saving...").disabled).toBe(true)
    expect(button("Cancel").disabled).toBe(true)
    await flush(() => finalize.resolve(reply()))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(button("Save").disabled).toBe(false)
  })

  it.each([
    ["shots", 409, "Game changed since you opened it. Reload before saving."],
    ["shots", 422, "Shots against cannot be less than goals against."],
    ["full", 409, "This completed game's state changed. Reload before saving."],
    ["full", 422, "Goal history is invalid."],
  ] as const)("retains %s edits after a %i error without reporting success", async (mode, status, error) => {
    fetchMock.mockResolvedValueOnce(reply(status, { error }))
    const state = initialState()
    await render(state)
    await click(mode === "shots" ? "Increase home shots" : "Add home goal")
    await click("Save")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(container.textContent).toContain(error)
    expect(container.textContent).toContain("Editing:")
    expect(container.querySelector('output[aria-label="Home shots"]')?.textContent).toBe(mode === "shots" ? "6,5,5" : "5,5,5")
    expect(container.querySelector('output[aria-label="Goal count"]')?.textContent).toBe(mode === "full" ? "1" : "0")
    expect(button("Save").disabled).toBe(false)
    expect(button("Cancel").disabled).toBe(false)
    // A rejected proposed state is not a new compare-and-swap baseline.
    await click("Save")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requestBody(1).expectedState).toEqual(state)
  })

  it("rebases to the canonical saved state after a partial finalization failure and retries unchanged edits", async () => {
    let accepted: LiveGameState
    fetchMock.mockImplementationOnce(async (_url: string, options: RequestInit) => {
      const proposed = JSON.parse(options.body as string).state
      accepted = { ...proposed, updatedAt: NOW + 5000, notes: "Canonical saved state" }
      return reply(503, { error: "Finalization temporarily unavailable", stateSaved: true, state: accepted })
    })
    await render()
    await click("Add home goal")
    await click("Save")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Finalization temporarily unavailable")

    vi.mocked(Date.now).mockReturnValue(NOW + 10000)
    await click("Save")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe("/api/bash/scorekeeper/g55/finalize")
    expect(fetchMock.mock.calls[1][1].method).toBe("POST")
    expect(requestBody(1).expectedState).toEqual(accepted!)
    expect(requestBody(1).state).toEqual({ ...accepted!, updatedAt: NOW + 10000 })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain("Finalization temporarily unavailable")
  })

  it.each(["events", "shots"])("uses the accepted snapshot and full finalization when correcting %s after a partial failure", async (kind) => {
    let accepted: LiveGameState
    fetchMock.mockImplementationOnce(async (_url: string, options: RequestInit) => {
      accepted = { ...JSON.parse(options.body as string).state, updatedAt: NOW + 5000 }
      return reply(503, { error: "Finalization temporarily unavailable", stateSaved: true, state: accepted })
    })
    await render()
    await click("Add home goal")
    await click("Save")
    expect(onSaved).not.toHaveBeenCalled()

    vi.mocked(Date.now).mockReturnValue(NOW + 10000)
    await click(kind === "events" ? "Add home goal" : "Increase home shots")
    await click("Save")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe("/api/bash/scorekeeper/g55/finalize")
    expect(fetchMock.mock.calls[1][1].method).toBe("POST")
    expect(requestBody(1).expectedState).toEqual(accepted!)
    expect(requestBody(1).state.updatedAt).toBe(NOW + 10000)
    expect(requestBody(1).state.goals).toHaveLength(kind === "events" ? 2 : 1)
    expect(requestBody(1).state.homeShots).toEqual(kind === "shots" ? [6, 5, 5] : [5, 5, 5])
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it("preserves the pending finalization obligation after a retry rejects validation", async () => {
    let accepted: LiveGameState
    fetchMock.mockImplementationOnce(async (_url: string, options: RequestInit) => {
      accepted = JSON.parse(options.body as string).state
      return reply(503, { error: "Partial write", stateSaved: true, state: accepted })
    }).mockResolvedValueOnce(reply(409, { error: "Please retry finalization" }))
    await render()
    await click("Add home goal")
    await click("Save")
    await click("Save")
    expect(onSaved).not.toHaveBeenCalled()
    await click("Save")
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.every(([url]) => url === "/api/bash/scorekeeper/g55/finalize")).toBe(true)
    expect(requestBody(2).expectedState).toEqual(accepted!)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it.each(["shots", "full"])("keeps %s edits and the original baseline after a network failure", async (kind) => {
    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"))
    const state = initialState()
    await render(state)
    await click(kind === "shots" ? "Increase home shots" : "Add home goal")
    await click("Save")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Network unavailable")
    expect(button("Save").disabled).toBe(false)
    await click("Save")
    expect(requestBody(1).expectedState).toEqual(state)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it("cancels without making any request, even after editing", async () => {
    await render()
    await click("Increase home shots")
    await click("Cancel")
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(["shots", "full"])("disables repeated Save, Cancel, and controls while the %s request is in flight", async (kind) => {
    const pending = deferredReply()
    fetchMock.mockReturnValueOnce(pending.promise)
    await render()
    await click(kind === "shots" ? "Increase home shots" : "Add home goal")
    await click("Save")
    const save = button("Saving...")
    expect(save.disabled).toBe(true)
    expect(button("Cancel").disabled).toBe(true)
    expect(button("Increase home shots").matches(":disabled")).toBe(true)
    await flush(() => { save.click(); save.click(); button("Cancel").click(); button("Increase home shots").click() })
    expect(container.querySelector('output[aria-label="Home shots"]')?.textContent).toBe(kind === "shots" ? "6,5,5" : "5,5,5")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    await flush(() => pending.resolve(reply()))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it("retries a durable failed finalization after reloading with no further edits", async () => {
    const state = { ...initialState(), finalizationPending: { attemptId: "interrupted", phase: "failed" as const } }
    await render(state)
    await click("Save")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/bash/scorekeeper/g55/finalize")
    expect(requestBody().expectedState).toEqual(state)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])("treats unchanged Save as a no-op, including normalized legacy arrays (%s)", async (legacy) => {
    const state = initialState()
    if (legacy) {
      delete (state as Partial<LiveGameState>).goaliePulls
      delete (state as Partial<LiveGameState>).goalieChanges
      delete (state as Partial<LiveGameState>).timeouts
    }
    await render(state)
    await click("Save")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(button("Save").disabled).toBe(false)
  })

  it("submits mixed shot and event edits together for complete validation", async () => {
    const state = initialState()
    await render(state)
    await click("Increase home shots")
    await click("Add home goal")
    await click("Save")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/bash/scorekeeper/g55/finalize")
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(requestBody().expectedState).toEqual(state)
    expect(requestBody().state.homeShots).toEqual([6, 5, 5])
    expect(requestBody().state.goals).toHaveLength(1)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it("shows newly assigned and substituted goalies and saves their allocations with the event edit", async () => {
    const state = initialState()
    await render(state)
    expect(container.querySelector('output[aria-label="Allocation goalies"]')?.textContent).not.toContain("3:Relief goalie")
    await click("Assign relief goalie")
    await click("Add goalie change")
    const goalies = container.querySelector('output[aria-label="Allocation goalies"]')?.textContent ?? ""
    expect(goalies).toContain("3:Relief goalie")
    expect(goalies).toContain("1:Home goalie")
    expect(goalies).toContain("2:Away goalie")
    expect(goalies.match(/3:Relief goalie/g)).toHaveLength(1)
    await click("Allocate relief goalie shots")
    await click("Save")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/bash/scorekeeper/g55/finalize")
    expect(requestBody().expectedState).toEqual(state)
    expect(requestBody().state).toMatchObject({
      homeGoalieId: 3, goalieShotsAgainst: { "1": 6, "3": 6, "2": 15 },
      goalieChanges: [{ id: "relief", outGoalieId: 1, inGoalieId: 3 }],
    })
    expect(requestBody().state.homeAttendance).toContain(3)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })
})
