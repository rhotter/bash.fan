import type { Metadata } from "next"
import { FantasyAdmin } from "@/components/admin/fantasy-admin"
import { FantasyScopeBar } from "@/components/admin/fantasy-scope-bar"
import { DEFAULT_CONTEST, listContestKeys, parseContest } from "@/lib/fantasy/season"
import { contestLabel } from "@/lib/fantasy/view-state"
import { getAllSeasons, getCurrentSeason } from "@/lib/seasons"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Fantasy" }

export default async function AdminFantasyPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; contest?: string; type?: string }>
}) {
  const params = await searchParams
  const [seasons, current] = await Promise.all([getAllSeasons(), getCurrentSeason()])
  const season = seasons.find((s) => s.id === params.season) ?? current
  const contests = await listContestKeys(season.id)
  // With no run named: `regular` if it's on, otherwise the latest run, so a season of named runs doesn't open on an empty one.
  const fallback = contests.includes(DEFAULT_CONTEST) ? DEFAULT_CONTEST : (contests.at(-1) ?? DEFAULT_CONTEST)
  const contest = parseContest(params.contest) ?? fallback

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Fantasy</h1>
        <p className="text-sm text-muted-foreground">
          {season.name} · {contestLabel(contest)}
        </p>
      </div>
      <FantasyScopeBar
        seasons={seasons.map(({ id, name }) => ({ id, name }))}
        seasonId={season.id}
        contest={contest}
        contests={contests}
      />
      <FantasyAdmin key={`${season.id}/${contest}`} seasonId={season.id} contest={contest} type={params.type} />
    </div>
  )
}
