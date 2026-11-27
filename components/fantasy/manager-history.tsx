import { ChevronDown } from "lucide-react"
import { Predictions } from "@/components/fantasy/standings"
import { LineupStats } from "@/components/fantasy/standings-table"
import { ProvisionalBadge } from "@/components/fantasy/week-row"
import { weekLabel } from "@/lib/fantasy/week"
import type { LineupForm } from "@/lib/fantasy/lineups"

/** The Weeks as a table in the standings' style, with the same column widths in the heading and every row. */
function HistoryTable({ columns, children }: { columns: string[]; children: React.ReactNode }) {
  return (
    <div className="border-t-2 border-foreground">
      <div aria-hidden className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-xs text-muted-foreground">
        <span className="flex-1">Week</span>
        {columns.map((column) => (
          <span key={column} className="w-16 text-right">{column}</span>
        ))}
        <span className="w-4" />
      </div>
      <ol>{children}</ol>
    </div>
  )
}

function HistoryRow({
  weekId,
  provisional,
  figures,
  children,
}: {
  weekId: string
  provisional: boolean
  /** One for each column, the first being the score. The label is what a screen reader hears after it. */
  figures: { label: string; value: number }[]
  /** The details, shown when the row is opened. */
  children: React.ReactNode
}) {
  return (
    <li className="border-b border-border has-[>details[open]]:bg-muted/60">
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-2.5 text-sm tabular-nums hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 font-semibold">
            Week of {weekLabel(weekId)}
            {provisional && <ProvisionalBadge />}
          </span>
          {figures.map(({ label, value }, index) => (
            <span key={label} className={index === 0 ? "w-16 text-right text-base font-bold" : "w-16 text-right text-muted-foreground"}>
              {value}
              <span className="sr-only"> {label}</span>
            </span>
          ))}
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform [details[open]>summary_&]:rotate-180" />
        </summary>
        <div className="px-2 pb-4 pt-1 sm:px-4">{children}</div>
      </details>
    </li>
  )
}

function SectionHeading({ title, total }: { title: string; total: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="text-sm text-muted-foreground">{total}</p>
    </div>
  )
}

export function PickemHistory({ pickem }: { pickem: LineupForm["pickemHistory"] }) {
  return (
    <section className="mt-8 space-y-3">
      <SectionHeading title="Pick'em" total={`Season: ${pickem.correct} correct, ${pickem.goalError} goals off`} />
      {pickem.weeks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Their Predictions show here once each Week closes.
        </p>
      ) : (
        <HistoryTable columns={["Correct", "Goals off"]}>
          {[...pickem.weeks].reverse().map((week) => (
            <HistoryRow
              key={week.id}
              weekId={week.id}
              provisional={week.provisional}
              figures={[
                { label: "correct", value: week.correct },
                { label: "goals off", value: week.goalError },
              ]}
            >
              <Predictions row={week} games={week.games} />
            </HistoryRow>
          ))}
        </HistoryTable>
      )}
    </section>
  )
}

export function ManagerHistory({ history, pickem }: { history: LineupForm["history"]; pickem: LineupForm["pickemHistory"] }) {
  return (
    <>
      <LineupHistory history={history} />
      <PickemHistory pickem={pickem} />
    </>
  )
}

function LineupHistory({ history }: { history: LineupForm["history"] }) {
  return (
    <section className="mt-6 space-y-3">
      <SectionHeading title="Fantasy" total={`Season total: ${history.points}`} />
      {history.weeks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Their Lineups show here once each Week closes.</p>
      ) : (
        <HistoryTable columns={["Pts"]}>
          {[...history.weeks].reverse().map((week) => (
            <HistoryRow
              key={week.id}
              weekId={week.id}
              provisional={week.provisional}
              figures={[{ label: "points", value: week.points }]}
            >
              <LineupStats selections={week.selections} />
            </HistoryRow>
          ))}
        </HistoryTable>
      )}
    </section>
  )
}
