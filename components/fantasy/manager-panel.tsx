"use client"

import { LineupFormPanel } from "@/components/fantasy/lineup-form"
import { PredictionsFormPanel } from "@/components/fantasy/predictions-form"
import { ManagerHistory } from "@/components/fantasy/manager-history"
import { WeekOverviewPanel } from "@/components/fantasy/week-overview"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { LineupForm } from "@/lib/fantasy/lineups"

/** The Manager Link page body: the shared Week overview, then one tab per task. */
export function ManagerPanel({ form, token }: { form: LineupForm; token: string }) {
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
