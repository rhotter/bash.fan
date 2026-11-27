import { IntentLink } from "@/components/intent-link"
import { Button } from "@/components/ui/button"
import type { OpenContest } from "@/lib/fantasy/season"
import { contestLabel, instantLabel } from "@/lib/fantasy/view-state"
import { cn } from "@/lib/utils"

/** The other contests people can join, so an upcoming one isn't missed while another is running. */
export function OpenContestList({ contests, className }: { contests: OpenContest[]; className?: string }) {
  if (contests.length === 0) return null
  return (
    <ul aria-label="Other contests open to join" className={cn("space-y-2", className)}>
      {contests.map(({ contest, picksOpenAt, timeZone }) => {
        const name = contestLabel(contest)
        return (
          <li key={contest} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
            <p>
              <span className="font-semibold">{name}</span> is open to join.
              {picksOpenAt && ` Picks open ${instantLabel(picksOpenAt, timeZone)}.`}
            </p>
            <Button asChild size="sm" variant="outline">
              <IntentLink href={`/fantasy/register?contest=${encodeURIComponent(contest)}`} prefetch={false}>
                Join {name}
              </IntentLink>
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
