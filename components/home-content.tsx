"use client"

import { useSearchParams } from "next/navigation"
import { ErrorNotice } from "@/components/error-notice"
import { ScoresTab } from "@/components/scores-tab"
import { useBashData, type BashApiData } from "@/lib/hockey-data"

export function HomeContent({ initialData }: { initialData?: BashApiData }) {
  const searchParams = useSearchParams()
  const season = searchParams.get("season") || undefined
  const { games, isLoading, isError, errorMessage } = useBashData(season, initialData)

  if (isError && games.length === 0) return <ErrorNotice message={errorMessage ?? "Could not load scores. Try again."} />
  return <>
    {isError && <ErrorNotice message={`Scores could not refresh; showing the last loaded results. ${errorMessage ?? ""}`} />}
    <ScoresTab games={games} isLoading={isLoading} />
  </>
}
