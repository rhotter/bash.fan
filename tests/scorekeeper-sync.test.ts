import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSyncManager, saveToLocalStorage } from "@/lib/scorekeeper-sync"
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
  it("does not claim a device backup succeeded if browser storage rejects it", () => {
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("Storage full") } })
    expect(saveToLocalStorage("g1", state(1))).toBe(false)
  })
  it.each([401, 409, 422])("reports HTTP %i as a save error, not offline, and stops automatic retries", async (status) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "A newer state was saved. Reload this game." }), { status }))
    vi.stubGlobal("fetch", fetch)
    const listener = vi.fn()
    const sync = createSyncManager("g1", "pin")
    sync.setStatusListener(listener)
    sync.scheduleSync(state(1))
    expect(await sync.flush()).toBe(false)
    expect(listener).toHaveBeenLastCalledWith("error", expect.any(String))
    expect(sync.getLastError()).toBeTruthy()
    expect(sync.canAutoRetry()).toBe(false)
    await vi.advanceTimersByTimeAsync(11000)
    expect(fetch).toHaveBeenCalledTimes(1)
    sync.destroy()
  })
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

describe("incremental timing uploads", () => {
  const event = (id: string) => ({ id, kind: "clock" as const, action: "change" as const,
    capturedAt: 1000, recordedAt: 1000, source: "device" as const, period: 1, clockSeconds: 1200, details: {} })
  const timed = (updatedAt: number, ids: string[]) => ({ ...state(updatedAt), timing: { version: 1 as const,
    firstPlayStartedAt: 1000, hasPlayStarted: true, entries: ids.map(event) } })
  function storage() {
    const values = new Map<string, string>()
    vi.stubGlobal("localStorage", { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) })
  }
  it("sends only unacknowledged entries across saves and reloads", async () => {
    storage()
    const fetch = vi.fn(async (_url, options) => {
      const ids = JSON.parse(options.body).timing.entries.map((e: { id: string }) => e.id)
      return new Response(JSON.stringify({ ok: true, timingAckIds: ids }))
    })
    vi.stubGlobal("fetch", fetch)
    const sync = createSyncManager("g1", "pin")
    sync.scheduleSync(timed(1, ["first"]))
    expect(await sync.flush()).toBe(true)
    sync.scheduleSync(timed(2, ["first", "second"]))
    expect(await sync.flush()).toBe(true)
    expect(JSON.parse(fetch.mock.calls[1][1].body).timing.entries.map((e: { id: string }) => e.id)).toEqual(["second"])
    sync.destroy()
    const reloaded = createSyncManager("g1", "pin")
    reloaded.scheduleSync(timed(3, ["first", "second", "third"]))
    expect(await reloaded.flush()).toBe(true)
    expect(JSON.parse(fetch.mock.calls[2][1].body).timing.entries.map((e: { id: string }) => e.id)).toEqual(["third"])
    reloaded.scheduleSync(timed(4, ["first", "second", "third"]))
    expect(await reloaded.flush()).toBe(true)
    expect(JSON.parse(fetch.mock.calls[3][1].body).timing.entries).toEqual([])
    reloaded.destroy()
  })
  it("resends after an uncertain response and never treats a beacon as an acknowledgment", async () => {
    storage()
    const fetch = vi.fn().mockRejectedValueOnce(new Error("response lost after commit"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, timingAckIds: ["first"] })))
    vi.stubGlobal("fetch", fetch)
    vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => true) })
    const sync = createSyncManager("g1", "pin")
    sync.scheduleSync(timed(1, ["first"]))
    expect(await sync.flush()).toBe(false)
    sync.sendBeacon(timed(1, ["first"]))
    expect(sync.prepareState(timed(1, ["first"])).timing?.entries).toHaveLength(1)
    expect(await sync.flush()).toBe(true)
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body)
    expect(sync.prepareState(timed(2, ["first"])).timing?.entries).toEqual([])
    sync.destroy()
  })
  it("only acknowledges IDs actually included in the confirmed request", async () => {
    storage()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, timingAckIds: ["first", "not-sent"] }))))
    const sync = createSyncManager("g1", "pin")
    sync.scheduleSync(timed(1, ["first"]))
    expect(await sync.flush()).toBe(true)
    expect(sync.prepareState(timed(2, ["first", "not-sent"])).timing?.entries.map(e => e.id)).toEqual(["not-sent"])
    sync.destroy()
  })
})
