import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"

export interface LiveGameData {
  state: unknown
  homeScore: number | null
  awayScore: number | null
  status: string
  homeSlug: string
  awaySlug: string
  homeTeam: string
  awayTeam: string
  updatedAt: string
  playerNames: Record<number, string>
  goalieIds: number[]
}

export async function fetchLiveGameData(id: string): Promise<LiveGameData | null> {
  const rows = await rawSql(sql`
    SELECT gl.state, gl.updated_at,
      g.home_score, g.away_score, g.status,
      g.home_team, g.away_team,
      COALESCE(ht.name, g.home_team) as home_team_name, COALESCE(awt.name, g.away_team) as away_team_name
    FROM game_live gl
    JOIN games g ON gl.game_id = g.id
    LEFT JOIN teams ht ON g.home_team = ht.slug
    LEFT JOIN teams awt ON g.away_team = awt.slug
    WHERE gl.game_id = ${id}
  `)

  if (rows.length === 0) return null

  const row = rows[0]
  const state = row.state as { homeAttendance?: number[]; awayAttendance?: number[]; goals?: { scorerId: number; assist1Id: number | null; assist2Id: number | null }[]; penalties?: { playerId: number }[] }

  // Collect all player IDs referenced in the state
  const playerIds = new Set<number>()
  for (const pid of state.homeAttendance ?? []) playerIds.add(pid)
  for (const pid of state.awayAttendance ?? []) playerIds.add(pid)
  for (const g of state.goals ?? []) {
    playerIds.add(g.scorerId)
    if (g.assist1Id) playerIds.add(g.assist1Id)
    if (g.assist2Id) playerIds.add(g.assist2Id)
  }
  for (const p of state.penalties ?? []) playerIds.add(p.playerId)

  const playerNames: Record<number, string> = {}
  const goalieIds: number[] = []
  if (playerIds.size > 0) {
    const ids = [...playerIds]
    const playerResult = await rawSql(sql`SELECT id, name FROM players WHERE id IN ${ids}`)
    for (const r of playerResult) {
      playerNames[r.id] = r.name
    }

    // Read goalie IDs from state
    const stateObj = row.state as { homeGoalieId?: number | null; awayGoalieId?: number | null }
    if (stateObj.homeGoalieId != null) goalieIds.push(stateObj.homeGoalieId)
    if (stateObj.awayGoalieId != null) goalieIds.push(stateObj.awayGoalieId)
  }

  return {
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
  }
}
