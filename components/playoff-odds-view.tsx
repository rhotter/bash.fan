"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RotateCcw, Sparkles } from "lucide-react"
import { LoadingState } from "@/components/loading-state"
import { ErrorNotice } from "@/components/error-notice"
import { PlayoffOddsTable } from "@/components/playoff-odds-table"
import { TeamOddsPanel } from "@/components/team-odds-panel"
import { BigGamesSection } from "@/components/big-games-section"
import { PlayoffOddsMethodology } from "@/components/playoff-odds-methodology"
import { PlayoffOddsLeagueCharts } from "@/components/playoff-odds-league-charts"
import { PlayoffOddsFilterBar, STATS_MODEL_OPTIONS } from "@/components/playoff-odds-filter-bar"
import { usePlayoffOdds } from "@/lib/hockey-data"
import { CLIENT_WHATIF_ITERATIONS, computePlayoffOdds } from "@/lib/playoff-odds"
import type {
  BigGameOutcomeKey,
  PlayoffOddsMode,
  PlayoffOddsSnapshot,
} from "@/lib/playoff-odds-types"

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
  const [highlightedSlug, setHighlightedSlug] = useState<string | null>(null)
  const [modeSwitchOrigin, setModeSwitchOrigin] = useState<{
    seasonKey: string
    snapshotSeasonId: string
  } | null>(null)

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

  const {
    snapshot: baselineSnapshot,
    isLoading,
    isStaleData,
    isError,
    errorMessage,
    refresh,
  } = usePlayoffOdds(season, mode, initialData)

  const handleModeChange = useCallback(
    (nextMode: PlayoffOddsMode) => {
      if (baselineSnapshot && !isStaleData) {
        setModeSwitchOrigin({
          seasonKey: season ?? "__current__",
          snapshotSeasonId: baselineSnapshot.seasonId,
        })
      }
      setMode(nextMode)
      onUrlStateChange?.({ mode: nextMode, team: selectedTeamSlug ?? undefined })
    },
    [baselineSnapshot, isStaleData, season, onUrlStateChange, selectedTeamSlug]
  )

  const handleSelectTeam = useCallback(
    (slug: string | null) => {
      setSelectedTeamSlug(slug)
      setHighlightedSlug(null)
      onUrlStateChange?.({ mode, team: slug ?? undefined })
    },
    [mode, onUrlStateChange]
  )

  // Selecting a team from a table row lower on the page should bring the team view into view
  const teamSelectorRef = useRef<HTMLDivElement | null>(null)
  const handleSelectTeamFromTable = useCallback(
    (slug: string | null) => {
      handleSelectTeam(slug)
      if (slug) {
        requestAnimationFrame(() => {
          teamSelectorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" })
        })
      }
    },
    [handleSelectTeam]
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

  const allUpcomingGames = useMemo(
    () => (baselineSnapshot ? baselineSnapshot.regularGames.filter((g) => g.status !== "final") : []),
    [baselineSnapshot]
  )

  // Drop any locked outcome whose game finalized during an SWR refresh
  const effectiveLockedOutcomes = useMemo(() => {
    const upcomingIds = new Set(allUpcomingGames.map((g) => g.id))
    const filtered: Record<string, BigGameOutcomeKey> = {}
    for (const [gid, outcome] of Object.entries(lockedOutcomes)) {
      if (upcomingIds.has(gid)) filtered[gid] = outcome
    }
    return filtered
  }, [lockedOutcomes, allUpcomingGames])

  const lockedCount = Object.keys(effectiveLockedOutcomes).length

  const baselineMatchesRequest = Boolean(
    baselineSnapshot &&
      !isStaleData &&
      baselineSnapshot.mode === mode &&
      (!season || baselineSnapshot.seasonId === season)
  )

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
      resolvedFormat: baselineSnapshot.format,
      games: baselineSnapshot.regularGames,
      mode: baselineMatchesRequest ? mode : baselineSnapshot.mode,
      iterations: CLIENT_WHATIF_ITERATIONS,
      includeTimeline: false,
      includeTailProbes: true,
      lockedOutcomes: effectiveLockedOutcomes,
    })

    // Keep baseline season timeline available in the team breakdown chart
    return {
      ...whatIfSnap,
      timeline: baselineSnapshot.timeline,
      teamColors: baselineSnapshot.teamColors,
    }
  }, [baselineSnapshot, baselineMatchesRequest, lockedCount, effectiveLockedOutcomes, mode])

  const baselineTeamsBySlug = useMemo(() => {
    if (!baselineSnapshot || !baselineMatchesRequest || lockedCount === 0) return undefined
    return new Map(baselineSnapshot.teams.map((t) => [t.slug, t]))
  }, [baselineSnapshot, baselineMatchesRequest, lockedCount])

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

  const currentSeasonKey = season ?? "__current__"
  const modeOrSeasonFetchFailed = isError && !baselineMatchesRequest
  const isSameSeasonModeFailure =
    modeOrSeasonFetchFailed &&
    Boolean(
      activeSnapshot &&
        activeSnapshot.teams.length > 0 &&
        activeSnapshot.mode !== mode &&
        modeSwitchOrigin !== null &&
        modeSwitchOrigin.seasonKey === currentSeasonKey &&
        modeSwitchOrigin.snapshotSeasonId === activeSnapshot.seasonId
    )

  if (
    isError &&
    (!activeSnapshot ||
      activeSnapshot.teams.length === 0 ||
      (modeOrSeasonFetchFailed && !isSameSeasonModeFailure))
  ) {
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
  const activeModel = STATS_MODEL_OPTIONS.find((o) => o.value === mode) ?? STATS_MODEL_OPTIONS[0]
  const teamOptions = [...activeSnapshot.teams]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ slug: t.slug, name: t.name }))

  return (
    <div className="flex flex-col gap-6">
      {/* Teams / Stats Model filter bar + season header.
          Always mounted so users can switch back from a failed model fetch. */}
      <div className="space-y-5">
        <div ref={teamSelectorRef} className="scroll-mt-20">
          <PlayoffOddsFilterBar
            teams={teamOptions}
            teamValue={selectedTeam ? selectedTeam.slug : null}
            onTeamChange={handleSelectTeam}
            mode={mode}
            onModeChange={handleModeChange}
          />
        </div>

        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">{activeSnapshot.seasonName} playoff odds</h2>
          <p className="text-xs text-muted-foreground">
            We ran {activeSnapshot.iterations.toLocaleString()} Monte Carlo simulations with {STATS_MODEL_OPTIONS.length}{" "}
            different models.
            {activeSnapshot.endedEarly && <span className="font-medium text-foreground"> Season ended early.</span>}
          </p>
          <p id="playoff-odds-stats-model-hint" className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{activeModel.label}:</span> {activeModel.hint}
          </p>
        </div>
      </div>

      {modeOrSeasonFetchFailed ? (
        <ErrorNotice
          message={errorMessage ?? "Unable to load playoff odds for this view right now."}
          onRetry={() => {
            void refresh()
          }}
        />
      ) : (
        <>
          {/* Non-blocking error notice if background refresh fails while showing matching cached data */}
          {isError && (
            <ErrorNotice
              message={errorMessage ?? "Unable to refresh playoff odds right now."}
              onRetry={() => {
                void refresh()
              }}
            />
          )}

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

          {selectedTeam ? (
            <>
              {/* Team view */}
              <TeamOddsPanel
                team={selectedTeam}
                snapshot={activeSnapshot}
                isWhatIfActive={lockedCount > 0}
                onClose={() => handleSelectTeam(null)}
              />

              <BigGamesSection
                snapshot={activeSnapshot}
                lockedOutcomes={effectiveLockedOutcomes}
                onToggleOutcome={handleToggleOutcome}
                onClearLocked={handleClearLocked}
                allUpcomingGames={allUpcomingGames}
                lockedTeamSlug={selectedTeam.slug}
              />
            </>
          ) : (
            <>
              {/* All teams: SCS-style Points + Chance Will Make Playoffs charts */}
              <PlayoffOddsLeagueCharts
                snapshot={activeSnapshot}
                highlightedSlug={highlightedSlug}
                onHighlight={setHighlightedSlug}
                isWhatIfActive={lockedCount > 0}
              />

              {/* Playoff Odds & Seed Distribution Table */}
              <PlayoffOddsTable
                snapshot={activeSnapshot}
                baselineTeamsBySlug={baselineTeamsBySlug}
                selectedTeamSlug={selectedTeamSlug}
                onSelectTeam={handleSelectTeamFromTable}
                highlightedSlug={highlightedSlug}
                onHighlightTeam={setHighlightedSlug}
              />

              {/* This week's games ("Who should we root for?") */}
              <BigGamesSection
                snapshot={activeSnapshot}
                lockedOutcomes={effectiveLockedOutcomes}
                onToggleOutcome={handleToggleOutcome}
                onClearLocked={handleClearLocked}
                allUpcomingGames={allUpcomingGames}
              />
            </>
          )}

          {/* Collapsible Methodology Disclosure */}
          <PlayoffOddsMethodology snapshot={activeSnapshot} />
        </>
      )}
    </div>
  )
}
