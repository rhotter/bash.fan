import { fetchApi as fetch, readApiJson, errorMessage } from "@/lib/api-errors"
import type { LiveGameState } from "./scorekeeper-types"

const STORAGE_PREFIX = "bash-live-"
const TIMING_ACK_PREFIX = "bash-timing-acked-"

export function getStorageKey(gameId: string) {
  return `${STORAGE_PREFIX}${gameId}`
}

export function saveToLocalStorage(gameId: string, state: LiveGameState, expectedState?: LiveGameState | null) {
  try {
    // Keep the original server snapshot and correction together across reloads.
    localStorage.setItem(getStorageKey(gameId), JSON.stringify(expectedState ? { state, expectedState } : state))
    return true
  } catch {
    return false
  }
}

export function loadLocalDraft(gameId: string): { state: LiveGameState; expectedState?: LiveGameState } | null {
  try {
    const raw = localStorage.getItem(getStorageKey(gameId))
    if (!raw) return null
    const saved = JSON.parse(raw)
    return saved.state && saved.expectedState ? saved : { state: saved as LiveGameState }
  } catch {
    return null
  }
}

export function loadFromLocalStorage(gameId: string): LiveGameState | null {
  return loadLocalDraft(gameId)?.state ?? null
}

export function clearLocalStorage(gameId: string) {
  try {
    localStorage.removeItem(getStorageKey(gameId))
    localStorage.removeItem(`${TIMING_ACK_PREFIX}${gameId}`)
  } catch {
    // ignore
  }
}

export type SyncStatus = "synced" | "syncing" | "pending" | "offline" | "error"

export function createSyncManager(gameId: string, pin: string) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let pendingState: LiveGameState | null = null
  let syncing: Promise<boolean> | null = null
  let lastSyncedUpdatedAt: number | null = null
  let destroyed = false
  let onStatusChange: ((status: SyncStatus, message?: string) => void) | null = null
  let lastError: string | null = null
  let networkFailure = false
  let shouldRetry = true

  // Keep only confirmed IDs. A failed response/beacon never advances this ledger.
  const acknowledgedTiming = new Set<string>()
  try {
    const saved = JSON.parse(localStorage.getItem(`${TIMING_ACK_PREFIX}${gameId}`) ?? "[]")
    if (Array.isArray(saved)) for (const id of saved) if (typeof id === "string") acknowledgedTiming.add(id)
  } catch { /* Missing storage means safe, idempotent resends after reload. */ }

  function prepareState(state: LiveGameState): LiveGameState {
    if (!state.timing) return state
    return { ...state, timing: { ...state.timing, entries: state.timing.entries.filter(e => !acknowledgedTiming.has(e.id)) } }
  }

  async function doSync(state: LiveGameState): Promise<boolean> {
    try {
      const outgoing = prepareState(state)
      const res = await fetch(`/api/bash/scorekeeper/${gameId}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-pin": pin },
        body: JSON.stringify(outgoing),
      })
      networkFailure = false
      shouldRetry = res.status == null || res.status >= 500 || res.status === 429
      lastError = res.ok ? null : (await readApiJson(res)).error
      if (res.ok && outgoing.timing?.entries.length && typeof res.json === "function") {
        const body = await readApiJson(res)
        const sentIds = new Set(outgoing.timing.entries.map(e => e.id))
        if (Array.isArray(body.timingAckIds)) {
          for (const id of body.timingAckIds) if (sentIds.has(id)) acknowledgedTiming.add(id)
          try { localStorage.setItem(`${TIMING_ACK_PREFIX}${gameId}`, JSON.stringify([...acknowledgedTiming])) } catch { /* retry is safe */ }
        }
      }
      return res.ok
    } catch (error) {
      networkFailure = true
      shouldRetry = true
      lastError = errorMessage(error, "Could not save the latest changes. Please try again.")
      return false
    }
  }

  async function flush(): Promise<boolean> {
    if (timer) { clearTimeout(timer); timer = null }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    if (syncing) {
      const ok = await syncing
      return ok && pendingState ? flush() : ok
    }
    if (!pendingState) return true
    const run = async () => {
      while (pendingState) {
        onStatusChange?.("syncing")
        const state = pendingState
        pendingState = null
        const ok = await doSync(state)
        if (!ok) {
          // Keep a newer edit made while this request was in flight.
          pendingState ??= state
          onStatusChange?.(networkFailure ? "offline" : "error", lastError ?? undefined)
          if (!destroyed && shouldRetry) retryTimer = setTimeout(() => { void flush() }, 5000)
          return false
        }
        lastSyncedUpdatedAt = state.updatedAt
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
      }
      onStatusChange?.("synced")
      return true
    }
    syncing = run()
    try { return await syncing } finally { syncing = null }
  }

  function scheduleSync(state: LiveGameState) {
    if (destroyed) return
    pendingState = state
    onStatusChange?.("pending")

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => flush(), 500)
  }

  function sendBeacon(state: LiveGameState) {
    try {
      const blob = new Blob([JSON.stringify(prepareState(state))], { type: "application/json" })
      navigator.sendBeacon(`/api/bash/scorekeeper/${gameId}/state?pin=${pin}`, blob)
    } catch {
      // best-effort
    }
  }

  function setStatusListener(listener: (status: SyncStatus, message?: string) => void) {
    onStatusChange = listener
  }

  function destroy() {
    destroyed = true
    if (timer) clearTimeout(timer)
    if (retryTimer) clearTimeout(retryTimer)
  }

  return { prepareState, scheduleSync, sendBeacon, setStatusListener, destroy, flush, getLastSyncedUpdatedAt: () => lastSyncedUpdatedAt, getLastError: () => lastError, isOffline: () => networkFailure, canAutoRetry: () => lastError == null || shouldRetry }
}
