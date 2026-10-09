import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSyncManager } from "@/lib/scorekeeper-sync"
import { createInitialState } from "@/lib/scorekeeper-types"

const pending = () => {
  let resolve!: (value: { ok: boolean }) => void
  const promise = new Promise<{ ok: boolean }>((r) => { resolve = r })
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
})
