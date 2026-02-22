"use client"

import { useState, useMemo } from "react"
import { type Standing } from "@/lib/hockey-data"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import Link from "next/link"

type SortKey = "pts" | "gp" | "w" | "otw" | "l" | "otl" | "gf" | "ga" | "gd"
type SortDir = "asc" | "desc"

export function StandingsTab({
  standings,
  isLoading,
}: {
  standings: Standing[]
  isLoading: boolean
}) {
  const [sortKey, setSortKey] = useState<SortKey>("pts")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const sorted = useMemo(() => {
    return [...standings].sort((a, b) => {
      const av = a[sortKey] as number
      const bv = b[sortKey] as number
      return sortDir === "desc" ? bv - av : av - bv
    })
  }, [standings, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    else { setSortKey(key); setSortDir("desc") }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (standings.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">No standings data available yet.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
            <th className="text-center font-medium py-2.5 w-8">#</th>
            <th className="text-left font-medium py-2.5">Team</th>
            <SortableTh label="GP" sortKey="gp" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            <SortableTh label="W" sortKey="w" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            <SortableTh label="OTW" sortKey="otw" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            <SortableTh label="L" sortKey="l" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            <SortableTh label="OTL" sortKey="otl" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            <SortableTh label="GF" sortKey="gf" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            <SortableTh label="GA" sortKey="ga" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            <SortableTh label="+/-" sortKey="gd" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            <SortableTh label="PTS" sortKey="pts" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} bold />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={row.slug}
              className={cn(
                "border-t border-border/20 hover:bg-card/60 transition-colors",
                i % 2 === 0 && "bg-card/15"
              )}
            >
              <td className="text-center py-2 text-muted-foreground/40 tabular-nums">{i + 1}</td>
              <td className="py-2">
                <Link href={`/team/${row.slug}`} className="text-xs font-semibold hover:text-primary transition-colors">
                  {row.team}
                </Link>
              </td>
              <td className="text-center tabular-nums py-2 text-muted-foreground">{row.gp}</td>
              <td className={cn("text-center tabular-nums py-2", row.w > 0 && "font-medium")}>{row.w}</td>
              <td className="text-center tabular-nums py-2 text-muted-foreground">{row.otw}</td>
              <td className="text-center tabular-nums py-2 text-muted-foreground">{row.l}</td>
              <td className="text-center tabular-nums py-2 text-muted-foreground">{row.otl}</td>
              <td className="text-center tabular-nums py-2 text-muted-foreground">{row.gf}</td>
              <td className="text-center tabular-nums py-2 text-muted-foreground">{row.ga}</td>
              <td className="text-center tabular-nums py-2 text-muted-foreground">
                {row.gd > 0 ? `+${row.gd}` : row.gd}
              </td>
              <td className="text-center tabular-nums py-2 font-bold">{row.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="py-2 border-t border-border/20">
        <p className="text-[10px] text-muted-foreground/50">
          W=3pts, OTW=2pts, OTL=1pt, L=0pts
        </p>
      </div>
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/30" />
  return dir === "desc"
    ? <ChevronDown className="h-2.5 w-2.5 text-primary" />
    : <ChevronUp className="h-2.5 w-2.5 text-primary" />
}

function SortableTh({ label, sortKey, currentKey, dir, onToggle, bold }: {
  label: string; sortKey: SortKey; currentKey: SortKey; dir: SortDir
  onToggle: (k: SortKey) => void; bold?: boolean
}) {
  return (
    <th
      className="text-center font-medium py-2.5 w-10 cursor-pointer select-none"
      onClick={() => onToggle(sortKey)}
    >
      <div className="flex items-center justify-center gap-0.5">
        <span className={cn(bold && "font-bold")}>{label}</span>
        <SortIcon active={currentKey === sortKey} dir={dir} />
      </div>
    </th>
  )
}
