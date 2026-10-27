"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { LoadingState } from "@/components/loading-state"
import { StandingsTab } from "@/components/standings-tab"
import { HeadToHeadTab } from "@/components/head-to-head-tab"
import { useBashData, type BashApiData } from "@/lib/hockey-data"
import { cn } from "@/lib/utils"

import { isLegacyTeamSlug } from "@/lib/team-filters"

export function StandingsContent({ initialData }: { initialData?: BashApiData }) {
  const searchParams = useSearchParams()
  const season = searchParams.get("season") || undefined

  const { games, standings, isLoading } = useBashData(season, initialData)

  const paramView = searchParams.get("view") === "h2h" ? "h2h" : "standings"
  const paramTeam = searchParams.get("team") || undefined

  const [view, setView] = useState<"standings" | "h2h">(paramView)
  const [selectedTeam, setSelectedTeam] = useState<string | undefined>(paramTeam)

  // Sync state when Next.js client navigation updates searchParams (e.g. clicking SiteHeader "Standings" link)
  useEffect(() => {
    setView(paramView)
    setSelectedTeam(paramTeam)
  }, [paramView, paramTeam])

  // Listen for browser Back / Forward navigation
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search)
      setView(params.get("view") === "h2h" ? "h2h" : "standings")
      setSelectedTeam(params.get("team") || undefined)
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  const availableTeams = useMemo(() => {
    if (standings.length > 0) {
      return [...standings]
        .filter((s) => !isLegacyTeamSlug(s.slug))
        .sort((a, b) => a.team.localeCompare(b.team))
    }
    const map = new Map<string, string>()
    for (const g of games) {
      if (g.gameType === "regular" && !g.isPlayoff) {
        if (!isLegacyTeamSlug(g.homeSlug) && !map.has(g.homeSlug)) map.set(g.homeSlug, g.homeTeam)
        if (!isLegacyTeamSlug(g.awaySlug) && !map.has(g.awaySlug)) map.set(g.awaySlug, g.awayTeam)
      }
    }
    return [...map.entries()]
      .map(([slug, name]) => ({
        slug,
        team: name,
        gp: 0,
        w: 0,
        otw: 0,
        l: 0,
        otl: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        pts: 0,
      }))
      .sort((a, b) => a.team.localeCompare(b.team))
  }, [standings, games])

  // Validate selected team against available teams when in h2h view
  useEffect(() => {
    if (view === "h2h" && availableTeams.length > 0) {
      const isValid = selectedTeam && availableTeams.some((s) => s.slug === selectedTeam)
      if (!isValid) {
        const fallback = availableTeams[0].slug
        setSelectedTeam(fallback)
        const params = new URLSearchParams(searchParams.toString())
        params.set("view", "h2h")
        params.set("team", fallback)
        const qs = params.toString()
        window.history.replaceState(null, "", qs ? `/standings?${qs}` : "/standings")
      }
    }
  }, [view, selectedTeam, availableTeams, searchParams])

  const handleViewChange = useCallback((nextView: "standings" | "h2h") => {
    setView(nextView)
    const params = new URLSearchParams(searchParams.toString())
    if (nextView === "h2h") {
      params.set("view", "h2h")
      const activeTeam = (selectedTeam && availableTeams.some((s) => s.slug === selectedTeam))
        ? selectedTeam
        : availableTeams[0]?.slug
      if (activeTeam) {
        params.set("team", activeTeam)
        setSelectedTeam(activeTeam)
      }
    } else {
      params.delete("view")
      params.delete("team")
    }
    const qs = params.toString()
    window.history.replaceState(null, "", qs ? `/standings?${qs}` : "/standings")
  }, [searchParams, selectedTeam, availableTeams])

  const handleSelectTeam = useCallback((slug: string) => {
    setSelectedTeam(slug)
    const params = new URLSearchParams(searchParams.toString())
    params.set("view", "h2h")
    params.set("team", slug)
    const qs = params.toString()
    window.history.replaceState(null, "", qs ? `/standings?${qs}` : "/standings")
  }, [searchParams])

  if (season === "all") {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">Standings are not available for All Time view. Select a specific season.</p>
      </div>
    )
  }

  if (isLoading && standings.length === 0 && games.length === 0) {
    return <LoadingState variant="table" label="Loading standings…" />
  }

  if (standings.length === 0 && games.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">No standings data available yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Standings / Head to Head toggle */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => handleViewChange("standings")}
          className={cn(
            "rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors min-h-[44px] sm:min-h-0 cursor-pointer",
            view === "standings" ? "bg-card text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
          )}
        >
          Standings
        </button>
        <button
          type="button"
          onClick={() => handleViewChange("h2h")}
          className={cn(
            "rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors min-h-[44px] sm:min-h-0 cursor-pointer",
            view === "h2h" ? "bg-card text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
          )}
        >
          Head to Head
        </button>
        <div className="h-px flex-1 bg-border/40 ml-2" />
      </div>

      {view === "h2h" ? (
        <HeadToHeadTab
          games={games}
          standings={availableTeams}
          isLoading={isLoading}
          selectedTeamSlug={selectedTeam}
          onSelectTeam={handleSelectTeam}
        />
      ) : (
        <StandingsTab standings={standings} isLoading={isLoading} />
      )}
    </div>
  )
}
