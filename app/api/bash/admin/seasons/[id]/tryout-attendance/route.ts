import { NextRequest, NextResponse } from "next/server"
import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string }>
}

// GET /api/bash/admin/seasons/[id]/tryout-attendance
// Returns players who attended at least one tryout game for this season,
// with attendance count and whether they are new (no prior player_seasons records).
export async function GET(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId } = await context.params

  try {
    // Verify this is a fall season (tryout attendance only relevant for fall)
    const seasonRows = await rawSql(sql`
      SELECT season_type FROM seasons WHERE id = ${seasonId}
    `)
    if (seasonRows.length === 0) {
      return NextResponse.json({ error: "Season not found" }, { status: 404 })
    }
    if (seasonRows[0].season_type !== "fall") {
      return NextResponse.json(
        { error: "Tryout attendance is only available for fall seasons" },
        { status: 400 }
      )
    }

    // Query: all players who appear in adhoc_game_rosters for tryout games in this season
    const rows = await rawSql(sql`
      SELECT
        p.id as player_id,
        p.name,
        COUNT(DISTINCT agr.game_id)::int as tryout_games_attended,
        CASE WHEN EXISTS (
          SELECT 1 FROM player_seasons ps
          WHERE ps.player_id = p.id AND ps.season_id != ${seasonId}
        ) THEN false ELSE true END as is_new_player
      FROM adhoc_game_rosters agr
      JOIN players p ON agr.player_id = p.id
      JOIN games g ON agr.game_id = g.id
      WHERE g.season_id = ${seasonId}
        AND g.game_type = 'tryout'
      GROUP BY p.id, p.name
      ORDER BY is_new_player DESC, tryout_games_attended DESC, p.name ASC
    `)

    return NextResponse.json({
      seasonId,
      totalTryoutGames: await rawSql(sql`
        SELECT COUNT(*)::int as count
        FROM games
        WHERE season_id = ${seasonId} AND game_type = 'tryout'
      `).then((r) => r[0]?.count ?? 0),
      players: rows.map((r) => ({
        playerId: r.player_id,
        name: r.name,
        tryoutGamesAttended: r.tryout_games_attended,
        isNewPlayer: r.is_new_player,
      })),
    })
  } catch (err) {
    console.error("Failed to fetch tryout attendance:", err)
    return NextResponse.json({ error: "Failed to fetch tryout attendance" }, { status: 500 })
  }
}
