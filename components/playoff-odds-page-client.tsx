"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { PlayoffOddsView } from "@/components/playoff-odds-view"
import { isValidPlayoffOddsMode, type PlayoffOddsMode, type PlayoffOddsSnapshot } from "@/lib/playoff-odds-types"

export function PlayoffOddsPageClient({
  initialData,
}: {
  initialData?: PlayoffOddsSnapshot
}) {
  const searchParams = useSearchParams()
  const season = searchParams.get("season") || undefined
  const rawMode = searchParams.get("mode")
  const initialMode: PlayoffOddsMode = isValidPlayoffOddsMode(rawMode) ? rawMode : "weighted"
  const initialTeam = searchParams.get("team") || undefined

  const handleUrlStateChange = useCallback((next: { mode: PlayoffOddsMode; team?: string }) => {
    const params = new URLSearchParams(window.location.search)
    if (next.mode !== "weighted") params.set("mode", next.mode)
    else params.delete("mode")
    if (next.team) params.set("team", next.team)
    else params.delete("team")
    const qs = params.toString()
    window.history.replaceState(null, "", qs ? `/playoff-odds?${qs}` : "/playoff-odds")
  }, [])

  const standingsHref = season && season !== "all" ? `/standings?season=${season}` : "/standings"

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Playoff Odds</h1>
          <p className="text-xs text-muted-foreground">
            Monte Carlo playoff qualification probabilities, seed projections, and upcoming Big Games.
          </p>
        </div>
        <Link
          href={standingsHref}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Standings
        </Link>
      </div>

      <PlayoffOddsView
        season={season}
        initialMode={initialMode}
        initialTeam={initialTeam}
        initialData={initialData}
        onUrlStateChange={handleUrlStateChange}
      />
    </div>
  )
}
