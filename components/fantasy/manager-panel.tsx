"use client"

import { useRouter } from "next/navigation"
import { useCallback, useRef, type MouseEvent } from "react"
import { LineupFormPanel } from "@/components/fantasy/lineup-form"
import { PredictionsFormPanel } from "@/components/fantasy/predictions-form"
import { Predictions } from "@/components/fantasy/standings"
import { LineupStats } from "@/components/fantasy/standings-table"
import { WeekOverviewPanel } from "@/components/fantasy/week-overview"
import { ProvisionalBadge, WEEK_NAV_CLASS } from "@/components/fantasy/week-row"
import { IntentLink } from "@/components/intent-link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { weekLabel } from "@/lib/fantasy/week"
import { cn } from "@/lib/utils"
import type { LineupForm } from "@/lib/fantasy/lineups"

/** The Manager Link page body: the shared Week overview, then one tab per task. */
export function ManagerPanel({ form, token, managerId }: { form: LineupForm; token: string; managerId: number }) {
  const router = useRouter()
  const unsaved = useRef(false)
  const setUnsaved = useCallback((dirty: boolean) => {
    unsaved.current = dirty
  }, [])
  // Other Weeks' pages may be cached from before this save, and a save changes their uses left.
  const onSaved = () => router.refresh()

  function confirmLeave(event: MouseEvent) {
    if (unsaved.current && !window.confirm("Discard your unsaved changes?")) event.preventDefault()
  }

  // Weeks run oldest first, so late in a season the chosen one would start out of sight.
  const showChosen = useCallback((strip: HTMLElement | null) => {
    const chosen = strip?.querySelector<HTMLElement>("[aria-current=page]")
    // Centered, so Weeks on both sides of it show.
    if (strip && chosen) strip.scrollLeft = chosen.offsetLeft + (chosen.offsetWidth - strip.clientWidth) / 2
  }, [])

  const lineup = form.history.weeks.find(({ id }) => id === form.week.id)
  const picks = form.pickemHistory.weeks.find(({ id }) => id === form.week.id)

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <p>
          Season: <span className="font-semibold">{form.history.points}</span> Fantasy points. Pick&apos;em:{" "}
          <span className="font-semibold">{form.pickemHistory.correct}</span> correct, {form.pickemHistory.goalError} goals off.
        </p>
        <IntentLink href={`/fantasy/manager/${managerId}`} onClick={confirmLeave} className="underline">
          Season results
        </IntentLink>
      </div>
      {(form.status === "final-week" || form.status === "ended") && (
        <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm">
          {form.status === "ended"
            ? "This run has ended, so there are no more picks to make."
            : "Picks are closed: the last Week is being played."}
        </p>
      )}
      {form.weekIds.length > 1 && (
        <nav ref={showChosen} aria-label="Weeks" className={cn(WEEK_NAV_CLASS, "relative")}>
          {form.weekIds.map((id) => (
            <IntentLink
              key={id}
              href={`/fantasy/m/${token}?week=${id}`}
              scroll={false}
              onClick={id === form.week.id ? undefined : confirmLeave}
              aria-current={id === form.week.id ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-xs font-semibold transition-colors",
                id === form.week.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {weekLabel(id)}
            </IntentLink>
          ))}
        </nav>
      )}
      {!form.noGames && <h2 className="text-lg font-semibold">Week of {weekLabel(form.week.id)}</h2>}
      <Tabs defaultValue="lineup">
        <TabsList>
          <TabsTrigger value="lineup">Lineup</TabsTrigger>
          <TabsTrigger value="predictions">Predictions</TabsTrigger>
        </TabsList>
        <TabsContent value="lineup">
          {/* Only here: Predictions list the same games themselves. */}
          <div className="mt-4">
            <WeekOverviewPanel overview={form.overview} />
          </div>
          {form.closed ? (
            lineup ? (
              <ClosedPicks total={`${lineup.points} points`} provisional={lineup.provisional}>
                <LineupStats selections={lineup.selections} />
              </ClosedPicks>
            ) : (
              <p className="mt-6 text-sm text-muted-foreground">You didn&apos;t save a Lineup for this Week.</p>
            )
          ) : form.noGames ? (
            <p className="mt-6 text-sm text-muted-foreground">The Lineup form opens once games are scheduled.</p>
          ) : (
            // Keyed by Week, so one Week's picks never carry into another.
            <LineupFormPanel key={form.week.id} form={form} token={token} onSaved={onSaved} onDirtyChange={setUnsaved} />
          )}
        </TabsContent>
        <TabsContent value="predictions">
          {form.closed ? (
            picks ? (
              <ClosedPicks total={`${picks.correct} correct, ${picks.goalError} ${picks.goalError === 1 ? "goal" : "goals"} off`} provisional={picks.provisional}>
                <Predictions row={picks} games={picks.games} />
              </ClosedPicks>
            ) : (
              <p className="mt-6 text-sm text-muted-foreground">You made no Predictions for this Week.</p>
            )
          ) : form.noGames ? (
            <p className="mt-6 text-sm text-muted-foreground">Predictions open once games are scheduled.</p>
          ) : (
            <PredictionsFormPanel
              key={form.week.id}
              overview={form.overview}
              saved={form.predictions}
              week={form.week}
              token={token}
              onSaved={onSaved}
              onDirtyChange={setUnsaved}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** A closed Week's picks, under their result. */
function ClosedPicks({ total, provisional, children }: { total: string; provisional: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-6 space-y-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        {total}
        {provisional && <ProvisionalBadge />}
      </p>
      {children}
    </div>
  )
}
