import { IntentLink } from "@/components/intent-link"
import { Badge } from "@/components/ui/badge"
import { weekLabel } from "@/lib/fantasy/week"
import { cn } from "@/lib/utils"
import type { FantasyOverview } from "@/lib/fetch-fantasy"

type OverviewManager = FantasyOverview["managers"][number]

export function UsageList({ uses }: { uses: OverviewManager["uses"] }) {
  if (uses.length === 0) return <p className="text-sm text-muted-foreground">No uses yet.</p>
  return (
    <ul className="flex flex-wrap gap-1.5">
      {uses.map((use) => (
        <li key={`${use.kind}-${use.playerId}`}>
          <Badge variant={use.cap !== null && use.used > use.cap ? "destructive" : use.used === use.cap ? "default" : "outline"}>
            {use.playerName} ({use.kind}) {use.used}/{use.cap ?? "∞"}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

export function FantasyOverviewPanel({ overview }: { overview: FantasyOverview }) {
  const { weeks, managers } = overview
  const cell = "whitespace-nowrap px-3 py-2 text-right tabular-nums"

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Overview</h2>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className={cell}>#</th>
              <th className="px-3 py-2 text-left">Team</th>
              {weeks.map((week) => (
                <th key={week.id} className={cell}>
                  {weekLabel(week.id)}
                  {week.provisional && " *"}
                </th>
              ))}
              <th className={cell}>Total</th>
              <th className={cell}>Open Week</th>
              <th className={cell}>Top use</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {managers.map((manager) => {
              const top = manager.uses[0]
              const overCap = top?.cap != null && top.used > top.cap
              return (
                <tr key={manager.managerId}>
                  <td className={cell}>{manager.rank}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    <IntentLink href={`/admin/fantasy/managers/${manager.managerId}`} className="underline-offset-2 hover:underline">
                      {manager.teamName}
                    </IntentLink>
                  </td>
                  {weeks.map((week) => {
                    const entry = manager.weeks.find((w) => w.id === week.id)
                    return (
                      <td key={week.id} className={cn(cell, !entry && "text-muted-foreground")}>
                        {entry?.points ?? "–"}
                      </td>
                    )
                  })}
                  <td className={cn(cell, "font-semibold")}>{manager.points}</td>
                  <td className={cell}>{manager.openWeekSubmitted ? "In" : "–"}</td>
                  <td className={cn(cell, overCap && "text-destructive")}>
                    {top ? `${top.used}/${top.cap ?? "∞"}` : "–"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">* Provisional: a game in this Week isn&apos;t scored yet. Click a team for its breakdown.</p>
    </section>
  )
}
