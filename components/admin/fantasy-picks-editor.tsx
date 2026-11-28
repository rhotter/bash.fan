"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { LineupFormPanel } from "@/components/fantasy/lineup-form"
import { PredictionsFormPanel } from "@/components/fantasy/predictions-form"
import { useUnsavedPicks } from "@/components/fantasy/use-unsaved-picks"
import { WeekOverviewPanel } from "@/components/fantasy/week-overview"
import { WEEK_NAV_CLASS } from "@/components/fantasy/week-row"
import { IntentLink } from "@/components/intent-link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { weekLabel } from "@/lib/fantasy/week"
import type { loadAdminPicks } from "@/lib/fantasy/lineups"
import { cn } from "@/lib/utils"

type AdminPicks = NonNullable<Awaited<ReturnType<typeof loadAdminPicks>>>

/** Admin-only: view and enter one Manager's picks for any Week. */
export function FantasyPicksEditor({ picks, adminUrl, pageHref }: { picks: AdminPicks; adminUrl: string; pageHref: string }) {
  const router = useRouter()
  const { form, weekIds, openWeekId, closed } = picks
  const { setLineupDirty, setPredictionsDirty, confirmLeave } = useUnsavedPicks()
  // The page's points, history and uses are rendered on the server, so reload them after a save.
  const onSaved = () => {
    toast.success("Picks saved.")
    router.refresh()
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Edit picks</h2>
      <nav aria-label="Weeks to edit" className={WEEK_NAV_CLASS}>
        {weekIds.map((id) => (
          <IntentLink
            key={id}
            href={`${pageHref}?week=${id}`}
            scroll={false}
            onClick={id === form.week.id ? undefined : confirmLeave}
            aria-current={id === form.week.id ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-xs font-semibold transition-colors",
              id === form.week.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {weekLabel(id)}
            {id >= openWeekId && " (open)"}
          </IntentLink>
        ))}
      </nav>
      <p role="note" className="rounded-md border border-border bg-muted p-3 text-sm">
        {closed
          ? "This Week has closed. Saving here changes picks after the deadline and updates the standings straight away."
          : "This Week is still open. These picks aren't public yet, and the Manager can still change them."}
      </p>
      {form.noGames ? (
        <p className="text-sm text-muted-foreground">This Week has no games to pick.</p>
      ) : (
        <div className="max-w-3xl space-y-4">
          {/* Keyed by Week, so one Week's unsaved boxes never carry into another. */}
          <Tabs key={form.week.id} defaultValue="lineup">
            <TabsList>
              <TabsTrigger value="lineup">Lineup</TabsTrigger>
              <TabsTrigger value="predictions">Predictions</TabsTrigger>
            </TabsList>
            {/* Both stay mounted, so switching tabs keeps what's been typed. */}
            <TabsContent value="lineup" forceMount className="data-[state=inactive]:hidden">
              <div className="mt-4">
                <WeekOverviewPanel overview={form.overview} />
              </div>
              <LineupFormPanel form={form} adminUrl={adminUrl} onSaved={onSaved} onDirtyChange={setLineupDirty} />
            </TabsContent>
            <TabsContent value="predictions" forceMount className="data-[state=inactive]:hidden">
              <PredictionsFormPanel
                onDirtyChange={setPredictionsDirty}
                overview={form.overview}
                saved={form.predictions}
                week={form.week}
                adminUrl={adminUrl}
                onSaved={onSaved}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </section>
  )
}
