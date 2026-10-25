import { describe, expect, it } from "vitest"
import {
  validateTradeInput as liveValidateTradeInputDirect,
  type TradeDraftPickInput,
  type TradeInput,
  type TradeValidationSuccess,
  type TradeValidationFailure,
  type TradeValidationResult,
} from "@/lib/trade-helpers"

export type {
  TradeDraftPickInput,
  TradeInput,
  TradeValidationSuccess,
  TradeValidationFailure,
  TradeValidationResult,
}

export function referenceValidateTradeInput(input: unknown): TradeValidationResult {
  return liveValidateTradeInputDirect(input)
}

// Progressive Loader: Attempt to load live module if available, fallback to reference oracle
let liveValidateTradeInput: ((input: unknown) => TradeValidationResult) | null = null
try {
  const mod = require("@/lib/trade-helpers")
  if (typeof mod.validateTradeInput === "function") {
    liveValidateTradeInput = mod.validateTradeInput
  }
} catch {
  // Fallback when module is loaded dynamically
}

const validateTradeInput = liveValidateTradeInput ?? referenceValidateTradeInput

describe("lib/trade-helpers: validateTradeInput", () => {
  describe("Category-Partition: Payload Structure & Type Validation", () => {
    it.each([
      [null, "null"],
      [undefined, "undefined"],
      ["", "string"],
      [123, "number"],
      [true, "boolean"],
      [[], "array"],
    ])("rejects non-object payload: %s (%s)", (val, _label) => {
      const res = validateTradeInput(val)
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/object/i)
      }
    })

    it("rejects empty object payload", () => {
      const res = validateTradeInput({})
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/teamASlug.*teamBSlug/i)
      }
    })

    it("rejects missing teamASlug", () => {
      const res = validateTradeInput({ teamBSlug: "loons", teamBPlayerIds: [10] })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toContain("teamASlug")
      }
    })

    it("rejects missing teamBSlug", () => {
      const res = validateTradeInput({ teamASlug: "yetis", teamAPlayerIds: [20] })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toContain("teamBSlug")
      }
    })

    it("rejects empty or whitespace-only team slugs", () => {
      const res = validateTradeInput({ teamASlug: "  ", teamBSlug: "loons", teamAPlayerIds: [1] })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toContain("teamASlug")
      }
    })

    it("rejects same-team trade (teamASlug === teamBSlug)", () => {
      const res = validateTradeInput({
        teamASlug: "sharks",
        teamBSlug: "sharks",
        teamAPlayerIds: [10],
        teamBPlayerIds: [20],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/same team/i)
      }
    })

    it("rejects same-team trade after trimming whitespace", () => {
      const res = validateTradeInput({
        teamASlug: "  sharks ",
        teamBSlug: "sharks",
        teamAPlayerIds: [10],
        teamBPlayerIds: [20],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/same team/i)
      }
    })
  })

  describe("Category-Partition & BVA: Trade Assets & Emptiness", () => {
    it("rejects trade with empty player lists and no draft picks", () => {
      const res = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [],
        teamBPlayerIds: [],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/at least one player or draft pick/i)
      }
    })

    it("rejects trade with empty player lists and empty draft picks array", () => {
      const res = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [],
        teamBPlayerIds: [],
        draftPicks: [],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/at least one player or draft pick/i)
      }
    })

    it("accepts asymmetric player trade: Team A sends 1 player, Team B sends 0 players + 1 pick", () => {
      const res = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [895],
        teamBPlayerIds: [],
        draftPicks: [
          {
            fromTeamSlug: "yetis",
            toTeamSlug: "loons",
            round: 2,
            originalTeamSlug: "yetis",
            targetSeason: "2027-summer",
          },
        ],
      })
      expect(res.valid).toBe(true)
      if (res.valid) {
        expect(res.data.teamAPlayerIds).toEqual([895])
        expect(res.data.teamBPlayerIds).toEqual([])
        expect(res.data.draftPicks).toHaveLength(1)
      }
    })

    it("accepts pick-only trade: Team A sends pick, Team B sends pick (0 players on both sides)", () => {
      const res = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [],
        teamBPlayerIds: [],
        draftPicks: [
          {
            fromTeamSlug: "loons",
            toTeamSlug: "yetis",
            round: 1,
            originalTeamSlug: "loons",
            targetSeason: "2027-summer",
          },
          {
            fromTeamSlug: "yetis",
            toTeamSlug: "loons",
            round: 2,
            originalTeamSlug: "yetis",
            targetSeason: "2027-summer",
          },
        ],
      })
      expect(res.valid).toBe(true)
      if (res.valid) {
        expect(res.data.teamAPlayerIds).toHaveLength(0)
        expect(res.data.teamBPlayerIds).toHaveLength(0)
        expect(res.data.draftPicks).toHaveLength(2)
      }
    })
  })

  describe("Category-Partition: Player ID Validation & Deduplication", () => {
    it("rejects non-array teamAPlayerIds", () => {
      const res = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: "not-an-array" as any,
        teamBPlayerIds: [10],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/array/i)
      }
    })

    it.each([
      [-1, "negative number"],
      [0, "zero"],
      [1.5, "float"],
      ["10" as any, "string"],
      [NaN, "NaN"],
      [Infinity, "Infinity"],
    ])("rejects invalid player ID %s (%s) on Team A", (invalidId) => {
      const res = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [invalidId],
        teamBPlayerIds: [20],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/positive integer/i)
      }
    })

    it("rejects invalid player ID on Team B", () => {
      const res = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [10],
        teamBPlayerIds: [-99],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/positive integer/i)
      }
    })

    it("deduplicates redundant player IDs on the same team", () => {
      const res = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [101, 102, 101, 102, 103],
        teamBPlayerIds: [201, 201],
      })
      expect(res.valid).toBe(true)
      if (res.valid) {
        expect(res.data.teamAPlayerIds).toEqual([101, 102, 103])
        expect(res.data.teamBPlayerIds).toEqual([201])
      }
    })

    it("rejects overlapping player IDs between Team A and Team B", () => {
      const res = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [100, 200],
        teamBPlayerIds: [300, 100],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/cannot appear on both teams/i)
      }
    })
  })

  describe("Boundary Value Analysis (BVA): Draft Pick Rounds (1..20)", () => {
    const baseTrade = {
      teamASlug: "loons",
      teamBSlug: "yetis",
      teamAPlayerIds: [10],
      teamBPlayerIds: [20],
    }

    it("rejects draft pick with round = 0 (lower bound - 1)", () => {
      const res = validateTradeInput({
        ...baseTrade,
        draftPicks: [
          {
            fromTeamSlug: "loons",
            toTeamSlug: "yetis",
            round: 0,
            originalTeamSlug: "loons",
            targetSeason: "2027-summer",
          },
        ],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/between 1 and 20/i)
      }
    })

    it("accepts draft pick with round = 1 (exact lower bound)", () => {
      const res = validateTradeInput({
        ...baseTrade,
        draftPicks: [
          {
            fromTeamSlug: "loons",
            toTeamSlug: "yetis",
            round: 1,
            originalTeamSlug: "loons",
            targetSeason: "2027-summer",
          },
        ],
      })
      expect(res.valid).toBe(true)
      if (res.valid) {
        expect(res.data.draftPicks[0].draftPickRound).toBe(1)
      }
    })

    it("accepts draft pick with round = 20 (exact upper bound)", () => {
      const res = validateTradeInput({
        ...baseTrade,
        draftPicks: [
          {
            fromTeamSlug: "loons",
            toTeamSlug: "yetis",
            round: 20,
            originalTeamSlug: "loons",
            targetSeason: "2027-summer",
          },
        ],
      })
      expect(res.valid).toBe(true)
      if (res.valid) {
        expect(res.data.draftPicks[0].draftPickRound).toBe(20)
      }
    })

    it("rejects draft pick with round = 21 (upper bound + 1)", () => {
      const res = validateTradeInput({
        ...baseTrade,
        draftPicks: [
          {
            fromTeamSlug: "loons",
            toTeamSlug: "yetis",
            round: 21,
            originalTeamSlug: "loons",
            targetSeason: "2027-summer",
          },
        ],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/between 1 and 20/i)
      }
    })

    it.each([
      [-1, "negative"],
      [2.5, "float"],
      ["3" as any, "string"],
    ])("rejects non-integer draft pick round: %s (%s)", (invalidRound) => {
      const res = validateTradeInput({
        ...baseTrade,
        draftPicks: [
          {
            fromTeamSlug: "loons",
            toTeamSlug: "yetis",
            round: invalidRound,
            originalTeamSlug: "loons",
            targetSeason: "2027-summer",
          },
        ],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/between 1 and 20/i)
      }
    })
  })

  describe("Category-Partition: Draft Pick Team Direction & Metadata", () => {
    const baseTrade = {
      teamASlug: "loons",
      teamBSlug: "yetis",
      teamAPlayerIds: [10],
      teamBPlayerIds: [20],
    }

    it("rejects draft pick when fromTeamSlug does not match either team", () => {
      const res = validateTradeInput({
        ...baseTrade,
        draftPicks: [
          {
            fromTeamSlug: "sharks",
            toTeamSlug: "yetis",
            round: 1,
            originalTeamSlug: "sharks",
            targetSeason: "2027-summer",
          },
        ],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/must be traded between loons and yetis/i)
      }
    })

    it("rejects draft pick when toTeamSlug does not match either team", () => {
      const res = validateTradeInput({
        ...baseTrade,
        draftPicks: [
          {
            fromTeamSlug: "loons",
            toTeamSlug: "kings",
            round: 1,
            originalTeamSlug: "kings",
            targetSeason: "2027-summer",
          },
        ],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/must be traded between loons and yetis/i)
      }
    })

    it("rejects draft pick with identical fromTeamSlug and toTeamSlug", () => {
      const res = validateTradeInput({
        ...baseTrade,
        draftPicks: [
          {
            fromTeamSlug: "loons",
            toTeamSlug: "loons",
            round: 1,
            originalTeamSlug: "loons",
            targetSeason: "2027-summer",
          },
        ],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/identical fromTeamSlug and toTeamSlug/i)
      }
    })

    it("rejects draft pick with empty originalTeamSlug", () => {
      const res = validateTradeInput({
        ...baseTrade,
        draftPicks: [
          {
            fromTeamSlug: "loons",
            toTeamSlug: "yetis",
            round: 1,
            originalTeamSlug: "  ",
            targetSeason: "2027-summer",
          },
        ],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/requires originalTeamSlug/i)
      }
    })

    it("rejects draft pick with empty targetSeason", () => {
      const res = validateTradeInput({
        ...baseTrade,
        draftPicks: [
          {
            fromTeamSlug: "loons",
            toTeamSlug: "yetis",
            round: 1,
            originalTeamSlug: "sharks",
            targetSeason: "",
          },
        ],
      })
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/requires targetSeason/i)
      }
    })
  })

  describe("Pairwise & Workload: Real-World Trades & Normalization", () => {
    it("validates Fall 2026 Week 1 Trade #1: Eddie Parsons (953) ↔ Logan Truman (1032)", () => {
      const trade1: TradeInput = {
        teamASlug: "rangers",
        teamBSlug: "red-wings",
        teamAPlayerIds: [953],
        teamBPlayerIds: [1032],
        notes: "Fall 2026 Week 1 1-for-1 player trade",
      }

      const res = validateTradeInput(trade1)
      expect(res.valid).toBe(true)
      if (res.valid) {
        expect(res.data.teamASlug).toBe("rangers")
        expect(res.data.teamBSlug).toBe("red-wings")
        expect(res.data.teamAPlayerIds).toEqual([953])
        expect(res.data.teamBPlayerIds).toEqual([1032])
        expect(res.data.draftPicks).toEqual([])
        expect(res.data.notes).toBe("Fall 2026 Week 1 1-for-1 player trade")
      }
    })

    it("validates Fall 2026 Week 1 Trade #2: 2 players ↔ 2 players block trade", () => {
      const trade2: TradeInput = {
        teamASlug: "gold-seals",
        teamBSlug: "loons",
        teamAPlayerIds: [974, 1020], // Jonny Callan & Lee Jacobs
        teamBPlayerIds: [895, 630],  // Steph Tryphonas & Darrell Draper
        notes: "Fall 2026 Week 1 2-for-2 block trade",
      }

      const res = validateTradeInput(trade2)
      expect(res.valid).toBe(true)
      if (res.valid) {
        expect(res.data.teamAPlayerIds).toEqual([974, 1020])
        expect(res.data.teamBPlayerIds).toEqual([895, 630])
        expect(res.data.draftPicks).toHaveLength(0)
      }
    })

    it("normalizes draft picks into itemType: 'draft_pick' with null playerId", () => {
      const tradeWithPick: TradeInput = {
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [101],
        teamBPlayerIds: [201],
        draftPicks: [
          {
            fromTeamSlug: "loons",
            toTeamSlug: "yetis",
            round: 3,
            originalTeamSlug: "sharks",
            targetSeason: "2027-summer",
          },
        ],
      }

      const res = validateTradeInput(tradeWithPick)
      expect(res.valid).toBe(true)
      if (res.valid) {
        expect(res.data.draftPicks).toEqual([
          {
            itemType: "draft_pick",
            fromTeamSlug: "loons",
            toTeamSlug: "yetis",
            playerId: null,
            draftPickRound: 3,
            draftPickOriginalTeamSlug: "sharks",
            draftPickTargetSeason: "2027-summer",
          },
        ])
      }
    })

    it("trims whitespace on notes and omits notes if empty string", () => {
      const resWithWhitespace = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [101],
        teamBPlayerIds: [201],
        notes: "   Valid note with spaces   ",
      })
      expect(resWithWhitespace.valid).toBe(true)
      if (resWithWhitespace.valid) {
        expect(resWithWhitespace.data.notes).toBe("Valid note with spaces")
      }

      const resWithEmptyNote = validateTradeInput({
        teamASlug: "loons",
        teamBSlug: "yetis",
        teamAPlayerIds: [101],
        teamBPlayerIds: [201],
        notes: "     ",
      })
      expect(resWithEmptyNote.valid).toBe(true)
      if (resWithEmptyNote.valid) {
        expect(resWithEmptyNote.data.notes).toBeUndefined()
      }
    })
  })

  describe("N-Team Circular Trades (teamSlugs + playerMoves)", () => {
    it("accepts a valid 3-team circular trade with players and draft picks", () => {
      const res = validateTradeInput({
        teamSlugs: ["loons", "yetis", "reign"],
        playerMoves: [
          { playerId: 101, fromTeamSlug: "loons", toTeamSlug: "yetis" },
          { playerId: 201, fromTeamSlug: "yetis", toTeamSlug: "reign" },
          { playerId: 301, fromTeamSlug: "reign", toTeamSlug: "loons" },
        ],
        draftPicks: [
          {
            fromTeamSlug: "reign",
            toTeamSlug: "yetis",
            round: 2,
            originalTeamSlug: "reign",
            targetSeason: "2027-summer",
          },
        ],
        notes: "3-team circular trade",
      })

      expect(res.valid).toBe(true)
      if (res.valid) {
        expect(res.data.teamSlugs).toEqual(["loons", "yetis", "reign"])
        expect(res.data.playerMoves).toEqual([
          { playerId: 101, fromTeamSlug: "loons", toTeamSlug: "yetis" },
          { playerId: 201, fromTeamSlug: "yetis", toTeamSlug: "reign" },
          { playerId: 301, fromTeamSlug: "reign", toTeamSlug: "loons" },
        ])
        expect(res.data.draftPicks).toHaveLength(1)
      }
    })

    it("rejects 3-team trade when a player move references a non-participating team", () => {
      const res = validateTradeInput({
        teamSlugs: ["loons", "yetis", "reign"],
        playerMoves: [
          { playerId: 101, fromTeamSlug: "loons", toTeamSlug: "seals" },
        ],
      })
      expect(res.valid).toBe(false)
    })
  })
})
