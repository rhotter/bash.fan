import { LoadingState } from "@/components/loading-state"
import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { ScheduleContent } from "@/components/schedule-content"
import { fetchBashData } from "@/lib/fetch-bash-data"

export const revalidate = 30

type ScheduleSearchParams = Promise<{ season?: string; gameType?: string; team?: string }>

export async function generateMetadata({ searchParams }: { searchParams: ScheduleSearchParams }): Promise<Metadata> {
  const { season: rawSeason, gameType, team } = await searchParams
  const season = rawSeason && rawSeason !== "all" ? rawSeason : undefined
  const gt = (gameType || "").toLowerCase()
  const isPlayoffView = (gt === "playoff" || gt === "playoffs") && (!team || team === "all")

  const ogParams = new URLSearchParams()
  if (season) ogParams.set("season", season)
  if (isPlayoffView) ogParams.set("gameType", "playoff")
  const ogQs = ogParams.toString()
  const ogImageUrl = ogQs ? `/api/bash/og/schedule?${ogQs}` : "/api/bash/og/schedule"

  if (isPlayoffView) {
    return {
      title: "Playoff Bracket & Schedule",
      description: "BASH playoff bracket, series scores, and upcoming tournament matchups.",
      openGraph: {
        title: "Playoff Bracket & Schedule | BASH",
        description: "BASH playoff bracket, series scores, and upcoming tournament matchups.",
        images: [{ url: ogImageUrl, width: 1200, height: 630, alt: "BASH Playoff Bracket" }],
      },
      twitter: {
        card: "summary_large_image",
        title: "Playoff Bracket & Schedule | BASH",
        description: "BASH playoff bracket, series scores, and upcoming tournament matchups.",
        images: [ogImageUrl],
      },
    }
  }

  return {
    title: "Schedule",
    description: "Full BASH season schedule including past results, upcoming games, tryouts, playoffs, and exhibition matchups.",
    openGraph: {
      title: "Schedule | BASH",
      description: "Full BASH season schedule including past results, upcoming games, tryouts, playoffs, and exhibition matchups.",
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: "BASH Season Schedule" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Schedule | BASH",
      description: "Full BASH season schedule including past results, upcoming games, tryouts, playoffs, and exhibition matchups.",
      images: [ogImageUrl],
    },
  }
}

export default async function SchedulePage({ searchParams }: { searchParams: ScheduleSearchParams }) {
  const { season } = await searchParams
  if (season === "all") redirect("/stats?season=all")
  const data = await fetchBashData(season)

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <Suspense fallback={<LoadingState variant="table" label="Loading schedule…" />}>
          <ScheduleContent initialData={data} />
        </Suspense>
      </main>
    </div>
  )
}
