"use client"

import { useState } from "react"
import { useRefStats } from "@/lib/hockey-data"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react"

type SortKey = "games" | "totalPen" | "totalPim" | "avgPimPerGame"
type SortDir = "asc" | "desc"

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/30" />
  return dir === "desc"
    ? <ChevronDown className="h-2.5 w-2.5 text-primary" />
    : <ChevronUp className="h-2.5 w-2.5 text-primary" />
}

export function RefsTab() {
  const { refs, isLoading, isError } = useRefStats()
  const [sortKey, setSortKey] = useState<SortKey>("games")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    else { setSortKey(key); setSortDir("desc") }
  }

  const sorted = [...refs].sort((a, b) => {
    const av = a[sortKey] ?? 0
    const bv = b[sortKey] ?? 0
    return sortDir === "desc" ? bv - av : av - bv
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError || refs.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">No referee data available yet. Data will appear after game boxscores are synced.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
            <th className="text-center font-medium py-2.5 w-8">#</th>
            <th className="text-left font-medium py-2.5 min-w-[140px]">Referee</th>
            <SortableTh label="Games" sortKey="games" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} bold />
            <SortableTh label="Pen" sortKey="totalPen" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            <SortableTh label="PIM" sortKey="totalPim" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            <SortableTh label="PIM/G" sortKey="avgPimPerGame" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr
              key={r.name}
              className={cn(
                "border-t border-border/20 hover:bg-muted/50 transition-colors",
                i % 2 === 0 && "bg-card/15"
              )}
            >
              <td className="text-center py-2 text-muted-foreground/40 tabular-nums">{i + 1}</td>
              <td className="py-2 pr-2">
                <span className="text-xs font-semibold leading-tight text-foreground">{r.name}</span>
              </td>
              <td className="text-center tabular-nums py-2 px-3 font-bold">{r.games}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{r.totalPen}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{r.totalPim}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{r.avgPimPerGame}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SortableTh({ label, sortKey, currentKey, dir, onToggle, bold }: {
  label: string; sortKey: SortKey; currentKey: SortKey; dir: SortDir
  onToggle: (k: SortKey) => void; bold?: boolean
}) {
  return (
    <th
      className="text-center font-medium py-2.5 w-14 cursor-pointer select-none"
      onClick={() => onToggle(sortKey)}
    >
      <div className="flex items-center justify-center gap-0.5">
        <span className={cn(bold && "font-bold")}>{label}</span>
        <SortIcon active={currentKey === sortKey} dir={dir} />
      </div>
    </th>
  )
}
