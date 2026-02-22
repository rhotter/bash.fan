import { sql } from "@/lib/db"
import type { BashGameDetail, PlayerBoxScore, GoalieBoxScore } from "@/app/api/bash/game/[id]/route"

export type { BashGameDetail, PlayerBoxScore, GoalieBoxScore }

export async function fetchGameDetail(id: string): Promise<BashGameDetail | null> {
  const gameRows = await sql`
    SELECT g.*,
      ht.name as home_team_name,
      awt.name as away_team_name
    FROM games g
    JOIN teams ht ON g.home_team = ht.slug
    JOIN teams awt ON g.away_team = awt.slug
    WHERE g.id = ${id}
  `

  if (gameRows.length === 0) return null

  const game = gameRows[0]

  async function getPlayerStats(gameId: string, teamSlug: string): Promise<PlayerBoxScore[]> {
    const rows = await sql`
      SELECT p.id, p.name,
        pgs.goals, pgs.assists, pgs.points,
        pgs.gwg, pgs.ppg, pgs.shg, pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
      FROM player_game_stats pgs
      JOIN players p ON pgs.player_id = p.id
      JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = '2025-2026'
      WHERE pgs.game_id = ${gameId} AND ps.team_slug = ${teamSlug}
      ORDER BY pgs.points DESC, pgs.goals DESC, p.name ASC
    `
    return rows.map((r) => ({
      id: r.id, name: r.name,
      goals: r.goals, assists: r.assists, points: r.points,
      gwg: r.gwg, ppg: r.ppg, shg: r.shg, eng: r.eng,
      hatTricks: r.hat_tricks, pen: r.pen, pim: r.pim,
    }))
  }

  async function getGoalieStats(gameId: string, teamSlug: string): Promise<GoalieBoxScore[]> {
    const rows = await sql`
      SELECT p.id, p.name,
        ggs.minutes, ggs.goals_against, ggs.shots_against, ggs.saves,
        ggs.shutouts, ggs.goalie_assists, ggs.result
      FROM goalie_game_stats ggs
      JOIN players p ON ggs.player_id = p.id
      JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = '2025-2026'
      WHERE ggs.game_id = ${gameId} AND ps.team_slug = ${teamSlug}
    `
    return rows.map((r) => ({
      id: r.id, name: r.name,
      minutes: r.minutes,
      goalsAgainst: r.goals_against,
      shotsAgainst: r.shots_against,
      saves: r.saves,
      savePercentage: r.shots_against > 0
        ? (r.saves / r.shots_against).toFixed(3)
        : "0.000",
      shutouts: r.shutouts,
      goalieAssists: r.goalie_assists,
      result: r.result,
    }))
  }

  const [homePlayers, awayPlayers, homeGoalies, awayGoalies, officialRows] = await Promise.all([
    getPlayerStats(id, game.home_team),
    getPlayerStats(id, game.away_team),
    getGoalieStats(id, game.home_team),
    getGoalieStats(id, game.away_team),
    sql`SELECT name, role FROM game_officials WHERE game_id = ${id} ORDER BY role, name`,
  ])

  return {
    id,
    date: game.date,
    time: game.time,
    homeTeam: game.home_team_name,
    homeSlug: game.home_team,
    awayTeam: game.away_team_name,
    awaySlug: game.away_team,
    homeScore: game.home_score,
    awayScore: game.away_score,
    status: game.status,
    isOvertime: game.is_overtime,
    location: game.location,
    homePlayers,
    awayPlayers,
    homeGoalies,
    awayGoalies,
    officials: officialRows.map((r) => ({ name: r.name, role: r.role })),
  }
}
