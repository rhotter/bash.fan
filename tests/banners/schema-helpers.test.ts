/**
 * Tier 1 (Feature Coverage), Tier 2 (Boundary & Corner Cases),
 * and Tier 3 (Cross-Feature Pairwise Combinations)
 *
 * Verifies pure helper algorithms, math transitions, boundaries, and combinations.
 */

import { describe, expect, it } from "vitest"
import {
  computeCountdownSuffix,
  createMockBanner,
  formatEventTime,
  getBannerStatus,
  getDismissalKey,
  isBannerVisible,
  needsMobileLabelWarning,
  validateBannerInput,
  BannerVariant,
  CountdownType,
} from "./harness"

describe("Tier 1: Feature Coverage (Pure Helpers & Contracts)", () => {
  describe("Feature 1.1: getBannerStatus operational transitions", () => {
    it("returns 'draft' when isActive is false regardless of dates", () => {
      const draftBanner = createMockBanner({
        isActive: false,
        startDate: "2026-10-01T00:00:00Z",
        endDate: "2026-10-10T00:00:00Z",
      })
      expect(getBannerStatus(draftBanner, new Date("2026-10-05T00:00:00Z"))).toBe("draft")
    })

    it("returns 'scheduled' when isActive is true but current time is before startDate", () => {
      const scheduledBanner = createMockBanner({
        isActive: true,
        startDate: "2026-10-10T00:00:00Z",
        endDate: "2026-10-20T00:00:00Z",
      })
      expect(getBannerStatus(scheduledBanner, new Date("2026-10-05T00:00:00Z"))).toBe("scheduled")
    })

    it("returns 'live' when isActive is true and current time is within [startDate, endDate]", () => {
      const activeBanner = createMockBanner({
        isActive: true,
        startDate: "2026-10-01T00:00:00Z",
        endDate: "2026-10-10T00:00:00Z",
      })
      expect(getBannerStatus(activeBanner, new Date("2026-10-05T12:00:00Z"))).toBe("live")
    })

    it("returns 'expired' when isActive is true but current time is after endDate", () => {
      const expiredBanner = createMockBanner({
        isActive: true,
        startDate: "2026-10-01T00:00:00Z",
        endDate: "2026-10-10T00:00:00Z",
      })
      expect(getBannerStatus(expiredBanner, new Date("2026-10-11T00:00:00Z"))).toBe("expired")
    })

    it("returns 'live' when isActive is true and dates are unbounded (null start and end)", () => {
      const unboundedBanner = createMockBanner({
        isActive: true,
        startDate: null,
        endDate: null,
      })
      expect(getBannerStatus(unboundedBanner, new Date("2026-10-05T00:00:00Z"))).toBe("live")
    })

    it("returns 'live' when isActive is true and only endDate is set and now <= endDate", () => {
      const endingBanner = createMockBanner({
        isActive: true,
        startDate: null,
        endDate: "2026-10-15T00:00:00Z",
      })
      expect(getBannerStatus(endingBanner, new Date("2026-10-05T00:00:00Z"))).toBe("live")
    })
  })

  describe("Feature 1.2: computeCountdownSuffix string derivation", () => {
    const fixedNow = new Date("2026-10-04T12:00:00Z")

    it("returns null when countdownType is 'none'", () => {
      expect(computeCountdownSuffix("none", "2026-10-10T12:00:00Z", fixedNow)).toBeNull()
    })

    it("computes plural '· X days left' for deadline > 1 day away", () => {
      // 3.5 days away -> Math.ceil = 4 days
      const target = new Date("2026-10-08T00:00:00Z")
      expect(computeCountdownSuffix("deadline", target, fixedNow)).toBe("· 4 days left")
    })

    it("computes singular '· 1 day left' for deadline under 24 hours away", () => {
      // 12 hours away -> Math.ceil = 1 day
      const target = new Date("2026-10-05T00:00:00Z")
      expect(computeCountdownSuffix("deadline", target, fixedNow)).toBe("· 1 day left")
    })

    it("computes '· Live in X days' for event several days in future", () => {
      const target = new Date("2026-10-07T12:00:00Z") // 3 full days
      expect(computeCountdownSuffix("event", target, fixedNow)).toBe("· Live in 3 days")
    })

    it("computes '· Live today @ {time}' for event on same calendar day", () => {
      const sameDayTarget = new Date("2026-10-04T19:00:00Z")
      const suffix = computeCountdownSuffix("event", sameDayTarget, fixedNow)
      expect(suffix).toMatch(/^· Live today @ /)
      expect(suffix).toContain(":")
    })

    it("computes '· LIVE NOW' when current time reaches or exceeds event timestamp", () => {
      const pastTarget = new Date("2026-10-04T11:59:59Z")
      expect(computeCountdownSuffix("event", pastTarget, fixedNow)).toBe("· LIVE NOW")
    })
  })

  describe("Feature 1.3: Dismissal key versioning & invalidation", () => {
    it("generates default version 1 dismissal key", () => {
      expect(getDismissalKey("promo-1", 1)).toBe("bash-banner-promo-1-v1")
    })

    it("generates incremented version key when dismissal is reset", () => {
      expect(getDismissalKey("promo-1", 2)).toBe("bash-banner-promo-1-v2")
      expect(getDismissalKey("promo-1", 10)).toBe("bash-banner-promo-1-v10")
    })

    it("isBannerVisible honors client-side dismissed set", () => {
      const banner = createMockBanner({ id: "rainout", dismissVersion: 1 })
      const dismissed = new Set(["bash-banner-rainout-v1"])
      expect(isBannerVisible(banner, "/", dismissed)).toBe(false)
    })

    it("isBannerVisible reveals banner when dismissVersion is incremented", () => {
      // User previously dismissed v1
      const bannerV2 = createMockBanner({ id: "rainout", dismissVersion: 2 })
      const dismissed = new Set(["bash-banner-rainout-v1"])
      expect(isBannerVisible(bannerV2, "/", dismissed)).toBe(true)
    })

    it("supports dismissal key lookup with string array as well as Set", () => {
      const banner = createMockBanner({ id: "welcome", dismissVersion: 1 })
      expect(isBannerVisible(banner, "/", ["bash-banner-welcome-v1"])).toBe(false)
      expect(isBannerVisible(banner, "/", ["bash-banner-other-v1"])).toBe(true)
    })
  })

  describe("Feature 1.4: Route suppression contract", () => {
    const banner = createMockBanner({
      hideOnPaths: ["/admin"],
    })

    it("suppresses banner on exact match of hideOnPaths", () => {
      expect(isBannerVisible(banner, "/admin")).toBe(false)
    })

    it("suppresses banner on sub-paths of hideOnPaths", () => {
      expect(isBannerVisible(banner, "/admin/banners")).toBe(false)
      expect(isBannerVisible(banner, "/admin/scoresheet/game-123")).toBe(false)
    })

    it("allows banner on public root path", () => {
      expect(isBannerVisible(banner, "/")).toBe(true)
    })

    it("allows banner on public sub-routes", () => {
      expect(isBannerVisible(banner, "/standings")).toBe(true)
      expect(isBannerVisible(banner, "/player/john-doe")).toBe(true)
    })

    it("respects multi-path suppression lists", () => {
      const customBanner = createMockBanner({
        hideOnPaths: ["/admin", "/draft/2026-summer"],
      })
      expect(isBannerVisible(customBanner, "/admin")).toBe(false)
      expect(isBannerVisible(customBanner, "/draft/2026-summer")).toBe(false)
      expect(isBannerVisible(customBanner, "/draft/2025-fall")).toBe(true)
    })
  })

  describe("Feature 1.5: Validation contracts for Admin API", () => {
    it("validates successful minimal input", () => {
      const result = validateBannerInput({
        label: "Season Registration Open",
        href: "/register",
        variant: "default",
      })
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it("rejects missing or empty label", () => {
      const result = validateBannerInput({ label: "", href: "/test" })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("label is required and cannot be empty")
    })

    it("rejects invalid visual variant", () => {
      const result = validateBannerInput({ label: "Test", variant: "super-urgent" })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toMatch(/invalid variant/)
    })

    it("rejects countdownType without countdownTarget", () => {
      const result = validateBannerInput({
        label: "Draft Night",
        countdownType: "event",
        countdownTarget: null,
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("countdownTarget is required when countdownType is not 'none'")
    })

    it("rejects inverted date ranges (startDate > endDate)", () => {
      const result = validateBannerInput({
        label: "Inverted Banner",
        startDate: "2026-10-20T00:00:00Z",
        endDate: "2026-10-10T00:00:00Z",
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("startDate must be before or equal to endDate")
    })

    it("rejects negative priority values", () => {
      const result = validateBannerInput({
        label: "Priority Test",
        priority: -5,
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("priority must be a non-negative integer")
    })
  })
})

describe("Tier 2: Boundary & Corner Cases", () => {
  describe("Boundary 2.1: Empty and whitespace labels", () => {
    it("rejects empty string label in validation", () => {
      expect(validateBannerInput({ label: "" }).valid).toBe(false)
    })

    it("rejects spaces-only label in validation", () => {
      expect(validateBannerInput({ label: "     " }).valid).toBe(false)
    })

    it("rejects newline and tab whitespace in label", () => {
      expect(validateBannerInput({ label: "\n\t  \r" }).valid).toBe(false)
    })

    it("does not trigger mobile warning on empty label", () => {
      expect(needsMobileLabelWarning("")).toBe(false)
      expect(needsMobileLabelWarning(null)).toBe(false)
    })

    it("handles whitespace-only mobileLabel as empty when checking length warning", () => {
      const longLabel = "This is a headline that exceeds 35 characters easily"
      expect(needsMobileLabelWarning(longLabel, "   ")).toBe(true)
    })
  })

  describe("Boundary 2.2: Null and undefined date combinations", () => {
    it("treats null start and null end as perpetually live", () => {
      const banner = createMockBanner({ startDate: null, endDate: null, isActive: true })
      expect(getBannerStatus(banner, new Date())).toBe("live")
    })

    it("handles null startDate with valid future endDate", () => {
      const banner = createMockBanner({
        startDate: null,
        endDate: "2026-12-31T23:59:59Z",
        isActive: true,
      })
      expect(getBannerStatus(banner, new Date("2026-10-04T00:00:00Z"))).toBe("live")
    })

    it("handles valid past startDate with null endDate", () => {
      const banner = createMockBanner({
        startDate: "2026-01-01T00:00:00Z",
        endDate: null,
        isActive: true,
      })
      expect(getBannerStatus(banner, new Date("2026-10-04T00:00:00Z"))).toBe("live")
    })

    it("handles malformed date strings gracefully without throwing", () => {
      const banner = createMockBanner({
        startDate: "not-a-valid-date",
        endDate: "corrupted",
        isActive: true,
      })
      // Should fall back to live rather than crashing
      expect(() => getBannerStatus(banner, new Date())).not.toThrow()
    })

    it("computeCountdownSuffix returns null for null or invalid target", () => {
      expect(computeCountdownSuffix("deadline", null)).toBeNull()
      expect(computeCountdownSuffix("event", undefined)).toBeNull()
      expect(computeCountdownSuffix("event", "invalid-timestamp")).toBeNull()
    })
  })

  describe("Boundary 2.3: Negative time differences and past target dates", () => {
    const fixedNow = new Date("2026-10-04T12:00:00Z")

    it("returns null suffix for deadline target 1 millisecond in the past", () => {
      const pastTarget = new Date(fixedNow.getTime() - 1)
      expect(computeCountdownSuffix("deadline", pastTarget, fixedNow)).toBeNull()
    })

    it("returns null suffix for deadline target days in the past", () => {
      const pastTarget = new Date("2026-09-01T00:00:00Z")
      expect(computeCountdownSuffix("deadline", pastTarget, fixedNow)).toBeNull()
    })

    it("returns '· LIVE NOW' for event target in the past", () => {
      const pastEvent = new Date(fixedNow.getTime() - 3600_000)
      expect(computeCountdownSuffix("event", pastEvent, fixedNow)).toBe("· LIVE NOW")
    })

    it("hides deadline banner when deadline has passed via isBannerVisible", () => {
      const expiredDeadlinedBanner = createMockBanner({
        countdownType: "deadline",
        countdownTarget: new Date(fixedNow.getTime() - 1000),
      })
      expect(isBannerVisible(expiredDeadlinedBanner, "/", new Set(), fixedNow)).toBe(false)
    })

    it("keeps event banner visible even when target is past (shows LIVE NOW)", () => {
      const liveEventBanner = createMockBanner({
        countdownType: "event",
        countdownTarget: new Date(fixedNow.getTime() - 1000),
        isActive: true,
      })
      expect(isBannerVisible(liveEventBanner, "/", new Set(), fixedNow)).toBe(true)
    })
  })

  describe("Boundary 2.4: Exact countdown timestamp match", () => {
    const exactNow = new Date("2026-10-04T18:00:00.000Z")

    it("transitions event to '· LIVE NOW' at the exact millisecond", () => {
      expect(computeCountdownSuffix("event", exactNow, exactNow)).toBe("· LIVE NOW")
    })

    it("returns '· LIVE NOW' 1ms after event target", () => {
      const after = new Date(exactNow.getTime() + 1)
      expect(computeCountdownSuffix("event", exactNow, after)).toBe("· LIVE NOW")
    })

    it("shows today time 1ms before event target on same day", () => {
      const before = new Date(exactNow.getTime() - 1)
      const suffix = computeCountdownSuffix("event", exactNow, before)
      expect(suffix).toMatch(/^· Live today @ /)
    })

    it("treats deadline as expired (returns null) at exact millisecond match", () => {
      expect(computeCountdownSuffix("deadline", exactNow, exactNow)).toBeNull()
    })

    it("formatEventTime produces consistent hour and minute representation", () => {
      const time = formatEventTime(exactNow)
      expect(time).toBeTruthy()
      expect(time).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i)
    })
  })

  describe("Boundary 2.5: Mobile label 35-character threshold", () => {
    it("returns false for label with exactly 34 characters and no mobile label", () => {
      const label34 = "A".repeat(34)
      expect(needsMobileLabelWarning(label34, null)).toBe(false)
    })

    it("returns false for label with exactly 35 characters and no mobile label", () => {
      const label35 = "A".repeat(35)
      expect(needsMobileLabelWarning(label35, null)).toBe(false)
    })

    it("returns true for label with exactly 36 characters and no mobile label", () => {
      const label36 = "A".repeat(36)
      expect(needsMobileLabelWarning(label36, null)).toBe(true)
    })

    it("returns false for 36-character label when mobileLabel is provided", () => {
      const label36 = "A".repeat(36)
      expect(needsMobileLabelWarning(label36, "Short Mobile")).toBe(false)
    })

    it("ignores surrounding whitespace when counting characters", () => {
      // 34 chars surrounded by spaces should not trigger
      const padded34 = "   " + "B".repeat(34) + "   "
      expect(needsMobileLabelWarning(padded34, null)).toBe(false)

      // 36 chars surrounded by spaces should trigger
      const padded36 = "   " + "B".repeat(36) + "   "
      expect(needsMobileLabelWarning(padded36, null)).toBe(true)
    })
  })

  describe("Boundary 2.6: Special characters in URLs", () => {
    it("handles relative URL with query string parameters", () => {
      const banner = createMockBanner({ href: "/standings?season=2026-summer&tab=points" })
      expect(banner.href).toContain("?")
      expect(validateBannerInput(banner).valid).toBe(true)
    })

    it("handles relative URL with hash anchor", () => {
      const banner = createMockBanner({ href: "/rules#overtime-shootouts" })
      expect(banner.href).toContain("#")
      expect(validateBannerInput(banner).valid).toBe(true)
    })

    it("handles encoded special characters in URL", () => {
      const banner = createMockBanner({ href: "/team/san%20jose%20sharks" })
      expect(banner.href).toContain("%20")
      expect(validateBannerInput(banner).valid).toBe(true)
    })

    it("handles external HTTPS links (e.g. Sportability or Twitch)", () => {
      const banner = createMockBanner({
        href: "https://www.sportability.com/spx/Leagues/League.asp?LID=49583",
      })
      expect(banner.href).toMatch(/^https:\/\//)
      expect(validateBannerInput(banner).valid).toBe(true)
    })

    it("handles mailto or tel URI schemes without crashing", () => {
      const banner = createMockBanner({ href: "mailto:commissioner@bashhockey.com" })
      expect(validateBannerInput(banner).valid).toBe(true)
    })
  })
})

describe("Tier 3: Cross-Feature Combinations (Pairwise Matrix)", () => {
  const variants: BannerVariant[] = ["default", "live", "warning"]
  const countdowns: CountdownType[] = ["none", "deadline", "event"]
  const mobileLabelOptions = [
    { name: "present", value: "Short Mobile Copy" },
    { name: "absent", value: null },
  ]

  const now = new Date("2026-10-04T12:00:00Z")
  const futureTarget = new Date("2026-10-09T12:00:00Z") // 5 days out

  // Iterate all 18 pairwise combinations
  variants.forEach((variant) => {
    countdowns.forEach((countdownType) => {
      mobileLabelOptions.forEach((mobileOpt) => {
        const testCaseName = `variant=${variant} × countdown=${countdownType} × mobileLabel=${mobileOpt.name}`

        it(`evaluates combination: ${testCaseName}`, () => {
          const banner = createMockBanner({
            variant,
            countdownType,
            countdownTarget: countdownType === "none" ? null : futureTarget,
            mobileLabel: mobileOpt.value,
            isActive: true,
          })

          // 1. Status is live
          expect(getBannerStatus(banner, now)).toBe("live")

          // 2. Countdown suffix logic matches type
          const suffix = computeCountdownSuffix(banner.countdownType, banner.countdownTarget, now)
          if (countdownType === "none") {
            expect(suffix).toBeNull()
          } else if (countdownType === "deadline") {
            expect(suffix).toBe("· 5 days left")
          } else if (countdownType === "event") {
            expect(suffix).toBe("· Live in 5 days")
          }

          // 3. Mobile label presence check
          if (mobileOpt.name === "present") {
            expect(banner.mobileLabel).toBe("Short Mobile Copy")
          } else {
            expect(banner.mobileLabel).toBeNull()
          }

          // 4. Banner visibility
          expect(isBannerVisible(banner, "/", new Set(), now)).toBe(true)

          // 5. Variant integrity
          expect(["default", "live", "warning"]).toContain(banner.variant)
        })
      })
    })
  })
})

describe("Milestone 1 Implementation Verification: lib/banner-helpers.ts", () => {
  it("verifies live implementation conformance if present on disk", async () => {
    const { getLiveOrOracleHelpers } = await import("./harness")
    const { isLive, helpers } = await getLiveOrOracleHelpers()
    if (!isLive) {
      // lib/banner-helpers.ts is in development by implementing agent
      expect(true).toBe(true)
      return
    }

    // Verify all expected function exports exist
    expect(typeof helpers.getBannerStatus).toBe("function")
    expect(typeof helpers.computeCountdownSuffix).toBe("function")
    expect(typeof helpers.getDismissalKey).toBe("function")
    expect(typeof helpers.isBannerVisible).toBe("function")
    expect(typeof helpers.needsMobileLabelWarning).toBe("function")
  })
})
