import type { LiveGameState } from "./scorekeeper-types"

export interface TimingCapture {
  at: number // Unix milliseconds from the scorekeeper device; not a verified faceoff time.
  period: number
  clockSeconds: number
}

export interface GameTimingEntry {
  id: string
  kind: "clock" | "goal" | "penalty" | "timeout" | "goaliePull" | "goalieChange" | "shots" | "shootout"
  action: "add" | "edit" | "remove" | "change"
  capturedAt: number
  recordedAt: number
  source: "device" | "server"
  period: number
  clockSeconds: number
  // Retain the original event/clock context, including edits and removals.
  details: Record<string, unknown>
}

export interface GameTiming {
  version: 1
  firstPlayStartedAt?: number
  hasPlayStarted?: boolean
  entries: GameTimingEntry[]
}

export function captureGameTime(state: LiveGameState, at: number): TimingCapture {
  return {
    at,
    period: state.period,
    clockSeconds: Math.max(0, state.clockSeconds - (state.clockRunning && state.clockStartedAt != null
      ? (at - state.clockStartedAt) / 1000 : 0)),
  }
}

/** Append at interaction time, before debounced/offline saves. No historical backfill. */
export function recordGameTiming(
  previous: LiveGameState,
  next: LiveGameState,
  options: { at: number; id: string; periodLength: number; capture?: TimingCapture; source?: "device" | "server" },
): LiveGameState {
  const { at, id, periodLength, source = "device" } = options
  const capture = options.capture ?? captureGameTime(previous, at)
  const entries: GameTimingEntry[] = []
  function add(kind: GameTimingEntry["kind"], action: GameTimingEntry["action"], details: Record<string, unknown>) {
    entries.push({ id: `${id}:${entries.length}`, kind, action, capturedAt: capture.at, recordedAt: at,
      source, period: capture.period, clockSeconds: capture.clockSeconds, details })
  }
  const clock = (s: LiveGameState) => ({ period: s.period, seconds: s.clockSeconds, running: s.clockRunning, startedAt: s.clockStartedAt })
  if (JSON.stringify(clock(previous)) !== JSON.stringify(clock(next))) {
    add("clock", "change", { before: clock(previous), after: clock(next) })
  }
  const collections = [
    ["goals", "goal"], ["penalties", "penalty"], ["timeouts", "timeout"],
    ["goaliePulls", "goaliePull"], ["goalieChanges", "goalieChange"],
  ] as const
  for (const [key, kind] of collections) {
    const before = new Map((previous[key] ?? []).map(event => [event.id, event]))
    const after = new Map((next[key] ?? []).map(event => [event.id, event]))
    for (const [eventId, event] of after) {
      const old = before.get(eventId)
      if (!old) add(kind, "add", { eventId, event })
      else if (JSON.stringify(old) !== JSON.stringify(event)) add(kind, "edit", { eventId, before: old, event })
    }
    for (const [eventId, event] of before) {
      if (!after.has(eventId)) add(kind, "remove", { eventId, event })
    }
  }
  for (const side of ["home", "away"] as const) {
    const before = previous[`${side}Shots`]
    const after = next[`${side}Shots`]
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      const delta = (after[i] ?? 0) - (before[i] ?? 0)
      if (delta) add("shots", "change", { side, shotPeriod: i + 1, delta, total: after[i] ?? 0 })
    }
    const oldAttempts = previous.shootout?.[`${side}Attempts`] ?? []
    const attempts = next.shootout?.[`${side}Attempts`] ?? []
    if (JSON.stringify(oldAttempts) !== JSON.stringify(attempts)) {
      add("shootout", "change", { side, before: oldAttempts, after: attempts })
    }
  }
  const base = withoutGameTiming(next)
  if (!entries.length) return { ...base, ...(previous.timing ? { timing: previous.timing } : {}) }
  const timing: GameTiming = { version: 1, ...previous.timing, entries: [...(previous.timing?.entries ?? []), ...entries] }
  // Never call a mid-game resume the opening faceoff, or replace the first start.
  if (source === "device" && timing.firstPlayStartedAt == null && previous.period === 1 && next.period === 1
    && !previous.clockRunning && next.clockRunning && previous.clockSeconds === periodLength
    && !previous.timing?.hasPlayStarted
    && !(previous.timing?.entries ?? []).some(e => e.kind === "clock" && (e.details.after as { running?: boolean })?.running)
    && !previous.goals.length && !previous.penalties.length
    && !previous.homeShots.some(Boolean) && !previous.awayShots.some(Boolean)) {
    timing.firstPlayStartedAt = next.clockStartedAt ?? at
  }
  timing.hasPlayStarted = !!(previous.timing?.hasPlayStarted || previous.clockRunning || next.clockRunning
    || timing.entries.some(e => e.kind === "clock" && (e.details.after as { running?: boolean })?.running))
  return { ...base, timing }
}

/** Timing stays in stored/authenticated scorekeeper state, not public game payloads. */
export function withoutGameTiming<T extends { timing?: GameTiming }>(state: T): Omit<T, "timing"> {
  const { timing: _timing, ...publicState } = state
  return publicState
}

/** Only this compact summary is stored in game_live; entries live in game_timing_events. */
export function compactGameTiming(state: LiveGameState): LiveGameState {
  if (!state.timing) return state
  return { ...state, timing: {
    version: 1,
    ...(state.timing.firstPlayStartedAt != null ? { firstPlayStartedAt: state.timing.firstPlayStartedAt } : {}),
    hasPlayStarted: !!(state.timing.hasPlayStarted || state.timing.firstPlayStartedAt != null
      || state.timing.entries.some(e => e.kind === "clock" && (e.details.after as { running?: boolean })?.running)),
    entries: [],
  } }
}
