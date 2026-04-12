import { db, schema, rawSql } from "@/lib/db"
import { sql, eq, asc } from "drizzle-orm"
import type { BashGameDetail, PlayerBoxScore, GoalieBoxScore } from "@/app/api/bash/game/[id]/route"

export type { BashGameDetail, PlayerBoxScore, GoalieBoxScore }

export async function fetchGameDetail(id: string): Promise<BashGameDetail | null> {
  const gameResult = await rawSql(sql`
    SELECT g.*,
      ht.name as home_team_name,
      awt.name as away_team_name
    FROM games g
    JOIN teams ht ON g.home_team = ht.slug
    JOIN teams awt ON g.away_team = awt.slug
    WHERE g.id = ${id}
  `)

  if (gameResult.length === 0) return null

  const game = gameResult[0]

  async function getPlayerStats(gameId: string, teamSlug: string, seasonId: string): Promise<PlayerBoxScore[]> {
    const result = await rawSql(sql`
      SELECT p.id, p.name,
        pgs.goals, pgs.assists, pgs.points,
        pgs.gwg, pgs.ppg, pgs.shg, pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
      FROM player_game_stats pgs
      JOIN players p ON pgs.player_id = p.id
      JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = ${seasonId}
      WHERE pgs.game_id = ${gameId} AND ps.team_slug = ${teamSlug}
      ORDER BY pgs.points DESC, pgs.goals DESC, p.name ASC
    `)
    return result.map((r) => ({
      id: r.id, name: r.name,
      goals: r.goals, assists: r.assists, points: r.points,
      gwg: r.gwg, ppg: r.ppg, shg: r.shg, eng: r.eng,
      hatTricks: r.hat_tricks, pen: r.pen, pim: r.pim,
    }))
  }

  async function getGoalieStats(gameId: string, teamSlug: string, seasonId: string): Promise<GoalieBoxScore[]> {
    const result = await rawSql(sql`
      SELECT p.id, p.name,
        ggs.seconds, ggs.goals_against, ggs.shots_against, ggs.saves,
        ggs.shutouts, ggs.goalie_assists, ggs.result
      FROM goalie_game_stats ggs
      JOIN players p ON ggs.player_id = p.id
      JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = ${seasonId}
      WHERE ggs.game_id = ${gameId} AND ps.team_slug = ${teamSlug}
    `)
    return result.map((r) => ({
      id: r.id, name: r.name,
      seconds: r.seconds,
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

  // Officials — simple query using Drizzle query builder
  const officialsPromise = db
    .select({ name: schema.gameOfficials.name, role: schema.gameOfficials.role })
    .from(schema.gameOfficials)
    .where(eq(schema.gameOfficials.gameId, id))
    .orderBy(asc(schema.gameOfficials.role), asc(schema.gameOfficials.name))

  const [homePlayers, awayPlayers, homeGoalies, awayGoalies, officialRows] = await Promise.all([
    getPlayerStats(id, game.home_team, game.season_id),
    getPlayerStats(id, game.away_team, game.season_id),
    getGoalieStats(id, game.home_team, game.season_id),
    getGoalieStats(id, game.away_team, game.season_id),
    officialsPromise,
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
    isForfeit: game.is_forfeit,
    location: game.location,
    homePlayers,
    awayPlayers,
    homeGoalies,
    awayGoalies,
    officials: officialRows.map((r) => ({ name: r.name, role: r.role })),
    notes: game.notes ?? null,
  }
}
