"use client"

import { useMemo, useState, useRef, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowLeft } from "lucide-react"
import { IntentLink } from "@/components/intent-link"
import { LoadingState } from "@/components/loading-state"
import { ErrorNotice } from "@/components/error-notice"
import { TeamLogo } from "@/components/team-logo"
import { PlayoffBracket, hasBracketMetadata } from "@/components/playoff-bracket"
import { useBashData, type BashApiData, type BashGame } from "@/lib/hockey-data"
import { compareGamesChronological, formatGameDate, formatGameTime } from "@/lib/format-time"
import { isLegacyTeamSlug } from "@/lib/team-filters"
import { cn } from "@/lib/utils"

type GameTypeFilter = "all" | "tryout" | "regular" | "playoff" | "exhibition"

function getGameCategory(g: BashGame): Exclude<GameTypeFilter, "all"> {
  if (g.gameType === "tryout") return "tryout"
  if (g.isPlayoff || g.gameType === "playoff" || g.gameType === "championship") return "playoff"
  if (g.gameType === "exhibition") return "exhibition"
  return "regular"
}

const CATEGORY_LABELS: Record<Exclude<GameTypeFilter, "all">, string> = {
  tryout: "Tryout",
  regular: "Regular Season",
  playoff: "Playoff",
  exhibition: "Exhibition",
}

function parseGameTypeParam(raw: string | null): GameTypeFilter {
  if (!raw) return "all"
  const val = raw.toLowerCase()
  if (val === "playoff" || val === "playoffs") return "playoff"
  if (val === "tryout" || val === "tryouts") return "tryout"
  if (val === "regular") return "regular"
  if (val === "exhibition") return "exhibition"
  return "all"
}

export function ScheduleContent({ initialData }: { initialData?: BashApiData }) {
  const searchParams = useSearchParams()
  const season = searchParams.get("season") || undefined
  const { games, isLoading, isError, errorMessage } = useBashData(season, initialData)

  const paramTeam = searchParams.get("team") || "all"
  const paramType = parseGameTypeParam(searchParams.get("gameType"))

  const [teamFilter, setTeamFilter] = useState<string>(paramTeam)
  const [typeFilter, setTypeFilter] = useState<GameTypeFilter>(paramType)
  const [highlightedNext, setHighlightedNext] = useState(false)

  const nextGameRef = useRef<HTMLDivElement>(null)
  const hasAutoJumped = useRef(false)
  const prevSeasonRef = useRef(season)

  const syncFilterUrl = (nextTeam: string, nextType: GameTypeFilter) => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    if (nextTeam !== "all") params.set("team", nextTeam)
    else params.delete("team")
    if (nextType !== "all") params.set("gameType", nextType)
    else params.delete("gameType")
    const qs = params.toString()
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
  }

  const handleTeamChange = (nextTeam: string) => {
    setTeamFilter(nextTeam)
    syncFilterUrl(nextTeam, typeFilter)
  }

  const handleTypeChange = (nextType: GameTypeFilter) => {
    setTypeFilter(nextType)
    syncFilterUrl(teamFilter, nextType)
  }

  // Sync Next.js client navigation updates to URL searchParams
  useEffect(() => {
    setTeamFilter(paramTeam)
    setTypeFilter(paramType)
  }, [paramTeam, paramType])

  // Sync browser back/forward navigation
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search)
      setTeamFilter(params.get("team") || "all")
      setTypeFilter(parseGameTypeParam(params.get("gameType")))
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  // Reset auto-jump only when season actually changes
  useEffect(() => {
    if (prevSeasonRef.current === season) return
    prevSeasonRef.current = season
    hasAutoJumped.current = false
  }, [season])

  const teams = useMemo(() => {
    const map = new Map<string, string>()
    for (const g of games) {
      if (g.awaySlug && g.awaySlug !== "tbd" && !isLegacyTeamSlug(g.awaySlug)) {
        map.set(g.awaySlug, g.awayTeam)
      }
      if (g.homeSlug && g.homeSlug !== "tbd" && !isLegacyTeamSlug(g.homeSlug)) {
        map.set(g.homeSlug, g.homeTeam)
      }
    }
    return [...map.entries()]
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [games])

  const availableTypes = useMemo(() => {
    const present = new Set<Exclude<GameTypeFilter, "all">>()
    for (const g of games) {
      present.add(getGameCategory(g))
    }
    return (["tryout", "regular", "playoff", "exhibition"] as const).filter((t) => present.has(t))
  }, [games])

  const sortedFilteredGames = useMemo(() => {
    return [...games]
      .filter((g) => {
        if (typeFilter !== "all" && getGameCategory(g) !== typeFilter) return false
        if (teamFilter !== "all" && g.awaySlug !== teamFilter && g.homeSlug !== teamFilter) return false
        return true
      })
      .sort((a, b) => {
        const dateCmp = a.date.localeCompare(b.date)
        if (dateCmp !== 0) return dateCmp
        return compareGamesChronological(a, b)
      })
  }, [games, teamFilter, typeFilter])

  const nextGameId = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const liveOrUpcoming = sortedFilteredGames.find((g) => g.status === "live" || g.status === "upcoming")
    if (liveOrUpcoming) return liveOrUpcoming.id
    const todayOrLater = sortedFilteredGames.find((g) => g.date >= today)
    return todayOrLater?.id ?? null
  }, [sortedFilteredGames])

  const dateGroups = useMemo(() => {
    const groups: { date: string; games: BashGame[] }[] = []
    for (const g of sortedFilteredGames) {
      const last = groups[groups.length - 1]
      if (last && last.date === g.date) {
        last.games.push(g)
      } else {
        groups.push({ date: g.date, games: [g] })
      }
    }
    return groups
  }, [sortedFilteredGames])

  // Auto-jump to today/next game once on initial load (skip in playoff view so bracket stays visible)
  useEffect(() => {
    if (hasAutoJumped.current || typeFilter === "playoff") return
    if (!nextGameId || !nextGameRef.current) return
    hasAutoJumped.current = true
    requestAnimationFrame(() => {
      nextGameRef.current?.scrollIntoView({ behavior: "instant", block: "center" })
    })
  }, [nextGameId, typeFilter])

  const handleJumpToNext = () => {
    if (!nextGameRef.current) return
    nextGameRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    setHighlightedNext(true)
    setTimeout(() => setHighlightedNext(false), 1200)
  }

  if (isError && games.length === 0) {
    return <ErrorNotice message={errorMessage ?? "Could not load schedule. Try again."} />
  }

  if (isLoading && games.length === 0) {
    return <LoadingState variant="table" label="Loading schedule…" />
  }

  const scoresHref = season ? `/?season=${season}` : "/"

  return (
    <div className="flex flex-col gap-4">
      {isError && (
        <ErrorNotice message={`Schedule could not refresh; showing the last loaded results. ${errorMessage ?? ""}`} />
      )}

      {/* Top bar: Back to Scores + Title + Next Game */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <IntentLink
            href={scoresHref}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Scores
          </IntentLink>
          <span className="text-border">|</span>
          <h1 className="text-sm font-bold tracking-tight text-foreground truncate">Season Schedule</h1>
        </div>

        {nextGameId && typeFilter !== "playoff" && (
          <button
            type="button"
            onClick={handleJumpToNext}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted px-2.5 py-1 rounded-full transition-colors cursor-pointer shrink-0"
          >
            <ArrowDown className="h-2.5 w-2.5" />
            Next game
          </button>
        )}
      </div>

      {/* Filters (matching StatsTab styling) */}
      {(teams.length > 0 || availableTypes.length > 1) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border border-border/10 rounded-lg p-3 bg-card/45">
          <div className="flex flex-wrap items-end gap-2 sm:gap-3 w-full sm:w-auto">
            {teams.length > 0 && (
              <>
                {/* Mobile Team Filter Dropdown */}
                <div className="flex flex-col gap-1.5 sm:hidden w-[135px]">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">
                    Team
                  </span>
                  <select
                    aria-label="Filter by team"
                    value={teamFilter}
                    onChange={(e) => handleTeamChange(e.target.value)}
                    className="rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold text-foreground appearance-none cursor-pointer pr-6 bg-[length:10px] bg-[right_6px_center] bg-no-repeat min-h-[36px] w-full"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                    }}
                  >
                    <option value="all">All Teams</option>
                    {teams.map((t) => (
                      <option key={t.slug} value={t.slug}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Desktop Team Filter */}
                <div className="hidden sm:flex sm:flex-col sm:gap-1.5">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">
                    Team
                  </span>
                  {teams.length > 8 ? (
                    <select
                      aria-label="Filter by team"
                      value={teamFilter}
                      onChange={(e) => handleTeamChange(e.target.value)}
                      className="rounded-md bg-card border border-border/40 px-2.5 py-1.5 text-[11px] font-semibold text-foreground appearance-none cursor-pointer pr-7 bg-[length:12px] bg-[right_8px_center] bg-no-repeat w-40"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                      }}
                    >
                      <option value="all">All Teams</option>
                      {teams.map((t) => (
                        <option key={t.slug} value={t.slug}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      <button
                        type="button"
                        onClick={() => handleTeamChange("all")}
                        className={cn(
                          "shrink-0 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors flex items-center gap-1 cursor-pointer",
                          teamFilter === "all"
                            ? "bg-card text-foreground font-semibold"
                            : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-card/40",
                        )}
                      >
                        All Teams
                      </button>
                      {teams.map((t) => (
                        <button
                          key={t.slug}
                          type="button"
                          onClick={() => handleTeamChange(t.slug)}
                          className={cn(
                            "shrink-0 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors flex items-center gap-1 cursor-pointer",
                            teamFilter === t.slug
                              ? "bg-card text-foreground font-semibold"
                              : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-card/40",
                          )}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {availableTypes.length > 1 && (
              <div className="flex flex-col gap-1.5 w-[135px]">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">
                  Game Type
                </span>
                <select
                  aria-label="Filter by game type"
                  value={typeFilter}
                  onChange={(e) => handleTypeChange(e.target.value as GameTypeFilter)}
                  className="rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold text-foreground appearance-none cursor-pointer pr-6 bg-[length:10px] bg-[right_6px_center] bg-no-repeat min-h-[36px] sm:min-h-0 w-full"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  }}
                >
                  <option value="all">All Game Types</option>
                  {availableTypes.map((t) => (
                    <option key={t} value={t}>
                      {CATEGORY_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Playoff Bracket (when All Teams + Playoff is selected and bracket metadata exists) */}
      {teamFilter === "all" && typeFilter === "playoff" && hasBracketMetadata(sortedFilteredGames) && (
        <PlayoffBracket games={sortedFilteredGames} />
      )}

      {/* Schedule List */}
      {dateGroups.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-xs text-muted-foreground">No games match the selected filters.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border/50 bg-card divide-y divide-border/40 overflow-hidden">
          {dateGroups.map(({ date, games: dayGames }) => {
            const hasNext = dayGames.some((g) => g.id === nextGameId)
            return (
              <div key={date} className="divide-y divide-border/30">
                <div className="px-3 py-1.5 bg-muted/40 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {formatGameDate(date)}
                  </span>
                  {hasNext && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground">
                      Next up
                    </span>
                  )}
                </div>
                {dayGames.map((g) => {
                  const isNext = g.id === nextGameId
                  return (
                    <ScheduleGameRow
                      key={g.id}
                      game={g}
                      rowRef={isNext ? nextGameRef : undefined}
                      highlighted={isNext && highlightedNext}
                      hideCategoryBadge={typeFilter !== "all"}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ScheduleGameRow({
  game: g,
  rowRef,
  highlighted,
  hideCategoryBadge,
}: {
  game: BashGame
  rowRef?: React.RefObject<HTMLDivElement | null>
  highlighted?: boolean
  hideCategoryBadge?: boolean
}) {
  const isFinal = g.status === "final"
  const isLive = g.status === "live"
  const awayWon = isFinal && g.awayScore != null && g.homeScore != null && g.awayScore > g.homeScore
  const homeWon = isFinal && g.homeScore != null && g.awayScore != null && g.homeScore > g.awayScore
  const category = getGameCategory(g)

  const awayName = (!g.awaySlug || g.awaySlug === "tbd") && g.awayPlaceholder ? g.awayPlaceholder : g.awayTeam
  const homeName = (!g.homeSlug || g.homeSlug === "tbd") && g.homePlaceholder ? g.homePlaceholder : g.homeTeam

  const statusLabel = isLive
    ? "Live"
    : isFinal
      ? `Final${g.isForfeit ? "/Forfeit" : g.hasShootout ? "/SO" : g.isOvertime ? "/OT" : ""}`
      : formatGameTime(g.time)

  return (
    <div
      ref={rowRef}
      className={cn(
        "relative flex items-center gap-1.5 sm:gap-4 px-2.5 sm:px-3 py-2.5 hover:bg-muted/40 transition-colors scroll-mt-24",
        highlighted && "bg-muted/70 ring-1 ring-inset ring-foreground/30",
      )}
    >
      <IntentLink
        href={`/game/${g.id}`}
        className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-primary"
        aria-label={`View ${awayName} at ${homeName} on ${formatGameDate(g.date)}`}
      >
        <span className="sr-only">View game</span>
      </IntentLink>

      {/* Time / Status */}
      <div className="w-[48px] sm:w-[84px] shrink-0 text-[10px] sm:text-[11px] tabular-nums">
        {isLive ? (
          <span className="inline-flex items-center gap-1 text-red-500 font-bold uppercase text-[10px]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
            </span>
            Live
          </span>
        ) : (
          <span className={cn("truncate block", isFinal ? "text-muted-foreground font-medium" : "text-muted-foreground/80")}>
            {statusLabel}
          </span>
        )}
      </div>

      {/* Matchup + optional title/badge */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 text-[11px] sm:text-xs">
          <TeamCell name={awayName} slug={g.awaySlug} won={awayWon} muted={isFinal && !awayWon} />
          <span className="text-[10px] text-muted-foreground/50 shrink-0">@</span>
          <TeamCell name={homeName} slug={g.homeSlug} won={homeWon} muted={isFinal && !homeWon} />
        </div>
        {(g.title || (!hideCategoryBadge && category !== "regular")) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {!hideCategoryBadge && category !== "regular" && (
              <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {CATEGORY_LABELS[category]}
              </span>
            )}
            {g.title && (
              <span className="text-[11px] text-muted-foreground truncate">
                {g.title}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Score */}
      <div className="w-10 sm:w-16 shrink-0 text-right font-mono tabular-nums text-[11px] sm:text-xs">
        {isFinal || isLive ? (
          <span className="inline-flex items-center justify-end gap-0.5 sm:gap-1">
            <span className={cn(awayWon ? "font-bold text-foreground" : isFinal ? "text-muted-foreground/50" : "text-muted-foreground")}>
              {g.awayScore ?? 0}
            </span>
            <span className="text-muted-foreground/40">–</span>
            <span className={cn(homeWon ? "font-bold text-foreground" : isFinal ? "text-muted-foreground/50" : "text-muted-foreground")}>
              {g.homeScore ?? 0}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground/40">–</span>
        )}
      </div>
    </div>
  )
}

function TeamCell({
  name,
  slug,
  won,
  muted,
}: {
  name: string
  slug: string
  won: boolean
  muted: boolean
}) {
  const isTbd = !slug || slug === "tbd"
  const textClass = cn(
    "truncate",
    won ? "font-bold text-foreground" : muted ? "text-muted-foreground/60" : "font-medium text-foreground",
  )

  return (
    <span className="inline-flex items-center gap-1 sm:gap-1.5 min-w-0">
      <TeamLogo slug={slug || "tbd"} name={name} size={18} className={cn("shrink-0", muted && "opacity-50")} />
      {isTbd ? (
        <span className={textClass}>{name}</span>
      ) : (
        <IntentLink
          href={`/team/${slug}`}
          className={cn(textClass, "relative z-10 hover:text-primary transition-colors")}
        >
          {name}
        </IntentLink>
      )}
    </span>
  )
}
