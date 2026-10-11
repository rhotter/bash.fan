import { describe, expect, it } from "vitest"
import { formatSeasonName, seasonIdFromName } from "@/lib/season-name"

describe("Season display names", () => {
  it.each([
    ["BASH 2026-2027", "Fall 2026–27"],
    ["2024-2025", "Fall 2024–25"],
    ["2018-19", "Fall 2018–19"],
    ["1999-2000", "Fall 1999–00"],
    ["2026 Summer", "Summer 2026"],
    ["Summer 2026", "Summer 2026"],
    ["Fall 2026", "Fall 2026–27"],
    ["Fall 2026–27", "Fall 2026–27"],
    ["BASH 2026 Summer", "Summer 2026"],
    ["2003-2004 Rookie Registration", "Fall 2003–04 · Rookie Registration"],
    ["1997-1998 Playoffs Only", "Fall 1997–98 · Playoffs Only"],
    ["Fall 1997–98 · Playoffs Only", "Fall 1997–98 · Playoffs Only"],
    ["  2026 Summer  ", "Summer 2026"],
    ["Summer 2026 Alumni", "Summer 2026 · Alumni"],
  ])("formats %s as %s and is idempotent", (name, expected) => {
    expect(formatSeasonName(name)).toBe(expected)
    expect(formatSeasonName(expected)).toBe(expected)
  })

  it.each(["All Time", "Spring Invitational 2026", "2026 Charity Tournament", "Summer 2026-2027", "Fall 2026 Summer", "", "Unknown"])("preserves custom or ambiguous name %s", name => {
    expect(formatSeasonName(name)).toBe(name)
  })
})

 describe("New season identifiers", () => {
  it.each([
    ["Fall 2026–27", "2026-2027"],
    ["Summer 2026", "2026-summer"],
    ["Fall 1999–00", "1999-2000"],
    ["2026-2027", "2026-2027"],
    ["BASH 2026-2027", "bash-2026-2027"],
    ["Charity Tournament", "charity-tournament"],
  ])("keeps %s on the existing ID convention", (name, id) => {
    expect(seasonIdFromName(name)).toBe(id)
  })
})
