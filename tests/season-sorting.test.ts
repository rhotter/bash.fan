import { describe, expect, it } from "vitest"
import { getSeasonSortWeight, compareSeasonsDesc } from "@/lib/seasons"

describe("Season Chronological Sorting", () => {
  it("assigns correct chronological sort weights", () => {
    // Within 2025: Summer is earlier than Fall
    const summer2025 = getSeasonSortWeight("2025-summer", "summer")
    const fall2025 = getSeasonSortWeight("2025-2026", "fall")
    expect(fall2025).toBeGreaterThan(summer2025)

    // Between 2025 and 2026:
    // Summer 2025 < Fall 2025-2026 < Summer 2026 < Fall 2026-2027
    const summer2026 = getSeasonSortWeight("2026-summer", "summer")
    const fall2026 = getSeasonSortWeight("bash-2026-2027", "fall")

    expect(summer2026).toBeGreaterThan(fall2025)
    expect(fall2026).toBeGreaterThan(summer2026)
  })

  it("sorts seasons in reverse chronological order (newest to oldest)", () => {
    const seasons = [
      { seasonId: "2025-2026", seasonType: "fall" },
      { seasonId: "2026-summer", seasonType: "summer" },
      { seasonId: "2025-summer", seasonType: "summer" },
    ]

    const sorted = [...seasons].sort(compareSeasonsDesc)

    expect(sorted.map((s) => s.seasonId)).toEqual([
      "2026-summer",
      "2025-2026",
      "2025-summer",
    ])
  })

  it("correctly handles longer history across multiple years", () => {
    const seasons = [
      { seasonId: "2024-summer", seasonType: "summer" },
      { seasonId: "2025-summer", seasonType: "summer" },
      { seasonId: "2025-2026", seasonType: "fall" },
      { seasonId: "2024-2025", seasonType: "fall" },
      { seasonId: "2026-summer", seasonType: "summer" },
      { seasonId: "bash-2026-2027", seasonType: "fall" },
    ]

    const sorted = [...seasons].sort(compareSeasonsDesc)

    expect(sorted.map((s) => s.seasonId)).toEqual([
      "bash-2026-2027",
      "2026-summer",
      "2025-2026",
      "2025-summer",
      "2024-2025",
      "2024-summer",
    ])
  })

  it("handles objects with id property (as returned by getAllSeasons)", () => {
    const seasons = [
      { id: "2025-summer", seasonType: "summer" },
      { id: "2026-summer", seasonType: "summer" },
      { id: "2025-2026", seasonType: "fall" },
    ]

    const sorted = [...seasons].sort(compareSeasonsDesc)

    expect(sorted.map((s) => s.id)).toEqual([
      "2026-summer",
      "2025-2026",
      "2025-summer",
    ])
  })

  it("uses deterministic secondary tie-breaker when weights are equal", () => {
    const seasons = [
      { id: "tournament-a" },
      { id: "tournament-b" },
    ]

    const sorted = [...seasons].sort(compareSeasonsDesc)
    expect(sorted.map((s) => s.id)).toEqual([
      "tournament-b",
      "tournament-a",
    ])
  })
})
