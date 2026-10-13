import { afterEach, describe, expect, it, vi } from "vitest"
import { apiErrorMessage, fetchApi, readApiJson } from "@/lib/api-errors"

afterEach(() => vi.unstubAllGlobals())

describe("User-facing API failures", () => {
  it("keeps validation and conflict instructions instead of replacing them with a password error", async () => {
    for (const status of [409, 422]) {
      const response = new Response(JSON.stringify({ error: "A newer result was saved. Reload this game." }), { status })
      expect((await readApiJson(response)).error).toBe("A newer result was saved. Reload this game.")
    }
    expect(apiErrorMessage({ status: 422, url: "" }, { error: "Select at least one player." })).toBe("Select at least one player.")
  })

  it("distinguishes session, permission, and rate-limit failures", () => {
    expect(apiErrorMessage({ status: 401, url: "/api/bash/admin/login" })).toContain("Invalid PIN")
    expect(apiErrorMessage({ status: 401, url: "/api/bash/admin/players" })).toContain("sign in again")
    expect(apiErrorMessage({ status: 403, url: "" })).toContain("permission")
    expect(apiErrorMessage({ status: 429, url: "" })).toContain("Wait a moment")
  })

  it("does not expose HTML, SQL, or server details when a write fails", async () => {
    for (const response of [
      new Response("<html>Bad gateway</html>", { status: 502 }),
      new Response(JSON.stringify({ error: "SELECT password FROM secrets", details: "postgres stack trace" }), { status: 500 }),
    ]) {
      const data = await readApiJson(response)
      expect(data.error).toContain("Reload to check")
      expect(data.error).not.toMatch(/password|secrets|gateway|postgres|html/i)
      expect(data.details).toBeUndefined()
    }
  })

  it("preserves accepted-state recovery even when finalization fails", async () => {
    const state = { goals: [], updatedAt: 123 }
    const data = await readApiJson(new Response(JSON.stringify({ stateSaved: true, state, error: "Internal error" }), { status: 500 }))
    expect(data.stateSaved).toBe(true)
    expect(data.state).toEqual(state)
    expect(data.error).toContain("game was saved")
    expect(data.error).toContain("Retry saving")
  })

  it("rejects a failed read rather than treating its body as an empty successful list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Database unavailable", players: [] }), { status: 503 })))
    await expect(fetchApi("/api/bash/players")).rejects.toThrow("Reload to check")
  })

  it("rejects an unreadable success response rather than confirming that a save succeeded", async () => {
    await expect(readApiJson(new Response("<html>Unexpected response</html>"))).rejects.toThrow("unexpected response")
  })

  it("describes an interrupted mutation as unconfirmed instead of saying nothing was saved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch") }))
    await expect(fetchApi("/api/bash/admin/players", { method: "POST" })).rejects.toThrow("Could not confirm whether")
    await expect(fetchApi("/api/bash/players")).rejects.toThrow("Check your connection")
  })
})
