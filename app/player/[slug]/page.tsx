import type { Metadata } from "next"
import { SiteHeader } from "@/components/site-header"
import { PlayerPageContent } from "@/components/player-page-content"
import { fetchPlayerDetail } from "@/lib/fetch-player-detail"
import { notFound } from "next/navigation"

export const revalidate = 60

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const player = await fetchPlayerDetail(slug)
  if (!player) return { title: "Player Not Found" }

  const description = player.seasonStats
    ? `${player.name} - ${player.team} | ${player.seasonStats.gp} GP, ${player.seasonStats.goals} G, ${player.seasonStats.assists} A, ${player.seasonStats.points} PTS`
    : `${player.name} - ${player.team} | BASH player stats and game log`

  return { title: player.name, description }
}

export default async function PlayerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const player = await fetchPlayerDetail(slug)

  if (!player) notFound()

  return (
    <div className="flex flex-1 flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <PlayerPageContent player={player} />
      </main>
    </div>
  )
}
