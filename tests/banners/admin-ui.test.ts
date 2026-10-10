import { describe, expect, it } from "vitest"
import {
  getBannerStatus,
  computeCountdownSuffix,
  resolveEffectiveVariant,
  needsMobileLabelWarning,
  validateBannerInput,
} from "@/lib/banner-helpers"
import { createMockBanner } from "./harness"

describe("Milestone 3: Admin UI Logic & Contracts", () => {
  describe("1. Admin Sidebar Navigation Contract", () => {
    it("includes Banners item in AdminSidebar NAV_ITEMS", async () => {
      const { AdminSidebar, NAV_ITEMS } = await import("@/components/admin/admin-sidebar")
      expect(AdminSidebar).toBeDefined()
      expect(NAV_ITEMS).toBeDefined()
      expect(
        NAV_ITEMS.some(
          (item) => item.href === "/admin/banners" && item.label === "Banners"
        )
      ).toBe(true)
    })
  })

  describe("2. Status Badge Resolution for Admin Table", () => {
    const fixedNow = new Date("2026-10-05T12:00:00Z")

    it("maps active banner within date window to 'live'", () => {
      const banner = createMockBanner({
        isActive: true,
        startDate: "2026-10-01T00:00:00Z",
        endDate: "2026-10-10T00:00:00Z",
      })
      expect(getBannerStatus(banner, fixedNow)).toBe("live")
    })

    it("maps active banner before startDate to 'scheduled'", () => {
      const banner = createMockBanner({
        isActive: true,
        startDate: "2026-10-10T00:00:00Z",
        endDate: "2026-10-20T00:00:00Z",
      })
      expect(getBannerStatus(banner, fixedNow)).toBe("scheduled")
    })

    it("maps active banner after endDate to 'expired'", () => {
      const banner = createMockBanner({
        isActive: true,
        startDate: "2026-09-01T00:00:00Z",
        endDate: "2026-09-30T00:00:00Z",
      })
      expect(getBannerStatus(banner, fixedNow)).toBe("expired")
    })

    it("maps inactive banner to 'draft' regardless of dates", () => {
      const banner = createMockBanner({
        isActive: false,
        startDate: "2026-10-01T00:00:00Z",
        endDate: "2026-10-10T00:00:00Z",
      })
      expect(getBannerStatus(banner, fixedNow)).toBe("draft")
    })
  })

  describe("3. Dual Interactive Preview Live Calculations", () => {
    const previewNow = new Date("2026-10-05T12:00:00Z")

    it("computes live countdown suffix for deadline preview", () => {
      const target = new Date("2026-10-10T12:00:00Z")
      const suffix = computeCountdownSuffix("deadline", target, previewNow)
      expect(suffix).toBe(" · 5 days left")
    })

    it("computes live countdown suffix for event preview", () => {
      const target = new Date("2026-10-08T12:00:00Z")
      const suffix = computeCountdownSuffix("event", target, previewNow)
      expect(suffix).toBe(" · Live in 3 days")
    })

    it("resolves effective variant to 'live' when event countdown reaches LIVE NOW", () => {
      const pastEvent = new Date(previewNow.getTime() - 1000)
      const suffix = computeCountdownSuffix("event", pastEvent, previewNow)
      expect(suffix).toBe(" · LIVE NOW")

      const effectiveVariant = resolveEffectiveVariant("default", "event", suffix)
      expect(effectiveVariant).toBe("live")
    })

    it("maintains default variant when event is in the future", () => {
      const futureEvent = new Date(previewNow.getTime() + 86400000)
      const suffix = computeCountdownSuffix("event", futureEvent, previewNow)
      expect(suffix).toBe(" · Live in 1 day")

      const effectiveVariant = resolveEffectiveVariant("default", "event", suffix)
      expect(effectiveVariant).toBe("default")
    })
  })

  describe("4. Mobile Copy Length Guidance & Overflow Warnings", () => {
    it("flags warning when label > 35 characters and mobileLabel is empty", () => {
      const longLabel = "Fall 2026–27 Street Hockey Registration Open" // 45 chars
      expect(needsMobileLabelWarning(longLabel, "")).toBe(true)
      expect(needsMobileLabelWarning(longLabel, null)).toBe(true)
      expect(needsMobileLabelWarning(longLabel, undefined)).toBe(true)
      expect(needsMobileLabelWarning(longLabel, "   ")).toBe(true)
    })

    it("clears warning when label <= 35 characters", () => {
      const shortLabel = "Fall Registration Open" // 22 chars
      expect(needsMobileLabelWarning(shortLabel, "")).toBe(false)
      expect(needsMobileLabelWarning(shortLabel, null)).toBe(false)
    })

    it("clears warning when mobileLabel is provided even if label > 35 characters", () => {
      const longLabel = "Fall 2026–27 Street Hockey Registration Open" // 45 chars
      const shortMobile = "Fall Reg Open"
      expect(needsMobileLabelWarning(longLabel, shortMobile)).toBe(false)
    })
  })

  describe("5. Form Payload Parsing & Validation for Admin Mutations", () => {
    it("validates and accepts valid create payload", () => {
      const validPayload = {
        label: "Winter 2027 Registration",
        mobileLabel: "Winter Reg",
        href: "/register",
        variant: "default",
        isActive: true,
        startDate: "2027-01-01T00:00:00Z",
        endDate: "2027-01-31T23:59:59Z",
        countdownType: "deadline",
        countdownTarget: "2027-01-31T23:59:59Z",
        priority: 15,
        hideOnPaths: ["/admin"],
      }
      const result = validateBannerInput(validPayload)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it("rejects payload missing label or empty label", () => {
      const invalidPayload = {
        label: "   ",
        href: "/register",
      }
      const result = validateBannerInput(invalidPayload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("label is required and cannot be empty")
    })

    it("rejects payload with invalid countdownType", () => {
      const invalidPayload = {
        label: "Banner Notice",
        href: "/register",
        countdownType: "unknown-type",
      }
      const result = validateBannerInput(invalidPayload)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("invalid countdownType"))).toBe(true)
    })

    it("rejects payload when countdownType is deadline but target is missing", () => {
      const invalidPayload = {
        label: "Banner Notice",
        href: "/register",
        countdownType: "deadline",
      }
      const result = validateBannerInput(invalidPayload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("countdownTarget is required when countdownType is not 'none'")
    })

    it("rejects negative or fractional priority", () => {
      expect(validateBannerInput({ label: "Test", priority: -5 }).valid).toBe(false)
      expect(validateBannerInput({ label: "Test", priority: 1.5 }).valid).toBe(false)
      expect(validateBannerInput({ label: "Test", priority: 0 }).valid).toBe(true)
      expect(validateBannerInput({ label: "Test", priority: 50 }).valid).toBe(true)
    })

    it("rejects startDate after endDate", () => {
      const result = validateBannerInput({
        label: "Out of order dates",
        startDate: "2026-10-20T00:00:00Z",
        endDate: "2026-10-10T00:00:00Z",
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("startDate must be before or equal to endDate")
    })
  })
})
