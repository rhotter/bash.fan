import { afterEach, describe, expect, it, vi } from "vitest"
import { authenticateScorekeeper } from "@/lib/scorekeeper-login"

afterEach(() => vi.unstubAllGlobals())

describe("Scorekeeper PIN login", () => {
  it.each(["live", "final"])("authenticates a %s game without saving or changing its state", async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal("fetch", fetch)
    expect(await authenticateScorekeeper("g55", status, "  test-pin  ")).toBe("test-pin")
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/bash/admin/validate-pin", {
      method: "POST", headers: { "x-pin": "test-pin" },
    })
  })

  it("validates before initializing an upcoming game", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal("fetch", fetch)
    await authenticateScorekeeper("g55", "upcoming", "test-pin")
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/bash/admin/validate-pin", "/api/bash/scorekeeper/g55/start",
    ])
  })

  it("rejects a wrong PIN without attempting to start a game", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ error: "Invalid PIN" }), { status: 401 }))
    vi.stubGlobal("fetch", fetch)
    await expect(authenticateScorekeeper("g55", "upcoming", "wrong")).rejects.toThrow("Invalid PIN")
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("shows a game failure rather than blaming the password", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Game not found" }), { status: 404 }))
    vi.stubGlobal("fetch", fetch)
    await expect(authenticateScorekeeper("g55", "upcoming", "test-pin")).rejects.toThrow("Game not found")
  })

  it("does not label a server failure as an invalid PIN", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>(async () => new Response("Server error", { status: 500 })))
    await expect(authenticateScorekeeper("g55", "live", "test-pin")).rejects.toThrow("Reload to check")
  })
})
