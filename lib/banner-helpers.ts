/**
 * Pure helper module for BASH Site Banners.
 *
 * Contains zero React, DOM, or Next.js dependencies.
 * 100% testable in a pure Node.js / Vitest environment.
 */

// ─── Types & Interfaces ──────────────────────────────────────────────────────

/** Visual style for the banner dot indicator */
export type BannerVariant = "default" | "live" | "warning"

/** Administrative lifecycle state of a banner */
export type BannerStatus = "live" | "scheduled" | "expired" | "draft"

/** Countdown calculation mode */
export type CountdownType = "none" | "deadline" | "event"

/**
 * Full database/API record representing a site banner.
 */
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
  createdAt?: string | Date | null
  updatedAt?: string | Date | null
}

/**
 * Public payload delivered to client browsers via GET /api/bash/banners.
 */
export interface PublicBanner {
  id: string
  label: string
  mobileLabel?: string | null
  href: string
  variant: BannerVariant
  countdownType: CountdownType
  countdownTarget?: string | Date | null
  dismissVersion: number
  hideOnPaths: string[]
}

/**
 * Minimal interface required to compute banner administrative status.
 */
export interface BannerStatusInput {
  isActive: boolean
  startDate?: string | Date | null
  endDate?: string | Date | null
}

// ─── Pure Helper Functions ───────────────────────────────────────────────────

/**
 * Computes the administrative status of a banner ("draft", "scheduled", "expired", or "live").
 */
export function getBannerStatus(
  banner: BannerStatusInput,
  now?: Date,
): BannerStatus {
  if (!banner.isActive) {
    return "draft"
  }

  const currentDate = now ? new Date(now) : new Date()

  if (banner.startDate) {
    const start = new Date(banner.startDate)
    if (!isNaN(start.getTime()) && currentDate.getTime() < start.getTime()) {
      return "scheduled"
    }
  }

  if (banner.endDate) {
    const end = new Date(banner.endDate)
    if (!isNaN(end.getTime()) && currentDate.getTime() > end.getTime()) {
      return "expired"
    }
  }

  return "live"
}

/**
 * Formats a target event time into a clean 12-hour time string (e.g., "7:00 PM").
 */
export function formatEventTime(
  target: Date | string,
  timeZone?: string,
): string {
  const date = typeof target === "string" ? new Date(target) : target
  if (isNaN(date.getTime())) {
    return ""
  }

  return date
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    })
    .replace(/\u202F/g, " ")
}

/**
 * Computes the trailing countdown suffix for banners.
 *
 * Deadline math: " · X day(s) left" (returns null when expired).
 * Event math: " · Live in X days", " · Live today @ {time}", or " · LIVE NOW" when now >= target.
 */
export function computeCountdownSuffix(
  type: CountdownType,
  target: string | Date | null | undefined,
  now?: Date,
  timeZone?: string,
): string | null {
  if (type === "none" || !target) {
    return null
  }

  const targetDate = typeof target === "string" ? new Date(target) : target
  if (isNaN(targetDate.getTime())) {
    return null
  }

  const currentDate = now ? new Date(now) : new Date()

  if (type === "deadline") {
    const diffMs = targetDate.getTime() - currentDate.getTime()
    if (diffMs <= 0) {
      return null
    }
    const daysLeft = Math.ceil(diffMs / 86400000)
    return ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
  }

  if (type === "event") {
    if (currentDate.getTime() >= targetDate.getTime()) {
      return " · LIVE NOW"
    }

    let isSameDay: boolean
    if (timeZone) {
      try {
        const dtf = new Intl.DateTimeFormat("en-US", {
          timeZone,
          year: "numeric",
          month: "numeric",
          day: "numeric",
        })
        isSameDay = dtf.format(currentDate) === dtf.format(targetDate)
      } catch {
        isSameDay =
          currentDate.getFullYear() === targetDate.getFullYear() &&
          currentDate.getMonth() === targetDate.getMonth() &&
          currentDate.getDate() === targetDate.getDate()
      }
    } else {
      isSameDay =
        currentDate.getFullYear() === targetDate.getFullYear() &&
        currentDate.getMonth() === targetDate.getMonth() &&
        currentDate.getDate() === targetDate.getDate()
    }

    if (isSameDay) {
      const timeStr = formatEventTime(targetDate, timeZone)
      return ` · Live today @ ${timeStr}`
    }

    const diffMs = targetDate.getTime() - currentDate.getTime()
    const daysUntil = Math.max(1, Math.ceil(diffMs / 86400000))
    return ` · Live in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`
  }

  return null
}

/**
 * Generates the versioned localStorage dismissal key for a banner.
 */
export function getDismissalKey(id: string, dismissVersion: number): string {
  return `bash-banner-${id}-v${dismissVersion}`
}

/**
 * Checks whether the desktop headline exceeds 35 characters while the mobileLabel is blank,
 * requiring a warning in the admin banner creator dialog.
 */
export function needsMobileLabelWarning(
  label: string | null | undefined,
  mobileLabel?: string | null,
): boolean {
  const trimmedLabel = typeof label === "string" ? label.trim() : ""
  const trimmedMobile = typeof mobileLabel === "string" ? mobileLabel.trim() : ""
  return trimmedLabel.length > 35 && trimmedMobile.length === 0
}

/**
 * Resolves the visual variant dynamically, promoting to "live" when an event countdown is LIVE NOW.
 */
export function resolveEffectiveVariant(
  variant: BannerVariant,
  countdownType: CountdownType,
  suffix: string | null,
): BannerVariant {
  if (countdownType === "event" && suffix === " · LIVE NOW") {
    return "live"
  }
  return variant
}

/**
 * Master client visibility evaluation for a banner.
 * Checks active toggle, scheduling dates, deadline expiration, route suppression, and dismissals.
 */
export function isBannerVisible(
  banner: BannerRecord | PublicBanner,
  pathname: string,
  dismissedKeys: Set<string> | string[],
  now?: Date,
): boolean {
  // If active toggle exists on record, enforce it
  if ("isActive" in banner && !banner.isActive) {
    return false
  }

  const currentDate = now ? new Date(now) : new Date()

  // Scheduling window check
  if ("startDate" in banner && banner.startDate) {
    const start = new Date(banner.startDate)
    if (!isNaN(start.getTime()) && currentDate.getTime() < start.getTime()) {
      return false
    }
  }

  if ("endDate" in banner && banner.endDate) {
    const end = new Date(banner.endDate)
    if (!isNaN(end.getTime()) && currentDate.getTime() > end.getTime()) {
      return false
    }
  }

  // Deadline expiration check
  if (banner.countdownType === "deadline" && banner.countdownTarget) {
    const target = new Date(banner.countdownTarget)
    if (!isNaN(target.getTime()) && currentDate.getTime() > target.getTime()) {
      return false
    }
  }

  // Route suppression check
  if (banner.hideOnPaths && Array.isArray(banner.hideOnPaths)) {
    if (
      banner.hideOnPaths.some(
        (p) => typeof p === "string" && p.length > 0 && pathname.startsWith(p),
      )
    ) {
      return false
    }
  }

  // Dismissal check
  const dismissVersion = banner.dismissVersion ?? 1
  const dismissKey = getDismissalKey(banner.id, dismissVersion)

  const isDismissed =
    dismissedKeys instanceof Set
      ? dismissedKeys.has(dismissKey)
      : Array.isArray(dismissedKeys)
        ? dismissedKeys.includes(dismissKey)
        : false

  if (isDismissed) {
    return false
  }

  return true
}

/**
 * Normalizes mobile label from form/API input.
 * Empty or whitespace-only strings become null.
 */
export function normalizeMobileLabel(
  mobileLabel?: string | null,
): string | null {
  if (!mobileLabel) return null
  const trimmed = mobileLabel.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Normalizes route suppression paths from form/API input (array or comma-separated string).
 * Defaults to ["/admin"] if empty.
 */
export function normalizeHideOnPaths(input: unknown): string[] {
  if (Array.isArray(input)) {
    const cleaned = input
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter((p) => p.length > 0)
    return cleaned.length > 0 ? cleaned : ["/admin"]
  }
  if (typeof input === "string") {
    const cleaned = input
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    return cleaned.length > 0 ? cleaned : ["/admin"]
  }
  return ["/admin"]
}
