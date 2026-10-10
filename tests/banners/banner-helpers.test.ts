import { describe, expect, it } from "vitest"
import {
  computeCountdownSuffix,
  formatEventTime,
  getBannerStatus,
  getDismissalKey,
  isBannerVisible,
  needsMobileLabelWarning,
  normalizeHideOnPaths,
  normalizeMobileLabel,
  resolveEffectiveVariant,
  validateBannerInput,
  type BannerRecord,
  type PublicBanner,
} from "@/lib/banner-helpers"

describe("lib/banner-helpers", () => {
  // ─── getBannerStatus ───────────────────────────────────────────────────────
  describe("getBannerStatus", () => {
    const now = new Date("2026-10-04T12:00:00Z")

    it("returns 'draft' if isActive is false regardless of dates", () => {
      expect(
        getBannerStatus(
          {
            isActive: false,
            startDate: "2026-10-01T00:00:00Z",
            endDate: "2026-10-10T00:00:00Z",
          },
          now,
        ),
      ).toBe("draft")
    })

    it("returns 'scheduled' when current time is before startDate", () => {
      expect(
        getBannerStatus(
          {
            isActive: true,
            startDate: "2026-10-05T00:00:00Z",
            endDate: "2026-10-10T00:00:00Z",
          },
          now,
        ),
      ).toBe("scheduled")
    })

    it("returns 'expired' when current time is after endDate", () => {
      expect(
        getBannerStatus(
          {
            isActive: true,
            startDate: "2026-10-01T00:00:00Z",
            endDate: "2026-10-03T00:00:00Z",
          },
          now,
        ),
      ).toBe("expired")
    })

    it("returns 'expired' when countdownType is 'deadline' and current time reaches or exceeds countdownTarget", () => {
      expect(
        getBannerStatus(
          {
            isActive: true,
            countdownType: "deadline",
            countdownTarget: "2026-10-04T11:00:00Z", // 1 hour in past relative to now (12:00:00Z)
          },
          now,
        ),
      ).toBe("expired")

      expect(
        getBannerStatus(
          {
            isActive: true,
            countdownType: "deadline",
            countdownTarget: now, // exactly at target
          },
          now,
        ),
      ).toBe("expired")
    })

    it("returns 'live' when countdownType is 'deadline' and countdownTarget is still in the future", () => {
      expect(
        getBannerStatus(
          {
            isActive: true,
            countdownType: "deadline",
            countdownTarget: "2026-10-04T13:00:00Z", // 1 hour in future relative to now
          },
          now,
        ),
      ).toBe("live")
    })

    it("returns 'live' when current time is within window", () => {
      expect(
        getBannerStatus(
          {
            isActive: true,
            startDate: "2026-10-01T00:00:00Z",
            endDate: "2026-10-10T00:00:00Z",
          },
          now,
        ),
      ).toBe("live")
    })

    it("returns 'live' when dates are null or undefined", () => {
      expect(getBannerStatus({ isActive: true }, now)).toBe("live")
      expect(
        getBannerStatus({ isActive: true, startDate: null, endDate: null }, now),
      ).toBe("live")
    })

    it("handles Date objects and ISO strings equally", () => {
      expect(
        getBannerStatus(
          {
            isActive: true,
            startDate: new Date("2026-10-01T00:00:00Z"),
            endDate: new Date("2026-10-10T00:00:00Z"),
          },
          now,
        ),
      ).toBe("live")
    })

    it("handles boundary times exactly at startDate and endDate", () => {
      // Exactly at startDate
      const atStart = new Date("2026-10-01T00:00:00Z")
      expect(
        getBannerStatus(
          {
            isActive: true,
            startDate: atStart,
            endDate: "2026-10-10T00:00:00Z",
          },
          atStart,
        ),
      ).toBe("live")

      // Exactly at endDate
      const atEnd = new Date("2026-10-10T00:00:00Z")
      expect(
        getBannerStatus(
          {
            isActive: true,
            startDate: "2026-10-01T00:00:00Z",
            endDate: atEnd,
          },
          atEnd,
        ),
      ).toBe("live")
    })
  })

  // ─── formatEventTime ───────────────────────────────────────────────────────
  describe("formatEventTime", () => {
    it("formats event time in 12-hour format with timezone support", () => {
      const date = new Date("2026-10-04T19:00:00Z")
      expect(formatEventTime(date, "UTC")).toBe("7:00 PM")
      expect(formatEventTime(date, "America/Los_Angeles")).toBe("12:00 PM")
    })

    it("accepts ISO string representations", () => {
      expect(formatEventTime("2026-10-04T19:00:00Z", "UTC")).toBe("7:00 PM")
    })

    it("returns empty string for invalid dates", () => {
      expect(formatEventTime("invalid-date")).toBe("")
    })
  })

  // ─── computeCountdownSuffix ───────────────────────────────────────────────
  describe("computeCountdownSuffix", () => {
    const now = new Date("2026-10-04T12:00:00Z")

    it("returns null when countdownType is 'none'", () => {
      expect(
        computeCountdownSuffix("none", "2026-10-10T00:00:00Z", now),
      ).toBeNull()
    })

    it("returns null when target is null, undefined, or invalid", () => {
      expect(computeCountdownSuffix("deadline", null, now)).toBeNull()
      expect(computeCountdownSuffix("deadline", undefined, now)).toBeNull()
      expect(computeCountdownSuffix("deadline", "invalid-date", now)).toBeNull()
      expect(computeCountdownSuffix("event", null, now)).toBeNull()
    })

    describe("deadline countdown", () => {
      it("formats multiple days remaining", () => {
        // 5 days from now
        const target = new Date("2026-10-09T12:00:00Z")
        expect(computeCountdownSuffix("deadline", target, now)).toBe(
          " · 5 days left",
        )
      })

      it("formats single day remaining as singular 'day'", () => {
        // 20 hours from now
        const target = new Date("2026-10-05T08:00:00Z")
        expect(computeCountdownSuffix("deadline", target, now)).toBe(
          " · 1 day left",
        )
      })

      it("handles boundary right before expiration (1 millisecond left)", () => {
        const target = new Date(now.getTime() + 1)
        expect(computeCountdownSuffix("deadline", target, now)).toBe(
          " · 1 day left",
        )
      })

      it("returns null when deadline has passed (expired)", () => {
        const pastTarget = new Date("2026-10-04T11:59:59Z")
        expect(computeCountdownSuffix("deadline", pastTarget, now)).toBeNull()
      })

      it("returns null when current time exactly equals target time", () => {
        expect(computeCountdownSuffix("deadline", now, now)).toBeNull()
      })
    })

    describe("event countdown", () => {
      it("formats future day event", () => {
        // 3 days from now
        const target = new Date("2026-10-07T12:00:00Z")
        expect(computeCountdownSuffix("event", target, now)).toBe(
          " · Live in 3 days",
        )
      })

      it("formats 1 day away event as singular 'day'", () => {
        const target = new Date(now.getTime() + 24 * 3600 * 1000)
        expect(computeCountdownSuffix("event", target, now)).toBe(
          " · Live in 1 day",
        )
      })

      it("formats next calendar day as 1 day even if more than 24 hours away", () => {
        // Now is 2026-10-04T12:00:00Z. Target is 2026-10-05T22:00:00Z (34 hours away, but next calendar day)
        const target = new Date("2026-10-05T22:00:00Z")
        expect(computeCountdownSuffix("event", target, now, "UTC")).toBe(
          " · Live in 1 day",
        )
      })

      it("formats same day event with formatted time", () => {
        // Same calendar day in UTC
        const target = new Date("2026-10-04T16:00:00Z")
        const timeStr = formatEventTime(target, "UTC")
        expect(computeCountdownSuffix("event", target, now, "UTC")).toBe(
          ` · Live today @ ${timeStr}`,
        )
      })

      it("returns ' · LIVE NOW' when current time reaches or exceeds target", () => {
        const exactTarget = new Date("2026-10-04T12:00:00Z")
        const pastTarget = new Date("2026-10-04T11:00:00Z")

        expect(computeCountdownSuffix("event", exactTarget, now)).toBe(
          " · LIVE NOW",
        )
        expect(computeCountdownSuffix("event", pastTarget, now)).toBe(
          " · LIVE NOW",
        )
      })
    })
  })

  // ─── getDismissalKey ───────────────────────────────────────────────────────
  describe("getDismissalKey", () => {
    it("generates correct versioned dismissal keys", () => {
      expect(getDismissalKey("fall-2026", 1)).toBe("bash-banner-fall-2026-v1")
      expect(getDismissalKey("draft-night", 3)).toBe("bash-banner-draft-night-v3")
    })
  })

  // ─── needsMobileLabelWarning ───────────────────────────────────────────────
  describe("needsMobileLabelWarning", () => {
    it("returns false when label is 35 characters or less", () => {
      expect(needsMobileLabelWarning("Short headline")).toBe(false)
      expect(needsMobileLabelWarning("12345678901234567890123456789012345")).toBe(
        false,
      ) // exactly 35
    })

    it("returns true when label > 35 characters and mobileLabel is missing or blank", () => {
      const longLabel = "123456789012345678901234567890123456" // 36 chars
      expect(needsMobileLabelWarning(longLabel)).toBe(true)
      expect(needsMobileLabelWarning(longLabel, "")).toBe(true)
      expect(needsMobileLabelWarning(longLabel, "   ")).toBe(true)
      expect(needsMobileLabelWarning(longLabel, null)).toBe(true)
      expect(needsMobileLabelWarning(longLabel, undefined)).toBe(true)
    })

    it("returns false when label > 35 characters but mobileLabel is provided", () => {
      const longLabel = "Fall 2026–27 Registration is Now Open — Secure Your Spot!"
      expect(needsMobileLabelWarning(longLabel, "Register for Fall")).toBe(false)
    })

    it("trims whitespace before measuring length", () => {
      expect(needsMobileLabelWarning("   short   ")).toBe(false)
      expect(needsMobileLabelWarning(null)).toBe(false)
      expect(needsMobileLabelWarning(undefined)).toBe(false)
    })
  })

  // ─── resolveEffectiveVariant ───────────────────────────────────────────────
  describe("resolveEffectiveVariant", () => {
    it("promotes variant to 'live' when event suffix is ' · LIVE NOW'", () => {
      expect(resolveEffectiveVariant("default", "event", " · LIVE NOW")).toBe(
        "live",
      )
      expect(resolveEffectiveVariant("warning", "event", " · LIVE NOW")).toBe(
        "live",
      )
    })

    it("retains existing variant when suffix is not ' · LIVE NOW'", () => {
      expect(
        resolveEffectiveVariant("warning", "event", " · Live in 2 days"),
      ).toBe("warning")
      expect(
        resolveEffectiveVariant("default", "deadline", " · 3 days left"),
      ).toBe("default")
      expect(resolveEffectiveVariant("default", "none", null)).toBe("default")
    })
  })

  // ─── isBannerVisible ───────────────────────────────────────────────────────
  describe("isBannerVisible", () => {
    const now = new Date("2026-10-04T12:00:00Z")
    const baseBanner: BannerRecord = {
      id: "test-banner",
      label: "Test Announcement",
      href: "/register",
      variant: "default",
      isActive: true,
      countdownType: "none",
      priority: 10,
      dismissVersion: 1,
      hideOnPaths: ["/admin"],
    }

    it("returns true for a standard eligible banner", () => {
      expect(isBannerVisible(baseBanner, "/scores", new Set(), now)).toBe(true)
    })

    it("returns false if isActive is false", () => {
      expect(
        isBannerVisible(
          { ...baseBanner, isActive: false },
          "/scores",
          new Set(),
          now,
        ),
      ).toBe(false)
    })

    it("returns false if scheduled for the future", () => {
      expect(
        isBannerVisible(
          { ...baseBanner, startDate: "2026-10-05T00:00:00Z" },
          "/scores",
          new Set(),
          now,
        ),
      ).toBe(false)
    })

    it("returns false if expired by endDate", () => {
      expect(
        isBannerVisible(
          { ...baseBanner, endDate: "2026-10-03T00:00:00Z" },
          "/scores",
          new Set(),
          now,
        ),
      ).toBe(false)
    })

    it("returns false if deadline countdown has expired", () => {
      expect(
        isBannerVisible(
          {
            ...baseBanner,
            countdownType: "deadline",
            countdownTarget: "2026-10-03T00:00:00Z",
          },
          "/scores",
          new Set(),
          now,
        ),
      ).toBe(false)
    })

    it("returns true if event countdown is past (switches to live now)", () => {
      expect(
        isBannerVisible(
          {
            ...baseBanner,
            countdownType: "event",
            countdownTarget: "2026-10-03T00:00:00Z",
          },
          "/scores",
          new Set(),
          now,
        ),
      ).toBe(true)
    })

    it("returns false when current path matches hideOnPaths", () => {
      expect(isBannerVisible(baseBanner, "/admin", new Set(), now)).toBe(false)
      expect(
        isBannerVisible(baseBanner, "/admin/banners", new Set(), now),
      ).toBe(false)
      expect(isBannerVisible(baseBanner, "/standings", new Set(), now)).toBe(true)
    })

    it("returns false when dismissal key is present in Set or array", () => {
      const dismissedSet = new Set(["bash-banner-test-banner-v1"])
      expect(isBannerVisible(baseBanner, "/scores", dismissedSet, now)).toBe(
        false,
      )

      const dismissedArray = ["bash-banner-test-banner-v1"]
      expect(isBannerVisible(baseBanner, "/scores", dismissedArray, now)).toBe(
        false,
      )
    })

    it("returns true if dismissVersion has incremented since dismissal", () => {
      const dismissedSet = new Set(["bash-banner-test-banner-v1"])
      const updatedBanner = { ...baseBanner, dismissVersion: 2 }
      expect(isBannerVisible(updatedBanner, "/scores", dismissedSet, now)).toBe(
        true,
      )
    })

    it("handles PublicBanner objects correctly", () => {
      const publicBanner: PublicBanner = {
        id: "pub-banner",
        label: "Public Announcement",
        href: "/events",
        variant: "live",
        countdownType: "none",
        dismissVersion: 1,
        hideOnPaths: ["/admin"],
      }
      expect(isBannerVisible(publicBanner, "/scores", new Set(), now)).toBe(true)
      expect(isBannerVisible(publicBanner, "/admin", new Set(), now)).toBe(false)
    })
  })

  // ─── Normalization Helpers ────────────────────────────────────────────────
  describe("normalization helpers", () => {
    describe("normalizeMobileLabel", () => {
      it("normalizes empty or whitespace string to null", () => {
        expect(normalizeMobileLabel("")).toBeNull()
        expect(normalizeMobileLabel("   ")).toBeNull()
        expect(normalizeMobileLabel(null)).toBeNull()
        expect(normalizeMobileLabel(undefined)).toBeNull()
      })

      it("trims and preserves valid string", () => {
        expect(normalizeMobileLabel("  Short Label  ")).toBe("Short Label")
      })
    })

    describe("normalizeHideOnPaths", () => {
      it("normalizes string array", () => {
        expect(normalizeHideOnPaths(["/admin", "/draft", "  "])).toEqual([
          "/admin",
          "/draft",
        ])
      })

      it("normalizes comma-separated string", () => {
        expect(normalizeHideOnPaths("/admin, /draft , ")).toEqual([
          "/admin",
          "/draft",
        ])
      })

      it("prepends leading slash if omitted", () => {
        expect(normalizeHideOnPaths(["admin", "draft/scores"])).toEqual(["/admin", "/draft/scores"])
        expect(normalizeHideOnPaths("admin, draft/scores")).toEqual(["/admin", "/draft/scores"])
      })

      it("falls back to default ['/admin'] when input is empty or invalid", () => {
        expect(normalizeHideOnPaths([])).toEqual(["/admin"])
        expect(normalizeHideOnPaths("")).toEqual(["/admin"])
        expect(normalizeHideOnPaths(null)).toEqual(["/admin"])
      })
    })
  })

  // ─── Defensive Edge Cases & Robustness ─────────────────────────────────────
  describe("defensive edge cases & robustness", () => {
    it("formatEventTime gracefully handles invalid timezones by falling back", () => {
      const date = new Date("2026-10-04T19:00:00Z")
      expect(() => formatEventTime(date, "Invalid/TimeZone")).not.toThrow()
      expect(formatEventTime(date, "Invalid/TimeZone")).toBeTruthy()
    })

    it("formatEventTime supports numeric epoch timestamps", () => {
      const ms = new Date("2026-10-04T19:00:00Z").getTime()
      expect(formatEventTime(ms, "UTC")).toBe("7:00 PM")
    })

    it("computeCountdownSuffix supports numeric epoch timestamps", () => {
      const now = new Date("2026-10-04T12:00:00Z")
      const targetMs = new Date("2026-10-09T12:00:00Z").getTime()
      expect(computeCountdownSuffix("deadline", targetMs, now)).toBe(" · 5 days left")
    })

    it("computeCountdownSuffix returns null if now is an invalid Date", () => {
      const target = new Date("2026-10-09T12:00:00Z")
      const invalidNow = new Date("invalid-date")
      expect(computeCountdownSuffix("deadline", target, invalidNow)).toBeNull()
      expect(computeCountdownSuffix("event", target, invalidNow)).toBeNull()
    })

    it("isBannerVisible does not throw when pathname is null or undefined", () => {
      const banner: PublicBanner = {
        id: "test",
        label: "Notice",
        href: "/",
        variant: "default",
        countdownType: "none",
        dismissVersion: 1,
        hideOnPaths: ["/admin"],
      }
      expect(isBannerVisible(banner, null as unknown as string, new Set())).toBe(true)
      expect(isBannerVisible(banner, undefined as unknown as string, new Set())).toBe(true)
    })
  })

  // ─── validateBannerInput ──────────────────────────────────────────────────
  describe("validateBannerInput", () => {
    it("accepts empty string for date fields to allow form clearing", () => {
      const result = validateBannerInput({
        label: "Cleared Dates Banner",
        href: "/scores",
        startDate: "",
        endDate: "",
        countdownType: "none",
        countdownTarget: "",
      })
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it("rejects empty href string if provided", () => {
      const result1 = validateBannerInput({
        label: "Empty Href",
        href: "",
      })
      expect(result1.valid).toBe(false)
      expect(result1.errors).toContain("href cannot be empty")

      const result2 = validateBannerInput({
        label: "Whitespace Href",
        href: "   ",
      })
      expect(result2.valid).toBe(false)
      expect(result2.errors).toContain("href cannot be empty")
    })
  })
})
