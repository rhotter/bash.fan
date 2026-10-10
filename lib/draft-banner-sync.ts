import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"

export interface SyncDraftBannerParams {
  draftId: string
  seasonId: string
  event: "publish" | "unpublish" | "start" | "complete" | "revert_to_live"
}

/**
 * Generates unique, predictable banner IDs for each lifecycle stage of a draft.
 */
export function getDraftBannerIds(draftId: string) {
  return {
    predraftId: `draft-${draftId}-predraft`,
    liveId: `draft-${draftId}-live`,
    resultsId: `draft-${draftId}-results`,
  }
}

/**
 * Formats draft date and time matching the existing BASH draft banner copy.
 * e.g., "BASH Draft: Wed @ 7pm" or "BASH Draft: Sat @ 1:30pm"
 * Falls back to "BASH Draft Board is now available" if date is null/unspecified.
 */
export function formatDraftDateLabel(
  draftDate?: Date | string | null,
  _seasonName?: string,
): string {
  if (!draftDate) {
    return "BASH Draft Board is now available"
  }
  const date = draftDate instanceof Date ? draftDate : new Date(draftDate)
  if (isNaN(date.getTime())) {
    return "BASH Draft Board is now available"
  }

  try {
    const timeZone = "America/Los_Angeles"
    const weekday = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone,
    }).format(date) // e.g. "Wed"

    const timeParts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "numeric",
      hour12: true,
      timeZone,
    }).formatToParts(date)

    const hour = timeParts.find((p) => p.type === "hour")?.value
    const minute = timeParts.find((p) => p.type === "minute")?.value
    const dayPeriod = timeParts.find((p) => p.type === "dayPeriod")?.value.toLowerCase() || ""

    const timeFormatted = minute === "00" ? `${hour}${dayPeriod}` : `${hour}:${minute}${dayPeriod}`
    return `BASH Draft: ${weekday} @ ${timeFormatted}`
  } catch {
    return "BASH Draft Board is now available"
  }
}

/**
 * Calculates the exact upcoming Friday at 11:59:59.999 PM in Pacific Time (America/Los_Angeles).
 * If called on a Friday, expires that same Friday night at 11:59:59.999 PM PT.
 * If called on a Saturday or Sunday, expires the next week's Friday at 11:59:59.999 PM PT.
 */
export function getFridayMidnightPT(now: Date = new Date()): Date {
  const timeZone = "America/Los_Angeles"
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  })
  const parts = dtf.formatToParts(now)
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || ""

  const weekday = getPart("weekday")
  const day = Number(getPart("day"))
  const month = Number(getPart("month"))
  const year = Number(getPart("year"))

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  const currentDayIndex = dayMap[weekday] ?? 0

  const daysUntilFriday = currentDayIndex <= 5 ? 5 - currentDayIndex : 6

  // Calculate target calendar day in UTC representation
  const targetUtc = new Date(Date.UTC(year, month - 1, day + daysUntilFriday, 12, 0, 0))
  const targetYear = targetUtc.getUTCFullYear()
  const targetMonth = String(targetUtc.getUTCMonth() + 1).padStart(2, "0")
  const targetDay = String(targetUtc.getUTCDate()).padStart(2, "0")

  const isoLocal = `${targetYear}-${targetMonth}-${targetDay}T23:59:59.999`
  const guessUtc = new Date(`${isoLocal}Z`)

  const ptParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hour12: false,
  }).formatToParts(guessUtc)

  const ptHour = Number(ptParts.find((p) => p.type === "hour")?.value || 0)
  let offsetHours = (23 - ptHour + 24) % 24
  if (offsetHours > 12) offsetHours -= 24

  return new Date(guessUtc.getTime() + offsetHours * 3600 * 1000)
}

/**
 * Synchronizes draft state transitions to the site_banners table.
 * Adheres strictly to Neon Postgres stateless HTTP driver constraints (sequential writes, no transactions).
 */
export async function syncDraftBanner({
  draftId,
  seasonId,
  event,
}: SyncDraftBannerParams): Promise<void> {
  const { predraftId, liveId, resultsId } = getDraftBannerIds(draftId)
  const now = new Date()

  switch (event) {
    case "publish": {
      // 1. Deactivate any live or results banner for this draft if they exist
      await db
        .update(schema.siteBanners)
        .set({ isActive: false, updatedAt: now })
        .where(eq(schema.siteBanners.id, liveId))
      await db
        .update(schema.siteBanners)
        .set({ isActive: false, updatedAt: now })
        .where(eq(schema.siteBanners.id, resultsId))

      // 2. Query draft instance for date
      const [draft] = await db
        .select()
        .from(schema.draftInstances)
        .where(eq(schema.draftInstances.id, draftId))
        .limit(1)

      const draftDate = draft?.draftDate ? new Date(draft.draftDate) : null
      const label = formatDraftDateLabel(draftDate)

      const values = {
        id: predraftId,
        label,
        mobileLabel: "BASH Draft",
        href: `/draft/${seasonId}`,
        variant: "default" as const,
        isActive: true,
        startDate: null,
        endDate: null,
        countdownType: (draftDate ? "event" : "none") as "event" | "none",
        countdownTarget: draftDate,
        priority: 20,
        dismissVersion: 1,
        hideOnPaths: ["/admin", "/draft"],
        createdAt: now,
        updatedAt: now,
      }

      await db
        .insert(schema.siteBanners)
        .values(values)
        .onConflictDoUpdate({
          target: schema.siteBanners.id,
          set: {
            label: values.label,
            mobileLabel: values.mobileLabel,
            href: values.href,
            variant: values.variant,
            isActive: true,
            countdownType: values.countdownType,
            countdownTarget: values.countdownTarget,
            priority: values.priority,
            hideOnPaths: values.hideOnPaths,
            updatedAt: now,
          },
        })
      break
    }

    case "unpublish": {
      await db
        .update(schema.siteBanners)
        .set({ isActive: false, updatedAt: now })
        .where(eq(schema.siteBanners.id, predraftId))
      break
    }

    case "start": {
      // Deactivate pre-draft banner
      await db
        .update(schema.siteBanners)
        .set({ isActive: false, updatedAt: now })
        .where(eq(schema.siteBanners.id, predraftId))

      const values = {
        id: liveId,
        label: "BASH Draft is LIVE — Watch the picks unfold",
        mobileLabel: "BASH Draft Live",
        href: `/draft/${seasonId}`,
        variant: "live" as const,
        isActive: true,
        startDate: null,
        endDate: null,
        countdownType: "none" as const,
        countdownTarget: null,
        priority: 100,
        dismissVersion: 1,
        hideOnPaths: ["/admin", "/draft"],
        createdAt: now,
        updatedAt: now,
      }

      await db
        .insert(schema.siteBanners)
        .values(values)
        .onConflictDoUpdate({
          target: schema.siteBanners.id,
          set: {
            label: values.label,
            mobileLabel: values.mobileLabel,
            href: values.href,
            variant: values.variant,
            isActive: true,
            priority: values.priority,
            updatedAt: now,
          },
        })
      break
    }

    case "complete": {
      // Deactivate live banner
      await db
        .update(schema.siteBanners)
        .set({ isActive: false, updatedAt: now })
        .where(eq(schema.siteBanners.id, liveId))

      const fridayMidnight = getFridayMidnightPT(now)

      const values = {
        id: resultsId,
        label: "View Draft Results",
        mobileLabel: "Draft Results",
        href: `/draft/${seasonId}`,
        variant: "default" as const,
        isActive: true,
        startDate: now,
        endDate: fridayMidnight,
        countdownType: "none" as const,
        countdownTarget: null,
        priority: 30,
        dismissVersion: 1,
        hideOnPaths: ["/admin", "/draft"],
        createdAt: now,
        updatedAt: now,
      }

      await db
        .insert(schema.siteBanners)
        .values(values)
        .onConflictDoUpdate({
          target: schema.siteBanners.id,
          set: {
            label: values.label,
            mobileLabel: values.mobileLabel,
            href: values.href,
            variant: values.variant,
            isActive: true,
            startDate: values.startDate,
            endDate: values.endDate,
            priority: values.priority,
            updatedAt: now,
          },
        })
      break
    }

    case "revert_to_live": {
      // Deactivate results banner
      await db
        .update(schema.siteBanners)
        .set({ isActive: false, updatedAt: now })
        .where(eq(schema.siteBanners.id, resultsId))

      // Re-activate or recreate live banner
      const values = {
        id: liveId,
        label: "BASH Draft is LIVE — Watch the picks unfold",
        mobileLabel: "BASH Draft Live",
        href: `/draft/${seasonId}`,
        variant: "live" as const,
        isActive: true,
        startDate: null,
        endDate: null,
        countdownType: "none" as const,
        countdownTarget: null,
        priority: 100,
        dismissVersion: 1,
        hideOnPaths: ["/admin", "/draft"],
        createdAt: now,
        updatedAt: now,
      }

      await db
        .insert(schema.siteBanners)
        .values(values)
        .onConflictDoUpdate({
          target: schema.siteBanners.id,
          set: {
            label: values.label,
            mobileLabel: values.mobileLabel,
            href: values.href,
            variant: values.variant,
            isActive: true,
            priority: values.priority,
            updatedAt: now,
          },
        })
      break
    }
  }
}
