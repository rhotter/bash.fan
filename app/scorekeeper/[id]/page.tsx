import { sql } from "@/lib/db"
import { SiteHeader } from "@/components/site-header"
import { ScorekeeperApp } from "@/components/scorekeeper/scorekeeper-app"
import type { RosterPlayer } from "@/lib/scorekeeper-types"

export const dynamic = "force-dynamic"

export default async function ScorekeeperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Get game info
  const gameRows = await sql`
    SELECT g.id, g.date, g.time, g.status, g.season_id,
      g.home_team, g.away_team,
      ht.name as home_team_name, awt.name as away_team_name
    FROM games g
    JOIN teams ht ON g.home_team = ht.slug
    JOIN teams awt ON g.away_team = awt.slug
    WHERE g.id = ${id}
  `

  if (gameRows.length === 0) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Game not found.</p>
      </div>
    )
  }

  const game = gameRows[0]

  // Get rosters for both teams from player_seasons
  async function getRoster(teamSlug: string, seasonId: string): Promise<RosterPlayer[]> {
    const rows = await sql`
      SELECT p.id, p.name, ps.is_goalie
      FROM player_seasons ps
      JOIN players p ON ps.player_id = p.id
      WHERE ps.season_id = ${seasonId} AND ps.team_slug = ${teamSlug}
      ORDER BY ps.is_goalie ASC, p.name ASC
    `
    return rows.map((r) => ({ id: r.id, name: r.name, isGoalie: r.is_goalie }))
  }

  const [homeRoster, awayRoster] = await Promise.all([
    getRoster(game.home_team, game.season_id),
    getRoster(game.away_team, game.season_id),
  ])

  // Check if there's existing live state
  const liveRows = await sql`
    SELECT state FROM game_live WHERE game_id = ${id}
  `

  return (
    <>
    <SiteHeader />
    <ScorekeeperApp
      gameId={id}
      date={game.date}
      time={game.time}
      status={game.status}
      homeSlug={game.home_team}
      awaySlug={game.away_team}
      homeTeam={game.home_team_name}
      awayTeam={game.away_team_name}
      homeRoster={homeRoster}
      awayRoster={awayRoster}
      existingState={liveRows.length > 0 ? liveRows[0].state : null}
    />
    </>
  )
}
