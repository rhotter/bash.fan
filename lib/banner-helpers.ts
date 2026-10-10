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
  startDate?: string | Date | null
  endDate?: string | Date | null
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
  countdownType?: CountdownType
  countdownTarget?: string | Date | null
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

  if (banner.countdownType === "deadline" && banner.countdownTarget) {
    const target = new Date(banner.countdownTarget)
    if (!isNaN(target.getTime()) && currentDate.getTime() >= target.getTime()) {
      return "expired"
    }
  }

  return "live"
}

/**
 * Formats a target event time into a clean 12-hour time string (e.g., "7:00 PM").
 */
export function formatEventTime(
  target: Date | string | number,
  timeZone?: string,
): string {
  const date = target instanceof Date ? target : new Date(target)
  if (isNaN(date.getTime())) {
    return ""
  }

  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }
  if (timeZone) {
    options.timeZone = timeZone
  }

  try {
    return date
      .toLocaleTimeString("en-US", options)
      .replace(/\u202F/g, " ")
  } catch {
    try {
      return date
        .toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
        .replace(/\u202F/g, " ")
    } catch {
      return ""
    }
  }
}

/**
 * Computes the trailing countdown suffix for banners.
 *
 * Deadline math: " · X day(s) left" (returns null when expired).
 * Event math: " · Live in X days", " · Live today @ {time}", or " · LIVE NOW" when now >= target.
 */
export function computeCountdownSuffix(
  type: CountdownType,
  target: string | Date | number | null | undefined,
  now?: Date,
  timeZone: string = "America/Los_Angeles",
): string | null {
  if (type === "none" || !target) {
    return null
  }

  const targetDate = target instanceof Date ? target : new Date(target)
  if (isNaN(targetDate.getTime())) {
    return null
  }

  const currentDate = now ? (now instanceof Date ? now : new Date(now)) : new Date()
  if (isNaN(currentDate.getTime())) {
    return null
  }

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

    let daysUntil: number
    if (timeZone) {
      try {
        const dtfParts = new Intl.DateTimeFormat("en-US", {
          timeZone,
          year: "numeric",
          month: "numeric",
          day: "numeric",
        })
        const [cParts, tParts] = [dtfParts.formatToParts(currentDate), dtfParts.formatToParts(targetDate)]
        const getPart = (parts: Intl.DateTimeFormatPart[], type: string) =>
          Number(parts.find((p) => p.type === type)?.value)
        const cDate = new Date(Date.UTC(getPart(cParts, "year"), getPart(cParts, "month") - 1, getPart(cParts, "day")))
        const tDate = new Date(Date.UTC(getPart(tParts, "year"), getPart(tParts, "month") - 1, getPart(tParts, "day")))
        daysUntil = Math.max(1, Math.round((tDate.getTime() - cDate.getTime()) / 86400000))
      } catch {
        const cDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())
        const tDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate())
        daysUntil = Math.max(1, Math.round((tDay.getTime() - cDay.getTime()) / 86400000))
      }
    } else {
      const cDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())
      const tDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate())
      daysUntil = Math.max(1, Math.round((tDay.getTime() - cDay.getTime()) / 86400000))
    }

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
  if (countdownType === "event" && suffix?.trim() === "· LIVE NOW") {
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
    if (!isNaN(target.getTime()) && currentDate.getTime() >= target.getTime()) {
      return false
    }
  }

  // Route suppression check
  if (banner.hideOnPaths && Array.isArray(banner.hideOnPaths)) {
    if (
      pathname &&
      banner.hideOnPaths.some((p) => {
        if (typeof p !== "string" || p.length === 0) return false
        if (p === "/") return pathname === "/"
        const prefix = p.endsWith("/") ? p.slice(0, -1) : p
        return pathname === prefix || pathname.startsWith(`${prefix}/`)
      })
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
  mobileLabel?: unknown,
): string | null {
  if (typeof mobileLabel !== "string") return null
  const trimmed = mobileLabel.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Normalizes route suppression paths from form/API input (array or comma-separated string).
 * Defaults to ["/admin"] if empty.
 */
export function normalizeHideOnPaths(input: unknown): string[] {
  const cleanPath = (p: string) => {
    let trimmed = p.trim()
    if (!trimmed) return ""
    if (!trimmed.startsWith("/")) {
      trimmed = `/${trimmed}`
    }
    if (trimmed.length > 1 && trimmed.endsWith("/")) {
      trimmed = trimmed.replace(/\/+$/, "")
    }
    return trimmed
  }

  if (Array.isArray(input)) {
    const cleaned = input
      .map((p) => (typeof p === "string" ? cleanPath(p) : ""))
      .filter((p) => p.length > 0)
    return cleaned.length > 0 ? cleaned : ["/admin"]
  }
  if (typeof input === "string") {
    const cleaned = input
      .split(",")
      .map(cleanPath)
      .filter((p) => p.length > 0)
    return cleaned.length > 0 ? cleaned : ["/admin"]
  }
  return ["/admin"]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validates banner input payload for API POST/PUT requests and admin forms.
 */
export function validateBannerInput(input: unknown): ValidationResult {
  const errors: string[] = []

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Invalid request body"] }
  }

  const record = input as Record<string, unknown>

  // Label validation
  if (!record.label || typeof record.label !== "string" || record.label.trim().length === 0) {
    errors.push("label is required and cannot be empty")
  }

  // Href validation
  if (record.href !== undefined) {
    if (typeof record.href !== "string" || record.href.trim().length === 0) {
      errors.push("href cannot be empty")
    }
  }

  // Variant validation
  if (record.variant !== undefined) {
    if (typeof record.variant !== "string" || !["default", "live", "warning"].includes(record.variant)) {
      errors.push(`invalid variant: ${String(record.variant)}. Must be 'default', 'live', or 'warning'`)
    }
  }

  // Countdown type validation
  if (record.countdownType !== undefined) {
    if (typeof record.countdownType !== "string" || !["none", "deadline", "event"].includes(record.countdownType)) {
      errors.push(`invalid countdownType: ${String(record.countdownType)}. Must be 'none', 'deadline', or 'event'`)
    }
    if (record.countdownType !== "none" && !record.countdownTarget) {
      errors.push("countdownTarget is required when countdownType is not 'none'")
    }
  }

  // Countdown target date validation
  if (record.countdownTarget !== undefined && record.countdownTarget !== null && record.countdownTarget !== "") {
    const targetMs = new Date(record.countdownTarget as string | number | Date).getTime()
    if (isNaN(targetMs)) {
      errors.push("countdownTarget must be a valid date")
    }
  }

  // Priority validation
  if (record.priority !== undefined) {
    if (typeof record.priority !== "number" || !Number.isInteger(record.priority) || record.priority < 0) {
      errors.push("priority must be a non-negative integer")
    }
  }

  // Dismiss version validation
  if (record.dismissVersion !== undefined) {
    if (typeof record.dismissVersion !== "number" || !Number.isInteger(record.dismissVersion) || record.dismissVersion < 1) {
      errors.push("dismissVersion must be an integer >= 1")
    }
  }

  // Start date validation
  if (record.startDate !== undefined && record.startDate !== null && record.startDate !== "") {
    const startMs = new Date(record.startDate as string | number | Date).getTime()
    if (isNaN(startMs)) {
      errors.push("startDate must be a valid date")
    }
  }

  // End date validation
  if (record.endDate !== undefined && record.endDate !== null && record.endDate !== "") {
    const endMs = new Date(record.endDate as string | number | Date).getTime()
    if (isNaN(endMs)) {
      errors.push("endDate must be a valid date")
    }
  }

  // Date ordering validation
  if (record.startDate && record.endDate && record.startDate !== "" && record.endDate !== "") {
    const startMs = new Date(record.startDate as string | number | Date).getTime()
    const endMs = new Date(record.endDate as string | number | Date).getTime()
    if (!isNaN(startMs) && !isNaN(endMs) && startMs > endMs) {
      errors.push("startDate must be before or equal to endDate")
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}


