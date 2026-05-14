import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { SiteHeader } from "@/components/site-header"
import { ScorekeeperApp } from "@/components/scorekeeper/scorekeeper-app"
import type { RosterPlayer } from "@/lib/scorekeeper-types"
import { getSession } from "@/lib/admin-session"

export const dynamic = "force-dynamic"

export default async function ScorekeeperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Get game info
  const gameRows = await rawSql(sql`
    SELECT g.id, g.date, g.time, g.status, g.season_id,
      g.home_team, g.away_team, g.is_playoff, g.game_type,
      ht.name as home_team_name, awt.name as away_team_name
    FROM games g
    JOIN teams ht ON g.home_team = ht.slug
    JOIN teams awt ON g.away_team = awt.slug
    WHERE g.id = ${id}
  `)

  if (gameRows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Game not found.</p>
      </div>
    )
  }

  const game = gameRows[0]
  const isAdhocGame = game.game_type === 'exhibition' || game.game_type === 'tryout'

  // Get rosters — exhibition/tryout games use adhoc_game_rosters, others use player_seasons
  async function getRoster(teamSlug: string, seasonId: string, teamSide: 'home' | 'away'): Promise<RosterPlayer[]> {
    if (isAdhocGame) {
      const rows = await rawSql(sql`
        SELECT p.id, p.name
        FROM adhoc_game_rosters agr
        JOIN players p ON agr.player_id = p.id
        WHERE agr.game_id = ${id} AND agr.team_side = ${teamSide}
        ORDER BY p.name ASC
      `)
      return rows.map((r) => ({ id: r.id, name: r.name }))
    }
    const rows = await rawSql(sql`
      SELECT p.id, p.name
      FROM player_seasons ps
      JOIN players p ON ps.player_id = p.id
      WHERE ps.season_id = ${seasonId} AND ps.team_slug = ${teamSlug}
      ORDER BY p.name ASC
    `)
    return rows.map((r) => ({ id: r.id, name: r.name }))
  }

  const [homeRoster, awayRoster] = await Promise.all([
    getRoster(game.home_team, game.season_id, 'home'),
    getRoster(game.away_team, game.season_id, 'away'),
  ])

  // Check if there's existing live state
  const liveRows = await rawSql(sql`
    SELECT state FROM game_live WHERE game_id = ${id}
  `)

  return (
    <>
    <SiteHeader />
    <ScorekeeperApp
      gameId={id}
      date={game.date}
      time={game.time}
      status={game.status}
      isPlayoff={!!game.is_playoff}
      homeSlug={game.home_team}
      awaySlug={game.away_team}
      homeTeam={game.home_team_name}
      awayTeam={game.away_team_name}
      homeRoster={homeRoster}
      awayRoster={awayRoster}
      existingState={liveRows.length > 0 ? liveRows[0].state : null}
      initialAuthenticated={await getSession()}
    />
    </>
  )
}
