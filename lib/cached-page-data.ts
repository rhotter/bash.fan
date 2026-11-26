import { cache } from "react"
import { unstable_cache } from "next/cache"
import { fetchTeamDetail } from "@/lib/fetch-team-detail"
import { fetchPlayerStats } from "@/lib/fetch-player-stats"
import { fetchTeamStats } from "@/lib/fetch-team-stats"
import { fetchPlayoffOdds } from "@/lib/fetch-playoff-odds"
import { getCurrentSeason, getSeasonById } from "@/lib/seasons"
import type { PlayoffOddsMode } from "@/lib/playoff-odds-types"

// Public page snapshots can be shared briefly between visits. API handlers
// retain their existing freshness rules; no admin or live-score data is cached here.
const teamPageData = unstable_cache(fetchTeamDetail, ["team-page-data-v1"], {
  revalidate: 30,
  tags: ["seasons", "public-page-data"],
})
const statsPageData = unstable_cache(
  async (season: string | null, playoff: boolean, seasonType: string, gameType: string) => {
    const [playerStats, teamStats] = await Promise.all([
      fetchPlayerStats(season, playoff, seasonType, gameType),
      fetchTeamStats(season, playoff, seasonType, gameType),
    ])
    return {
      ...playerStats,
      teamSkaters: teamStats.teamSkaters,
      teamGoalies: teamStats.teamGoalies,
    }
  },
  ["stats-page-data-v9"],
  {
    revalidate: 30,
    tags: ["seasons", "public-page-data"],
  }
)
const activePlayoffOddsBySeasonId = unstable_cache(
  async (seasonId: string, mode: PlayoffOddsMode) => fetchPlayoffOdds(seasonId, mode),
  ["playoff-odds-active-v6"],
  {
    revalidate: 60,
    tags: ["seasons", "playoff-odds", "public-page-data"],
  }
)
const completedPlayoffOddsBySeasonId = unstable_cache(
  async (seasonId: string, mode: PlayoffOddsMode) => fetchPlayoffOdds(seasonId, mode),
  ["playoff-odds-completed-v6"],
  {
    revalidate: 3600,
    tags: ["seasons", "playoff-odds", "public-page-data"],
  }
)

export const fetchTeamPageData = cache((slug: string, season?: string) => teamPageData(slug, season ?? null))
export const fetchStatsPageData = cache((season?: string, seasonType?: string, gameType?: string) =>
  statsPageData(season ?? null, false, seasonType ?? "fall", gameType ?? "regular")
)
export const fetchPlayoffOddsPageData = cache(
  async (season?: string | null, mode: PlayoffOddsMode = "weighted") => {
    // Canonicalize season before touching unstable_cache so arbitrary query strings
    // cannot amplify the cache keyspace or trigger uncached CPU work.
    const resolved =
      season && season !== "all"
        ? (await getSeasonById(season)) ?? (await getCurrentSeason())
        : await getCurrentSeason()
    if (resolved.status === "completed") {
      return completedPlayoffOddsBySeasonId(resolved.id, mode)
    }
    return activePlayoffOddsBySeasonId(resolved.id, mode)
  }
)
