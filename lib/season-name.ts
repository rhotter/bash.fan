/** Canonical display names; season identifiers and custom event names stay intact. */
export function formatSeasonName(name: string): string {
  const trimmed = name.trim()
  const match = trimmed.match(/^(?:BASH\s+)?(?:(Fall|Summer)[\s-]+)?(\d{4})(?:\s*[-–—]\s*(\d{4}|\d{2}))?(?:[\s-]+(Fall|Summer))?(?:\s+Season)?(?:\s*(?:·\s*)?\s+(.+))?$/i)
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

/** Compact display format for tight table columns (e.g. "F 14-15", "S '14"). */
export function formatCompactSeasonName(nameOrId?: string): string {
  if (!nameOrId) return ""
  const canonical = formatSeasonName(nameOrId)
  const summerMatch = canonical.match(/(?:^|[\s-])summer[\s-]*(\d{4})|(\d{4})[\s-]*summer/i)
  if (summerMatch) {
    const yr = summerMatch[1] || summerMatch[2]
    return `S '${yr.slice(-2)}`
  }
  const fallMatch = canonical.match(/(?:fall\s+)?(\d{4})\s*[-–—]\s*(\d{2,4})/i)
  if (fallMatch) {
    return `F ${fallMatch[1].slice(-2)}-${fallMatch[2].slice(-2)}`
  }
  return canonical
}

/**
 * Chronological comparator for team-season records (newest season first).
 * Summer YYYY (weight = YYYY * 10 + 1) precedes Fall YYYY–YY+1 (weight = YYYY * 10 + 2).
 */
export function compareTeamSeasonDesc(
  a: { seasonId?: string; seasonName?: string },
  b: { seasonId?: string; seasonName?: string }
): number {
  const getWeight = (item: { seasonId?: string; seasonName?: string }) => {
    const raw = `${item.seasonId ?? ""} ${item.seasonName ?? ""}`.trim()
    if (!raw) return 0
    const yearMatch = (item.seasonId || item.seasonName || "").match(/(\d{4})/)
    const year = yearMatch ? parseInt(yearMatch[1], 10) : 0
    const isSummer = /\bsummer\b/i.test(raw) || (item.seasonId ?? "").toLowerCase().includes("summer")
    return year * 10 + (isSummer ? 1 : 2)
  }
  return (getWeight(b) - getWeight(a)) || (b.seasonId ?? "").localeCompare(a.seasonId ?? "")
}
