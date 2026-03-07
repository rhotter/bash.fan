import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const rows = await sql`
      SELECT gl.state, gl.updated_at,
        g.home_score, g.away_score, g.status,
        g.home_team, g.away_team,
        ht.name as home_team_name, awt.name as away_team_name
      FROM game_live gl
      JOIN games g ON gl.game_id = g.id
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE gl.game_id = ${id}
    `

    if (rows.length === 0) {
      return NextResponse.json({ error: "No live data" }, { status: 404 })
    }

    const row = rows[0]
    const state = row.state as { homeAttendance?: number[]; awayAttendance?: number[]; goals?: { scorerId: number; assist1Id: number | null; assist2Id: number | null }[]; penalties?: { playerId: number }[] }

    // Collect all player IDs referenced in the state
    const playerIds = new Set<number>()
    for (const id of state.homeAttendance ?? []) playerIds.add(id)
    for (const id of state.awayAttendance ?? []) playerIds.add(id)
    for (const g of state.goals ?? []) {
      playerIds.add(g.scorerId)
      if (g.assist1Id) playerIds.add(g.assist1Id)
      if (g.assist2Id) playerIds.add(g.assist2Id)
    }
    for (const p of state.penalties ?? []) playerIds.add(p.playerId)

    // Look up player names and goalie status
    let playerNames: Record<number, string> = {}
    let goalieIds: number[] = []
    if (playerIds.size > 0) {
      const ids = [...playerIds]
      const playerRows = await sql`SELECT id, name FROM players WHERE id = ANY(${ids})`
      for (const r of playerRows) {
        playerNames[r.id as number] = r.name as string
      }

      const goalieRows = await sql`
        SELECT DISTINCT player_id FROM player_seasons
        WHERE player_id = ANY(${ids}) AND is_goalie = true
      `
      goalieIds = goalieRows.map((r) => r.player_id as number)
    }

    return NextResponse.json({
      state: row.state,
      homeScore: row.home_score,
      awayScore: row.away_score,
      status: row.status,
      homeSlug: row.home_team,
      awaySlug: row.away_team,
      homeTeam: row.home_team_name,
      awayTeam: row.away_team_name,
      updatedAt: row.updated_at,
      playerNames,
      goalieIds,
    }, {
      headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" },
    })
  } catch (error) {
    console.error("Failed to fetch live game:", error)
    return NextResponse.json({ error: "Failed to fetch live data" }, { status: 500 })
  }
}
