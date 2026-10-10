/**
 * Date/time formatting and normalization utilities.
 * All date functions use the browser's local timezone automatically.
 */

export function formatGameDate(dateStr: string): string {
  // dateStr is "YYYY-MM-DD" — parse as local date
  const [y, m, d] = dateStr.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

export function formatGameDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function formatGameDateNoYear(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

/**
 * Normalizes a time string into a canonical storage format: "h:mmam" / "h:mmpm".
 * Handles all known input formats:
 *   - Sportability shorthand: "9:00p", "6:00a"
 *   - Full AM/PM: "9:00pm", "9:00 AM"
 *   - 24-hour (from HTML <input type="time">): "09:00", "14:00"
 *   - Already canonical: "9:00am", "2:00pm"
 *   - Special: "TBD", "", null/undefined
 *
 * Call this server-side before writing to the database.
 */
export function normalizeTimeForStorage(time: string | null | undefined): string {
  if (!time) return "TBD"
  const trimmed = time.trim()
  if (!trimmed || trimmed.toUpperCase() === "TBD") return "TBD"

  // Match AM/PM variants: "9:00p", "9:00pm", "9:00 PM", "12:00a", "6:00am", "9:00:00 PM"
  const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(a|am|p|pm)$/i)
  if (ampmMatch) {
    const h = parseInt(ampmMatch[1], 10)
    const m = ampmMatch[2]
    const minVal = parseInt(m, 10)
    const suffix = ampmMatch[3].toLowerCase().startsWith("p") ? "pm" : "am"
    // Reject invalid hours/minutes for 12-hour format (e.g. "13:00pm", "9:65pm")
    if (h >= 1 && h <= 12 && minVal >= 0 && minVal <= 59) return `${h}:${m}${suffix}`
  }

  // Match pure 24-hour with optional seconds: "09:00", "14:00", "0:00", "14:00:00"
  const milMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (milMatch) {
    let h = parseInt(milMatch[1], 10)
    const m = milMatch[2]
    const minVal = parseInt(m, 10)
    if (h >= 0 && h <= 23 && minVal >= 0 && minVal <= 59) {
      const suffix = h >= 12 ? "pm" : "am"
      if (h === 0) h = 12
      else if (h > 12) h -= 12
      return `${h}:${m}${suffix}`
    }
  }

  // Fallback: return as-is
  return trimmed
}

/**
 * Formats a game time for user-facing display.
 * Delegates to normalizeTimeForStorage for consistent output.
 */
export function formatGameTime(time: string): string {
  if (!time || time === "TBD") return time || "TBD"
  return normalizeTimeForStorage(time)
}

/**
 * Converts a stored time string (any format) back to 24-hour "HH:MM" format
 * for use as the `value` of an HTML <input type="time"> element.
 * Returns "" for "TBD" or unrecognized formats.
 */
export function toHHMM(time: string | null | undefined): string {
  if (!time) return ""
  const trimmed = time.trim()
  if (!trimmed || trimmed.toUpperCase() === "TBD") return ""

  // AM/PM variants: "9:00pm", "9:00p", "12:00am", "12:00pm", "1:00pm", "11:30pm", "9:00:00 PM"
  const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(a|am|p|pm)$/i)
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1], 10)
    const m = ampmMatch[2]
    const minVal = parseInt(m, 10)
    if (h < 1 || h > 12 || minVal < 0 || minVal > 59) return ""
    const isPM = ampmMatch[3].toLowerCase().startsWith("p")
    if (isPM && h !== 12) h += 12
    else if (!isPM && h === 12) h = 0
    return `${String(h).padStart(2, "0")}:${m}`
  }

  // Pure 24-hour with optional seconds: "09:00", "14:00", "14:00:00"
  const milMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (milMatch) {
    const h = parseInt(milMatch[1], 10)
    const m = milMatch[2]
    const minVal = parseInt(m, 10)
    if (h >= 0 && h <= 23 && minVal >= 0 && minVal <= 59) {
      return `${String(h).padStart(2, "0")}:${m}`
    }
    return ""
  }

  return ""
}

/**
 * Compares two game time strings chronologically.
 * Uses 24-hour HH:MM conversion so that morning games (e.g., "9:00am")
 * precede afternoon/evening games (e.g., "1:00pm", "11:00pm").
 * Unset/TBD times sort to the end.
 */
export function compareGameTimes(timeA?: string | null, timeB?: string | null): number {
  const normA = toHHMM(timeA)
  const normB = toHHMM(timeB)

  if (normA && normB) {
    return normA.localeCompare(normB)
  }
  if (normA && !normB) {
    return -1 // valid time comes before TBD / unknown
  }
  if (!normA && normB) {
    return 1 // TBD / unknown comes after valid time
  }
  // Neither is valid HH:MM (e.g. both TBD, or both empty)
  return (timeA || "").localeCompare(timeB || "")
}

/**
 * Compares two games chronologically by date then time, with tiebreak on id.
 */
export function compareGamesChronological<
  T extends { date?: string | null; time?: string | null; id?: string | number }
>(a: T, b: T): number {
  const dateA = a.date?.split("T")[0].trim() || "9999-99-99"
  const dateB = b.date?.split("T")[0].trim() || "9999-99-99"
  if (dateA !== dateB) {
    return dateA.localeCompare(dateB)
  }
  const timeComp = compareGameTimes(a.time, b.time)
  if (timeComp !== 0) {
    return timeComp
  }
  return String(a.id ?? "").localeCompare(String(b.id ?? ""))
}

