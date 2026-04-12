import type { Metadata } from "next"
import { SiteHeader } from "@/components/site-header"
import { TeamPageContent } from "@/components/team-page-content"
import { fetchTeamDetail } from "@/lib/fetch-team-detail"
import { notFound } from "next/navigation"

export const revalidate = 60

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ season?: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const { season } = await searchParams
  const team = await fetchTeamDetail(slug, season)
  if (!team) return { title: "Team Not Found" }

  const r = team.record
  const description = r.gp > 0
    ? `${team.name} | ${r.w + r.otw}W-${r.l + r.otl}L, ${r.pts} PTS, Rank #${r.rank}/${r.totalTeams}`
    : `${team.name} | BASH team roster, schedule, and stats`

  return { title: team.name, description }
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ season?: string }>
}) {
  const { slug } = await params
  const { season } = await searchParams
  const team = await fetchTeamDetail(slug, season)

  if (!team) notFound()

  return (
    <div className="flex flex-1 flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <TeamPageContent team={team} />
      </main>
    </div>
  )
}
