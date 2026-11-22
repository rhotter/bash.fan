"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { LoadingState } from "@/components/loading-state"
import { StandingsTab } from "@/components/standings-tab"
import { HeadToHeadTab } from "@/components/head-to-head-tab"
import { PlayoffOddsView } from "@/components/playoff-odds-view"
import { useBashData, type BashApiData, type PlayoffOddsSnapshot } from "@/lib/hockey-data"
import { isValidPlayoffOddsMode, type PlayoffOddsMode } from "@/lib/playoff-odds-types"
import { cn } from "@/lib/utils"
import { isLegacyTeamSlug } from "@/lib/team-filters"

type StandingsView = "standings" | "h2h" | "odds"

const VIEW_TABS: ReadonlyArray<{ id: StandingsView; label: string }> = [
  { id: "standings", label: "Standings" },
  { id: "h2h", label: "Head to Head" },
  { id: "odds", label: "Playoff Odds" },
]

function parseViewParam(raw: string | null): StandingsView {
  if (raw === "h2h") return "h2h"
  if (raw === "odds") return "odds"
  return "standings"
}

export function StandingsContent({
  initialData,
  initialPlayoffOdds,
}: {
  initialData?: BashApiData
  initialPlayoffOdds?: PlayoffOddsSnapshot
}) {
  const searchParams = useSearchParams()
  const season = searchParams.get("season") || undefined

  const { games, standings, isLoading } = useBashData(season, initialData)

  const paramView = parseViewParam(searchParams.get("view"))
  const paramTeam = searchParams.get("team") || undefined
  const rawMode = searchParams.get("mode")
  const paramMode: PlayoffOddsMode = isValidPlayoffOddsMode(rawMode) ? rawMode : "weighted"

  const [view, setView] = useState<StandingsView>(paramView)
  const [selectedTeam, setSelectedTeam] = useState<string | undefined>(paramTeam)
  const [oddsMode, setOddsMode] = useState<PlayoffOddsMode>(paramMode)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Sync state when Next.js client navigation updates searchParams (e.g. clicking SiteHeader "Standings" link)
  useEffect(() => {
    setView(paramView)
    setSelectedTeam(paramTeam)
    setOddsMode(paramMode)
  }, [paramView, paramTeam, paramMode])

  // Listen for browser Back / Forward navigation
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search)
      setView(parseViewParam(params.get("view")))
      setSelectedTeam(params.get("team") || undefined)
      const m = params.get("mode")
      setOddsMode(isValidPlayoffOddsMode(m) ? m : "weighted")
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
        params.delete("mode")
        const qs = params.toString()
        window.history.replaceState(null, "", qs ? `/standings?${qs}` : "/standings")
      }
    }
  }, [view, selectedTeam, availableTeams, searchParams])

  const handleViewChange = useCallback(
    (nextView: StandingsView) => {
      setView(nextView)
      const params = new URLSearchParams(searchParams.toString())
      if (nextView === "h2h") {
        params.set("view", "h2h")
        params.delete("mode")
        const activeTeam =
          selectedTeam && availableTeams.some((s) => s.slug === selectedTeam)
            ? selectedTeam
            : availableTeams[0]?.slug
        if (activeTeam) {
          params.set("team", activeTeam)
          setSelectedTeam(activeTeam)
        }
      } else if (nextView === "odds") {
        params.set("view", "odds")
        if (oddsMode !== "weighted") params.set("mode", oddsMode)
        else params.delete("mode")
        params.delete("team")
        setSelectedTeam(undefined)
      } else {
        params.delete("view")
        params.delete("team")
        params.delete("mode")
      }
      const qs = params.toString()
      window.history.replaceState(null, "", qs ? `/standings?${qs}` : "/standings")
    },
    [searchParams, selectedTeam, availableTeams, oddsMode]
  )

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      let nextIdx: number
      if (e.key === "ArrowRight") nextIdx = (idx + 1) % VIEW_TABS.length
      else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + VIEW_TABS.length) % VIEW_TABS.length
      else if (e.key === "Home") nextIdx = 0
      else if (e.key === "End") nextIdx = VIEW_TABS.length - 1
      else return

      e.preventDefault()
      handleViewChange(VIEW_TABS[nextIdx].id)
      tabRefs.current[nextIdx]?.focus()
    },
    [handleViewChange]
  )

  const handleSelectTeam = useCallback(
    (slug: string) => {
      setSelectedTeam(slug)
      const params = new URLSearchParams(searchParams.toString())
      params.set("view", "h2h")
      params.set("team", slug)
      params.delete("mode")
      const qs = params.toString()
      window.history.replaceState(null, "", qs ? `/standings?${qs}` : "/standings")
    },
    [searchParams]
  )

  const handleOddsUrlStateChange = useCallback(
    (next: { mode: PlayoffOddsMode; team?: string }) => {
      setOddsMode(next.mode)
      setSelectedTeam(next.team)
      const params = new URLSearchParams(searchParams.toString())
      params.set("view", "odds")
      if (next.mode !== "weighted") params.set("mode", next.mode)
      else params.delete("mode")
      if (next.team) params.set("team", next.team)
      else params.delete("team")
      const qs = params.toString()
      window.history.replaceState(null, "", qs ? `/standings?${qs}` : "/standings")
    },
    [searchParams]
  )

  if (season === "all") {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">
          Standings are not available for All Time view. Select a specific season.
        </p>
      </div>
    )
  }

  if (view !== "odds" && isLoading && standings.length === 0 && games.length === 0) {
    return <LoadingState variant="table" label="Loading standings…" />
  }

  if (view !== "odds" && standings.length === 0 && games.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">No standings data available yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Accessible Standings / Head to Head / Playoff Odds tablist */}
      <div className="flex items-center gap-1">
        <div role="tablist" aria-label="Standings views" className="flex items-center gap-1">
          {VIEW_TABS.map((tab, idx) => {
            const active = view === tab.id
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[idx] = el
                }}
                id={`standings-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`standings-panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => handleViewChange(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={cn(
                  "relative rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors min-h-[44px] sm:min-h-0 cursor-pointer whitespace-nowrap",
                  "aria-selected:after:content-[''] aria-selected:after:absolute aria-selected:after:inset-x-2 aria-selected:after:bottom-0 aria-selected:after:border-b-2 aria-selected:after:border-foreground",
                  active
                    ? "bg-card text-foreground"
                    : "text-muted-foreground/60 hover:text-muted-foreground"
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <div className="h-px flex-1 bg-border/40 ml-2" />
      </div>

      <div
        id={`standings-panel-${view}`}
        role="tabpanel"
        aria-labelledby={`standings-tab-${view}`}
      >
        {view === "odds" ? (
          <PlayoffOddsView
            season={season}
            initialMode={oddsMode}
            initialTeam={selectedTeam}
            initialData={initialPlayoffOdds}
            onUrlStateChange={handleOddsUrlStateChange}
          />
        ) : view === "h2h" ? (
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
    </div>
  )
}
