import { LoadingState } from "@/components/loading-state"
import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { StandingsContent } from "@/components/standings-content"
import { fetchBashData } from "@/lib/fetch-bash-data"
import { fetchPlayoffOddsPageData } from "@/lib/cached-page-data"
import { isValidPlayoffOddsMode } from "@/lib/playoff-odds-types"

type StandingsSearchParams = Promise<{ season?: string; view?: string; mode?: string }>

export async function generateMetadata({ searchParams }: { searchParams: StandingsSearchParams }): Promise<Metadata> {
  const { season: rawSeason, view, mode } = await searchParams
  const season = rawSeason && rawSeason !== "all" ? rawSeason : undefined

  if (view === "odds") {
    const ogParams = new URLSearchParams()
    if (season) ogParams.set("season", season)
    if (isValidPlayoffOddsMode(mode)) ogParams.set("mode", mode)
    const qs = ogParams.toString()
    const ogImageUrl = qs ? `/api/bash/og/playoff-odds?${qs}` : "/api/bash/og/playoff-odds"

    return {
      title: "Playoff Odds",
      description: "Monte Carlo playoff qualification odds and seed projections for BASH.",
      openGraph: {
        title: "Playoff Odds | BASH",
        description: "Monte Carlo playoff qualification odds and seed projections for BASH.",
        images: [{ url: ogImageUrl, width: 1200, height: 630, alt: "Chance Will Make Playoffs" }],
      },
      twitter: {
        card: "summary_large_image",
        title: "Playoff Odds | BASH",
        description: "Monte Carlo playoff qualification odds and seed projections for BASH.",
        images: [ogImageUrl],
      },
    }
  }

  return {
    title: "Standings",
    description:
      "BASH league standings, head-to-head series breakdowns, and Monte Carlo playoff odds & seed projections.",
  }
}

export const revalidate = 30

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: StandingsSearchParams
}) {
  const { season, view, mode } = await searchParams
  if (season === "all") redirect("/stats?season=all")

  const oddsMode = isValidPlayoffOddsMode(mode) ? mode : "weighted"

  const [data, initialPlayoffOdds] = await Promise.all([
    fetchBashData(season),
    view === "odds" ? fetchPlayoffOddsPageData(season, oddsMode) : Promise.resolve(undefined),
  ])

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <Suspense fallback={<LoadingState variant="table" label="Loading standings…" />}>
          <StandingsContent initialData={data} initialPlayoffOdds={initialPlayoffOdds} />
        </Suspense>
      </main>
    </div>
  )
}
