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
      g.home_team, g.away_team, g.is_playoff, g.is_forfeit, g.game_type,
      COALESCE(ht.name, g.home_team) as home_team_name, COALESCE(awt.name, g.away_team) as away_team_name,
      s.game_length
    FROM games g
    LEFT JOIN teams ht ON g.home_team = ht.slug
    LEFT JOIN teams awt ON g.away_team = awt.slug
    LEFT JOIN seasons s ON g.season_id = s.id
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

  // Get rosters — exhibition/tryout games use adhoc_game_rosters as source of truth;
  // regular games use player_seasons, plus any adhoc overlay (subs for this game).
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
      SELECT p.id, p.name FROM player_seasons ps
      JOIN players p ON ps.player_id = p.id
      WHERE ps.season_id = ${seasonId} AND ps.team_slug = ${teamSlug}
      UNION
      SELECT p.id, p.name FROM adhoc_game_rosters agr
      JOIN players p ON agr.player_id = p.id
      WHERE agr.game_id = ${id} AND agr.team_side = ${teamSide}
      ORDER BY name ASC
    `)
    return rows.map((r) => ({ id: r.id, name: r.name }))
  }

  const [homeRoster, awayRoster, adhocSubs] = await Promise.all([
    getRoster(game.home_team, game.season_id, 'home'),
    getRoster(game.away_team, game.season_id, 'away'),
    rawSql(sql`
      SELECT player_id FROM adhoc_game_rosters
      WHERE game_id = ${id} AND is_sub = true
    `),
  ])
  const initialSubPlayerIds: number[] = adhocSubs.map((r) => r.player_id)

  // Check if there's existing live state
  const liveRows = await rawSql(sql`
    SELECT state FROM game_live WHERE game_id = ${id}
  `)

  const defaultPeriodLength = Math.round(((game.game_length || 60) / 3) * 60)

  return (
    <>
    <SiteHeader />
    <ScorekeeperApp
      gameId={id}
      date={game.date}
      time={game.time}
      status={game.status}
      isPlayoff={!!game.is_playoff}
      isForfeit={!!game.is_forfeit}
      gameType={game.game_type || "regular"}
      homeSlug={game.home_team}
      awaySlug={game.away_team}
      homeTeam={game.home_team_name}
      awayTeam={game.away_team_name}
      homeRoster={homeRoster}
      awayRoster={awayRoster}
      initialSubPlayerIds={initialSubPlayerIds}
      existingState={liveRows.length > 0 ? liveRows[0].state : null}
      initialAuthenticated={await getSession()}
      defaultPeriodLength={defaultPeriodLength}
    />
    </>
  )
}
