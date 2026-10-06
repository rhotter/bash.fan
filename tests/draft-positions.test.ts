import { describe, expect, it } from "vitest"
import {
  isNotGoaliePosition,
  isPlayerGoalie,
  matchesPositionFilter,
} from "@/lib/draft-helpers"

describe("Draft Position Helpers", () => {
  describe("isNotGoaliePosition", () => {
    it("detects 'not goalie' variations", () => {
      expect(isNotGoaliePosition("not goalie")).toBe(true)
      expect(isNotGoaliePosition("Not Goalie")).toBe(true)
      expect(isNotGoaliePosition("not a goalie")).toBe(true)
      expect(isNotGoaliePosition("anywhere but goalie")).toBe(true)
      expect(isNotGoaliePosition("any but goalie")).toBe(true)
      expect(isNotGoaliePosition("anything but goalie")).toBe(true)
      expect(isNotGoaliePosition("no goalie")).toBe(true)
      expect(isNotGoaliePosition("never goalie")).toBe(true)
      expect(isNotGoaliePosition("all except goalie")).toBe(true)
      expect(isNotGoaliePosition("not G")).toBe(true)
      expect(isNotGoaliePosition("no G")).toBe(true)
      expect(isNotGoaliePosition("not a G")).toBe(true)
      expect(isNotGoaliePosition("no goalies")).toBe(true)
      expect(isNotGoaliePosition("not goalies")).toBe(true)
      expect(isNotGoaliePosition("all except goalies")).toBe(true)
    })

    it("does not false-positive on actual goalie positions", () => {
      expect(isNotGoaliePosition("Goalie")).toBe(false)
      expect(isNotGoaliePosition("G")).toBe(false)
      expect(isNotGoaliePosition("G, D, F")).toBe(false)
      expect(isNotGoaliePosition("D/Goalie")).toBe(false)
      expect(isNotGoaliePosition("Goalie, Wing")).toBe(false)
      expect(isNotGoaliePosition("Defense, forward, goalie")).toBe(false)
      expect(isNotGoaliePosition("Forward")).toBe(false)
      expect(isNotGoaliePosition("All")).toBe(false)
      expect(isNotGoaliePosition(null)).toBe(false)
    })
  })

  describe("isPlayerGoalie", () => {
    it("identifies goalies correctly", () => {
      expect(isPlayerGoalie("Goalie")).toBe(true)
      expect(isPlayerGoalie("goalie")).toBe(true)
      expect(isPlayerGoalie("Goalies")).toBe(true)
      expect(isPlayerGoalie("Goalkeepers")).toBe(true)
      expect(isPlayerGoalie("Netminders")).toBe(true)
      expect(isPlayerGoalie("G")).toBe(true)
      expect(isPlayerGoalie("G, D, F")).toBe(true)
      expect(isPlayerGoalie("D/Goalie")).toBe(true)
      expect(isPlayerGoalie("Goalie, Wing")).toBe(true)
    })

    it("rejects non-goalies and 'not goalie'", () => {
      expect(isPlayerGoalie("not goalie")).toBe(false)
      expect(isPlayerGoalie("Not Goalie")).toBe(false)
      expect(isPlayerGoalie("not G")).toBe(false)
      expect(isPlayerGoalie("no G")).toBe(false)
      expect(isPlayerGoalie("anywhere but goalie")).toBe(false)
      expect(isPlayerGoalie("Defense")).toBe(false)
      expect(isPlayerGoalie("Center")).toBe(false)
      expect(isPlayerGoalie("Forward")).toBe(false)
      expect(isPlayerGoalie(null)).toBe(false)
    })
  })

  describe("matchesPositionFilter", () => {
    it("returns true when filter is empty", () => {
      expect(matchesPositionFilter("not goalie", [])).toBe(true)
      expect(matchesPositionFilter("Goalie", [])).toBe(true)
    })

    it("filters out 'not goalie' and 'not G' from Goalie (G) filter", () => {
      expect(matchesPositionFilter("not goalie", ["G"])).toBe(false)
      expect(matchesPositionFilter("Not Goalie", ["G"])).toBe(false)
      expect(matchesPositionFilter("not G", ["G"])).toBe(false)
      expect(matchesPositionFilter("no G", ["G"])).toBe(false)
      expect(matchesPositionFilter("anywhere but goalie", ["G"])).toBe(false)
    })

    it("allows 'not goalie' to match D, C, and F filters", () => {
      expect(matchesPositionFilter("not goalie", ["D"])).toBe(true)
      expect(matchesPositionFilter("not goalie", ["C"])).toBe(true)
      expect(matchesPositionFilter("not goalie", ["F"])).toBe(true)
      expect(matchesPositionFilter("not G", ["D"])).toBe(true)
      expect(matchesPositionFilter("anywhere but goalie", ["D"])).toBe(true)
      expect(matchesPositionFilter("anywhere but goalie", ["C"])).toBe(true)
      expect(matchesPositionFilter("anywhere but goalie", ["F"])).toBe(true)
    })

    it("restricts compound positions like 'Defense, not goalie' to their specific position", () => {
      expect(matchesPositionFilter("Defense, not goalie", ["D"])).toBe(true)
      expect(matchesPositionFilter("Defense, not goalie", ["F"])).toBe(false)
      expect(matchesPositionFilter("Defense, not goalie", ["C"])).toBe(false)
      expect(matchesPositionFilter("Defense, not goalie", ["G"])).toBe(false)

      expect(matchesPositionFilter("Forward, not goalie", ["F"])).toBe(true)
      expect(matchesPositionFilter("Forward, not goalie", ["D"])).toBe(false)
      expect(matchesPositionFilter("Forward, not goalie", ["C"])).toBe(false)
      expect(matchesPositionFilter("Forward, not goalie", ["G"])).toBe(false)
    })

    it("handles multi-selection filters", () => {
      // If user filters for G and D, 'not goalie' matches because of D
      expect(matchesPositionFilter("not goalie", ["G", "D"])).toBe(true)
      // If user filters only for G, 'not goalie' does not match
      expect(matchesPositionFilter("not goalie", ["G"])).toBe(false)
    })

    it("correctly matches actual goalies", () => {
      expect(matchesPositionFilter("Goalie", ["G"])).toBe(true)
      expect(matchesPositionFilter("Goalies", ["G"])).toBe(true)
      expect(matchesPositionFilter("Goalkeepers", ["G"])).toBe(true)
      expect(matchesPositionFilter("Netminders", ["G"])).toBe(true)
      expect(matchesPositionFilter("Goalie", ["D"])).toBe(false)
      expect(matchesPositionFilter("Goalie, Wing", ["G"])).toBe(true)
      expect(matchesPositionFilter("Goalie, Wing", ["F"])).toBe(true)
      expect(matchesPositionFilter("Goalie, Wing", ["D"])).toBe(false)
    })

    it("correctly matches skater positions", () => {
      expect(matchesPositionFilter("Defense", ["D"])).toBe(true)
      expect(matchesPositionFilter("Defense", ["F"])).toBe(false)
      expect(matchesPositionFilter("Center", ["C"])).toBe(true)
      expect(matchesPositionFilter("Wing", ["F"])).toBe(true)
      expect(matchesPositionFilter("All", ["G"])).toBe(true)
      expect(matchesPositionFilter("All", ["D"])).toBe(true)
    })
  })

  describe("parsePositionTags", () => {
    it("parses 'not goalie' as skater positions without G", async () => {
      const { parsePositionTags } = await import("@/lib/csv-utils")
      const tags = parsePositionTags("not goalie")
      expect(tags).not.toContain("G")
      expect(tags).toContain("F")
      expect(tags).toContain("D")
    })

    it("parses 'Defense, not goalie' correctly", async () => {
      const { parsePositionTags } = await import("@/lib/csv-utils")
      const tags = parsePositionTags("Defense, not goalie")
      expect(tags).not.toContain("G")
      expect(tags).toContain("D")
    })

    it("parses 'Goalie' correctly", async () => {
      const { parsePositionTags } = await import("@/lib/csv-utils")
      const tags = parsePositionTags("Goalie")
      expect(tags).toEqual(["G"])
    })

    it("parses plural 'Goalies' and 'Goalkeepers' correctly", async () => {
      const { parsePositionTags } = await import("@/lib/csv-utils")
      expect(parsePositionTags("Goalies")).toEqual(["G"])
      expect(parsePositionTags("Goalkeepers")).toEqual(["G"])
      expect(parsePositionTags("Netminders")).toEqual(["G"])
    })
  })
})
