// ⚠️ SYNC: This page mirrors app/game/[id]/page.tsx
// When updating roster fetching or data passing logic here, update the public page too.
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { sql } from "drizzle-orm"
import { rawSql } from "@/lib/db"
import { fetchGameDetail } from "@/lib/fetch-game-detail"
import { fetchLiveGameData } from "@/lib/fetch-live-game"
import { GamePageContent } from "@/components/game-page-content"
import type { RosterPlayer } from "@/lib/scorekeeper-types"

async function getRoster(teamSlug: string, seasonId: string, gameType: string, gameId: string, teamSide: 'home' | 'away'): Promise<RosterPlayer[]> {
  if (gameType === 'exhibition' || gameType === 'tryout') {
    const rows = await rawSql(sql`
      SELECT p.id, p.name
      FROM adhoc_game_rosters ar
      JOIN players p ON ar.player_id = p.id
      WHERE ar.game_id = ${gameId} AND ar.team_side = ${teamSide}
      ORDER BY p.name ASC
    `)
    return rows.map((r) => ({ id: r.id, name: r.name }))
  }

  const rows = await rawSql(sql`
    SELECT p.id, p.name
    FROM (
      SELECT ps.player_id
      FROM player_seasons ps
      WHERE ps.season_id = ${seasonId}
        AND ps.team_slug = ${teamSlug}
        AND NOT EXISTS (
          SELECT 1 FROM player_game_stats pgs
          WHERE pgs.game_id = ${gameId}
            AND pgs.player_id = ps.player_id
            AND pgs.team_slug IS NOT NULL
            AND pgs.team_slug <> ${teamSlug}
        )
        AND NOT EXISTS (
          SELECT 1 FROM goalie_game_stats ggs
          WHERE ggs.game_id = ${gameId}
            AND ggs.player_id = ps.player_id
            AND ggs.team_slug IS NOT NULL
            AND ggs.team_slug <> ${teamSlug}
        )
      UNION
      SELECT pgs.player_id
      FROM player_game_stats pgs
      WHERE pgs.game_id = ${gameId} AND pgs.team_slug = ${teamSlug}
      UNION
      SELECT ggs.player_id
      FROM goalie_game_stats ggs
      WHERE ggs.game_id = ${gameId} AND ggs.team_slug = ${teamSlug}
    ) r
    JOIN players p ON p.id = r.player_id
    ORDER BY p.name ASC
  `)
  return rows.map((r) => ({ id: r.id, name: r.name }))
}

export default async function AdminGameEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [detail, liveData] = await Promise.all([
    fetchGameDetail(id),
    fetchLiveGameData(id).catch(() => null),
  ])
  if (!detail) notFound()

  let homeRoster: RosterPlayer[] | undefined
  let awayRoster: RosterPlayer[] | undefined
  let seasonId: string | undefined

  // Fetch rosters for all games (upcoming, live, or final)
  // ⚠️ SYNC: Keep roster logic in sync with app/game/[id]/page.tsx
  const gameRows = await rawSql(sql`SELECT season_id FROM games WHERE id = ${id}`)
  if (gameRows.length > 0) {
    seasonId = gameRows[0].season_id
    const [hr, ar] = await Promise.all([
      getRoster(detail.homeSlug, seasonId!, detail.gameType, id, 'home'),
      getRoster(detail.awaySlug, seasonId!, detail.gameType, id, 'away'),
    ])
    homeRoster = hr
    awayRoster = ar
  }

  const backHref = seasonId ? `/admin/seasons/${seasonId}` : "/admin/seasons"

  return (
    <div className="space-y-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to schedule
      </Link>
      <GamePageContent
        initialDetail={detail}
        initialLiveData={liveData}
        homeRoster={homeRoster}
        awayRoster={awayRoster}
        forceEdit
      />
    </div>
  )
}
