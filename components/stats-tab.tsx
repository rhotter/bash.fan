"use client"

import { ErrorNotice } from "@/components/error-notice"
import { LoadingState } from "@/components/loading-state"
import { useState, useMemo, useCallback, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { usePlayerStats, type PlayerStatsData } from "@/lib/hockey-data"
import { cn } from "@/lib/utils"
import { SearchIcon, Crown } from "lucide-react"
import { IntentLink as Link } from "@/components/intent-link"
import { playerSlug } from "@/lib/player-slug"
import { sortedStatCellClass, useSort, SortableTh } from "@/components/stats-table"
import { formatSeasonName, formatCompactSeasonName, compareTeamSeasonDesc } from "@/lib/season-name"
import { compareSkaterStats, compareGoalieStats } from "@/lib/stats-sort"
import { TeamLogo } from "@/components/team-logo"

type SortKey = "points" | "goals" | "assists" | "pim" | "gp" | "gwg" | "ppg" | "shg" | "eng" | "hatTricks" | "pen" | "ptsPg"
type GoalieSortKey = "savePercentage" | "gaa" | "wins" | "losses" | "saves" | "goalsAgainst" | "shotsAgainst" | "gp" | "shutouts" | "goalieAssists"
type TeamSkaterSortKey = "points" | "goals" | "assists" | "pim" | "gp" | "pgp" | "gwg" | "ppg" | "shg" | "eng" | "hatTricks" | "pen" | "ptsPg" | "seasonName"
type TeamGoalieSortKey = "savePercentage" | "gaa" | "saves" | "goalsAgainst" | "shotsAgainst" | "saPg" | "gp" | "pgp" | "shutouts" | "goalieAssists" | "seasonName"

const goalieAscKeys = new Set<GoalieSortKey>(["gaa"])
const teamGoalieAscKeys = new Set<TeamGoalieSortKey>(["gaa"])

const PER_PAGE = 25

const getDefaultMinTeamGames = (gType: string, sType: string) =>
  gType === "playoffs" ? 2 : sType === "summer" ? 8 : 12

export function StatsTab({ initialData }: { initialData?: PlayerStatsData }) {
  const searchParams = useSearchParams()
  const season = searchParams.get("season") || undefined
  const seasonType = searchParams.get("seasonType") || "fall"
  const gameType = searchParams.get("gameType") || "regular"
  const router = useRouter()
  const [playoff, setPlayoff] = useState(false)
  const {
    skaters,
    goalies,
    skatersByTeam,
    goaliesByTeam,
    teamSkaters = [],
    teamGoalies = [],
    teams,
    hasPlayoffs,
    isLoading,
    isError,
    errorMessage,
  } = usePlayerStats(season, !playoff ? initialData : undefined, playoff, seasonType, gameType)
  const rawView = searchParams.get("view")
  const [activeTab, setActiveTab] = useState<"skaters" | "goalies" | "teams">(() =>
    rawView === "goalies" ? "goalies" : rawView === "teams" ? "teams" : "skaters"
  )

  useEffect(() => {
    const nextTab = rawView === "goalies" ? "goalies" : rawView === "teams" ? "teams" : "skaters"
    setActiveTab(nextTab)
  }, [rawView])

  useEffect(() => {
    setPlayoff(false)
  }, [season])

  useEffect(() => {
    setMinTeamGames(getDefaultMinTeamGames(gameType, seasonType))
    if (seasonType === "summer") {
      setFranchiseFilter("all")
    }
  }, [gameType, seasonType])

  useEffect(() => {
    const handlePopState = () => {
      const search = window.location.search
      const params = new URLSearchParams(search)
      const v = params.get("view")
      setActiveTab(v === "goalies" ? "goalies" : v === "teams" ? "teams" : "skaters")
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  const tab = activeTab

  const setTab = useCallback((t: "skaters" | "goalies" | "teams") => {
    setActiveTab(t)
    const currentSearch = typeof window !== "undefined" ? window.location.search : searchParams.toString()
    const params = new URLSearchParams(currentSearch)
    if (t === "skaters") {
      params.delete("view")
    } else {
      params.set("view", t)
    }
    const qs = params.toString()
    window.history.replaceState(null, "", qs ? `/stats?${qs}` : "/stats")
  }, [searchParams])

  const setSeasonType = useCallback((type: string) => {
    const currentSearch = typeof window !== "undefined" ? window.location.search : searchParams.toString()
    const params = new URLSearchParams(currentSearch)
    params.set("seasonType", type)
    if (activeTab === "teams") {
      params.set("view", "teams")
    } else if (activeTab === "goalies") {
      params.set("view", "goalies")
    } else {
      params.delete("view")
    }
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : "/stats", { scroll: false })
  }, [searchParams, router, activeTab])

  const setGameType = useCallback((type: string) => {
    const currentSearch = typeof window !== "undefined" ? window.location.search : searchParams.toString()
    const params = new URLSearchParams(currentSearch)
    params.set("gameType", type)
    if (activeTab === "teams") {
      params.set("view", "teams")
    } else if (activeTab === "goalies") {
      params.set("view", "goalies")
    } else {
      params.delete("view")
    }
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : "/stats", { scroll: false })
  }, [searchParams, router, activeTab])

  const [minGames, setMinGames] = useState<number | "">(15)
  const [minTeamGames, setMinTeamGames] = useState<number | "">(() => getDefaultMinTeamGames(gameType, seasonType))
  const [resultFilter, setResultFilter] = useState<"all" | "champions" | "finalists">("all")
  const [franchiseFilter, setFranchiseFilter] = useState<string>("all")
  const [nameFilter, setNameFilter] = useState("")
  const [teamFilter, setTeamFilter] = useState<string>("all")

  const availableFranchises = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of teamSkaters) {
      if (t.franchiseSlug && t.franchiseName) map.set(t.franchiseSlug, t.franchiseName)
    }
    for (const t of teamGoalies) {
      if (t.franchiseSlug && t.franchiseName) map.set(t.franchiseSlug, t.franchiseName)
    }
    return Array.from(map.entries())
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [teamSkaters, teamGoalies])
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("points")
  const { sortKey: goalieSortKey, sortDir: goalieSortDir, toggleSort: toggleGoalieSort } = useSort<GoalieSortKey>("savePercentage", "desc", goalieAscKeys)
  const { sortKey: teamSkaterSortKey, sortDir: teamSkaterSortDir, toggleSort: toggleTeamSkaterSort } = useSort<TeamSkaterSortKey>("points")
  const { sortKey: teamGoalieSortKey, sortDir: teamGoalieSortDir, toggleSort: toggleTeamGoalieSort } = useSort<TeamGoalieSortKey>("savePercentage", "desc", teamGoalieAscKeys)
  const [skaterPage, setSkaterPage] = useState(1)
  const [goaliePage, setGoaliePage] = useState(1)
  const [teamSkaterPage, setTeamSkaterPage] = useState(1)
  const [teamGoaliePage, setTeamGoaliePage] = useState(1)

  const nameLower = nameFilter.toLowerCase()
  const nameTrimmedLower = nameFilter.trim().toLowerCase()

  const rankedSkaters = useMemo(() => {
    let list = (season === "all" || teamFilter === "all")
      ? skaters
      : (skatersByTeam ?? skaters).filter((p) => p.teamSlug === teamFilter)
    if (season === "all" && tab === "skaters") {
      const minGp = typeof minGames === "number" ? minGames : 0
      list = list.filter((p) => p.gp >= minGp)
    }
    return [...list].sort((a, b) => compareSkaterStats(a, b, sortKey, sortDir)).map((player, index) => ({ ...player, rank: index + 1 }))
  }, [skaters, skatersByTeam, teamFilter, sortKey, sortDir, season, tab, minGames])
 
  const rankedGoalies = useMemo(() => {
    let list = (season === "all" || teamFilter === "all")
      ? goalies
      : (goaliesByTeam ?? goalies).filter((p) => p.teamSlug === teamFilter)
    if (season === "all" && tab === "goalies") {
      const minGp = typeof minGames === "number" ? minGames : 0
      list = list.filter((p) => p.gp >= minGp)
    }
    return [...list].sort((a, b) => compareGoalieStats(a, b, goalieSortKey, goalieSortDir)).map((player, index) => ({ ...player, rank: index + 1 }))
  }, [goalies, goaliesByTeam, teamFilter, goalieSortKey, goalieSortDir, season, tab, minGames])

  const rankedTeamSkaters = useMemo(() => {
    let list = teamSkaters
    if (season === "all" && tab === "teams") {
      const minTgp = typeof minTeamGames === "number" ? minTeamGames : 0
      list = list.filter((t) => t.gp >= minTgp)
      if (resultFilter === "champions") {
        list = list.filter((t) => t.isChampion === true)
      } else if (resultFilter === "finalists") {
        list = list.filter((t) => t.isChampion === true || t.isFinalist === true)
      }
      if (seasonType !== "summer" && franchiseFilter !== "all") {
        list = list.filter((t) => t.franchiseSlug === franchiseFilter)
      }
    }
    return [...list].sort((a, b) => {
      const seasonCmp = compareTeamSeasonDesc(a, b)
      const stableTiebreaker = a.team.localeCompare(b.team) || seasonCmp
      if (teamSkaterSortKey === "seasonName") {
        return teamSkaterSortDir === "desc"
          ? (seasonCmp || b.points - a.points || b.goals - a.goals || stableTiebreaker)
          : (-seasonCmp || b.points - a.points || b.goals - a.goals || stableTiebreaker)
      }
      if (teamSkaterSortKey === "ptsPg") {
        const av = parseFloat(a.ptsPg) || 0
        const bv = parseFloat(b.ptsPg) || 0
        return teamSkaterSortDir === "desc"
          ? (bv - av || b.points - a.points || b.goals - a.goals || stableTiebreaker)
          : (av - bv || b.points - a.points || b.goals - a.goals || stableTiebreaker)
      }
      const av = (a[teamSkaterSortKey] ?? 0) as number
      const bv = (b[teamSkaterSortKey] ?? 0) as number
      const ptsTiebreaker = teamSkaterSortKey === "points" ? 0 : b.points - a.points
      const goalsTiebreaker = teamSkaterSortKey === "goals" ? 0 : b.goals - a.goals
      return teamSkaterSortDir === "desc"
        ? (bv - av || ptsTiebreaker || goalsTiebreaker || stableTiebreaker)
        : (av - bv || ptsTiebreaker || goalsTiebreaker || stableTiebreaker)
    }).map((t, index) => ({ ...t, rank: index + 1 }))
  }, [teamSkaters, teamSkaterSortKey, teamSkaterSortDir, season, seasonType, tab, minTeamGames, resultFilter, franchiseFilter])

  const rankedTeamGoalies = useMemo(() => {
    let list = teamGoalies
    if (season === "all" && tab === "teams") {
      const minTgp = typeof minTeamGames === "number" ? minTeamGames : 0
      list = list.filter((t) => t.gp >= minTgp)
      if (resultFilter === "champions") {
        list = list.filter((t) => t.isChampion === true)
      } else if (resultFilter === "finalists") {
        list = list.filter((t) => t.isChampion === true || t.isFinalist === true)
      }
      if (seasonType !== "summer" && franchiseFilter !== "all") {
        list = list.filter((t) => t.franchiseSlug === franchiseFilter)
      }
    }
    return [...list].sort((a, b) => {
      const seasonCmp = compareTeamSeasonDesc(a, b)
      const stableTiebreaker = a.team.localeCompare(b.team) || seasonCmp
      if (teamGoalieSortKey === "seasonName") {
        return teamGoalieSortDir === "desc"
          ? (seasonCmp || b.savePercentage - a.savePercentage || a.gaa - b.gaa || stableTiebreaker)
          : (-seasonCmp || b.savePercentage - a.savePercentage || a.gaa - b.gaa || stableTiebreaker)
      }
      if (teamGoalieSortKey === "saPg") {
        const av = a.gp > 0 ? a.shotsAgainst / a.gp : 0
        const bv = b.gp > 0 ? b.shotsAgainst / b.gp : 0
        return teamGoalieSortDir === "desc"
          ? (bv - av || b.savePercentage - a.savePercentage || a.gaa - b.gaa || stableTiebreaker)
          : (av - bv || b.savePercentage - a.savePercentage || a.gaa - b.gaa || stableTiebreaker)
      }
      const av = (a[teamGoalieSortKey] ?? 0) as number
      const bv = (b[teamGoalieSortKey] ?? 0) as number
      const svTiebreaker = teamGoalieSortKey === "savePercentage" ? 0 : b.savePercentage - a.savePercentage
      const gaaTiebreaker = teamGoalieSortKey === "gaa" ? 0 : a.gaa - b.gaa
      return teamGoalieSortDir === "desc"
        ? (bv - av || svTiebreaker || gaaTiebreaker || stableTiebreaker)
        : (av - bv || svTiebreaker || gaaTiebreaker || stableTiebreaker)
    }).map((t, index) => ({ ...t, rank: index + 1 }))
  }, [teamGoalies, teamGoalieSortKey, teamGoalieSortDir, season, seasonType, tab, minTeamGames, resultFilter, franchiseFilter])

  // Search hides rows without changing their position in the full ranking.
  const filteredSkaters = useMemo(() => rankedSkaters.filter((player) => player.name.toLowerCase().includes(nameLower)), [rankedSkaters, nameLower])
  const filteredGoalies = useMemo(() => rankedGoalies.filter((player) => player.name.toLowerCase().includes(nameLower)), [rankedGoalies, nameLower])
  const normalizedNameLower = useMemo(() => nameTrimmedLower.replace(/[–—]/g, "-"), [nameTrimmedLower])
  const filteredTeamSkaters = useMemo(() => {
    if (season !== "all" || !nameTrimmedLower) return rankedTeamSkaters
    return rankedTeamSkaters.filter((t) => {
      const compact = formatCompactSeasonName(t.seasonName ?? t.seasonId).toLowerCase()
      return (
        t.team.toLowerCase().includes(nameTrimmedLower) ||
        t.teamSlug.toLowerCase().includes(normalizedNameLower) ||
        compact.includes(normalizedNameLower) ||
        (t.seasonName && t.seasonName.toLowerCase().replace(/[–—]/g, "-").includes(normalizedNameLower)) ||
        (t.seasonId && t.seasonId.toLowerCase().includes(nameTrimmedLower))
      )
    })
  }, [rankedTeamSkaters, nameTrimmedLower, normalizedNameLower, season])
  const filteredTeamGoalies = useMemo(() => {
    if (season !== "all" || !nameTrimmedLower) return rankedTeamGoalies
    return rankedTeamGoalies.filter((t) => {
      const compact = formatCompactSeasonName(t.seasonName ?? t.seasonId).toLowerCase()
      return (
        t.team.toLowerCase().includes(nameTrimmedLower) ||
        t.teamSlug.toLowerCase().includes(normalizedNameLower) ||
        compact.includes(normalizedNameLower) ||
        (t.seasonName && t.seasonName.toLowerCase().replace(/[–—]/g, "-").includes(normalizedNameLower)) ||
        (t.seasonId && t.seasonId.toLowerCase().includes(nameTrimmedLower))
      )
    })
  }, [rankedTeamGoalies, nameTrimmedLower, normalizedNameLower, season])

  const skaterTotalPages = Math.max(1, Math.ceil(filteredSkaters.length / PER_PAGE))
  const goalieTotalPages = Math.max(1, Math.ceil(filteredGoalies.length / PER_PAGE))
  const paginatedSkaters = filteredSkaters.slice((skaterPage - 1) * PER_PAGE, skaterPage * PER_PAGE)
  const paginatedGoalies = filteredGoalies.slice((goaliePage - 1) * PER_PAGE, goaliePage * PER_PAGE)

  const teamSkaterTotalPages = Math.max(1, Math.ceil(filteredTeamSkaters.length / PER_PAGE))
  const teamGoalieTotalPages = Math.max(1, Math.ceil(filteredTeamGoalies.length / PER_PAGE))
  const safeTeamSkaterPage = Math.min(teamSkaterPage, teamSkaterTotalPages)
  const safeTeamGoaliePage = Math.min(teamGoaliePage, teamGoalieTotalPages)
  const paginatedTeamSkaters = season === "all"
    ? filteredTeamSkaters.slice((safeTeamSkaterPage - 1) * PER_PAGE, safeTeamSkaterPage * PER_PAGE)
    : filteredTeamSkaters
  const paginatedTeamGoalies = season === "all"
    ? filteredTeamGoalies.slice((safeTeamGoaliePage - 1) * PER_PAGE, safeTeamGoaliePage * PER_PAGE)
    : filteredTeamGoalies

  const hasAnyTeamStats = teamSkaters.some((t) => t.gp > 0 || t.points > 0) || teamGoalies.length > 0

  if (isError && skaters.length === 0 && goalies.length === 0 && !hasAnyTeamStats) {
    return <ErrorNotice message={errorMessage ?? "Could not load stats. Try again."} />
  }

  if (isLoading && skaters.length === 0 && goalies.length === 0 && !hasAnyTeamStats) {
    return <LoadingState variant="stats" label="Loading stats…" />
  }

  if (skaters.length === 0 && goalies.length === 0 && !hasAnyTeamStats) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">No stats available yet. Stats will appear after games are synced.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {isError && <ErrorNotice message={`Stats could not refresh; showing the last loaded results. ${errorMessage ?? ""}`} />}
      {/* Skaters / Goalies / Teams toggle */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setTab("skaters")}
          className={cn(
            "rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors min-h-[44px] sm:min-h-0",
            tab === "skaters" ? "bg-card text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
          )}
        >
          Skaters
        </button>
        <button
          onClick={() => setTab("goalies")}
          className={cn(
            "rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors min-h-[44px] sm:min-h-0",
            tab === "goalies" ? "bg-card text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
          )}
        >
          Goalies
        </button>
        <button
          onClick={() => setTab("teams")}
          className={cn(
            "rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors min-h-[44px] sm:min-h-0",
            tab === "teams" ? "bg-card text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
          )}
        >
          Teams
        </button>
        <div className="h-px flex-1 bg-border/40 ml-2" />
      </div>

      {/* Filters Control Bar */}
      {(season === "all" || tab !== "teams" || hasPlayoffs || playoff) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border border-border/10 rounded-lg p-3 bg-card/45">
          <div className="flex items-end gap-2 sm:gap-3 w-full sm:w-auto">
            {/* Team Filter (only when season is not "all" and not in teams view) */}
            {season !== "all" && tab !== "teams" && (
              <>
                {/* Mobile Team Filter Dropdown (always select on small screen) */}
                <div className="flex flex-col gap-1.5 sm:hidden w-[120px]">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">Team</span>
                  <select
                    value={teamFilter}
                    onChange={(e) => { setTeamFilter(e.target.value); setSkaterPage(1); setGoaliePage(1) }}
                    className="rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold text-foreground appearance-none cursor-pointer pr-6 bg-[length:10px] bg-[right_6px_center] bg-no-repeat min-h-[36px] sm:min-h-0 w-full"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
                  >
                    <option value="all">All Teams</option>
                    {teams.map((t) => (
                      <option key={t.slug} value={t.slug}>{t.name}</option>
                    ))}
                  </select>
                </div>

                {/* Desktop Team Filter (buttons or select on larger screens) */}
                <div className="hidden sm:flex sm:flex-col sm:gap-1.5">
                  {teams.length > 8 ? (
                    <>
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">Team</span>
                      <select
                        value={teamFilter}
                        onChange={(e) => { setTeamFilter(e.target.value); setSkaterPage(1); setGoaliePage(1) }}
                        className="rounded-md bg-card border border-border/40 px-2.5 py-1.5 text-[11px] font-semibold text-foreground min-h-[40px] sm:min-h-0 appearance-none cursor-pointer pr-7 bg-[length:12px] bg-[right_8px_center] bg-no-repeat w-40"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
                      >
                        <option value="all">All Teams</option>
                        {teams.map((t) => (
                          <option key={t.slug} value={t.slug}>{t.name}</option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">Team</span>
                      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                        <button
                          onClick={() => { setTeamFilter("all"); setSkaterPage(1); setGoaliePage(1) }}
                          className={cn(
                            "shrink-0 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors min-h-[40px] sm:min-h-0 flex items-center gap-1",
                            teamFilter === "all"
                              ? "bg-card text-foreground font-semibold"
                              : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-card/40"
                          )}
                        >
                          All Teams
                        </button>
                        {teams.map((t) => (
                          <button
                            key={t.slug}
                            onClick={() => { setTeamFilter(t.slug); setSkaterPage(1); setGoaliePage(1) }}
                            className={cn(
                              "shrink-0 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors min-h-[40px] sm:min-h-0 flex items-center gap-1",
                              teamFilter === t.slug
                                ? "bg-card text-foreground font-semibold"
                                : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-card/40"
                            )}
                          >
                            {t.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {/* Game Type Filter */}
            {(season === "all" || hasPlayoffs || playoff) && (
              <div className="flex flex-col gap-1.5 w-[120px]">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">Game Type</span>
                <select
                  value={season === "all" ? gameType : (playoff ? "playoffs" : "regular")}
                  onChange={(e) => {
                    const nextGameType = e.target.value
                    if (season === "all") {
                      setGameType(nextGameType)
                      setMinTeamGames(getDefaultMinTeamGames(nextGameType, seasonType))
                    } else {
                      setPlayoff(nextGameType === "playoffs")
                    }
                    setSkaterPage(1)
                    setGoaliePage(1)
                    setTeamSkaterPage(1)
                    setTeamGoaliePage(1)
                  }}
                  className="rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold text-foreground appearance-none cursor-pointer pr-6 bg-[length:10px] bg-[right_6px_center] bg-no-repeat min-h-[36px] sm:min-h-0 w-full"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
                >
                  <option value="regular">Regular Season</option>
                  <option value="playoffs">Playoffs</option>
                  {season === "all" && <option value="all">All</option>}
                </select>
              </div>
            )}

            {/* All-time specific filters */}
            {season === "all" && (
              <>
                <div className="flex flex-col gap-1.5 w-[100px] sm:w-32">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">Season Type</span>
                  <select
                    value={seasonType}
                    onChange={(e) => {
                      const nextType = e.target.value
                      setSeasonType(nextType)
                      setMinTeamGames(getDefaultMinTeamGames(gameType, nextType))
                      if (nextType === "summer") {
                        setFranchiseFilter("all")
                      }
                      setGoaliePage(1)
                      setSkaterPage(1)
                      setTeamSkaterPage(1)
                      setTeamGoaliePage(1)
                    }}
                    className="rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold text-foreground appearance-none cursor-pointer pr-6 sm:pr-7 bg-[length:10px] sm:bg-[length:12px] bg-[right_6px_center] sm:bg-[right_8px_center] bg-no-repeat min-h-[36px] sm:min-h-0 w-full"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
                  >
                    <option value="fall">Fall</option>
                    <option value="summer">Summer</option>
                    <option value="all">All</option>
                  </select>
                </div>

                {tab === "teams" && (
                  <>
                    <div className="flex flex-col gap-1.5 w-[130px] sm:w-36">
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">Finish</span>
                      <select
                        value={resultFilter}
                        onChange={(e) => {
                          setResultFilter(e.target.value as "all" | "champions" | "finalists")
                          setTeamSkaterPage(1)
                          setTeamGoaliePage(1)
                        }}
                        className="rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold text-foreground appearance-none cursor-pointer pr-6 sm:pr-7 bg-[length:10px] sm:bg-[length:12px] bg-[right_6px_center] sm:bg-[right_8px_center] bg-no-repeat min-h-[36px] sm:min-h-0 w-full"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
                      >
                        <option value="all">All</option>
                        <option value="champions">Champions</option>
                        <option value="finalists">Champs + Finalists</option>
                      </select>
                    </div>

                    {seasonType !== "summer" && availableFranchises.length > 0 && (
                      <div className="flex flex-col gap-1.5 w-[100px] sm:w-28">
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">Franchise</span>
                        <select
                          value={franchiseFilter}
                          onChange={(e) => {
                            setFranchiseFilter(e.target.value)
                            setTeamSkaterPage(1)
                            setTeamGoaliePage(1)
                          }}
                          className="rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold text-foreground appearance-none cursor-pointer pr-6 sm:pr-7 bg-[length:10px] sm:bg-[length:12px] bg-[right_6px_center] sm:bg-[right_8px_center] bg-no-repeat min-h-[36px] sm:min-h-0 w-full"
                          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
                        >
                          <option value="all">All</option>
                          {availableFranchises.map((f) => (
                            <option key={f.slug} value={f.slug}>{f.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}

                {tab !== "teams" ? (
                  <div className="flex flex-col gap-1.5 w-[70px] sm:w-24">
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">Min Games</span>
                    <input
                      type="number"
                      min={0}
                      value={minGames}
                      onChange={(e) => {
                        const val = e.target.value
                        if (val === "") {
                          setMinGames("")
                        } else {
                          setMinGames(Math.max(0, parseInt(val) || 0))
                        }
                        setGoaliePage(1)
                        setSkaterPage(1)
                      }}
                      className="rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold text-foreground min-h-[36px] sm:min-h-0 text-center w-full"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 w-[70px] sm:w-24">
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">Min TGP</span>
                    <input
                      type="number"
                      min={0}
                      value={minTeamGames}
                      onChange={(e) => {
                        const val = e.target.value
                        if (val === "") {
                          setMinTeamGames("")
                        } else {
                          setMinTeamGames(Math.max(0, parseInt(val) || 0))
                        }
                        setTeamSkaterPage(1)
                        setTeamGoaliePage(1)
                      }}
                      className="rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold text-foreground min-h-[36px] sm:min-h-0 text-center w-full"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Search Input */}
          {(tab !== "teams" || season === "all") && (
            <div className="relative w-full sm:max-w-xs self-end">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
              <input
                type="text"
                value={nameFilter}
                onChange={(e) => {
                  setNameFilter(e.target.value)
                  setSkaterPage(1)
                  setGoaliePage(1)
                  setTeamSkaterPage(1)
                  setTeamGoaliePage(1)
                }}
                placeholder={tab === "teams" ? "Search teams or seasons..." : "Search players..."}
                className="w-full rounded-md bg-card border border-border/40 pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 min-h-[40px] sm:min-h-0"
              />
            </div>
          )}
        </div>
      )}

      {/* Skaters Table */}
      {tab === "skaters" && (
        <>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[700px] text-[11px] table-fixed">
              <thead>
                <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                  <th className="text-left font-medium py-2.5 sticky left-0 z-10 bg-background pl-4 sm:pl-2 w-[170px] sm:w-[100px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none">Player</th>
                  <SortableTh label="GP" sortKey="gp" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
                  <SortableTh label="G" sortKey="goals" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
                  <SortableTh label="A" sortKey="assists" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
                  <SortableTh label="PTS" sortKey="points" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
                  <SortableTh label="PTS/G" sortKey="ptsPg" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
                  <SortableTh label="GWG" sortKey="gwg" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
                  <SortableTh label="PPG" sortKey="ppg" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
                  <SortableTh label="SHG" sortKey="shg" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
                  <SortableTh label="ENG" sortKey="eng" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
                  <SortableTh label="HAT" sortKey="hatTricks" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
                  <SortableTh label="PIM" sortKey="pim" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {paginatedSkaters.map((p, i) => (
                  <tr
                    key={`${p.id}-${p.teamSlug}`}
                    className={cn(
                      "group border-t border-border/20 hover:bg-muted/50",
                      i % 2 === 0 && "bg-card/15"
                    )}
                  >
                    <td className="py-2 sticky left-0 z-10 bg-background group-hover:bg-muted/50 pl-4 sm:pl-2 w-[170px] sm:w-[100px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
                      <div className="flex items-center gap-2 pr-4">
                        <span className="text-muted-foreground/40 tabular-nums text-[10px] shrink-0 w-3 text-right">{p.rank}</span>
                        <TeamLogo slug={p.teamSlug} name={p.team} size={18} className="shrink-0" linked />
                        <Link href={`/player/${playerSlug(p.name)}`} prefetch={true} className="text-xs font-semibold leading-tight text-foreground hover:text-primary transition-colors truncate">{p.name}</Link>
                      </div>
                    </td>
                    <td className={sortedStatCellClass("gp", sortKey)}>{p.gp}</td>
                    <td className={sortedStatCellClass("goals", sortKey)}>{p.goals}</td>
                    <td className={sortedStatCellClass("assists", sortKey)}>{p.assists}</td>
                    <td className={sortedStatCellClass("points", sortKey)}>{p.points}</td>
                    <td className={sortedStatCellClass("ptsPg", sortKey)}>{p.ptsPg}</td>
                    <td className={sortedStatCellClass("gwg", sortKey)}>{p.gwg}</td>
                    <td className={sortedStatCellClass("ppg", sortKey)}>{p.ppg}</td>
                    <td className={sortedStatCellClass("shg", sortKey)}>{p.shg}</td>
                    <td className={sortedStatCellClass("eng", sortKey)}>{p.eng}</td>
                    <td className={sortedStatCellClass("hatTricks", sortKey)}>{p.hatTricks}</td>
                    <td className={sortedStatCellClass("pim", sortKey)}>{p.pim}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {skaterTotalPages > 1 && (
            <Pagination
              page={skaterPage}
              totalPages={skaterTotalPages}
              onPrev={() => setSkaterPage((p) => Math.max(1, p - 1))}
              onNext={() => setSkaterPage((p) => Math.min(skaterTotalPages, p + 1))}
            />
          )}
        </>
      )}

      {/* Goalies Table */}
      {tab === "goalies" && (
        <>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[700px] text-[11px] table-fixed">
              <thead>
                <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                  <th className="text-left font-medium py-2.5 sticky left-0 z-10 bg-background pl-4 sm:pl-2 w-[170px] sm:w-[100px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none">Goalie</th>
                  <SortableTh label="GP" sortKey="gp" currentKey={goalieSortKey} dir={goalieSortDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="W" sortKey="wins" currentKey={goalieSortKey} dir={goalieSortDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="L" sortKey="losses" currentKey={goalieSortKey} dir={goalieSortDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="SV%" sortKey="savePercentage" currentKey={goalieSortKey} dir={goalieSortDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="GAA" sortKey="gaa" currentKey={goalieSortKey} dir={goalieSortDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="SO" sortKey="shutouts" currentKey={goalieSortKey} dir={goalieSortDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="SV" sortKey="saves" currentKey={goalieSortKey} dir={goalieSortDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="GA" sortKey="goalsAgainst" currentKey={goalieSortKey} dir={goalieSortDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="SA" sortKey="shotsAgainst" currentKey={goalieSortKey} dir={goalieSortDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="A" sortKey="goalieAssists" currentKey={goalieSortKey} dir={goalieSortDir} onToggle={toggleGoalieSort} />
                </tr>
              </thead>
              <tbody>
                {paginatedGoalies.map((p, i) => (
                  <tr
                    key={`${p.id}-${p.teamSlug}`}
                    className={cn(
                      "group border-t border-border/20 hover:bg-muted/50",
                      i % 2 === 0 && "bg-card/15"
                    )}
                  >
                    <td className="py-2 sticky left-0 z-10 bg-background group-hover:bg-muted/50 pl-4 sm:pl-2 w-[170px] sm:w-[100px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
                      <div className="flex items-center gap-2 pr-4">
                        <span className="text-muted-foreground/40 tabular-nums text-[10px] shrink-0 w-3 text-right">{p.rank}</span>
                        <TeamLogo slug={p.teamSlug} name={p.team} size={18} className="shrink-0" linked />
                        <Link href={`/player/${playerSlug(p.name)}`} prefetch={true} className="text-xs font-semibold leading-tight text-foreground hover:text-primary transition-colors truncate">{p.name}</Link>
                      </div>
                    </td>
                    <td className={sortedStatCellClass("gp", goalieSortKey)}>{p.gp}</td>
                    <td className={sortedStatCellClass("wins", goalieSortKey)}>{p.wins}</td>
                    <td className={sortedStatCellClass("losses", goalieSortKey)}>{p.losses}</td>
                    <td className={sortedStatCellClass("savePercentage", goalieSortKey)}>
                      {p.savePercentage !== undefined ? p.savePercentage.toFixed(3) : "-"}
                    </td>
                    <td className={sortedStatCellClass("gaa", goalieSortKey)}>
                      {p.gaa !== undefined ? p.gaa.toFixed(2) : "-"}
                    </td>
                    <td className={sortedStatCellClass("shutouts", goalieSortKey)}>{p.shutouts}</td>
                    <td className={sortedStatCellClass("saves", goalieSortKey)}>{p.saves}</td>
                    <td className={sortedStatCellClass("goalsAgainst", goalieSortKey)}>{p.goalsAgainst}</td>
                    <td className={sortedStatCellClass("shotsAgainst", goalieSortKey)}>{p.shotsAgainst}</td>
                    <td className={sortedStatCellClass("goalieAssists", goalieSortKey)}>{p.goalieAssists}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {goalieTotalPages > 1 && (
            <Pagination
              page={goaliePage}
              totalPages={goalieTotalPages}
              onPrev={() => setGoaliePage((p) => Math.max(1, p - 1))}
              onNext={() => setGoaliePage((p) => Math.min(goalieTotalPages, p + 1))}
            />
          )}
        </>
      )}

      {/* Teams View: Stacked Team Skater and Goalie Tables */}
      {tab === "teams" && (
        <div className="flex flex-col gap-8">
          {/* Team Skaters Table */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Skater Stats</h3>
              <div className="h-px flex-1 bg-border/30" />
            </div>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className={cn("w-full text-[11px] table-fixed", season === "all" ? "min-w-[680px] sm:min-w-[760px]" : "min-w-[700px]")}>
                <thead>
                  <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                    <th className="text-left font-medium py-2.5 sticky left-0 z-10 bg-background pl-4 sm:pl-2 w-[168px] sm:w-[168px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none">Team</th>
                    {season === "all" && (
                      <SortableTh label="Season" sortKey="seasonName" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} className="text-left px-1.5 sm:px-3 w-14 sm:w-28 [&>button]:justify-start" />
                    )}
                    <SortableTh label="TGP" sortKey="gp" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} />
                    <SortableTh label="PGP" sortKey="pgp" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} />
                    <SortableTh label="G" sortKey="goals" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} />
                    <SortableTh label="A" sortKey="assists" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} />
                    <SortableTh label="PTS" sortKey="points" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} />
                    <SortableTh label="PTS/G" sortKey="ptsPg" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} />
                    <SortableTh label="GWG" sortKey="gwg" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} />
                    <SortableTh label="PPG" sortKey="ppg" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} />
                    <SortableTh label="SHG" sortKey="shg" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} />
                    <SortableTh label="ENG" sortKey="eng" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} />
                    <SortableTh label="HAT" sortKey="hatTricks" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} />
                    <SortableTh label="PIM" sortKey="pim" currentKey={teamSkaterSortKey} dir={teamSkaterSortDir} onToggle={toggleTeamSkaterSort} />
                  </tr>
                </thead>
                <tbody>
                  {paginatedTeamSkaters.map((t, i) => (
                    <tr
                      key={`${t.teamSlug}-${t.seasonId ?? "current"}`}
                      className={cn(
                        "group border-t border-border/20 hover:bg-muted/50",
                        i % 2 === 0 && "bg-card/15"
                      )}
                    >
                      <td className="py-2 sticky left-0 z-10 bg-background group-hover:bg-muted/50 pl-4 sm:pl-2 w-[168px] sm:w-[168px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
                        <div className="flex items-center gap-1.5 pr-2">
                          <span className="text-muted-foreground/40 tabular-nums text-[10px] shrink-0 w-3 text-right">{t.rank}</span>
                          <Link
                            href={t.seasonId ? `/team/${t.teamSlug}?season=${t.seasonId}` : `/team/${t.teamSlug}`}
                            prefetch={true}
                            className="flex items-center gap-1.5 group/team min-w-0"
                          >
                            <TeamLogo slug={t.teamSlug} name={t.team} size={18} className="shrink-0" seasonId={t.seasonId} />
                            <span className="text-xs font-semibold leading-tight text-foreground group-hover/team:text-primary transition-colors truncate">
                              {t.team}
                            </span>
                            {t.isChampion && (
                              <Crown className="h-3 w-3 text-amber-500 shrink-0" aria-label="Season Champion" />
                            )}
                          </Link>
                        </div>
                      </td>
                      {season === "all" && (
                        <td className={cn("text-left tabular-nums py-2 px-1.5 sm:px-3 w-14 sm:w-28 text-muted-foreground whitespace-nowrap text-[11px]", teamSkaterSortKey === "seasonName" && "font-bold text-foreground")}>
                          {t.seasonId ? (
                            <Link
                              href={`/stats?season=${t.seasonId}&view=teams`}
                              prefetch={true}
                              className="hover:text-primary transition-colors"
                            >
                              <span className="sm:hidden">{formatCompactSeasonName(t.seasonName ?? t.seasonId)}</span>
                              <span className="hidden sm:inline">{formatSeasonName(t.seasonName ?? t.seasonId ?? "-")}</span>
                            </Link>
                          ) : (
                            <>
                              <span className="sm:hidden">{formatCompactSeasonName(t.seasonName ?? t.seasonId)}</span>
                              <span className="hidden sm:inline">{formatSeasonName(t.seasonName ?? t.seasonId ?? "-")}</span>
                            </>
                          )}
                        </td>
                      )}
                      <td className={sortedStatCellClass("gp", teamSkaterSortKey)}>{t.gp}</td>
                      <td className={sortedStatCellClass("pgp", teamSkaterSortKey)}>{t.pgp ?? t.gp}</td>
                      <td className={sortedStatCellClass("goals", teamSkaterSortKey)}>{t.goals}</td>
                      <td className={sortedStatCellClass("assists", teamSkaterSortKey)}>{t.assists}</td>
                      <td className={sortedStatCellClass("points", teamSkaterSortKey)}>{t.points}</td>
                      <td className={sortedStatCellClass("ptsPg", teamSkaterSortKey)}>{t.ptsPg}</td>
                      <td className={sortedStatCellClass("gwg", teamSkaterSortKey)}>{t.gwg}</td>
                      <td className={sortedStatCellClass("ppg", teamSkaterSortKey)}>{t.ppg}</td>
                      <td className={sortedStatCellClass("shg", teamSkaterSortKey)}>{t.shg}</td>
                      <td className={sortedStatCellClass("eng", teamSkaterSortKey)}>{t.eng}</td>
                      <td className={sortedStatCellClass("hatTricks", teamSkaterSortKey)}>{t.hatTricks}</td>
                      <td className={sortedStatCellClass("pim", teamSkaterSortKey)}>{t.pim}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {paginatedTeamSkaters.length === 0 && (
              <p className="text-center py-6 text-xs text-muted-foreground">
                No skater stats found.
              </p>
            )}
            {season === "all" && teamSkaterTotalPages > 1 && (
              <Pagination
                page={safeTeamSkaterPage}
                totalPages={teamSkaterTotalPages}
                onPrev={() => setTeamSkaterPage((p) => Math.max(1, Math.min(p, teamSkaterTotalPages) - 1))}
                onNext={() => setTeamSkaterPage((p) => Math.min(teamSkaterTotalPages, Math.min(p, teamSkaterTotalPages) + 1))}
              />
            )}
          </div>

          {/* Team Goalies Table */}
          {teamGoalies.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Goalie Stats</h3>
                <div className="h-px flex-1 bg-border/30" />
              </div>
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className={cn("w-full text-[11px] table-fixed", season === "all" ? "min-w-[680px] sm:min-w-[760px]" : "min-w-[700px]")}>
                  <thead>
                    <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                      <th className="text-left font-medium py-2.5 sticky left-0 z-10 bg-background pl-4 sm:pl-2 w-[168px] sm:w-[168px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none">Team</th>
                      {season === "all" && (
                        <SortableTh label="Season" sortKey="seasonName" currentKey={teamGoalieSortKey} dir={teamGoalieSortDir} onToggle={toggleTeamGoalieSort} className="text-left px-1.5 sm:px-3 w-14 sm:w-28 [&>button]:justify-start" />
                      )}
                      <SortableTh label="TGP" sortKey="gp" currentKey={teamGoalieSortKey} dir={teamGoalieSortDir} onToggle={toggleTeamGoalieSort} />
                      <SortableTh label="PGP" sortKey="pgp" currentKey={teamGoalieSortKey} dir={teamGoalieSortDir} onToggle={toggleTeamGoalieSort} />
                      <SortableTh label="SV%" sortKey="savePercentage" currentKey={teamGoalieSortKey} dir={teamGoalieSortDir} onToggle={toggleTeamGoalieSort} />
                      <SortableTh label="GAA" sortKey="gaa" currentKey={teamGoalieSortKey} dir={teamGoalieSortDir} onToggle={toggleTeamGoalieSort} />
                      <SortableTh label="SO" sortKey="shutouts" currentKey={teamGoalieSortKey} dir={teamGoalieSortDir} onToggle={toggleTeamGoalieSort} />
                      <SortableTh label="SV" sortKey="saves" currentKey={teamGoalieSortKey} dir={teamGoalieSortDir} onToggle={toggleTeamGoalieSort} />
                      <SortableTh label="GA" sortKey="goalsAgainst" currentKey={teamGoalieSortKey} dir={teamGoalieSortDir} onToggle={toggleTeamGoalieSort} />
                      <SortableTh label="SA" sortKey="shotsAgainst" currentKey={teamGoalieSortKey} dir={teamGoalieSortDir} onToggle={toggleTeamGoalieSort} />
                      <SortableTh label="SA/G" sortKey="saPg" currentKey={teamGoalieSortKey} dir={teamGoalieSortDir} onToggle={toggleTeamGoalieSort} />
                      <SortableTh label="A" sortKey="goalieAssists" currentKey={teamGoalieSortKey} dir={teamGoalieSortDir} onToggle={toggleTeamGoalieSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedTeamGoalies.map((t, i) => (
                      <tr
                        key={`${t.teamSlug}-${t.seasonId ?? "current"}`}
                        className={cn(
                          "group border-t border-border/20 hover:bg-muted/50",
                          i % 2 === 0 && "bg-card/15"
                        )}
                      >
                        <td className="py-2 sticky left-0 z-10 bg-background group-hover:bg-muted/50 pl-4 sm:pl-2 w-[168px] sm:w-[168px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
                          <div className="flex items-center gap-1.5 pr-2">
                            <span className="text-muted-foreground/40 tabular-nums text-[10px] shrink-0 w-3 text-right">{t.rank}</span>
                            <Link
                              href={t.seasonId ? `/team/${t.teamSlug}?season=${t.seasonId}` : `/team/${t.teamSlug}`}
                              prefetch={true}
                              className="flex items-center gap-1.5 group/team min-w-0"
                            >
                              <TeamLogo slug={t.teamSlug} name={t.team} size={18} className="shrink-0" seasonId={t.seasonId} />
                              <span className="text-xs font-semibold leading-tight text-foreground group-hover/team:text-primary transition-colors truncate">
                                {t.team}
                              </span>
                              {t.isChampion && (
                                <Crown className="h-3 w-3 text-amber-500 shrink-0" aria-label="Season Champion" />
                              )}
                            </Link>
                          </div>
                        </td>
                        {season === "all" && (
                          <td className={cn("text-left tabular-nums py-2 px-1.5 sm:px-3 w-14 sm:w-28 text-muted-foreground whitespace-nowrap text-[11px]", teamGoalieSortKey === "seasonName" && "font-bold text-foreground")}>
                            {t.seasonId ? (
                              <Link
                                href={`/stats?season=${t.seasonId}&view=teams`}
                                prefetch={true}
                                className="hover:text-primary transition-colors"
                              >
                                <span className="sm:hidden">{formatCompactSeasonName(t.seasonName ?? t.seasonId)}</span>
                                <span className="hidden sm:inline">{formatSeasonName(t.seasonName ?? t.seasonId ?? "-")}</span>
                              </Link>
                            ) : (
                              <>
                                <span className="sm:hidden">{formatCompactSeasonName(t.seasonName ?? t.seasonId)}</span>
                                <span className="hidden sm:inline">{formatSeasonName(t.seasonName ?? t.seasonId ?? "-")}</span>
                              </>
                            )}
                          </td>
                        )}
                        <td className={sortedStatCellClass("gp", teamGoalieSortKey)}>{t.gp}</td>
                        <td className={sortedStatCellClass("pgp", teamGoalieSortKey)}>{t.pgp ?? t.gp}</td>
                        <td className={sortedStatCellClass("savePercentage", teamGoalieSortKey)}>
                          {t.savePercentage !== undefined ? t.savePercentage.toFixed(3) : "-"}
                        </td>
                        <td className={sortedStatCellClass("gaa", teamGoalieSortKey)}>
                          {t.gaa !== undefined ? t.gaa.toFixed(2) : "-"}
                        </td>
                        <td className={sortedStatCellClass("shutouts", teamGoalieSortKey)}>{t.shutouts}</td>
                        <td className={sortedStatCellClass("saves", teamGoalieSortKey)}>{t.saves}</td>
                        <td className={sortedStatCellClass("goalsAgainst", teamGoalieSortKey)}>{t.goalsAgainst}</td>
                        <td className={sortedStatCellClass("shotsAgainst", teamGoalieSortKey)}>{t.shotsAgainst}</td>
                        <td className={sortedStatCellClass("saPg", teamGoalieSortKey)}>
                          {t.saPg ?? (t.gp > 0 ? (t.shotsAgainst / t.gp).toFixed(2) : "0.00")}
                        </td>
                        <td className={sortedStatCellClass("goalieAssists", teamGoalieSortKey)}>{t.goalieAssists}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {paginatedTeamGoalies.length === 0 && (
                <p className="text-center py-6 text-xs text-muted-foreground">
                  No goalie stats found.
                </p>
              )}
              {season === "all" && teamGoalieTotalPages > 1 && (
                <Pagination
                  page={safeTeamGoaliePage}
                  totalPages={teamGoalieTotalPages}
                  onPrev={() => setTeamGoaliePage((p) => Math.max(1, Math.min(p, teamGoalieTotalPages) - 1))}
                  onNext={() => setTeamGoaliePage((p) => Math.min(teamGoalieTotalPages, Math.min(p, teamGoalieTotalPages) + 1))}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, onPrev, onNext }: {
  page: number; totalPages: number; onPrev: () => void; onNext: () => void
}) {
  return (
    <div className="flex items-center justify-between py-3 mt-1 border-t border-border/30">
      <button
        onClick={onPrev}
        disabled={page === 1}
        className="text-[10px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px] px-2 sm:min-h-0 transition-colors"
      >
        Previous
      </button>
      <button
        onClick={onNext}
        disabled={page === totalPages}
        className="text-[10px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px] px-2 sm:min-h-0 transition-colors"
      >
        Next
      </button>
    </div>
  )
}
