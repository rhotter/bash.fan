import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { OpenContestList } from "@/components/fantasy/open-contests"
import { RegistrationForm } from "@/components/fantasy/registration-form"
import { IntentLink } from "@/components/intent-link"
import { listCurrentFantasyContests, otherOpenContests, parseContest, pickRegistrationContest } from "@/lib/fantasy/season"
import { contestLabel, fantasyHref, instantLabel } from "@/lib/fantasy/view-state"
import { picksOpenAt, runStatus, takesRegistrations } from "@/lib/fantasy/week"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Join Fantasy",
  robots: { index: false, follow: false },
}

export default async function FantasyRegisterPage({ searchParams }: { searchParams: Promise<{ contest?: string }> }) {
  const { contest } = await searchParams
  const key = contest === undefined ? undefined : parseContest(contest)
  const contests = key === null ? [] : await listCurrentFantasyContests()
  const now = new Date()
  const season = key === null ? null : pickRegistrationContest(contests, key, now)
  if (!season) notFound()
  if (contests.length > 1 && contest === undefined) redirect(`/fantasy/register?contest=${season.contest}`)

  const name = contestLabel(season.contest)
  const status = runStatus(season.config, now)
  const open = takesRegistrations(status)
  const opensAt = status === "upcoming" ? picksOpenAt(season.config) : null
  const picksOpen = opensAt ? instantLabel(opensAt.toISOString(), season.config.lock.timeZone) : null
  const others = otherOpenContests(contests, season.contest, now)

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Join Fantasy</h1>
      {open ? (
        <>
          <p className="mt-3 rounded-md border border-border bg-muted p-3 text-sm">
            You&apos;re registering for the <span className="font-semibold">{name}</span> contest.
            {picksOpen && ` It hasn't started: picks open ${picksOpen}.`}
          </p>
          <OpenContestList contests={others} className="mt-3" />
          <p className="mt-3 text-sm text-muted-foreground">
            Your Team Name is public. Your real name is only seen by admins.
          </p>
          <RegistrationForm contest={season.contest} picksOpen={picksOpen} />
        </>
      ) : (
        <>
          <p role="status" className="mt-3 rounded-md border border-border bg-muted p-3 text-sm">
            Registration for the <span className="font-semibold">{name}</span> contest is closed.
            {others.length === 0 && " No other contest is open to join right now."}
          </p>
          <OpenContestList contests={others} className="mt-3" />
          <p className="mt-4 text-sm">
            <IntentLink
              href={fantasyHref({ tab: "fantasy", weekId: null, contest: contests.length > 1 ? season.contest : undefined })}
              className="font-medium underline"
            >
              View the {name} standings
            </IntentLink>
          </p>
        </>
      )}
    </main>
  )
}
