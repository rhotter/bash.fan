import { describe, expect, it } from "vitest"
import { fantasyHref, parseFantasyView } from "@/lib/fantasy/view-state"

const weeks = ["2026-11-07", "2026-11-14", "2026-11-21"]

describe("parseFantasyView", () => {
  it("defaults to the Fantasy tab and the latest Week", () => {
    expect(parseFantasyView({}, weeks)).toEqual({ tab: "fantasy", weekId: "2026-11-21" })
  })

  it("reads the tab and Week from the URL", () => {
    expect(parseFantasyView({ tab: "pickem", week: "2026-11-14" }, weeks)).toEqual({
      tab: "pickem",
      weekId: "2026-11-14",
    })
  })

  it("falls back for an unknown tab or Week", () => {
    expect(parseFantasyView({ tab: "bogus", week: "1999-01-01" }, weeks)).toEqual({
      tab: "fantasy",
      weekId: "2026-11-21",
    })
  })

  it("has no Week when there are none", () => {
    expect(parseFantasyView({ week: "2026-11-14" }, []).weekId).toBeNull()
  })

  it("starts on the given default Week, but still honours the URL", () => {
    expect(parseFantasyView({}, weeks, "2026-11-14").weekId).toBe("2026-11-14")
    expect(parseFantasyView({ week: "2026-11-21" }, weeks, "2026-11-14").weekId).toBe("2026-11-21")
  })
})

describe("fantasyHref", () => {
  it("keeps the tab and Week in the URL, leaving the default tab implicit", () => {
    expect(fantasyHref({ tab: "pickem", weekId: "2026-11-14" })).toBe("/fantasy?tab=pickem&week=2026-11-14")
    expect(fantasyHref({ tab: "fantasy", weekId: "2026-11-14" })).toBe("/fantasy?week=2026-11-14")
  })
})

describe("contest in the URL", () => {
  it("carries a named contest through parse and href, and leaves it out otherwise", () => {
    expect(parseFantasyView({ contest: "playoffs" }, weeks).contest).toBe("playoffs")
    expect(parseFantasyView({}, weeks)).not.toHaveProperty("contest")
    expect(fantasyHref({ tab: "pickem", weekId: "2026-11-14", contest: "playoffs" })).toBe(
      "/fantasy?contest=playoffs&tab=pickem&week=2026-11-14"
    )
  })
})

