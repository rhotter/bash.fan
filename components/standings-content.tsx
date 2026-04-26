"use client"

import { useSearchParams } from "next/navigation"
import { StandingsTab } from "@/components/standings-tab"
import { useBashData, type BashApiData } from "@/lib/hockey-data"

export function StandingsContent({ initialData }: { initialData?: BashApiData }) {
  const searchParams = useSearchParams()
  const season = searchParams.get("season") || undefined

  const { standings, isLoading } = useBashData(season, initialData)

  if (season === "all") {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">Standings are not available for All Time view. Select a specific season.</p>
      </div>
    )
  }

  return <StandingsTab standings={standings} isLoading={isLoading} />
}
