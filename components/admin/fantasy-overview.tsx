import { IntentLink } from "@/components/intent-link"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { weekLabel } from "@/lib/fantasy/week"
import { cn } from "@/lib/utils"
import type { FantasyOverview } from "@/lib/fetch-fantasy"

type OverviewManager = FantasyOverview["managers"][number]

/** A Manager's registration details. Admin-only: real names must never reach a public page. */
export interface ManagerPerson {
  id: number
  firstName: string
  lastName: string
  duplicate: boolean
}

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

export function FantasyOverviewPanel({ overview, people }: { overview: FantasyOverview; people: ManagerPerson[] }) {
  const { weeks, managers } = overview
  const peopleById = new Map(people.map((person) => [person.id, person]))
  const number = "text-right tabular-nums"
  // Rank, team, first and last name, one per Week, then total, open Week and top use.
  const columns = weeks.length + 7

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Overview</h2>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={number}>#</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>First name</TableHead>
              <TableHead>Last name</TableHead>
              {weeks.map((week) => (
                <TableHead key={week.id} className={number}>
                  {weekLabel(week.id)}
                  {week.provisional && " *"}
                </TableHead>
              ))}
              <TableHead className={number}>Total</TableHead>
              <TableHead className={number}>Open Week</TableHead>
              <TableHead className={number}>Top use</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {managers.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns} className="h-24 text-center text-muted-foreground">
                  No managers registered yet.
                </TableCell>
              </TableRow>
            )}
            {managers.map((manager) => {
              const person = peopleById.get(manager.managerId)
              const top = manager.uses[0]
              const overCap = top?.cap != null && top.used > top.cap
              return (
                <TableRow key={manager.managerId}>
                  <TableCell className={number}>{manager.rank}</TableCell>
                  <TableCell className="font-medium">
                    <IntentLink href={`/admin/fantasy/managers/${manager.managerId}`} className="underline-offset-2 hover:underline">
                      {manager.teamName}
                    </IntentLink>
                  </TableCell>
                  <TableCell>{person?.firstName ?? "–"}</TableCell>
                  <TableCell>
                    {person?.lastName ?? "–"}
                    {person?.duplicate && (
                      <Badge variant="outline" className="ml-2">
                        Duplicate name
                      </Badge>
                    )}
                  </TableCell>
                  {weeks.map((week) => {
                    const entry = manager.weeks.find((w) => w.id === week.id)
                    return (
                      <TableCell key={week.id} className={cn(number, !entry && "text-muted-foreground")}>
                        {entry?.points ?? "–"}
                      </TableCell>
                    )
                  })}
                  <TableCell className={cn(number, "font-semibold")}>{manager.points}</TableCell>
                  <TableCell className={number}>{manager.openWeekSubmitted ? "In" : "–"}</TableCell>
                  <TableCell className={cn(number, overCap && "text-destructive")}>
                    {top ? `${top.used}/${top.cap ?? "∞"}` : "–"}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">* Provisional: a game in this Week isn&apos;t scored yet. Click a team for its breakdown.</p>
    </section>
  )
}
