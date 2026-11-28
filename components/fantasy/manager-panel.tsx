"use client"

import { LineupFormPanel } from "@/components/fantasy/lineup-form"
import { PredictionsFormPanel } from "@/components/fantasy/predictions-form"
import { ManagerHistory } from "@/components/fantasy/manager-history"
import { WeekOverviewPanel } from "@/components/fantasy/week-overview"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { instantLabel } from "@/lib/fantasy/view-state"
import type { LineupForm } from "@/lib/fantasy/lineups"

/** The Manager Link page body: the shared Week overview, then one tab per task. */
export function ManagerPanel({ form, token }: { form: LineupForm; token: string }) {
  if (form.status === "upcoming" && form.picksOpenAt) {
    return (
      <p role="status" className="mt-6 rounded-md border border-border bg-muted p-3 text-sm">
        You&apos;re in. This run hasn&apos;t started yet: your picks open {instantLabel(form.picksOpenAt, form.week.timeZone)}.
        Come back with this link then.
      </p>
    )
  }
  // With nothing left to pick, only the History is useful.
  if (form.status !== "active") {
    return (
      <div className="mt-6 space-y-2">
        <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm">
          {form.status === "ended"
            ? "This run has ended, so there are no more picks to make."
            : "Picks are closed: the last Week is being played."}
        </p>
        <ManagerHistory history={form.history} pickem={form.pickemHistory} />
      </div>
    )
  }
  return (
    <div className="mt-6 space-y-6">
      <WeekOverviewPanel overview={form.overview} />
      <Tabs defaultValue="lineup">
        <TabsList>
          <TabsTrigger value="lineup">Lineup</TabsTrigger>
          <TabsTrigger value="predictions">Predictions</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="lineup">
          {form.noGames ? (
            <p className="mt-6 text-sm text-muted-foreground">The Lineup form opens once this Week has games.</p>
          ) : (
            <LineupFormPanel form={form} token={token} />
          )}
        </TabsContent>
        <TabsContent value="predictions">
          {form.noGames ? (
            <p className="mt-6 text-sm text-muted-foreground">Predictions open once this Week has games.</p>
          ) : (
            <PredictionsFormPanel overview={form.overview} saved={form.predictions} week={form.week} token={token} />
          )}
        </TabsContent>
        <TabsContent value="history">
          <ManagerHistory history={form.history} pickem={form.pickemHistory} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
