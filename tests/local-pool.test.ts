import { afterEach, describe, expect, it, vi } from "vitest"
import { getLocalPool } from "@/lib/db/local-pool"

// A pool connects only when queried, so none of these need a server.
const FIRST = "postgresql://postgres:postgres@localhost:5432/first"
const SECOND = "postgresql://postgres:postgres@localhost:5432/second"

describe("getLocalPool", () => {
  afterEach(() => vi.restoreAllMocks())

  it("reuses the pool for the same URL, and replaces it when the URL changes", () => {
    const first = getLocalPool(FIRST)
    expect(getLocalPool(FIRST)).toBe(first)

    const end = vi.spyOn(first, "end")
    const second = getLocalPool(SECOND)

    expect(second).not.toBe(first)
    expect(second.options.connectionString).toBe(SECOND)
    expect(end).toHaveBeenCalledOnce()
  })

  it("logs a dropped idle connection instead of crashing the process", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    // An EventEmitter throws on an "error" event that nothing listens for.
    expect(() => getLocalPool(FIRST).emit("error", new Error("terminating connection"), {})).not.toThrow()
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[db]"), "terminating connection")
  })
})
