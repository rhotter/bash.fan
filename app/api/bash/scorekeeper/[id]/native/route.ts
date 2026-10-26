import { NextResponse } from "next/server"
import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { authorizeScorekeeper } from "@/lib/operator-auth"
import type { RosterPlayer } from "@/lib/scorekeeper-types"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const authError = await authorizeScorekeeper(request, id)
  if (authError) return authError
  // Get game info
  const gameRows = await rawSql(sql`
    SELECT g.id, g.date, g.time, g.status, g.season_id,
      g.home_team, g.away_team, g.is_playoff, g.game_type,
      COALESCE(ht.name, g.home_team) as home_team_name, COALESCE(awt.name, g.away_team) as away_team_name,
      s.game_length
    FROM games g
    LEFT JOIN teams ht ON g.home_team = ht.slug
    LEFT JOIN teams awt ON g.away_team = awt.slug
    LEFT JOIN seasons s ON g.season_id = s.id
    WHERE g.id = ${id}
  `)

  if (gameRows.length === 0) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
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

  return NextResponse.json({
    status: game.status, isPlayoff: !!game.is_playoff,
    periodLength: Math.round(((game.game_length || 60) / 3) * 60),
    homeRoster, awayRoster, subPlayerIds: initialSubPlayerIds,
    state: liveRows[0]?.state ?? null,
  }, { headers: { "Cache-Control": "private, no-store" } })
}
