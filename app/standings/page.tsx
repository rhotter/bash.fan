import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { StandingsContent } from "@/components/standings-content"
import { fetchBashData } from "@/lib/fetch-bash-data"

export const metadata: Metadata = {
  title: "Standings",
  description: "BASH league standings - team rankings, points, wins, losses, and goal differential.",
}

export const revalidate = 30

export default async function StandingsPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const { season } = await searchParams
  if (season === "all") redirect("/stats?season=all")
  const data = await fetchBashData(season)

  return (
    <div className="flex flex-1 flex-col bg-background">
      <SiteHeader activeTab="standings" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <Suspense>
          <StandingsContent initialData={data} />
        </Suspense>
      </main>
    </div>
  )
}
