/**
 * Client-side date/time formatting utilities.
 * All functions use the browser's local timezone automatically.
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
