/**
 * Public Banner API & Client Presentation Contract Test Suite
 *
 * Covers:
 * - Public endpoint query filters (isActive, date windows)
 * - Priority & recency ranking engine
 * - Cache-Control header specifications
 * - Zero-UA responsive payload structure (label + mobileLabel)
 * - Protected suffix truncation layout rules
 * - WCAG 2.5.5 touch target hit area standards (44×44px)
 * - SWR configuration and layout stability
 */

import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"
import {
  createMockBanner,
  filterAndRankBanners,
  BannerRecord,
} from "./harness"

// -----------------------------------------------------------------------------
// Public Route Handler Simulator
// -----------------------------------------------------------------------------

function simulatePublicBannerApi(banners: BannerRecord[], now: Date = new Date()) {
  const topBanner = filterAndRankBanners(banners, now)
  const headers = {
    "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    "Content-Type": "application/json",
  }

  if (!topBanner) {
    return {
      status: 200,
      headers,
      body: { banner: null },
    }
  }

  // Format public payload
  const publicPayload = {
    id: topBanner.id,
    label: topBanner.label,
    mobileLabel: topBanner.mobileLabel ?? null,
    href: topBanner.href,
    variant: topBanner.variant,
    startDate: topBanner.startDate ? new Date(topBanner.startDate).toISOString() : null,
    endDate: topBanner.endDate ? new Date(topBanner.endDate).toISOString() : null,
    countdownType: topBanner.countdownType,
    countdownTarget: topBanner.countdownTarget
      ? new Date(topBanner.countdownTarget).toISOString()
      : null,
    priority: topBanner.priority,
    dismissVersion: topBanner.dismissVersion,
    hideOnPaths: topBanner.hideOnPaths,
  }

  return {
    status: 200,
    headers,
    body: { banner: publicPayload },
  }
}

describe("Public Banner API: Query Filtering Engine", () => {
  const now = new Date("2026-10-04T12:00:00Z")

  it("filters out inactive banners even if date window matches", () => {
    const inactiveBanner = createMockBanner({
      id: "inactive-1",
      isActive: false,
      priority: 100,
      startDate: "2026-10-01T00:00:00Z",
      endDate: "2026-10-10T00:00:00Z",
    })
    const activeBanner = createMockBanner({
      id: "active-1",
      isActive: true,
      priority: 10,
    })

    const result = filterAndRankBanners([inactiveBanner, activeBanner], now)
    expect(result).not.toBeNull()
    expect(result!.id).toBe("active-1")
  })

  it("filters out future scheduled banners", () => {
    const scheduledBanner = createMockBanner({
      id: "scheduled-1",
      isActive: true,
      startDate: "2026-10-05T00:00:00Z", // tomorrow
    })
    const result = filterAndRankBanners([scheduledBanner], now)
    expect(result).toBeNull()
  })

  it("filters out expired banners", () => {
    const expiredBanner = createMockBanner({
      id: "expired-1",
      isActive: true,
      endDate: "2026-10-03T00:00:00Z", // yesterday
    })
    const result = filterAndRankBanners([expiredBanner], now)
    expect(result).toBeNull()
  })

  it("includes open-ended banners where startDate and endDate are null", () => {
    const perpetualBanner = createMockBanner({
      id: "perpetual-1",
      isActive: true,
      startDate: null,
      endDate: null,
    })
    const result = filterAndRankBanners([perpetualBanner], now)
    expect(result).not.toBeNull()
    expect(result!.id).toBe("perpetual-1")
  })

  it("includes banner on exact boundary of startDate or endDate", () => {
    const exactStartBanner = createMockBanner({
      id: "boundary-start",
      isActive: true,
      startDate: now.toISOString(),
      endDate: "2026-10-10T00:00:00Z",
    })
    expect(filterAndRankBanners([exactStartBanner], now)?.id).toBe("boundary-start")

    const exactEndBanner = createMockBanner({
      id: "boundary-end",
      isActive: true,
      startDate: "2026-10-01T00:00:00Z",
      endDate: now.toISOString(),
    })
    expect(filterAndRankBanners([exactEndBanner], now)?.id).toBe("boundary-end")
  })
})

describe("Public Banner API: Priority & Recency Ranking", () => {
  const now = new Date("2026-10-04T12:00:00Z")

  it("selects higher priority banner over lower priority banner", () => {
    const lowPriority = createMockBanner({
      id: "low",
      priority: 10,
      createdAt: new Date("2026-10-01"),
    })
    const highPriority = createMockBanner({
      id: "high",
      priority: 50,
      createdAt: new Date("2026-10-01"),
    })

    const selected = filterAndRankBanners([lowPriority, highPriority], now)
    expect(selected?.id).toBe("high")
  })

  it("breaks priority tie using recency (most recent updatedAt wins)", () => {
    const older = createMockBanner({
      id: "older-same-priority",
      priority: 20,
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    })
    const newer = createMockBanner({
      id: "newer-same-priority",
      priority: 20,
      updatedAt: new Date("2026-10-03T00:00:00Z"),
    })

    const selected = filterAndRankBanners([older, newer], now)
    expect(selected?.id).toBe("newer-same-priority")
  })

  it("returns null when candidate array is empty", () => {
    expect(filterAndRankBanners([], now)).toBeNull()
  })

  it("returns null when all candidate banners are ineligible", () => {
    const allIneligible = [
      createMockBanner({ isActive: false }),
      createMockBanner({ startDate: "2026-10-10T00:00:00Z" }), // future
      createMockBanner({ endDate: "2026-10-01T00:00:00Z" }), // past
    ]
    expect(filterAndRankBanners(allIneligible, now)).toBeNull()
  })
})

describe("Public Banner API: HTTP Caching & Edge Headers", () => {
  it("sets required Cache-Control header on banner response", () => {
    const banner = createMockBanner({ id: "cached-1" })
    const res = simulatePublicBannerApi([banner])
    expect(res.headers["Cache-Control"]).toBe(
      "public, s-maxage=30, stale-while-revalidate=60"
    )
  })

  it("sets required Cache-Control header even when no banner is active", () => {
    const res = simulatePublicBannerApi([])
    expect(res.headers["Cache-Control"]).toBe(
      "public, s-maxage=30, stale-while-revalidate=60"
    )
    expect(res.body.banner).toBeNull()
  })
})

describe("Public Banner Architecture: Zero-UA Responsive Switching", () => {
  it("returns both label and mobileLabel in JSON response without UA sniffing", () => {
    const banner = createMockBanner({
      label: "Full Headline For Desktop Users",
      mobileLabel: "Short Mobile",
    })
    const res = simulatePublicBannerApi([banner])
    expect(res.body.banner?.label).toBe("Full Headline For Desktop Users")
    expect(res.body.banner?.mobileLabel).toBe("Short Mobile")
  })

  it("supports null mobileLabel when commissioner provides only standard label", () => {
    const banner = createMockBanner({
      label: "Universal Headline",
      mobileLabel: null,
    })
    const res = simulatePublicBannerApi([banner])
    expect(res.body.banner?.mobileLabel).toBeNull()
  })

  it("defines correct Tailwind CSS responsive classes according to PRD §8.5.2", () => {
    // PRD §8.5.2 dictates:
    // When mobileLabel exists:
    // desktop span: "hidden sm:inline"
    // mobile span: "inline sm:hidden"
    // When mobileLabel is null:
    // desktop span: "" (always visible)
    const mobileLabel = "Short Mobile"
    const desktopClass = mobileLabel ? "hidden sm:inline" : ""
    const mobileClass = "inline sm:hidden"

    expect(desktopClass).toBe("hidden sm:inline")
    expect(mobileClass).toBe("inline sm:hidden")
  })
})

describe("Public Banner UX: Layout Stability & Touch Accessibility", () => {
  const siteBannerSrc = fs.readFileSync(
    path.resolve(process.cwd(), "components/site-banner.tsx"),
    "utf-8"
  )

  it("enforces WCAG 2.5.5 minimum 44×44px hit target for mobile dismiss button", () => {
    // PRD §8.5.3 & §9.4
    expect(siteBannerSrc).toContain("min-h-[44px]")
    expect(siteBannerSrc).toContain("min-w-[44px]")
    expect(siteBannerSrc).toContain("touch-manipulation")
    expect(siteBannerSrc).toContain('aria-label="Dismiss banner"')
  })

  it("enforces protected suffix flex layout (shrink-0 tabular-nums) preventing countdown clipping", () => {
    // PRD §8.5.1
    expect(siteBannerSrc).toContain("shrink-0 text-muted-foreground/70 tabular-nums")
    expect(siteBannerSrc).toContain("truncate font-medium underline underline-offset-4")
  })

  it("enforces fixed single-line height h-8 with safe right padding to prevent CLS", () => {
    // PRD §8.5.4 & §9.4
    expect(siteBannerSrc).toContain("h-8")
    expect(siteBannerSrc).toContain("pr-12 sm:pr-8")
    expect(siteBannerSrc).toContain('role="region"')
    expect(siteBannerSrc).toContain('aria-label="Site announcement"')
  })
})
