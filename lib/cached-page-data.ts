import { cache } from "react"
import { unstable_cache } from "next/cache"
import { fetchTeamDetail } from "@/lib/fetch-team-detail"
import { fetchPlayerStats } from "@/lib/fetch-player-stats"

// Public page snapshots can be shared briefly between visits. API handlers
// retain their existing freshness rules; no admin or live-score data is cached here.
const teamPageData = unstable_cache(fetchTeamDetail, ["team-page-data-v1"], {
  revalidate: 30,
  tags: ["seasons", "public-page-data"],
})
const statsPageData = unstable_cache(fetchPlayerStats, ["stats-page-data-v1"], {
  revalidate: 30,
  tags: ["seasons", "public-page-data"],
})

export const fetchTeamPageData = cache((slug: string, season?: string) => teamPageData(slug, season ?? null))
export const fetchStatsPageData = cache((season?: string, seasonType?: string, gameType?: string) =>
  statsPageData(season ?? null, false, seasonType ?? "fall", gameType ?? "regular")
)
