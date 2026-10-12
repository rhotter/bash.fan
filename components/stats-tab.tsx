"use client"

import { LoadingState } from "@/components/loading-state"
import { useState, useMemo, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { usePlayerStats, type PlayerStatsData } from "@/lib/hockey-data"
import { cn } from "@/lib/utils"
import { SearchIcon } from "lucide-react"
import { IntentLink as Link } from "@/components/intent-link"
import { playerSlug } from "@/lib/player-slug"
import { useSort, SortableTh } from "@/components/stats-table"
import { TeamLogo } from "@/components/team-logo"

type SortKey = "points" | "goals" | "assists" | "pim" | "gp" | "gwg" | "ppg" | "shg" | "eng" | "hatTricks" | "pen" | "ptsPg"
type GoalieSortKey = "savePercentage" | "gaa" | "wins" | "losses" | "saves" | "goalsAgainst" | "shotsAgainst" | "gp" | "shutouts" | "goalieAssists"

const goalieAscKeys = new Set<GoalieSortKey>(["gaa"])

const PER_PAGE = 25

export function StatsTab({ initialData }: { initialData?: PlayerStatsData }) {
  const searchParams = useSearchParams()
  const season = searchParams.get("season") || undefined
  const seasonType = searchParams.get("seasonType") || "fall"
  const gameType = searchParams.get("gameType") || "regular"
  const router = useRouter()
  const [playoff, setPlayoff] = useState(false)
  const { skaters, goalies, teams, hasPlayoffs, isLoading } = usePlayerStats(season, !playoff ? initialData : undefined, playoff, seasonType, gameType)
  const rawView = searchParams.get("view")
  const tab = rawView === "goalies" ? "goalies" : "skaters" as const

  const setTab = useCallback((t: "skaters" | "goalies") => {
    const params = new URLSearchParams(searchParams.toString())
    if (t === "skaters") {
      params.delete("view")
    } else {
      params.set("view", t)
    }
    const qs = params.toString()
    window.history.replaceState(null, "", qs ? `/stats?${qs}` : "/stats")
  }, [searchParams])

  const setSeasonType = useCallback((type: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("seasonType", type)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : "/stats", { scroll: false })
  }, [searchParams, router])

  const setGameType = useCallback((type: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("gameType", type)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : "/stats", { scroll: false })
  }, [searchParams, router])

  const [minGames, setMinGames] = useState<number | "">(15)
  const [nameFilter, setNameFilter] = useState("")
  const [teamFilter, setTeamFilter] = useState<string>("all")
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("points")
  const { sortKey: goalieSortKey, sortDir: goalieSortDir, toggleSort: toggleGoalieSort } = useSort<GoalieSortKey>("savePercentage", "desc", goalieAscKeys)
  const [skaterPage, setSkaterPage] = useState(1)
  const [goaliePage, setGoaliePage] = useState(1)

  const nameLower = nameFilter.toLowerCase()

  const filteredSkaters = useMemo(() => {
    let list = (season === "all" || teamFilter === "all") ? skaters : skaters.filter((p) => p.teamSlug === teamFilter)
    if (nameLower) list = list.filter((p) => p.name.toLowerCase().includes(nameLower))
    if (season === "all" && tab === "skaters") {
      const minGp = typeof minGames === "number" ? minGames : 0
      list = list.filter((p) => p.gp >= minGp)
    }
    return [...list].sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number
      const bv = (b[sortKey] ?? 0) as number
      return sortDir === "desc" ? bv - av : av - bv
    })
  }, [skaters, teamFilter, nameLower, sortKey, sortDir, season, tab, minGames])
 
  const filteredGoalies = useMemo(() => {
    let list = (season === "all" || teamFilter === "all") ? goalies : goalies.filter((p) => p.teamSlug === teamFilter)
    if (nameLower) list = list.filter((p) => p.name.toLowerCase().includes(nameLower))
    if (season === "all" && tab === "goalies") {
      const minGp = typeof minGames === "number" ? minGames : 0
      list = list.filter((p) => p.gp >= minGp)
    }
    return [...list].sort((a, b) => {
      const av = (a[goalieSortKey] ?? 0) as number
      const bv = (b[goalieSortKey] ?? 0) as number
      return goalieSortDir === "desc" ? bv - av : av - bv
    })
  }, [goalies, teamFilter, nameLower, goalieSortKey, goalieSortDir, season, tab, minGames])

  const skaterTotalPages = Math.max(1, Math.ceil(filteredSkaters.length / PER_PAGE))
  const goalieTotalPages = Math.max(1, Math.ceil(filteredGoalies.length / PER_PAGE))
  const paginatedSkaters = filteredSkaters.slice((skaterPage - 1) * PER_PAGE, skaterPage * PER_PAGE)
  const paginatedGoalies = filteredGoalies.slice((goaliePage - 1) * PER_PAGE, goaliePage * PER_PAGE)

  if (isLoading && skaters.length === 0 && goalies.length === 0) {
    return <LoadingState variant="stats" label="Loading player stats…" />
  }

  if (skaters.length === 0 && goalies.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">No player stats available yet. Stats will appear after games are synced.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Skaters / Goalies toggle + Regular Season / Playoffs toggle */}
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
        {season !== "all" && (hasPlayoffs || playoff) && (
          <>
            <div className="w-px h-4 bg-border/40 mx-1" />
            <button
              onClick={() => { setPlayoff(false); setSkaterPage(1); setGoaliePage(1) }}
              className={cn(
                "rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors min-h-[44px] sm:min-h-0",
                !playoff ? "bg-card text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
              )}
            >
              Regular Season
            </button>
            <button
              onClick={() => { setPlayoff(true); setSkaterPage(1); setGoaliePage(1) }}
              className={cn(
                "rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors min-h-[44px] sm:min-h-0",
                playoff ? "bg-card text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
              )}
            >
              Playoffs
            </button>
          </>
        )}
        <div className="h-px flex-1 bg-border/40 ml-2" />
      </div>

      {/* Filters Control Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border border-border/10 rounded-lg p-3 bg-card/45">
        <div className="flex items-end gap-2 sm:gap-3 w-full sm:w-auto">
          {/* Team Filter (only when season is not "all") */}
          {season !== "all" && (
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

          {/* Game Type Filter (only when season is "all") */}
          {season === "all" && (
            <div className="flex flex-col gap-1.5 w-[120px]">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">Game Type</span>
              <select
                value={gameType}
                onChange={(e) => { setGameType(e.target.value); setSkaterPage(1); setGoaliePage(1); }}
                className="rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold text-foreground appearance-none cursor-pointer pr-6 bg-[length:10px] bg-[right_6px_center] bg-no-repeat min-h-[36px] sm:min-h-0 w-full"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
              >
                <option value="regular">Regular Season</option>
                <option value="playoffs">Playoffs</option>
                <option value="all">All</option>
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
                  onChange={(e) => { setSeasonType(e.target.value); setGoaliePage(1); setSkaterPage(1); }}
                  className="rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold text-foreground appearance-none cursor-pointer pr-6 sm:pr-7 bg-[length:10px] sm:bg-[length:12px] bg-[right_6px_center] sm:bg-[right_8px_center] bg-no-repeat min-h-[36px] sm:min-h-0 w-full"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
                >
                  <option value="fall">Fall</option>
                  <option value="summer">Summer</option>
                  <option value="all">All</option>
                </select>
              </div>

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
            </>
          )}
        </div>

        {/* Player Name Search */}
        <div className="relative w-full sm:max-w-xs self-end">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
          <input
            type="text"
            value={nameFilter}
            onChange={(e) => { setNameFilter(e.target.value); setSkaterPage(1); setGoaliePage(1) }}
            placeholder="Search players..."
            className="w-full rounded-md bg-card border border-border/40 pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 min-h-[40px] sm:min-h-0"
          />
        </div>
      </div>

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
                  <SortableTh label="PTS" sortKey="points" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} bold />
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
                    key={p.id}
                    className={cn(
                      "group border-t border-border/20 hover:bg-muted/50",
                      i % 2 === 0 && "bg-card/15"
                    )}
                  >
                    <td className="py-2 sticky left-0 z-10 bg-background group-hover:bg-muted/50 pl-4 sm:pl-2 w-[170px] sm:w-[100px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
                      <div className="flex items-center gap-2 pr-4">
                        <span className="text-muted-foreground/40 tabular-nums text-[10px] shrink-0 w-3 text-right">{(skaterPage - 1) * PER_PAGE + i + 1}</span>
                        <TeamLogo slug={p.teamSlug} name={p.team} size={18} className="shrink-0" linked />
                        <Link href={`/player/${playerSlug(p.name)}`} className="text-xs font-semibold leading-tight text-foreground hover:text-primary transition-colors truncate">{p.name}</Link>
                      </div>
                    </td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.gp}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.goals}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.assists}</td>
                    <td className="text-center tabular-nums py-2 px-3 font-bold">{p.points}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.ptsPg}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.gwg}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.ppg}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.shg}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.eng}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.hatTricks}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.pim}</td>
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
                  <SortableTh label="SV%" sortKey="savePercentage" currentKey={goalieSortKey} dir={goalieSortDir} onToggle={toggleGoalieSort} bold />
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
                    key={p.id}
                    className={cn(
                      "group border-t border-border/20 hover:bg-muted/50",
                      i % 2 === 0 && "bg-card/15"
                    )}
                  >
                    <td className="py-2 sticky left-0 z-10 bg-background group-hover:bg-muted/50 pl-4 sm:pl-2 w-[170px] sm:w-[100px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
                      <div className="flex items-center gap-2 pr-4">
                        <span className="text-muted-foreground/40 tabular-nums text-[10px] shrink-0 w-3 text-right">{(goaliePage - 1) * PER_PAGE + i + 1}</span>
                        <TeamLogo slug={p.teamSlug} name={p.team} size={18} className="shrink-0" linked />
                        <Link href={`/player/${playerSlug(p.name)}`} className="text-xs font-semibold leading-tight text-foreground hover:text-primary transition-colors truncate">{p.name}</Link>
                      </div>
                    </td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.gp}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.wins}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.losses}</td>
                    <td className="text-center tabular-nums py-2 px-3 font-bold">
                      {p.savePercentage !== undefined ? p.savePercentage.toFixed(3) : "-"}
                    </td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">
                      {p.gaa !== undefined ? p.gaa.toFixed(2) : "-"}
                    </td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.shutouts}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.saves}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.goalsAgainst}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.shotsAgainst}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.goalieAssists}</td>
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
