import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getSession } from "@/lib/admin-session"
import { FantasyManagerActions } from "@/components/admin/fantasy-manager-actions"
import { UsageList } from "@/components/admin/fantasy-overview"
import { IntentLink } from "@/components/intent-link"
import { PickemHistory } from "@/components/fantasy/manager-history"
import { BoxScore } from "@/components/fantasy/standings"
import { WeekRow } from "@/components/fantasy/week-row"
import { loadPublicManager } from "@/lib/fantasy/lineups"
import { fetchFantasyOverview } from "@/lib/fetch-fantasy"
import { findManagerById, listManagers, parseManagerId } from "@/lib/fantasy/managers"
import { getFantasySeason } from "@/lib/fantasy/season"
import { getSeasonById } from "@/lib/seasons"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Fantasy team" }

export default async function AdminFantasyTeamPage({ params }: { params: Promise<{ managerId: string }> }) {
  // This page renders real names on the server, so it checks the session itself rather than relying on the layout.
  if (!(await getSession())) notFound()
  const managerId = parseManagerId((await params).managerId)
  if (managerId === null) notFound()

  // Starts from the id, so any season's team opens here, not only the current one.
  const identity = await findManagerById(managerId)
  if (!identity) notFound()
  const [season, fantasySeason] = await Promise.all([
    getSeasonById(identity.seasonId),
    getFantasySeason(identity.seasonId, identity.contest),
  ])
  if (!season || !fantasySeason) notFound()

  const [overview, managers, profile] = await Promise.all([
    fetchFantasyOverview(fantasySeason),
    listManagers(season.id, identity.contest),
    loadPublicManager(identity),
  ])
  const manager = overview.managers.find((m) => m.managerId === managerId)
  const person = managers.find((m) => m.id === managerId)
  if (!manager || !person || !profile) notFound()
  const back = `/admin/fantasy?season=${encodeURIComponent(season.id)}&contest=${encodeURIComponent(identity.contest)}`

  return (
    <div className="space-y-6">
      <div>
        <IntentLink href={back} className="text-sm text-muted-foreground hover:underline">
          Fantasy · {season.name} · {identity.contest}
        </IntentLink>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{manager.teamName}</h1>
        <p className="text-sm text-muted-foreground">
          {person.firstName} {person.lastName} · #{manager.rank} · {manager.points} points · {season.name}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Open Week Lineup: {manager.openWeekSubmitted ? "submitted" : "not submitted"} ·{" "}
          <IntentLink href={`/fantasy/manager/${manager.managerId}`} className="underline">
            Public page
          </IntentLink>
        </p>
      </div>

      <FantasyManagerActions seasonId={season.id} manager={person} backHref={back} />

      <div className="grid items-start gap-6 md:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Lineups</h2>
          {manager.weeks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No locked Weeks yet.</p>
          ) : (
            <ul className="space-y-2">
              {[...manager.weeks].reverse().map((week) => (
                <li key={week.id}>
                  <WeekRow weekId={week.id} provisional={week.provisional} score={week.points}>
                    <BoxScore selections={week.selections} provisional={week.provisional} showIdleBackups />
                  </WeekRow>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="[&>section]:mt-0">
          <PickemHistory pickem={profile.pickemHistory} own={false} />
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Uses, including any held for unscored games</h2>
        <UsageList uses={manager.uses} />
      </section>
    </div>
  )
}
