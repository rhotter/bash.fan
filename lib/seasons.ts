import { db, schema } from "@/lib/db"
import { eq, desc, sql } from "drizzle-orm"
import { unstable_cache } from "next/cache"

export type SeasonType = "summer" | "fall"
export interface Season {
  id: string
  name: string
  leagueId: string
  seasonType: SeasonType
  status: string
  statsOnly: boolean
  enableSync: boolean
}

// ─── Module-level Next.js tag cache ──────────────────────────────────────────
// Season data changes ~2x/year. Caching avoids a Neon HTTP round trip
// (~50-200ms) on every single request that needs the current season.

function mapRow(s: typeof schema.seasons.$inferSelect): Season {
  return {
    id: s.id,
    name: s.name,
    leagueId: s.leagueId ?? "",
    seasonType: s.seasonType as SeasonType,
    status: s.status,
    statsOnly: s.statsOnly,
    enableSync: s.enableSync,
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const getCurrentSeason = unstable_cache(
  async (): Promise<Season> => {
    // 1. Explicitly featured season
    const s = await db.query.seasons.findFirst({
      where: eq(schema.seasons.isCurrent, true),
      orderBy: [desc(schema.seasons.id)],
    })
    if (s) {
      return mapRow(s)
    }

    // 2. Fallback: default to the last fully completed season
    // Chronologically ordered by latest game date, with season ID as tie-breaker
    const [lastCompleted] = await db
      .select()
      .from(schema.seasons)
      .where(eq(schema.seasons.status, "completed"))
      .orderBy(
        sql`(SELECT MAX(date) FROM games WHERE games.season_id = seasons.id) DESC NULLS LAST`,
        desc(schema.seasons.id)
      )
      .limit(1)

    if (lastCompleted) {
      return mapRow(lastCompleted)
    }

    // 3. Ultimate fallback: if no completed seasons exist (e.g. brand new setup), use newest by ID
    const fallback = await db.query.seasons.findFirst({ orderBy: [desc(schema.seasons.id)] })
    if (fallback) {
      return mapRow(fallback)
    }
    throw new Error("No seasons configured in the database.")
  },
  ['current-season'],
  { tags: ['seasons'], revalidate: 3600 }
)

export const getAllSeasons = unstable_cache(
  async (): Promise<Season[]> => {
    const rows = await db.query.seasons.findMany({
      orderBy: [desc(schema.seasons.id)],
    })
    return rows.map(mapRow).sort(compareSeasonsDesc)
  },
  ['all-seasons'],
  { tags: ['seasons'], revalidate: 3600 }
)

export async function getSeasonById(id: string): Promise<Season | undefined> {
  const all = await getAllSeasons()
  return all.find(s => s.id === id)
}

export async function isStatsOnlySeason(seasonId: string): Promise<boolean> {
  const s = await getSeasonById(seasonId)
  return s?.statsOnly === true
}

/**
 * Calculate a numeric chronological sort weight for a season.
 *
 * In BASH, within any calendar year Y:
 * 1. Summer season (Y-summer) runs ~May to August.
 * 2. Fall season (Y-(Y+1) or bash-Y-(Y+1)) starts ~September of year Y and runs into year Y+1.
 *
 * Therefore, chronological progression:
 * Summer 2025 < Fall 2025-2026 < Summer 2026 < Fall 2026-2027.
 * Weight = startYear * 10 + (isSummer ? 1 : 2).
 */
export function getSeasonSortWeight(
  seasonId: string,
  seasonType?: string | null
): number {
  if (!seasonId) return 0
  const match = seasonId.match(/(\d{4})/)
  const year = match ? parseInt(match[1], 10) : 0
  const isSummer =
    seasonType === "summer" || seasonId.toLowerCase().includes("summer")
  return year * 10 + (isSummer ? 1 : 2)
}

/**
 * Comparator to sort seasons in reverse chronological order (newest first).
 */
export function compareSeasonsDesc<
  T extends { id?: string; seasonId?: string; seasonType?: string | null }
>(a: T, b: T): number {
  const idA = a.seasonId ?? a.id ?? ""
  const idB = b.seasonId ?? b.id ?? ""
  return (
    getSeasonSortWeight(idB, b.seasonType) -
    getSeasonSortWeight(idA, a.seasonType) ||
    idB.localeCompare(idA)
  )
}

