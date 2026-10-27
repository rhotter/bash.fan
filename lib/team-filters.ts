// TODO: Remove once legacy seed-* and tbd teams are cleaned from production.

export function isLegacyTeamSlug(slug?: string | null): boolean {
  if (!slug) return false
  const s = slug.trim().toLowerCase()
  return s === "tbd" || s.startsWith("seed-")
}

export function filterLegacyTeams<T extends { slug: string }>(items: T[]): T[] {
  return items.filter((t) => !isLegacyTeamSlug(t.slug))
}
