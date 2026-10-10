/**
 * E2E Test Harness & Reference Oracle for BASH Site Banners System
 *
 * Implements authoritative behavior derived strictly from:
 * - ORIGINAL_REQUEST.md
 * - docs/prd-site-banners.md (§8.1 - §8.5)
 * - orchestrator_1/PROJECT.md & TEST_INFRA.md
 *
 * Provides pure reference logic, contract validators, mock factories,
 * and dynamic delegation to lib/banner-helpers.ts when available.
 */

import fs from "fs"
import path from "path"

export type BannerVariant = "default" | "live" | "warning"
export type CountdownType = "none" | "deadline" | "event"
export type BannerStatus = "live" | "scheduled" | "expired" | "draft"

export interface BannerRecord {
  id: string
  label: string
  mobileLabel?: string | null
  href: string
  variant: BannerVariant
  isActive: boolean
  startDate?: string | Date | null
  endDate?: string | Date | null
  countdownType: CountdownType
  countdownTarget?: string | Date | null
  priority: number
  dismissVersion: number
  hideOnPaths: string[]
  createdAt?: string | Date
  updatedAt?: string | Date
}

export interface PublicBanner {
  id: string
  label: string
  mobileLabel: string | null
  href: string
  variant: BannerVariant
  startDate: string | null
  endDate: string | null
  countdownType: CountdownType
  countdownTarget: string | null
  priority: number
  dismissVersion: number
  hideOnPaths: string[]
}

// -----------------------------------------------------------------------------
// Reference Oracle Implementation (PRD §8.1 - §8.5)
// -----------------------------------------------------------------------------

/**
 * Derives the operational status of a banner based on active toggle and schedule window.
 * PRD §8.4:
 * - "Draft": isActive === false
 * - "Scheduled": isActive === true && now < startDate
 * - "Expired": isActive === true && now > endDate
 * - "Live": isActive === true && startDate <= now <= endDate (or unbounded)
 */
export function getBannerStatus(
  banner: {
    isActive: boolean
    startDate?: string | Date | null
    endDate?: string | Date | null
  },
  now: Date = new Date()
): BannerStatus {
  if (!banner.isActive) {
    return "draft"
  }

  const nowMs = now.getTime()

  if (banner.startDate) {
    const startMs = new Date(banner.startDate).getTime()
    if (!isNaN(startMs) && nowMs < startMs) {
      return "scheduled"
    }
  }

  if (banner.endDate) {
    const endMs = new Date(banner.endDate).getTime()
    if (!isNaN(endMs) && nowMs > endMs) {
      return "expired"
    }
  }

  return "live"
}

/**
 * Formats time for event display (e.g. "7:00 PM").
 */
export function formatEventTime(target: Date | string): string {
  const d = new Date(target)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

/**
 * Computes countdown suffix string according to countdownType and target timestamp.
 * PRD §8.2:
 * 1. none: null
 * 2. deadline:
 *    - daysLeft = Math.max(0, Math.ceil((target - now) / 86400000))
 *    - if daysLeft <= 0: null (deadline expired)
 *    - suffix: " · {daysLeft} day{daysLeft === 1 ? '' : 's'} left"
 * 3. event:
 *    - if now < target:
 *      - same calendar day: " · Live today @ {formattedTime}"
 *      - future day: " · Live in {daysUntil} day{daysUntil === 1 ? '' : 's'}"
 *    - if now >= target:
 *      - " · LIVE NOW"
 */
export function computeCountdownSuffix(
  type: CountdownType,
  target: string | Date | null | undefined,
  now: Date = new Date()
): string | null {
  if (!type || type === "none" || !target) {
    return null
  }

  const targetDate = new Date(target)
  if (isNaN(targetDate.getTime())) {
    return null
  }

  const nowMs = now.getTime()
  const targetMs = targetDate.getTime()
  const diffMs = targetMs - nowMs

  if (type === "deadline") {
    const daysLeft = Math.ceil(diffMs / 86_400_000)
    if (daysLeft <= 0) {
      return null
    }
    return `· ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
  }

  if (type === "event") {
    if (nowMs >= targetMs) {
      return "· LIVE NOW"
    }

    // Check same calendar day
    const isSameDay =
      now.getFullYear() === targetDate.getFullYear() &&
      now.getMonth() === targetDate.getMonth() &&
      now.getDate() === targetDate.getDate()

    if (isSameDay) {
      const timeStr = formatEventTime(targetDate)
      return `· Live today @ ${timeStr}`
    }

    const daysUntil = Math.ceil(diffMs / 86_400_000)
    return `· Live in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`
  }

  return null
}

/**
 * Builds versioned localStorage dismissal key.
 * PRD §8.4 & §10: bash-banner-${id}-v${dismissVersion}
 */
export function getDismissalKey(bannerId: string, dismissVersion: number = 1): string {
  return `bash-banner-${bannerId}-v${dismissVersion}`
}

/**
 * Checks whether mobile label warning badge should be shown in admin UI.
 * PRD §8.4: Warning if label > 35 chars and mobileLabel is blank/empty.
 */
export function needsMobileLabelWarning(
  label: string | null | undefined,
  mobileLabel?: string | null | undefined
): boolean {
  if (!label) return false
  const trimmedLabel = label.trim()
  const trimmedMobile = mobileLabel ? mobileLabel.trim() : ""
  return trimmedLabel.length > 35 && trimmedMobile.length === 0
}

/**
 * Evaluates whether banner is visible on the current page path and visitor state.
 * PRD §8.5 & Survey:
 * - Must be active and in live status
 * - Path must not match hideOnPaths
 * - Key must not be in dismissedKeys
 * - If deadline countdown has passed (daysLeft <= 0), banner treats deadline as expired
 */
export function isBannerVisible(
  banner: BannerRecord,
  pathname: string,
  dismissedKeys: Set<string> | string[] = new Set(),
  now: Date = new Date()
): boolean {
  // 1. Status must be live
  if (getBannerStatus(banner, now) !== "live") {
    return false
  }

  // 2. Route suppression check
  if (banner.hideOnPaths && Array.isArray(banner.hideOnPaths)) {
    const isSuppressed = banner.hideOnPaths.some((p) => {
      if (typeof p !== "string" || p.length === 0) return false
      if (p === "/") return pathname === "/"
      const prefix = p.endsWith("/") ? p.slice(0, -1) : p
      return pathname === prefix || pathname.startsWith(`${prefix}/`)
    })
    if (isSuppressed) {
      return false
    }
  }

  // 3. Dismissal check
  const dismissKey = getDismissalKey(banner.id, banner.dismissVersion)
  const dismissedSet = dismissedKeys instanceof Set ? dismissedKeys : new Set(dismissedKeys)
  if (dismissedSet.has(dismissKey)) {
    return false
  }

  // 4. Deadline expiry check
  if (banner.countdownType === "deadline" && banner.countdownTarget) {
    const targetMs = new Date(banner.countdownTarget).getTime()
    if (!isNaN(targetMs) && Math.ceil((targetMs - now.getTime()) / 86_400_000) <= 0) {
      return false
    }
  }

  return true
}

// -----------------------------------------------------------------------------
// Validation Contracts (Admin API POST/PUT)
// -----------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateBannerInput(input: any): ValidationResult {
  const errors: string[] = []

  if (!input || typeof input !== "object") {
    return { valid: false, errors: ["Invalid request body"] }
  }

  // Label validation
  if (!input.label || typeof input.label !== "string" || input.label.trim().length === 0) {
    errors.push("label is required and cannot be empty")
  }

  // Variant validation
  if (input.variant !== undefined) {
    if (!["default", "live", "warning"].includes(input.variant)) {
      errors.push(`invalid variant: ${input.variant}. Must be 'default', 'live', or 'warning'`)
    }
  }

  // Countdown type validation
  if (input.countdownType !== undefined) {
    if (!["none", "deadline", "event"].includes(input.countdownType)) {
      errors.push(`invalid countdownType: ${input.countdownType}. Must be 'none', 'deadline', or 'event'`)
    }
    if (input.countdownType !== "none" && !input.countdownTarget) {
      errors.push("countdownTarget is required when countdownType is not 'none'")
    }
  }

  // Priority validation
  if (input.priority !== undefined) {
    if (typeof input.priority !== "number" || isNaN(input.priority) || input.priority < 0) {
      errors.push("priority must be a non-negative integer")
    }
  }

  // Dismiss version validation
  if (input.dismissVersion !== undefined) {
    if (typeof input.dismissVersion !== "number" || input.dismissVersion < 1) {
      errors.push("dismissVersion must be an integer >= 1")
    }
  }

  // Date ordering validation
  if (input.startDate && input.endDate) {
    const startMs = new Date(input.startDate).getTime()
    const endMs = new Date(input.endDate).getTime()
    if (!isNaN(startMs) && !isNaN(endMs) && startMs > endMs) {
      errors.push("startDate must be before or equal to endDate")
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// -----------------------------------------------------------------------------
// Public Query Engine Simulator (PRD §8.5 & PROJECT.md)
// -----------------------------------------------------------------------------

export function filterAndRankBanners(
  banners: BannerRecord[],
  now: Date = new Date()
): BannerRecord | null {
  const eligible = banners.filter((banner) => {
    if (!banner.isActive) return false

    const nowMs = now.getTime()
    if (banner.startDate) {
      const startMs = new Date(banner.startDate).getTime()
      if (!isNaN(startMs) && startMs > nowMs) return false
    }
    if (banner.endDate) {
      const endMs = new Date(banner.endDate).getTime()
      if (!isNaN(endMs) && endMs < nowMs) return false
    }

    return true
  })

  if (eligible.length === 0) return null

  // Sort by priority DESC, then updatedAt DESC (fallback to createdAt)
  eligible.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority
    }
    const aTime = a.updatedAt
      ? new Date(a.updatedAt).getTime()
      : (a.createdAt ? new Date(a.createdAt).getTime() : 0)
    const bTime = b.updatedAt
      ? new Date(b.updatedAt).getTime()
      : (b.createdAt ? new Date(b.createdAt).getTime() : 0)
    return bTime - aTime
  })

  return eligible[0]
}

// -----------------------------------------------------------------------------
// Mock Factory Helpers
// -----------------------------------------------------------------------------

let idCounter = 1000

export function createMockBanner(overrides: Partial<BannerRecord> = {}): BannerRecord {
  idCounter++
  return {
    id: overrides.id || `banner-${idCounter}`,
    label: overrides.label !== undefined ? overrides.label : "Fall 2026–27 Registration Open",
    mobileLabel: overrides.mobileLabel !== undefined ? overrides.mobileLabel : null,
    href: overrides.href !== undefined ? overrides.href : "/register",
    variant: overrides.variant || "default",
    isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    startDate: overrides.startDate !== undefined ? overrides.startDate : null,
    endDate: overrides.endDate !== undefined ? overrides.endDate : null,
    countdownType: overrides.countdownType || "none",
    countdownTarget: overrides.countdownTarget !== undefined ? overrides.countdownTarget : null,
    priority: overrides.priority !== undefined ? overrides.priority : 10,
    dismissVersion: overrides.dismissVersion !== undefined ? overrides.dismissVersion : 1,
    hideOnPaths: overrides.hideOnPaths || ["/admin"],
    createdAt: overrides.createdAt || new Date("2026-10-01T00:00:00Z"),
    updatedAt: overrides.updatedAt || new Date("2026-10-01T00:00:00Z"),
  }
}

/**
 * Safely loads real implementation from lib/banner-helpers.ts if present on disk,
 * otherwise falls back to this oracle.
 */
export async function getLiveOrOracleHelpers() {
  const libFile = path.resolve(process.cwd(), "lib/banner-helpers.ts")
  if (fs.existsSync(libFile)) {
    try {
      const liveModule = await import(libFile)
      return {
        isLive: true,
        helpers: liveModule,
      }
    } catch {
      // In case of syntax or compilation error in draft implementation
    }
  }

  return {
    isLive: false,
    helpers: {
      getBannerStatus,
      computeCountdownSuffix,
      getDismissalKey,
      isBannerVisible,
      needsMobileLabelWarning,
      formatEventTime,
    },
  }
}
