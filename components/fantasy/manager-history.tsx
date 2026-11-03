import { BoxScore, Predictions } from "@/components/fantasy/standings"
import { WeekRow } from "@/components/fantasy/week-row"
import type { LineupForm } from "@/lib/fantasy/lineups"

/** `own` is the Manager Link page, which speaks to the Manager. The public page speaks about them. */
export function PickemHistory({ pickem, own }: { pickem: LineupForm["pickemHistory"]; own: boolean }) {
  return (
    <section className="mt-8 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Pick'em</h2>
        <p className="text-sm text-muted-foreground">
          Season: {pickem.correct} correct, {pickem.goalError} goals off
        </p>
      </div>
      {pickem.weeks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {own ? "Your" : "Their"} Predictions show here once each Week closes.
        </p>
      ) : (
        <ul className="space-y-2">
          {[...pickem.weeks].reverse().map((week) => (
            <li key={week.id}>
              <WeekRow weekId={week.id} provisional={week.provisional} score={week.correct} note={`${week.goalError} goals off`}>
                <div className="pt-3">
                  <Predictions row={week} games={week.games} />
                </div>
              </WeekRow>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ManagerHistory({
  history,
  pickem,
  own = true,
}: {
  history: LineupForm["history"]
  pickem: LineupForm["pickemHistory"]
  own?: boolean
}) {
  return (
    <>
      <LineupHistory history={history} own={own} />
      <PickemHistory pickem={pickem} own={own} />
    </>
  )
}

function LineupHistory({ history, own }: { history: LineupForm["history"]; own: boolean }) {
  return (
    <section className="mt-6 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Previous Weeks</h2>
        <p className="text-sm text-muted-foreground">Season total: {history.points}</p>
      </div>
      {history.weeks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{own ? "Your" : "Their"} Lineups show here once each Week closes.</p>
      ) : (
        <ul className="space-y-2">
          {[...history.weeks].reverse().map((week) => (
            <li key={week.id}>
              <WeekRow weekId={week.id} provisional={week.provisional} score={week.points}>
                <BoxScore selections={week.selections} provisional={week.provisional} />
              </WeekRow>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
