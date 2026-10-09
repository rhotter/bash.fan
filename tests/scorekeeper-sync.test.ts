import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSyncManager } from "@/lib/scorekeeper-sync"
import { createInitialState } from "@/lib/scorekeeper-types"

const pending = () => {
  type Reply = { ok: boolean; status?: number; json?: () => Promise<Record<string, unknown>> }
  let resolve!: (value: Reply) => void
  const promise = new Promise<Reply>((r) => { resolve = r })
  return { promise, resolve }
}
const state = (updatedAt: number) => ({ ...createInitialState(), updatedAt })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe("scorekeeper save/finalize synchronization", () => {
  it("waits for an in-flight save and drains newer state before allowing finalization", async () => {
    const first = pending()
    const second = pending()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    vi.stubGlobal("fetch", fetch)
    const sync = createSyncManager("g1", "pin")
    sync.scheduleSync(state(1))
    const oldFlush = sync.flush()
    sync.scheduleSync(state(2))
    let finished = false
    const finalizeFlush = sync.flush().then((ok) => { finished = true; return ok })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(finished).toBe(false)
    first.resolve({ ok: true })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(finished).toBe(false)
    expect(JSON.parse(fetch.mock.calls[1][1].body).updatedAt).toBe(2)
    second.resolve({ ok: true })
    expect(await finalizeFlush).toBe(true)
    expect(await oldFlush).toBe(true)
    expect(sync.getLastSyncedUpdatedAt()).toBe(2)
    sync.destroy()
  })

  it("does not replace a newer pending correction with an older failed request", async () => {
    const first = pending()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetch)
    const sync = createSyncManager("g1", "pin")
    sync.scheduleSync(state(1))
    const saving = sync.flush()
    sync.scheduleSync(state(2))
    first.resolve({ ok: false })
    expect(await saving).toBe(false)
    expect(sync.getLastSyncedUpdatedAt()).toBeNull()
    expect(await sync.flush()).toBe(true)
    expect(JSON.parse(fetch.mock.calls[1][1].body).updatedAt).toBe(2)
    sync.destroy()
  })

  it("reports failed sync so finalization cannot run on unsaved state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    const sync = createSyncManager("g1", "pin")
    sync.scheduleSync(state(1))
    expect(await sync.flush()).toBe(false)
    expect(sync.getLastSyncedUpdatedAt()).toBeNull()
    sync.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("cancels pending saves, retry timers and beacons after a terminal forfeit", async () => {
    const first = pending()
    const fetch = vi.fn().mockReturnValueOnce(first.promise)
    const sendBeacon = vi.fn()
    const onForfeited = vi.fn()
    const onStatus = vi.fn()
    vi.stubGlobal("fetch", fetch)
    vi.stubGlobal("navigator", { sendBeacon })
    const sync = createSyncManager("g1", "pin", onForfeited)
    sync.setStatusListener(onStatus)
    sync.scheduleSync(state(1))
    const saving = sync.flush()
    sync.scheduleSync(state(2))
    const terminal = { code: "GAME_FORFEITED", error: "The game was forfeited", finalizationCanceled: true, state: state(1) }
    first.resolve({ ok: false, status: 409, json: async () => terminal })

    expect(await saving).toBe(false)
    expect(onForfeited).toHaveBeenCalledExactlyOnceWith(terminal)
    expect(sync.getLastSyncedUpdatedAt()).toBeNull()
    expect(onStatus).not.toHaveBeenCalledWith("offline")
    expect(vi.getTimerCount()).toBe(0)
    sync.scheduleSync(state(3))
    expect(await sync.flush()).toBe(false)
    sync.sendBeacon(state(3))
    await vi.advanceTimersByTimeAsync(15000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(sendBeacon).not.toHaveBeenCalled()
    expect(onForfeited).toHaveBeenCalledTimes(1)
  })

  it.each([409, 503])("keeps ordinary %i sync failures retryable", async (status) => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status, json: async () => ({ error: "Try again" }) })
      .mockResolvedValue({ ok: true })
    const onForfeited = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const sync = createSyncManager("g1", "pin", onForfeited)
    sync.scheduleSync(state(1))
    await vi.advanceTimersByTimeAsync(500)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(onForfeited).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(sync.getLastSyncedUpdatedAt()).toBe(1)
    sync.destroy()
  })

  it("does not start a queued save or report a terminal result after destruction", async () => {
    const first = pending()
    const fetch = vi.fn().mockReturnValueOnce(first.promise)
    const onForfeited = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const sync = createSyncManager("g1", "pin", onForfeited)
    sync.scheduleSync(state(1))
    const saving = sync.flush()
    sync.scheduleSync(state(2))
    sync.destroy()
    first.resolve({ ok: false, status: 409, json: async () => ({ code: "GAME_FORFEITED" }) })
    expect(await saving).toBe(false)
    await vi.advanceTimersByTimeAsync(15000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(onForfeited).not.toHaveBeenCalled()
  })
})
