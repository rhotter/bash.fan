// ⚠️ SYNC: This page mirrors app/admin/games/[id]/edit/page.tsx
// When updating roster fetching or data passing logic here, update the admin page too.
import type { Metadata } from "next"
import { SiteHeader } from "@/components/site-header"
import { GamePageContent } from "@/components/game-page-content"
import { fetchGameDetail } from "@/lib/fetch-game-detail"
import { fetchLiveGameData } from "@/lib/fetch-live-game"
import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import Link from "next/link"
import type { RosterPlayer } from "@/lib/scorekeeper-types"

export const revalidate = 30

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const detail = await fetchGameDetail(id)
  if (!detail) return { title: "Game Not Found" }

  const score = detail.homeScore != null && detail.awayScore != null
    ? ` ${detail.homeScore}-${detail.awayScore}`
    : ""
  const title = detail.title 
    ? `${detail.title}${score}` 
    : `${detail.awayTeam} @ ${detail.homeTeam}${score}`
  const ot = detail.isOvertime ? " (OT)" : ""
  const description = detail.title
    ? `${detail.title} - ${detail.date}`
    : detail.status === "final"
      ? `Final${ot}: ${detail.awayTeam} ${detail.awayScore}, ${detail.homeTeam} ${detail.homeScore} - ${detail.date}`
      : `${detail.awayTeam} vs ${detail.homeTeam} - ${detail.date}`

  return { title, description }
}

async function getRoster(teamSlug: string, seasonId: string): Promise<RosterPlayer[]> {
  const rows = await rawSql(sql`
    SELECT p.id, p.name
    FROM player_seasons ps
    JOIN players p ON ps.player_id = p.id
    WHERE ps.season_id = ${seasonId} AND ps.team_slug = ${teamSlug}
    ORDER BY p.name ASC
  `)
  return rows.map((r) => ({ id: r.id, name: r.name }))
}

async function getAdhocRoster(gameId: string, side: "home" | "away"): Promise<RosterPlayer[]> {
  const rows = await rawSql(sql`
    SELECT p.id, p.name
    FROM adhoc_game_rosters agr
    JOIN players p ON agr.player_id = p.id
    WHERE agr.game_id = ${gameId} AND agr.team_side = ${side}
    ORDER BY p.name ASC
  `)
  return rows.map((r) => ({ id: r.id, name: r.name }))
}

const ADHOC_GAME_TYPES = ["exhibition", "tryout"]

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [detail, liveData] = await Promise.all([
    fetchGameDetail(id),
    fetchLiveGameData(id).catch(() => null),
  ])

  // Fetch rosters for all games (upcoming, live, or final)
  // ⚠️ SYNC: Keep roster logic in sync with app/admin/games/[id]/edit/page.tsx
  let homeRoster: RosterPlayer[] | undefined
  let awayRoster: RosterPlayer[] | undefined
  let seasonId: string | undefined

  if (detail) {
    const gameRows = await rawSql(sql`
      SELECT season_id, game_type FROM games WHERE id = ${id}
    `)
    if (gameRows.length > 0) {
      seasonId = gameRows[0].season_id
      const gameType = gameRows[0].game_type ?? "regular"

      if (ADHOC_GAME_TYPES.includes(gameType)) {
        // Exhibition/tryout: use per-game adhoc rosters
        const [hr, ar] = await Promise.all([
          getAdhocRoster(id, "home"),
          getAdhocRoster(id, "away"),
        ])
        homeRoster = hr
        awayRoster = ar
      } else {
        // Regular/playoff: use season rosters
        const [hr, ar] = await Promise.all([
          getRoster(detail.homeSlug, seasonId!),
          getRoster(detail.awaySlug, seasonId!),
        ])
        homeRoster = hr
        awayRoster = ar
      }
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        {!detail && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <p className="text-sm text-muted-foreground">Game not found.</p>
            <Link
              href="/"
              className="text-xs text-primary hover:text-primary/80 transition-colors underline underline-offset-4"
            >
              Back to all scores
            </Link>
          </div>
        )}
        {detail && (
          <GamePageContent
            initialDetail={detail}
            initialLiveData={liveData}
            homeRoster={homeRoster}
            awayRoster={awayRoster}
          />
        )}
      </main>
    </div>
  )
}
