import { db, schema } from "@/lib/db"
import { eq, desc } from "drizzle-orm"
import { unstable_cache } from "next/cache"

export type SeasonType = "summer" | "fall"
export interface Season {
  id: string
  name: string
  leagueId: string
  seasonType: SeasonType
  statsOnly?: boolean
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
    statsOnly: s.statsOnly,
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const getCurrentSeason = unstable_cache(
  async (): Promise<Season> => {
    const s = await db.query.seasons.findFirst({
      where: eq(schema.seasons.isCurrent, true),
    })
    if (!s) {
      // Fallback: no season is marked current — use the most recent one
      const fallback = await db.query.seasons.findFirst({ orderBy: [desc(schema.seasons.id)] })
      if (fallback) {
        return mapRow(fallback)
      }
      throw new Error("No seasons configured in the database.")
    }
    return mapRow(s)
  },
  ['current-season'],
  { tags: ['seasons'], revalidate: 3600 }
)

export const getAllSeasons = unstable_cache(
  async (): Promise<Season[]> => {
    const rows = await db.query.seasons.findMany({
      orderBy: [desc(schema.seasons.id)],
    })
    return rows.map(mapRow)
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

