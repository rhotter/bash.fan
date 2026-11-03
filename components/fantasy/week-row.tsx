import { ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { weekLabel } from "@/lib/fantasy/week"

export function ProvisionalBadge() {
  return <Badge variant="secondary">Provisional</Badge>
}

export function Chevron() {
  return <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform [details[open]>summary_&]:rotate-90" />
}

/**
 * One Week of a Manager's season: the card, the summary line and the divider before the details.
 * Lineups and Pick'em share it so their lists line up, wherever they're shown.
 */
export function WeekRow({
  weekId,
  provisional,
  score,
  note,
  children,
}: {
  weekId: string
  provisional: boolean
  score: number
  /** Smaller text beside the score, such as the Pick'em tiebreak. */
  note?: string
  /** The details, shown when the row is opened. */
  children: React.ReactNode
}) {
  return (
    <details className="rounded-xl border border-border bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 p-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 font-medium">Week of {weekLabel(weekId)}</span>
        {provisional && <ProvisionalBadge />}
        <span className="shrink-0 tabular-nums">
          <span className="text-lg font-bold">{score}</span>
          {note && <span className="ml-2 text-xs text-muted-foreground">{note}</span>}
        </span>
        <Chevron />
      </summary>
      <div className="border-t border-border">{children}</div>
    </details>
  )
}
