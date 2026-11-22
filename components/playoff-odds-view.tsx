"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RotateCcw, Sparkles } from "lucide-react"
import { LoadingState } from "@/components/loading-state"
import { ErrorNotice } from "@/components/error-notice"
import { PlayoffOddsTable } from "@/components/playoff-odds-table"
import { TeamOddsPanel } from "@/components/team-odds-panel"
import { BigGamesSection } from "@/components/big-games-section"
import { PlayoffOddsMethodology } from "@/components/playoff-odds-methodology"
import { usePlayoffOdds } from "@/lib/hockey-data"
import { CLIENT_WHATIF_ITERATIONS, computePlayoffOdds } from "@/lib/playoff-odds"
import { cn } from "@/lib/utils"
import type {
  BigGameOutcomeKey,
  PlayoffOddsMode,
  PlayoffOddsSnapshot,
} from "@/lib/playoff-odds-types"

const MODE_OPTIONS: ReadonlyArray<{
  value: PlayoffOddsMode
  label: string
  hint: string
}> = [
  {
    value: "weighted",
    label: "Weighted",
    hint: "BASH-calibrated PythagenPuck + Empirical Bayes shrinkage (recommended)",
  },
  {
    value: "50_50",
    label: "50/50",
    hint: "Pure coin-flip schedule math (every remaining game is 50/50)",
  },
  {
    value: "classic",
    label: "SCS Classic",
    hint: "Ken Roberts's original points-percentage + piecewise regression",
  },
]

export function PlayoffOddsView({
  season,
  initialMode = "weighted",
  initialTeam,
  initialData,
  onUrlStateChange,
}: {
  season?: string
  initialMode?: PlayoffOddsMode
  initialTeam?: string
  initialData?: PlayoffOddsSnapshot
  onUrlStateChange?: (next: { mode: PlayoffOddsMode; team?: string }) => void
}) {
  const [mode, setMode] = useState<PlayoffOddsMode>(initialMode)
  const [selectedTeamSlug, setSelectedTeamSlug] = useState<string | null>(initialTeam ?? null)
  const [lockedOutcomes, setLockedOutcomes] = useState<Record<string, BigGameOutcomeKey>>({})
  const modeTabRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => {
    setSelectedTeamSlug(initialTeam ?? null)
  }, [initialTeam])

  // Clear What-If locks if user switches seasons
  useEffect(() => {
    setLockedOutcomes({})
  }, [season])

  const { snapshot: baselineSnapshot, isLoading, isValidating, isError, errorMessage, refresh } =
    usePlayoffOdds(season, mode, initialData)

  const handleModeChange = useCallback(
    (nextMode: PlayoffOddsMode) => {
      setMode(nextMode)
      onUrlStateChange?.({ mode: nextMode, team: selectedTeamSlug ?? undefined })
    },
    [onUrlStateChange, selectedTeamSlug]
  )

  const handleSelectTeam = useCallback(
    (slug: string | null) => {
      setSelectedTeamSlug(slug)
      onUrlStateChange?.({ mode, team: slug ?? undefined })
    },
    [mode, onUrlStateChange]
  )

  const handleModeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      let nextIdx: number
      if (e.key === "ArrowRight") nextIdx = (idx + 1) % MODE_OPTIONS.length
      else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + MODE_OPTIONS.length) % MODE_OPTIONS.length
      else if (e.key === "Home") nextIdx = 0
      else if (e.key === "End") nextIdx = MODE_OPTIONS.length - 1
      else return

      e.preventDefault()
      const next = MODE_OPTIONS[nextIdx]
      handleModeChange(next.value)
      modeTabRefs.current[nextIdx]?.focus()
    },
    [handleModeChange]
  )

  const handleToggleOutcome = useCallback((gameId: string, outcome: BigGameOutcomeKey) => {
    setLockedOutcomes((prev) => {
      const next = { ...prev }
      if (next[gameId] === outcome) {
        delete next[gameId]
      } else {
        next[gameId] = outcome
      }
      return next
    })
  }, [])

  const handleClearLocked = useCallback(() => {
    setLockedOutcomes({})
  }, [])

  const lockedCount = Object.keys(lockedOutcomes).length

  // Instant client-side What-If re-simulation when user locks 1+ upcoming game outcomes
  const activeSnapshot = useMemo(() => {
    if (!baselineSnapshot) return null
    if (lockedCount === 0) return baselineSnapshot

    const whatIfSnap = computePlayoffOdds({
      seasonId: baselineSnapshot.seasonId,
      seasonName: baselineSnapshot.seasonName,
      seasonType: baselineSnapshot.seasonType,
      seasonStatus: baselineSnapshot.seasonStatus,
      configuredPlayoffTeams: baselineSnapshot.format.playoffSpots,
      games: baselineSnapshot.regularGames,
      mode,
      iterations: CLIENT_WHATIF_ITERATIONS,
      includeTimeline: false,
      includeTailProbes: true,
      lockedOutcomes,
    })

    // Keep baseline season timeline available in the team breakdown chart
    return {
      ...whatIfSnap,
      timeline: baselineSnapshot.timeline,
    }
  }, [baselineSnapshot, lockedCount, lockedOutcomes, mode])

  const baselineTeamsBySlug = useMemo(() => {
    if (!baselineSnapshot || lockedCount === 0) return undefined
    return new Map(baselineSnapshot.teams.map((t) => [t.slug, t]))
  }, [baselineSnapshot, lockedCount])

  const allUpcomingGames = useMemo(
    () => (baselineSnapshot ? baselineSnapshot.regularGames.filter((g) => g.status !== "final") : []),
    [baselineSnapshot]
  )

  if (season === "all") {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">
          Playoff odds are not available for All Time view. Select a specific season.
        </p>
      </div>
    )
  }

  if (isLoading && !activeSnapshot) {
    return <LoadingState variant="table" label="Running Monte Carlo playoff simulations…" />
  }

  if (isError && !activeSnapshot) {
    return (
      <ErrorNotice
        message={errorMessage ?? "Unable to load playoff odds right now."}
        onRetry={() => {
          void refresh()
        }}
      />
    )
  }

  if (!activeSnapshot || activeSnapshot.teams.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">No regular-season schedule data available for this season.</p>
      </div>
    )
  }

  const selectedTeam =
    selectedTeamSlug ? activeSnapshot.teams.find((t) => t.slug === selectedTeamSlug) ?? null : null

  const formatSummary = activeSnapshot.format.allTeamsQualify
    ? `All ${activeSnapshot.format.teamCount} teams qualify (seeding race)`
    : activeSnapshot.format.hasPlayIn
      ? `Top ${activeSnapshot.format.playoffSpots} of ${activeSnapshot.format.teamCount} qualify (1–${activeSnapshot.format.directByeSpots} bye, 4v5 play-in)`
      : `Top ${activeSnapshot.format.playoffSpots} of ${activeSnapshot.format.teamCount} qualify`

  return (
    <div className="flex flex-col gap-6">
      {/* Season Context + Mode Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/70 px-3.5 py-2.5">
        <div className="space-y-0.5 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="font-semibold text-foreground">{activeSnapshot.seasonName}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground tabular-nums">
              {activeSnapshot.gamesPlayed} of {activeSnapshot.totalRegularGames} games final
            </span>
            <span className="hidden sm:inline text-muted-foreground">·</span>
            <span className="text-muted-foreground">{formatSummary}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground/80 tabular-nums">
            <span>{activeSnapshot.iterations.toLocaleString()} Monte Carlo simulations</span>
            <span>·</span>
            <span>{isValidating ? "Updating…" : `Computed in ${activeSnapshot.computeMs} ms`}</span>
            {activeSnapshot.endedEarly && (
              <>
                <span>·</span>
                <span className="font-medium text-foreground">Season ended early</span>
              </>
            )}
          </div>
        </div>

        {/* Accessible Mode Switcher Tablist */}
        <div
          role="tablist"
          aria-label="Simulation weighting model"
          className="inline-flex items-center rounded-md border border-border/60 bg-muted/50 p-0.5 text-[11px]"
        >
          {MODE_OPTIONS.map((opt, idx) => {
            const active = mode === opt.value
            return (
              <button
                key={opt.value}
                ref={(el) => {
                  modeTabRefs.current[idx] = el
                }}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                title={opt.hint}
                onClick={() => handleModeChange(opt.value)}
                onKeyDown={(e) => handleModeKeyDown(e, idx)}
                className={cn(
                  "relative rounded px-2.5 py-1 font-medium transition-colors cursor-pointer min-h-[32px] sm:min-h-0",
                  "aria-selected:bg-card aria-selected:text-foreground aria-selected:after:content-[''] aria-selected:after:absolute aria-selected:after:inset-x-1.5 aria-selected:after:bottom-0 aria-selected:after:border-b-2 aria-selected:after:border-foreground",
                  !active && "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Active What-If Scenario Banner */}
      {lockedCount > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/[0.06] px-3.5 py-2.5 text-xs"
        >
          <div className="flex items-center gap-2 text-foreground">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="font-semibold">What-If scenario active</span> ({lockedCount}{" "}
              {lockedCount === 1 ? "game" : "games"} locked) — live projected odds from{" "}
              <span className="tabular-nums">{activeSnapshot.iterations.toLocaleString()}</span> client simulations.
            </span>
          </div>
          <button
            type="button"
            onClick={handleClearLocked}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            Reset picks
          </button>
        </div>
      )}

      {/* Deliverable #1: Playoff Odds & Seed Distribution Table */}
      <PlayoffOddsTable
        snapshot={activeSnapshot}
        baselineTeamsBySlug={baselineTeamsBySlug}
        selectedTeamSlug={selectedTeamSlug}
        onSelectTeam={handleSelectTeam}
      />

      {/* Expandable Team Drill-Down Panel */}
      {selectedTeam && (
        <TeamOddsPanel
          team={selectedTeam}
          snapshot={activeSnapshot}
          isWhatIfActive={lockedCount > 0}
          onClose={() => handleSelectTeam(null)}
        />
      )}

      {/* Deliverable #2: Big Games ("Who should we root for?") */}
      <BigGamesSection
        snapshot={activeSnapshot}
        lockedOutcomes={lockedOutcomes}
        onToggleOutcome={handleToggleOutcome}
        onClearLocked={handleClearLocked}
        allUpcomingGames={allUpcomingGames}
      />

      {/* Collapsible Methodology Disclosure */}
      <PlayoffOddsMethodology snapshot={activeSnapshot} />
    </div>
  )
}
