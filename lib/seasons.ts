import { db, schema } from "@/lib/db"
import { eq, desc } from "drizzle-orm"

export type SeasonType = "summer" | "fall"
export interface Season {
  id: string
  name: string
  leagueId: string
  seasonType: SeasonType
  statsOnly?: boolean
}

// ─── Module-level TTL cache ─────────────────────────────────────────────────
// Season data changes ~2x/year. Caching avoids a Neon HTTP round trip
// (~50-200ms) on every single request that needs the current season.

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

let currentSeasonCache: { season: Season; ts: number } | null = null
let allSeasonsCache: { seasons: Season[]; ts: number } | null = null

function mapRow(s: typeof schema.seasons.$inferSelect): Season {
  return {
    id: s.id,
    name: s.name,
    leagueId: s.leagueId ?? "",
    seasonType: s.seasonType as SeasonType,
    statsOnly: s.statsOnly,
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getCurrentSeason(): Promise<Season> {
  if (currentSeasonCache && Date.now() - currentSeasonCache.ts < CACHE_TTL_MS) {
    return currentSeasonCache.season
  }

  const s = await db.query.seasons.findFirst({
    where: eq(schema.seasons.isCurrent, true),
  })
  if (!s) {
    // Fallback: no season is marked current — use the most recent one
    const fallback = await db.query.seasons.findFirst({ orderBy: [desc(schema.seasons.id)] })
    if (fallback) {
      const season = mapRow(fallback)
      currentSeasonCache = { season, ts: Date.now() }
      return season
    }
    throw new Error("No seasons configured in the database.")
  }

  const season = mapRow(s)
  currentSeasonCache = { season, ts: Date.now() }
  return season
}

export async function getAllSeasons(): Promise<Season[]> {
  if (allSeasonsCache && Date.now() - allSeasonsCache.ts < CACHE_TTL_MS) {
    return allSeasonsCache.seasons
  }

  const rows = await db.query.seasons.findMany({
    orderBy: [desc(schema.seasons.id)],
  })
  const seasons = rows.map(mapRow)
  allSeasonsCache = { seasons, ts: Date.now() }
  return seasons
}

export async function getSeasonById(id: string): Promise<Season | undefined> {
  // Piggyback off allSeasons cache when warm to avoid an extra DB hit
  const all = await getAllSeasons()
  return all.find(s => s.id === id)
}

export async function isStatsOnlySeason(seasonId: string): Promise<boolean> {
  const s = await getSeasonById(seasonId)
  return s?.statsOnly === true
}

/**
 * Invalidate the in-memory caches. Call this after admin mutations
 * (e.g. creating/updating a season) so the next read gets fresh data.
 */
export function invalidateSeasonCache(): void {
  currentSeasonCache = null
  allSeasonsCache = null
}
