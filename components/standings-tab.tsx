"use client"

import { LoadingState } from "@/components/loading-state"
import { useMemo } from "react"
import { type Standing } from "@/lib/hockey-data"
import { cn } from "@/lib/utils"
import { IntentLink as Link } from "@/components/intent-link"
import { sortedStatCellClass, useSort, SortableTh, statsRowClass } from "@/components/stats-table"
import { TeamLogo } from "@/components/team-logo"

type SortKey = "pts" | "gp" | "w" | "otw" | "l" | "otl" | "gf" | "ga" | "gd"

export function StandingsTab({
  standings,
  isLoading,
}: {
  standings: Standing[]
  isLoading: boolean
}) {
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("pts")

  const sorted = useMemo(() => {
    return [...standings].sort((a, b) => {
      const av = a[sortKey] as number
      const bv = b[sortKey] as number
      return sortDir === "desc" ? bv - av : av - bv
    })
  }, [standings, sortKey, sortDir])

  if (isLoading && standings.length === 0) {
    return <LoadingState variant="table" label="Loading standings…" />
  }

  if (standings.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">No standings data available yet.</p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto -mx-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[500px] text-[11px] table-fixed">
          <thead>
            <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
              <th className="text-left font-medium py-2.5 sticky left-0 z-10 bg-background pl-4 sm:pl-0 w-[170px] min-w-[170px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none">Team</th>
              <SortableTh label="GP" sortKey="gp" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="W" sortKey="w" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="OTW" sortKey="otw" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="L" sortKey="l" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="OTL" sortKey="otl" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="PTS" sortKey="pts" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="GF" sortKey="gf" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="GA" sortKey="ga" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="+/-" sortKey="gd" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.slug}
                className={cn(statsRowClass(i), "group")}
              >
                <td className="py-2 sticky left-0 z-10 bg-background group-hover:bg-muted/50 pl-4 sm:pl-0 w-[170px] min-w-[170px] sm:whitespace-nowrap after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
                  <div className="flex items-center gap-2 pr-4 min-w-0">
                    <span className="text-muted-foreground/40 tabular-nums text-[10px] shrink-0 w-3 text-right">{i + 1}</span>
                    <Link href={`/team/${row.slug}`} className="flex items-center gap-2 group/team min-w-0">
                      <TeamLogo slug={row.slug} name={row.team} size={28} className="shrink-0" />
                      <span className="text-xs font-semibold group-hover/team:text-primary transition-colors line-clamp-2">
                        {row.team}
                      </span>
                    </Link>
                  </div>
                </td>
                <td className={sortedStatCellClass("gp", sortKey)}>{row.gp}</td>
                <td className={sortedStatCellClass("w", sortKey)}>{row.w}</td>
                <td className={sortedStatCellClass("otw", sortKey)}>{row.otw}</td>
                <td className={sortedStatCellClass("l", sortKey)}>{row.l}</td>
                <td className={sortedStatCellClass("otl", sortKey)}>{row.otl}</td>
                <td className={sortedStatCellClass("pts", sortKey)}>{row.pts}</td>
                <td className={sortedStatCellClass("gf", sortKey)}>{row.gf}</td>
                <td className={sortedStatCellClass("ga", sortKey)}>{row.ga}</td>
                <td className={sortedStatCellClass("gd", sortKey)}>
                  {row.gd > 0 ? `+${row.gd}` : row.gd}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="py-2 border-t border-border/20">
        <p className="text-[10px] text-muted-foreground/50">
          W=3pts, OTW=2pts, OTL=1pt, L=0pts
        </p>
      </div>
    </>
  )
}
