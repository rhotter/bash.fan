import type { MetadataRoute } from 'next'
import { db, schema } from '@/lib/db'
import { getAllSeasons } from '@/lib/seasons'
import { playerSlug } from '@/lib/player-slug'
import { ne } from 'drizzle-orm'

const BASE_URL = 'https://www.bayareastreethockey.com'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // ─── Static pages ───────────────────────────────────────────────────────────
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/standings`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/stats`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/about`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/rulebook`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/how-to`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
  ]

  // ─── Dynamic: teams ─────────────────────────────────────────────────────────
  const teams = await db
    .select({ slug: schema.teams.slug })
    .from(schema.teams)
    .where(ne(schema.teams.slug, 'tbd'))

  const teamPages: MetadataRoute.Sitemap = teams.map((t) => ({
    url: `${BASE_URL}/team/${t.slug}`,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }))

  // ─── Dynamic: players ───────────────────────────────────────────────────────
  const players = await db
    .select({ name: schema.players.name })
    .from(schema.players)

  const playerPages: MetadataRoute.Sitemap = players.map((p) => ({
    url: `${BASE_URL}/player/${playerSlug(p.name)}`,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }))

  // ─── Dynamic: seasons (standings/stats with season param) ───────────────────
  const seasons = await getAllSeasons()
  const seasonPages: MetadataRoute.Sitemap = seasons.flatMap((s) => [
    { url: `${BASE_URL}/standings?season=${s.id}`, changeFrequency: 'weekly' as const, priority: 0.5 },
    { url: `${BASE_URL}/stats?season=${s.id}`, changeFrequency: 'weekly' as const, priority: 0.5 },
  ])

  return [...staticPages, ...teamPages, ...playerPages, ...seasonPages]
}
