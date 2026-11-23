import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { LoadingState } from "@/components/loading-state"
import { PlayoffOddsPageClient } from "@/components/playoff-odds-page-client"
import { fetchPlayoffOddsPageData } from "@/lib/cached-page-data"
import { isValidPlayoffOddsMode } from "@/lib/playoff-odds-types"

export const metadata: Metadata = {
  title: "Playoff Odds",
  description:
    "BASH Monte Carlo playoff odds predictor — chance to make playoffs, projected finish seed table, and Big Games rooting guide.",
}

export const revalidate = 60

export default async function PlayoffOddsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; mode?: string }>
}) {
  const { season, mode } = await searchParams
  if (season === "all") redirect("/stats?season=all")

  const oddsMode = isValidPlayoffOddsMode(mode) ? mode : "weighted"
  const initialData = await fetchPlayoffOddsPageData(season, oddsMode)

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <Suspense
          fallback={<LoadingState variant="table" label="Running Monte Carlo playoff simulations…" />}
        >
          <PlayoffOddsPageClient initialData={initialData} />
        </Suspense>
      </main>
    </div>
  )
}
