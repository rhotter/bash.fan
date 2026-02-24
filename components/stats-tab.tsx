"use client"

import { useState, useMemo, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { usePlayerStats, type PlayerStatsData } from "@/lib/hockey-data"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import { playerSlug } from "@/lib/player-slug"
import { useSort, SortableTh, statsRowClass } from "@/components/stats-table"

type SortKey = "points" | "goals" | "assists" | "pim" | "gp" | "gwg" | "ppg" | "shg" | "eng" | "hatTricks" | "pen" | "ptsPg"
type GoalieSortKey = "savePercentage" | "gaa" | "wins" | "losses" | "saves" | "goalsAgainst" | "shotsAgainst" | "gp" | "shutouts" | "goalieAssists"

const goalieAscKeys = new Set<GoalieSortKey>(["gaa"])

const PER_PAGE = 25

export function StatsTab({ initialData }: { initialData?: PlayerStatsData }) {
  const searchParams = useSearchParams()
  const season = searchParams.get("season") || undefined
  const [playoff, setPlayoff] = useState(false)
  const { skaters, goalies, teams, hasPlayoffs, isLoading, isError } = usePlayerStats(season, !playoff ? initialData : undefined, playoff)
  const router = useRouter()
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
    router.replace(qs ? `?${qs}` : "/stats", { scroll: false })
  }, [searchParams, router])

  const [teamFilter, setTeamFilter] = useState<string>("all")
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("points")
  const { sortKey: goalieSortKey, sortDir: goalieSortDir, toggleSort: toggleGoalieSort } = useSort<GoalieSortKey>("savePercentage", "desc", goalieAscKeys)
  const [skaterPage, setSkaterPage] = useState(1)
  const [goaliePage, setGoaliePage] = useState(1)

  const filteredSkaters = useMemo(() => {
    const list = teamFilter === "all" ? skaters : skaters.filter((p) => p.teamSlug === teamFilter)
    return [...list].sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number
      const bv = (b[sortKey] ?? 0) as number
      return sortDir === "desc" ? bv - av : av - bv
    })
  }, [skaters, teamFilter, sortKey, sortDir])

  const filteredGoalies = useMemo(() => {
    const list = teamFilter === "all" ? goalies : goalies.filter((p) => p.teamSlug === teamFilter)
    return [...list].sort((a, b) => {
      const av = (a[goalieSortKey] ?? 0) as number
      const bv = (b[goalieSortKey] ?? 0) as number
      return goalieSortDir === "desc" ? bv - av : av - bv
    })
  }, [goalies, teamFilter, goalieSortKey, goalieSortDir])

  const skaterTotalPages = Math.max(1, Math.ceil(filteredSkaters.length / PER_PAGE))
  const goalieTotalPages = Math.max(1, Math.ceil(filteredGoalies.length / PER_PAGE))
  const paginatedSkaters = filteredSkaters.slice((skaterPage - 1) * PER_PAGE, skaterPage * PER_PAGE)
  const paginatedGoalies = filteredGoalies.slice((goaliePage - 1) * PER_PAGE, goaliePage * PER_PAGE)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError || skaters.length === 0) {
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

      {/* Team filter */}
      {teams.length > 8 ? (
        <div className="flex items-center gap-2">
          <select
            value={teamFilter}
            onChange={(e) => { setTeamFilter(e.target.value); setSkaterPage(1); setGoaliePage(1) }}
            className="rounded-md bg-card border border-border/40 px-2.5 py-1.5 text-[11px] font-medium text-foreground min-h-[44px] sm:min-h-0 appearance-none cursor-pointer pr-7 bg-[length:12px] bg-[right_8px_center] bg-no-repeat"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
          >
            <option value="all">All Teams</option>
            {teams.map((t) => (
              <option key={t.slug} value={t.slug}>{t.name}</option>
            ))}
          </select>
        </div>
      ) : (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          <button
            onClick={() => { setTeamFilter("all"); setSkaterPage(1); setGoaliePage(1) }}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors min-h-[44px] sm:min-h-0 flex items-center gap-1",
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
                "shrink-0 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors min-h-[44px] sm:min-h-0 flex items-center gap-1",
                teamFilter === t.slug
                  ? "bg-card text-foreground font-semibold"
                  : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-card/40"
              )}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* Skaters Table */}
      {tab === "skaters" && (
        <>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[700px] text-[11px] table-fixed">
              <thead>
                <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                  <th className="text-left font-medium py-2.5 sticky left-0 z-10 bg-background pl-4 sm:pl-2 w-[160px] max-w-[160px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none">Player</th>
                  <th className="text-left font-medium py-2.5">Team</th>
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
                      "group border-t border-border/20 hover:bg-muted/50 transition-colors",
                      i % 2 === 0 && "bg-card/15"
                    )}
                  >
                    <td className="py-2 sticky left-0 z-10 bg-background group-hover:bg-muted/50 transition-colors pl-4 sm:pl-2 w-[160px] max-w-[160px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
                      <div className="flex items-baseline gap-2 pr-4">
                        <span className="text-muted-foreground/40 tabular-nums text-[10px] shrink-0 w-3 text-right">{(skaterPage - 1) * PER_PAGE + i + 1}</span>
                        <Link href={`/player/${playerSlug(p.name)}`} className="text-xs font-semibold leading-tight text-foreground hover:text-primary transition-colors truncate">{p.name}</Link>
                      </div>
                    </td>
                    <td className="py-2 text-muted-foreground text-xs">
                      <Link href={`/team/${p.teamSlug}`} className="hover:text-primary transition-colors whitespace-nowrap">{p.team}</Link>
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
                  <th className="text-left font-medium py-2.5 sticky left-0 z-10 bg-background pl-4 sm:pl-2 w-[160px] max-w-[160px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none">Goalie</th>
                  <th className="text-left font-medium py-2.5">Team</th>
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
                      "group border-t border-border/20 hover:bg-muted/50 transition-colors",
                      i % 2 === 0 && "bg-card/15"
                    )}
                  >
                    <td className="py-2 sticky left-0 z-10 bg-background group-hover:bg-muted/50 transition-colors pl-4 sm:pl-2 w-[160px] max-w-[160px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
                      <div className="flex items-baseline gap-2 pr-4">
                        <span className="text-muted-foreground/40 tabular-nums text-[10px] shrink-0 w-3 text-right">{(goaliePage - 1) * PER_PAGE + i + 1}</span>
                        <Link href={`/player/${playerSlug(p.name)}`} className="text-xs font-semibold leading-tight text-foreground hover:text-primary transition-colors truncate">{p.name}</Link>
                      </div>
                    </td>
                    <td className="py-2 text-muted-foreground text-xs">
                      <Link href={`/team/${p.teamSlug}`} className="hover:text-primary transition-colors whitespace-nowrap">{p.team}</Link>
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
