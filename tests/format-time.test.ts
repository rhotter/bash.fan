import { describe, it, expect } from "vitest"
import {
  toHHMM,
  normalizeTimeForStorage,
  formatGameTime,
  compareGameTimes,
  compareGamesChronological,
} from "@/lib/format-time"

describe("lib/format-time", () => {
  describe("toHHMM", () => {
    it("converts 12-hour AM/PM times to 24-hour HH:MM format", () => {
      expect(toHHMM("9:00am")).toBe("09:00")
      expect(toHHMM("9:30am")).toBe("09:30")
      expect(toHHMM("11:00am")).toBe("11:00")
      expect(toHHMM("12:00pm")).toBe("12:00")
      expect(toHHMM("1:00pm")).toBe("13:00")
      expect(toHHMM("1:15pm")).toBe("13:15")
      expect(toHHMM("11:00pm")).toBe("23:00")
      expect(toHHMM("12:00am")).toBe("00:00")
      expect(toHHMM("12:30am")).toBe("00:30")
    })

    it("handles Sportability shorthands and spaces", () => {
      expect(toHHMM("9:00a")).toBe("09:00")
      expect(toHHMM("1:00p")).toBe("13:00")
      expect(toHHMM("9:00 AM")).toBe("09:00")
      expect(toHHMM("1:00 PM")).toBe("13:00")
    })

    it("returns empty string for TBD, empty, and invalid times", () => {
      expect(toHHMM("TBD")).toBe("")
      expect(toHHMM("tbd")).toBe("")
      expect(toHHMM("")).toBe("")
      expect(toHHMM(null)).toBe("")
      expect(toHHMM(undefined)).toBe("")
      expect(toHHMM("Invalid")).toBe("")
    })
  })

  describe("normalizeTimeForStorage & formatGameTime", () => {
    it("normalizes times to canonical h:mmam/pm", () => {
      expect(normalizeTimeForStorage("9:00p")).toBe("9:00pm")
      expect(normalizeTimeForStorage("09:00")).toBe("9:00am")
      expect(normalizeTimeForStorage("14:00")).toBe("2:00pm")
      expect(normalizeTimeForStorage("TBD")).toBe("TBD")
      expect(formatGameTime("9:00a")).toBe("9:00am")
      expect(formatGameTime("TBD")).toBe("TBD")
    })
  })

  describe("compareGameTimes", () => {
    it("sorts 12-hour times chronologically without string comparison bugs", () => {
      // The classic string bug: "1:00pm" < "9:00am" because '1' < '9'
      expect(compareGameTimes("9:00am", "1:00pm")).toBeLessThan(0)
      expect(compareGameTimes("1:00pm", "9:00am")).toBeGreaterThan(0)
      expect(compareGameTimes("11:00am", "1:00pm")).toBeLessThan(0)
      expect(compareGameTimes("1:00pm", "11:00am")).toBeGreaterThan(0)
      expect(compareGameTimes("1:00pm", "11:00pm")).toBeLessThan(0)
      expect(compareGameTimes("11:00pm", "1:00pm")).toBeGreaterThan(0)
    })

    it("correctly orders morning -> noon -> afternoon -> night", () => {
      const times = ["1:00pm", "11:00pm", "9:00am", "12:00pm", "11:00am", "12:00am"]
      const sorted = [...times].sort(compareGameTimes)
      expect(sorted).toEqual([
        "12:00am",
        "9:00am",
        "11:00am",
        "12:00pm",
        "1:00pm",
        "11:00pm",
      ])
    })

    it("places TBD and unset times at the end", () => {
      const times = ["TBD", "1:00pm", "9:00am", "TBD", "11:00am"]
      const sorted = [...times].sort(compareGameTimes)
      expect(sorted).toEqual([
        "9:00am",
        "11:00am",
        "1:00pm",
        "TBD",
        "TBD",
      ])
      expect(compareGameTimes("9:00am", null)).toBeLessThan(0)
      expect(compareGameTimes(null, "9:00am")).toBeGreaterThan(0)
      expect(compareGameTimes("9:00am", "")).toBeLessThan(0)
      expect(compareGameTimes("", "9:00am")).toBeGreaterThan(0)
    })

    it("returns 0 for identical times", () => {
      expect(compareGameTimes("1:00pm", "1:00pm")).toBe(0)
      expect(compareGameTimes("TBD", "TBD")).toBe(0)
    })
  })

  describe("compareGamesChronological", () => {
    it("sorts games by date first, then chronologically by time", () => {
      const games = [
        { id: "g3", date: "2026-10-11", time: "1:00pm" },
        { id: "g5", date: "2026-10-18", time: "9:00am" },
        { id: "g1", date: "2026-10-11", time: "9:00am" },
        { id: "g4", date: "2026-10-11", time: "TBD" },
        { id: "g2", date: "2026-10-11", time: "11:00am" },
      ]

      const sorted = [...games].sort(compareGamesChronological)

      expect(sorted.map((g) => `${g.date} ${g.time} (${g.id})`)).toEqual([
        "2026-10-11 9:00am (g1)",
        "2026-10-11 11:00am (g2)",
        "2026-10-11 1:00pm (g3)",
        "2026-10-11 TBD (g4)",
        "2026-10-18 9:00am (g5)",
      ])
    })

    it("breaks ties with game id", () => {
      const games = [
        { id: "g-beta", date: "2026-10-11", time: "10:00am" },
        { id: "g-alpha", date: "2026-10-11", time: "10:00am" },
      ]
      const sorted = [...games].sort(compareGamesChronological)
      expect(sorted[0].id).toBe("g-alpha")
      expect(sorted[1].id).toBe("g-beta")
    })

    it("correctly treats ISO timestamps with 'T' and plain YYYY-MM-DD as the same date", () => {
      const games = [
        { id: "g2", date: "2026-10-11T00:00:00.000Z", time: "1:00pm" },
        { id: "g1", date: "2026-10-11", time: "9:00am" },
      ]
      const sorted = [...games].sort(compareGamesChronological)
      expect(sorted[0].id).toBe("g1")
      expect(sorted[1].id).toBe("g2")
    })

    it("sorts whitespace-only dates to the end alongside null/undefined", () => {
      const games = [
        { id: "g-blank", date: "   ", time: "9:00am" },
        { id: "g-valid", date: "2026-10-11", time: "9:00am" },
        { id: "g-empty", date: "", time: "9:00am" },
      ]
      const sorted = [...games].sort(compareGamesChronological)
      expect(sorted[0].id).toBe("g-valid")
      expect(sorted.slice(1).map((g) => g.id)).toEqual(["g-blank", "g-empty"])
    })
  })
})
