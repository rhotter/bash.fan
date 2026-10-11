/** Canonical display names; season identifiers and custom event names stay intact. */
export function formatSeasonName(name: string): string {
  const trimmed = name.trim()
  const match = trimmed.match(/^(?:BASH\s+)?(?:(Fall|Summer)\s+)?(\d{4})(?:\s*[-–—]\s*(\d{4}|\d{2}))?(?:\s+(Fall|Summer))?(?:\s+Season)?(?:\s*(?:·\s*)?\s+(.+))?$/i)
  if (!match) return name

  const [, prefix, year, endYear, suffix, qualifier] = match
  const type = (prefix || suffix)?.toLowerCase()
  if (!type && !endYear) return name
  // Do not reinterpret an ambiguous or contradictory custom name.
  if ((prefix && suffix && prefix.toLowerCase() !== suffix.toLowerCase()) || (type === "summer" && endYear)) return name

  const base = type === "summer"
    ? `Summer ${year}`
    : `Fall ${year}–${(endYear || String(Number(year) + 1)).slice(-2)}`
  return qualifier ? `${base} · ${qualifier.replace(/^·\s*/, "")}` : base
}

/** Keep new canonical names on the established URL/ID scheme. */
export function seasonIdFromName(name: string): string {
  const fall = name.match(/^Fall (\d{4})–(\d{2})$/i)
  const summer = name.match(/^Summer (\d{4})$/i)
  if (summer) return `${summer[1]}-summer`
  if (fall) {
    const start = Number(fall[1])
    let end = Math.floor(start / 100) * 100 + Number(fall[2])
    if (end < start) end += 100
    return `${start}-${end}`
  }
  return name.toLowerCase().replace(/\s+/g, "-")
}
