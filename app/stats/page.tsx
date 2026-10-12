import { LoadingState } from "@/components/loading-state"
import type { Metadata } from "next"
import { Suspense } from "react"
import { StatsTab } from "@/components/stats-tab"
import { fetchPlayerStats } from "@/lib/fetch-player-stats"

export const metadata: Metadata = {
  title: "Stats",
  description: "BASH player stats and leaderboards - goals, assists, points, and more.",
}

export const revalidate = 60

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ season?: string; seasonType?: string; gameType?: string }> }) {
  const { season, seasonType, gameType } = await searchParams
  const data = await fetchPlayerStats(season, false, seasonType, gameType)

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <Suspense fallback={<LoadingState variant="stats" label="Loading player stats…" />}>
          <StatsTab initialData={data} />
        </Suspense>
      </main>
    </div>
  )
}
