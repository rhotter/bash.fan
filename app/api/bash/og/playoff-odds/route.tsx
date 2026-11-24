import { fetchPlayoffOddsPageData } from "@/lib/cached-page-data"
import { generateOGImage, generatePlayoffOddsOGImage } from "@/lib/og-image"
import { isValidPlayoffOddsMode } from "@/lib/playoff-odds-types"
import { formatSeasonName } from "@/lib/season-name"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawSeason = searchParams.get("season")
  const season = rawSeason && rawSeason !== "all" ? rawSeason : undefined
  const rawMode = searchParams.get("mode")
  const mode = isValidPlayoffOddsMode(rawMode) ? rawMode : "weighted"

  try {
    const snapshot = await fetchPlayoffOddsPageData(season, mode)
    const seasonLabel = formatSeasonName(snapshot.seasonName)

    const response =
      snapshot.timeline.length >= 2 && snapshot.teams.length > 0
        ? generatePlayoffOddsOGImage(snapshot, seasonLabel)
        : generateOGImage("Playoff Odds", seasonLabel || "bayareastreethockey.com")

    response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60")
    return response
  } catch {
    return generateOGImage("Playoff Odds", "bayareastreethockey.com")
  }
}
