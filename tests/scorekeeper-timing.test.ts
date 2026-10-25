import { describe, expect, it } from "vitest"
import { captureGameTime, recordGameTiming, withoutGameTiming } from "@/lib/scorekeeper-timing"
import { createInitialState, type LiveGameState, type GoalEvent } from "@/lib/scorekeeper-types"

const start = 1_800_000_000_000
const goal: GoalEvent = { id: "goal-1", team: "home", period: 1, clock: "19:45", scorerId: 1, assist1Id: null, assist2Id: null, flags: [] }
const record = (before: LiveGameState, after: LiveGameState, at: number) => recordGameTiming(before, after, { at, id: String(at), periodLength: 1200 })

describe("private game timing", () => {
  it("preserves the first play timestamp across pauses, resumes, period changes and reloads", () => {
    const pregame = createInitialState()
    const ready = record(pregame, { ...pregame, period: 1 }, start - 1000)
    expect(ready.timing?.firstPlayStartedAt).toBeUndefined()
    const running = record(ready, { ...ready, clockRunning: true, clockStartedAt: start }, start)
    const paused = record(running, { ...running, clockRunning: false, clockStartedAt: null, clockSeconds: 1190 }, start + 10000)
    const reloaded: LiveGameState = JSON.parse(JSON.stringify(paused))
    const resumed = record(reloaded, { ...reloaded, clockRunning: true, clockStartedAt: start + 30000 }, start + 30000)
    const nextPeriod = record(resumed, { ...resumed, period: 2, clockSeconds: 1200, clockRunning: false, clockStartedAt: null }, start + 1500000)
    expect(nextPeriod.timing?.firstPlayStartedAt).toBe(start)
    expect(nextPeriod.timing?.entries).toHaveLength(5)
    expect(nextPeriod.timing?.entries[2]).toMatchObject({ kind: "clock", capturedAt: start + 10000, clockSeconds: 1190 })
    expect(pregame.timing).toBeUndefined()
  })

  it("timestamps a goal at drawer opening, not submission or offline synchronization", () => {
    const running = { ...createInitialState(), period: 1, clockRunning: true, clockStartedAt: start }
    const capture = captureGameTime(running, start + 15000)
    const paused = record(running, { ...running, clockRunning: false, clockStartedAt: null, clockSeconds: 1185 }, capture.at)
    const submitted = recordGameTiming(paused, { ...paused, goals: [goal] }, {
      at: start + 45000, id: "submit", periodLength: 1200, capture,
    })
    const stored: LiveGameState = JSON.parse(JSON.stringify(submitted))
    expect(stored.timing?.entries[1]).toMatchObject({ kind: "goal", action: "add", capturedAt: start + 15000,
      recordedAt: start + 45000, source: "device", period: 1, clockSeconds: 1185, details: { eventId: goal.id, event: goal } })
    const edited = record(stored, { ...stored, goals: [{ ...goal, clock: "19:30" }] }, start + 60000)
    const removed = record(edited, { ...edited, goals: [] }, start + 90000)
    expect(removed.timing?.entries.map(e => e.action)).toEqual(["change", "add", "edit", "remove"])
    expect(removed.timing?.entries[1]).toEqual(stored.timing?.entries[1])
  })

  it("does not invent historical timestamps or label a midgame resume as the first faceoff", () => {
    const legacy = { ...createInitialState(), period: 1, clockSeconds: 600, goals: [goal] }
    const notes = record(legacy, { ...legacy, notes: "Correction" }, start)
    expect(notes.timing).toBeUndefined()
    const resumed = record(notes, { ...notes, clockRunning: true, clockStartedAt: start }, start)
    expect(resumed.timing?.firstPlayStartedAt).toBeUndefined()
    expect(resumed.timing?.entries.map(e => e.kind)).toEqual(["clock"])
  })

  it("records penalties, timeouts, shots, goalie actions and shootout changes", () => {
    const before = { ...createInitialState(), period: 1 }
    const after = record(before, { ...before,
      penalties: [{ id: "p1", team: "home", period: 1, clock: "20:00", playerId: 1, infraction: "Tripping", minutes: 2 }],
      timeouts: [{ id: "t1", team: "away", period: 1, clock: "20:00" }],
      goaliePulls: [{ id: "gp1", team: "home", period: 1, pulledAt: "20:00", returnedAt: null }],
      goalieChanges: [{ id: "gc1", team: "away", period: 1, clock: "20:00", outGoalieId: 2, inGoalieId: 3 }],
      homeShots: [1, 0, 0], shootout: { homeAttempts: [{ playerId: 1, scored: true }], awayAttempts: [] },
    }, start)
    expect(after.timing?.entries.map(e => e.kind)).toEqual(["penalty", "timeout", "goaliePull", "goalieChange", "shots", "shootout"])
    const returned = record(after, { ...after, goaliePulls: [{ ...after.goaliePulls[0], returnedAt: "19:00" }] }, start + 60000)
    expect(returned.timing?.entries.at(-1)).toMatchObject({ kind: "goaliePull", action: "edit", capturedAt: start + 60000 })
  })

  it("retains private timing across server corrections from a public snapshot", () => {
    const before = record(createInitialState(), { ...createInitialState(), goals: [goal] }, start)
    const publicState = withoutGameTiming(before)
    expect(publicState).not.toHaveProperty("timing")
    const corrected = recordGameTiming(before, { ...publicState, goals: [{ ...goal, scorerId: 2 }] }, {
      at: start + 100000, id: "admin", periodLength: 0, source: "server",
    })
    expect(corrected.timing?.entries[0]).toEqual(before.timing?.entries[0])
    expect(corrected.timing?.entries[1]).toMatchObject({ source: "server", action: "edit", capturedAt: start + 100000 })
    expect(corrected.timing?.firstPlayStartedAt).toBeUndefined()
    expect(recordGameTiming(createInitialState(), { ...createInitialState(), timing: before.timing }, {
      at: start, id: "forged", periodLength: 0, source: "server",
    }).timing).toBeUndefined()
  })
})

it("does not infer another first start after a compacted midgame snapshot is reset to a full clock", async () => {
  const { compactGameTiming } = await import("@/lib/scorekeeper-timing")
  const previous = { ...createInitialState(), period: 1, clockSeconds: 600 }
  const running = record(previous, { ...previous, clockRunning: true, clockStartedAt: start }, start)
  const compact = compactGameTiming(running)
  expect(compact.timing?.entries).toEqual([])
  expect(compact.timing?.hasPlayStarted).toBe(true)
  const reset = record(compact, { ...compact, clockRunning: false, clockStartedAt: null, clockSeconds: 1200 }, start + 1000)
  const restarted = record(reset, { ...reset, clockRunning: true, clockStartedAt: start + 2000 }, start + 2000)
  expect(restarted.timing?.firstPlayStartedAt).toBeUndefined()
})
