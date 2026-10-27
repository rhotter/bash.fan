"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { ChevronRight } from "lucide-react"
import { LoadingState } from "@/components/loading-state"
import { TeamLogo } from "@/components/team-logo"
import { IntentLink as Link } from "@/components/intent-link"
import { useSort, SortableTh, SortIcon, statsRowClass } from "@/components/stats-table"
import { cn } from "@/lib/utils"
import {
  computeHeadToHead,
  formatGameDate,
  type HeadToHeadOpponentRecord,
} from "@/lib/head-to-head"
import { isLegacyTeamSlug } from "@/lib/team-filters"
import type { BashGame, Standing } from "@/app/api/bash/route"

type H2HSortKey = "opponent" | "gp" | "record" | "pts" | "gf" | "ga" | "gd"

const opponentAscKeys = new Set<H2HSortKey>(["opponent"])

export function HeadToHeadTab({
  games,
  standings,
  isLoading,
  selectedTeamSlug,
  onSelectTeam,
}: {
  games: BashGame[]
  standings: Standing[]
  isLoading: boolean
  selectedTeamSlug?: string
  onSelectTeam: (teamSlug: string) => void
}) {
  const [expandedSlugs, setExpandedSlugs] = useState<Set<string>>(new Set())
  const { sortKey, sortDir, toggleSort } = useSort<H2HSortKey>("pts", "desc", opponentAscKeys)

  const toggleExpand = useCallback((slug: string) => {
    setExpandedSlugs((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) {
        next.delete(slug)
      } else {
        next.add(slug)
      }
      return next
    })
  }, [])

  const teams = useMemo(() => {
    if (standings.length > 0) {
      return standings
        .filter((s) => !isLegacyTeamSlug(s.slug))
        .map((s) => ({ slug: s.slug, name: s.team }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    const map = new Map<string, string>()
    for (const g of games) {
      if (g.gameType === "regular" && !g.isPlayoff) {
        if (!isLegacyTeamSlug(g.homeSlug) && !map.has(g.homeSlug)) map.set(g.homeSlug, g.homeTeam)
        if (!isLegacyTeamSlug(g.awaySlug) && !map.has(g.awaySlug)) map.set(g.awaySlug, g.awayTeam)
      }
    }
    return [...map.entries()]
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [standings, games])

  const activeSlug = selectedTeamSlug && teams.some((t) => t.slug === selectedTeamSlug)
    ? selectedTeamSlug
    : teams[0]?.slug

  useEffect(() => {
    setExpandedSlugs(new Set())
  }, [activeSlug])

  const h2hData = useMemo(() => {
    return computeHeadToHead(games, activeSlug, teams)
  }, [games, activeSlug, teams])

  const sortedOpponents = useMemo(() => {
    if (!h2hData) return []
    return [...h2hData.opponents].sort((a: HeadToHeadOpponentRecord, b: HeadToHeadOpponentRecord) => {
      if (sortKey === "opponent") {
        const comp = a.opponentTeam.localeCompare(b.opponentTeam)
        return sortDir === "desc" ? -comp : comp
      }
      if (sortKey === "record") {
        if (a.pts !== b.pts) {
          return sortDir === "desc" ? b.pts - a.pts : a.pts - b.pts
        }
        if (a.w !== b.w) {
          return sortDir === "desc" ? b.w - a.w : a.w - b.w
        }
        if (a.gd !== b.gd) {
          return sortDir === "desc" ? b.gd - a.gd : a.gd - b.gd
        }
      } else {
        const av = a[sortKey]
        const bv = b[sortKey]
        const diff = (bv as number) - (av as number)
        if (diff !== 0) {
          return sortDir === "desc" ? diff : -diff
        }
      }

      // Secondary sorts for ties
      if (b.pts !== a.pts) return b.pts - a.pts
      if (b.gd !== a.gd) return b.gd - a.gd
      return a.opponentTeam.localeCompare(b.opponentTeam)
    })
  }, [h2hData, sortKey, sortDir])

  if (isLoading && (!h2hData || teams.length === 0)) {
    return <LoadingState variant="table" label="Loading head to head…" />
  }

  if (!h2hData || teams.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">No head-to-head data available yet.</p>
      </div>
    )
  }

  const { summary } = h2hData

  return (
    <div className="flex flex-col gap-5">
      {/* Filters Control Bar (matching /stats mobile dropdown + desktop pill row) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border border-border/10 rounded-lg p-3 bg-card/45">
        <div className="flex items-end gap-2 sm:gap-3 w-full sm:w-auto">
          {/* Mobile Team Filter Dropdown (always select on small screen) */}
          <div className="flex flex-col gap-1.5 sm:hidden w-[140px]">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">
              Team
            </span>
            <select
              aria-label="Team"
              value={activeSlug}
              onChange={(e) => onSelectTeam(e.target.value)}
              className="rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold text-foreground appearance-none cursor-pointer pr-6 bg-[length:10px] bg-[right_6px_center] bg-no-repeat min-h-[36px] sm:min-h-0 w-full"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
              }}
            >
              {teams.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Desktop Team Filter (buttons or select on larger screens) */}
          <div className="hidden sm:flex sm:flex-col sm:gap-1.5">
            {teams.length > 8 ? (
              <>
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">
                  Team
                </span>
                <select
                  aria-label="Team"
                  value={activeSlug}
                  onChange={(e) => onSelectTeam(e.target.value)}
                  className="rounded-md bg-card border border-border/40 px-2.5 py-1.5 text-[11px] font-semibold text-foreground min-h-[40px] sm:min-h-0 appearance-none cursor-pointer pr-7 bg-[length:12px] bg-[right_8px_center] bg-no-repeat w-40"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  }}
                >
                  {teams.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold pl-0.5">
                  Team
                </span>
                <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                  {teams.map((t) => (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() => onSelectTeam(t.slug)}
                      className={cn(
                        "shrink-0 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors min-h-[40px] sm:min-h-0 flex items-center gap-1 cursor-pointer",
                        activeSlug === t.slug
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
        </div>
      </div>

      {/* Head-to-Head Table */}
      <div className="overflow-x-auto -mx-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[500px] text-[11px] table-fixed">
          <thead>
            <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
              <th
                className="text-left font-medium py-2.5 sticky left-0 z-10 bg-background pl-4 sm:pl-0 w-[170px] min-w-[170px] cursor-pointer select-none after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none"
                onClick={() => toggleSort("opponent")}
              >
                <div className="flex items-center gap-1">
                  <span className={cn(sortKey === "opponent" && "font-bold text-foreground")}>Opponent</span>
                  <SortIcon active={sortKey === "opponent"} dir={sortDir} />
                </div>
              </th>
              <SortableTh label="GP" sortKey="gp" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="Record" sortKey="record" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="w-20" />
              <SortableTh label="PTS" sortKey="pts" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} bold />
              <SortableTh label="GF" sortKey="gf" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="GA" sortKey="ga" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="+/-" sortKey="gd" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sortedOpponents.map((row, i) => {
              const isExpanded = expandedSlugs.has(row.opponentSlug)
              return (
                <OpponentRowsGroup
                  key={row.opponentSlug}
                  row={row}
                  index={i}
                  isExpanded={isExpanded}
                  onToggleExpand={() => toggleExpand(row.opponentSlug)}
                />
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border/40 font-bold bg-muted/20">
              <td className="py-2.5 sticky left-0 z-10 bg-background pl-4 sm:pl-0 w-[170px] min-w-[170px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none">
                <div className="flex items-center gap-2 pr-4 min-w-0">
                  <span className="text-xs font-bold text-foreground pl-1">Total</span>
                </div>
              </td>
              <td className="text-center tabular-nums py-2.5 px-3 text-foreground font-semibold">{summary.gp}</td>
              <td className="text-center tabular-nums py-2.5 px-3 text-foreground font-semibold whitespace-nowrap">
                {summary.w}-{summary.otw}-{summary.otl}-{summary.l}
              </td>
              <td className="text-center tabular-nums py-2.5 px-3 font-bold text-foreground">{summary.pts}</td>
              <td className="text-center tabular-nums py-2.5 px-3 text-foreground font-semibold">{summary.gf}</td>
              <td className="text-center tabular-nums py-2.5 px-3 text-foreground font-semibold">{summary.ga}</td>
              <td className="text-center tabular-nums py-2.5 px-3 text-foreground font-semibold">
                {summary.gd > 0 ? `+${summary.gd}` : summary.gd}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="py-2 border-t border-border/20 text-[10px] text-muted-foreground/50">
        <p>W=3pts, OTW=2pts, OTL=1pt, L=0pts</p>
      </div>
    </div>
  )
}

function OpponentRowsGroup({
  row,
  index,
  isExpanded,
  onToggleExpand,
}: {
  row: HeadToHeadOpponentRecord
  index: number
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  return (
    <>
      <tr
        onClick={onToggleExpand}
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onToggleExpand()
          }
        }}
        className={cn(statsRowClass(index), "group cursor-pointer select-none")}
      >
        <td className="py-2 sticky left-0 z-10 bg-background group-hover:bg-muted/50 pl-4 sm:pl-0 w-[170px] min-w-[170px] sm:whitespace-nowrap after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
          <div className="flex items-center gap-1.5 pr-4 min-w-0">
            <button
              type="button"
              tabIndex={-1}
              aria-label={isExpanded ? `Collapse ${row.opponentTeam} series` : `Expand ${row.opponentTeam} series`}
              aria-expanded={isExpanded}
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpand()
              }}
              className="p-1 -ml-1 text-muted-foreground/60 hover:text-foreground transition-colors shrink-0 cursor-pointer"
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200",
                  isExpanded && "rotate-90 text-foreground"
                )}
              />
            </button>
            <Link
              href={`/team/${row.opponentSlug}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-2 group/team min-w-0"
            >
              <TeamLogo slug={row.opponentSlug} name={row.opponentTeam} size={26} className="shrink-0" />
              <span className="text-xs font-semibold group-hover/team:text-primary transition-colors line-clamp-2">
                {row.opponentTeam}
              </span>
            </Link>
          </div>
        </td>
        <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{row.gp}</td>
        <td className="text-center tabular-nums py-2 px-3 text-muted-foreground whitespace-nowrap">
          {row.w}-{row.otw}-{row.otl}-{row.l}
        </td>
        <td className="text-center tabular-nums py-2 px-3 font-bold text-foreground">{row.pts}</td>
        <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{row.gf}</td>
        <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{row.ga}</td>
        <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">
          {row.gd > 0 ? `+${row.gd}` : row.gd}
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-muted/10 border-t border-b border-border/20">
          <td colSpan={7} className="p-0">
            <div className="sticky left-0 w-[calc(100vw-2rem)] sm:static sm:w-full px-4 py-2.5 sm:pl-6 sm:pr-3 flex flex-col">
              <div className="flex items-center justify-between pb-1.5 text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                <span>
                  Season Series ({row.games.length} {row.games.length === 1 ? "game" : "games"})
                </span>
                <span>
                  {row.w}-{row.otw}-{row.otl}-{row.l} ({row.pts} pts)
                </span>
              </div>
              {row.games.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic py-1.5 border-t border-border/15">
                  No games scheduled or played this season.
                </p>
              ) : (
                <div className="divide-y divide-border/15 border-t border-border/15">
                  {row.games.map((g) => (
                    <Link
                      key={g.id}
                      href={`/game/${g.id}`}
                      className="flex items-center justify-between py-1.5 px-1 -mx-1 rounded-sm hover:bg-muted/40 transition-colors text-[11px] group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-[10px] text-muted-foreground/60 tabular-nums w-12 shrink-0">
                          {formatGameDate(g.date)}
                        </span>

                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-muted-foreground/70 font-medium w-4 shrink-0">
                            {g.isHome ? "vs" : "@"}
                          </span>
                          <span className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
                            {row.opponentTeam}
                          </span>
                          {(g.isOvertime || g.hasShootout) && (
                            <span className="text-[9px] text-muted-foreground/60 uppercase font-medium">
                              {g.hasShootout ? "SO" : "OT"}
                            </span>
                          )}
                          {g.isForfeit && (
                            <span className="text-[9px] text-rose-400 uppercase font-medium">
                              Forfeit
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0 text-right">
                        {g.status === "final" || g.status === "live" ? (
                          <>
                            {(g.result === "W" || g.result === "OTW" || g.result === "OTL" || g.result === "L") && (
                              <span
                                className={cn(
                                  "text-[10px] font-semibold uppercase tracking-wide",
                                  (g.result === "W" || g.result === "OTW") && "text-emerald-500",
                                  g.result === "OTL" && "text-amber-500",
                                  g.result === "L" && "text-rose-500"
                                )}
                              >
                                {g.result}
                              </span>
                            )}
                            {g.result === "LIVE" && (
                              <span className="text-[9px] font-bold uppercase tracking-wide text-red-400 animate-pulse">
                                LIVE
                              </span>
                            )}
                            {g.result === "FINAL" && (
                              <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                                FINAL
                              </span>
                            )}
                            <span className="font-semibold tabular-nums text-foreground w-10 text-right">
                              {g.status === "final" && (g.teamScore === null || g.opponentScore === null)
                                ? "Final"
                                : `${g.teamScore ?? 0} - ${g.opponentScore ?? 0}`}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground/40 tabular-nums w-10 text-right">
                            -
                          </span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
