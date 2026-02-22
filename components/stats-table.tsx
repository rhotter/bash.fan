import { useState, useCallback } from "react"
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
    ? <ChevronDown className="h-2.5 w-2.5 text-primary" />
    : <ChevronUp className="h-2.5 w-2.5 text-primary" />
}

// ─── SortableTh ──────────────────────────────────────────────────────────────

export function SortableTh<K extends string>({ label, sortKey, currentKey, dir, onToggle, bold, className }: {
  label: string
  sortKey: K
  currentKey: K
  dir: SortDir
  onToggle: (k: K) => void
  bold?: boolean
  className?: string
}) {
  return (
    <th
      className={cn("text-center font-medium py-2.5 w-10 cursor-pointer select-none", className)}
      onClick={() => onToggle(sortKey)}
    >
      <div className="flex items-center justify-center gap-0.5">
        <span className={cn(bold && "font-bold")}>{label}</span>
        <SortIcon active={currentKey === sortKey} dir={dir} />
      </div>
    </th>
  )
}

// ─── Row striping ────────────────────────────────────────────────────────────

export function statsRowClass(i: number) {
  return cn(
    "border-t border-border/20 hover:bg-muted/50 transition-colors",
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
