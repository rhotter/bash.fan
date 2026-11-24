import { fetchBashData } from "@/lib/fetch-bash-data"
import { buildBracketRounds } from "@/lib/playoff-bracket-utils"
import { generateOGImage, generatePlayoffBracketOGImage } from "@/lib/og-image"
import { formatSeasonName } from "@/lib/season-name"
import { getCurrentSeason } from "@/lib/seasons"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawSeason = searchParams.get("season")
  const season = rawSeason && rawSeason !== "all" ? rawSeason : undefined
  const gameType = (searchParams.get("gameType") || "").toLowerCase()
  const team = searchParams.get("team") || "all"

  const isPlayoffView = (gameType === "playoff" || gameType === "playoffs") && team === "all"

  if (isPlayoffView) {
    try {
      const [data, currentSeason] = await Promise.all([
        fetchBashData(season),
        season ? Promise.resolve(null) : getCurrentSeason(),
      ])
      const playoffGames = data.games.filter(
        (g) => g.isPlayoff || g.gameType === "playoff" || g.gameType === "championship",
      )
      const rounds = buildBracketRounds(playoffGames)
      const seasonLabel = season ? formatSeasonName(season) : currentSeason ? formatSeasonName(currentSeason.name) : undefined

      const response =
        rounds.length > 0
          ? generatePlayoffBracketOGImage(rounds, seasonLabel)
          : generateOGImage("Playoff Schedule", seasonLabel ?? "bayareastreethockey.com")

      response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60")
      return response
    } catch {
      return generateOGImage("Playoff Schedule", "bayareastreethockey.com")
    }
  }

  const response = generateOGImage("Season Schedule", "bayareastreethockey.com")
  response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600")
  return response
}
