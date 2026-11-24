import { LoadingState } from "@/components/loading-state"
import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { ScheduleContent } from "@/components/schedule-content"
import { fetchBashData } from "@/lib/fetch-bash-data"

export const metadata: Metadata = {
  title: "Schedule",
  description: "Full BASH season schedule including past results, upcoming games, tryouts, playoffs, and exhibition matchups.",
}

export const revalidate = 30

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
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
