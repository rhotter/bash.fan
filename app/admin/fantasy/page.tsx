import type { Metadata } from "next"
import { FantasyAdmin } from "@/components/admin/fantasy-admin"
import { FantasyScopeBar } from "@/components/admin/fantasy-scope-bar"
import { DEFAULT_CONTEST, listFantasyContests, parseContest } from "@/lib/fantasy/season"
import { getAllSeasons, getCurrentSeason } from "@/lib/seasons"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Fantasy" }

export default async function AdminFantasyPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; contest?: string }>
}) {
  const params = await searchParams
  const [seasons, current] = await Promise.all([getAllSeasons(), getCurrentSeason()])
  const season = seasons.find((s) => s.id === params.season) ?? current
  const contest = parseContest(params.contest ?? DEFAULT_CONTEST) ?? DEFAULT_CONTEST
  const contests = (await listFantasyContests(season.id)).map((c) => c.contest)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Fantasy</h1>
        <p className="text-sm text-muted-foreground">
          {season.name} · {contest}
        </p>
      </div>
      <FantasyScopeBar
        seasons={seasons.map(({ id, name }) => ({ id, name }))}
        seasonId={season.id}
        contest={contest}
        contests={contests}
      />
      <FantasyAdmin key={`${season.id}/${contest}`} seasonId={season.id} contest={contest} />
    </div>
  )
}
