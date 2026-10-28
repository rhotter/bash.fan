import { useState, useCallback } from "react"
import { StatLabel } from "@/components/stat-label"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronUp } from "lucide-react"

// ─── Sort types & hook ───────────────────────────────────────────────────────

export type SortDir = "asc" | "desc"

export function useSort<K extends string>(
  defaultKey: K,
  defaultDir: SortDir = "desc",
  ascKeys?: Set<K>
) {
  const [sortKey, setSortKey] = useState<K>(defaultKey)
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir)

  const toggleSort = useCallback(
    (key: K) => {
      if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"))
      else {
        setSortKey(key)
        setSortDir(ascKeys?.has(key) ? "asc" : "desc")
      }
    },
    [sortKey, ascKeys]
  )

  return { sortKey, sortDir, toggleSort } as const
}

// ─── SortIcon ────────────────────────────────────────────────────────────────

export function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/30" />
  return dir === "desc"
    ? <ChevronDown className="h-2.5 w-2.5 text-foreground" />
    : <ChevronUp className="h-2.5 w-2.5 text-foreground" />
}

// ─── SortableTh ──────────────────────────────────────────────────────────────

export function SortableTh<K extends string>({ label, sortKey, currentKey, dir, onToggle, className }: {
  label: string
  sortKey: K
  currentKey: K
  dir: SortDir
  onToggle: (k: K) => void
  className?: string
}) {
  return (
    <th
      className={cn("text-center font-medium py-2.5 w-10 cursor-pointer select-none whitespace-nowrap", className)}
      onClick={() => onToggle(sortKey)}
      scope="col"
      aria-sort={currentKey === sortKey ? (dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <StatLabel label={label}>
        <button type="button" className="flex w-full cursor-pointer items-center justify-center gap-0.5 rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
          <span className={cn(currentKey === sortKey && "font-bold text-foreground")}>{label}</span>
          <SortIcon active={currentKey === sortKey} dir={dir} />
        </button>
      </StatLabel>
    </th>
  )
}

// ─── Row striping ────────────────────────────────────────────────────────────

export function statsRowClass(i: number) {
  return cn(
    "border-t border-border/20 hover:bg-muted/50",
    i % 2 === 0 && "bg-card/15"
  )
}

// ─── SectionHeader ───────────────────────────────────────────────────────────

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground whitespace-nowrap">
        {children}
      </h4>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  )
}

// Keep numeric cell emphasis aligned with the active sort header.
export function sortedStatCellClass(key: string, currentKey: string) {
  return cn(
    "text-center tabular-nums py-2 px-3",
    key === currentKey ? "font-bold text-foreground" : "text-muted-foreground"
  )
}
