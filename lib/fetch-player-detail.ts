import { sql } from "@/lib/db"
import { getCurrentSeason, getSeasonById } from "@/lib/seasons"
import type { PlayerDetail, SkaterStats, GoalieStats } from "@/app/api/bash/player/[id]/route"

export type { PlayerDetail }

export async function fetchPlayerDetail(id: string): Promise<PlayerDetail | null> {
  const currentSeasonId = getCurrentSeason().id
  const playerId = parseInt(id)

  // Try current season first, then fall back to most recent season
  let playerRows = await sql`
    SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name, ps.season_id
    FROM players p
    JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = ${currentSeasonId}
    JOIN teams t ON ps.team_slug = t.slug
    WHERE p.id = ${playerId}
  `

  if (playerRows.length === 0) {
    playerRows = await sql`
      SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name, ps.season_id
      FROM players p
      JOIN player_seasons ps ON p.id = ps.player_id
      JOIN teams t ON ps.team_slug = t.slug
      WHERE p.id = ${playerId}
      ORDER BY ps.season_id DESC
      LIMIT 1
    `
  }

  if (playerRows.length === 0) return null

  const player = playerRows[0]
  const playerSeasonId = player.season_id

  let seasonStats: PlayerDetail["seasonStats"] = null
  let allTimeStats: PlayerDetail["allTimeStats"] = null
  let perSeasonStats: PlayerDetail["perSeasonStats"] = []
  let goalieSeasonStats: PlayerDetail["goalieSeasonStats"] = null
  let allTimeGoalieStats: PlayerDetail["allTimeGoalieStats"] = null
  let perSeasonGoalieStats: PlayerDetail["perSeasonGoalieStats"] = []
  let games: PlayerDetail["games"] = []
  let goalieGames: PlayerDetail["goalieGames"] = []

  function buildSkaterStats(s: Record<string, number>): SkaterStats {
    return {
      gp: s.gp, goals: s.goals, assists: s.assists, points: s.points,
      ptsPg: s.gp > 0 ? (s.points / s.gp).toFixed(2) : "0.00",
      gwg: s.gwg, ppg: s.ppg, shg: s.shg, eng: s.eng,
      hatTricks: s.hat_tricks, pen: s.pen, pim: s.pim,
    }
  }

  function buildGoalieStats(s: Record<string, number>): GoalieStats {
    const svPct = s.sa > 0 ? (s.saves / s.sa) : 0
    const gaa = s.minutes > 0 ? (s.ga / s.minutes) * 60 : 0
    return {
      gp: s.gp, wins: s.wins, losses: s.losses,
      gaa: gaa.toFixed(2), savePercentage: svPct.toFixed(3),
      saves: s.saves, goalsAgainst: s.ga, shotsAgainst: s.sa,
      shutouts: s.shutouts, goalieAssists: s.goalie_assists, minutes: s.minutes,
    }
  }

  // Always fetch both skater and goalie stats — a player can play both roles
  const [
    skaterSeasonRows, skaterAllTimeRows, skaterPerSeasonRows, skaterGameRows,
    goalieSeasonRows, goalieAllTimeRows, goaliePerSeasonRows, goalieGameRows,
  ] = await Promise.all([
    // Skater season stats
    sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
        SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
        SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
        SUM(pen)::int as pen, SUM(pim)::int as pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND g.season_id = ${playerSeasonId}
      WHERE pgs.player_id = ${player.id}
    `,
    // Skater all-time stats
    sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
        SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
        SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
        SUM(pen)::int as pen, SUM(pim)::int as pim
      FROM player_game_stats WHERE player_id = ${player.id}
    `,
    // Skater per-season stats
    sql`
      SELECT
        g.season_id,
        COUNT(*)::int as gp,
        SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
        SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
        SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
        SUM(pen)::int as pen, SUM(pim)::int as pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id
      WHERE pgs.player_id = ${player.id}
      GROUP BY g.season_id
      ORDER BY g.season_id DESC
    `,
    // Skater game log
    sql`
      SELECT
        pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime,
        ht.name as home_name, awt.name as away_name,
        pgs.goals, pgs.assists, pgs.points, pgs.gwg, pgs.ppg, pgs.shg,
        pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND g.season_id = ${playerSeasonId}
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE pgs.player_id = ${player.id}
      ORDER BY g.date DESC
    `,
    // Goalie season stats
    sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(minutes)::int as minutes,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.season_id = ${playerSeasonId}
      WHERE ggs.player_id = ${player.id}
    `,
    // Goalie all-time stats
    sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(minutes)::int as minutes,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats WHERE player_id = ${player.id}
    `,
    // Goalie per-season stats
    sql`
      SELECT
        g.season_id,
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(minutes)::int as minutes,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id
      WHERE ggs.player_id = ${player.id}
      GROUP BY g.season_id
      ORDER BY g.season_id DESC
    `,
    // Goalie game log
    sql`
      SELECT
        ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score,
        ht.name as home_name, awt.name as away_name,
        ggs.minutes, ggs.goals_against, ggs.shots_against, ggs.saves,
        ggs.shutouts, ggs.goalie_assists, ggs.result
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.season_id = ${playerSeasonId}
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE ggs.player_id = ${player.id}
      ORDER BY g.date DESC
    `,
  ])

  // Populate skater stats if data exists
  if (skaterSeasonRows.length > 0 && skaterSeasonRows[0].gp > 0) {
    seasonStats = buildSkaterStats(skaterSeasonRows[0])
  }
  if (skaterAllTimeRows.length > 0 && skaterAllTimeRows[0].gp > 0) {
    allTimeStats = buildSkaterStats(skaterAllTimeRows[0])
  }
  perSeasonStats = skaterPerSeasonRows
    .filter((r) => r.gp > 0)
    .map((r) => ({
      seasonId: r.season_id,
      seasonName: getSeasonById(r.season_id)?.name ?? r.season_id,
      stats: buildSkaterStats(r),
    }))
  games = skaterGameRows.map((r) => {
    const isHome = r.home_team === player.team_slug
    const teamScore = isHome ? r.home_score : r.away_score
    const opponentScore = isHome ? r.away_score : r.home_score
    let result: string | null = null
    if (teamScore != null && opponentScore != null) {
      if (teamScore > opponentScore) result = r.is_overtime ? "OTW" : "W"
      else result = r.is_overtime ? "OTL" : "L"
    }
    return {
      gameId: r.game_id, date: r.date,
      opponent: isHome ? r.away_name : r.home_name,
      opponentSlug: isHome ? r.away_team : r.home_team,
      isHome, teamScore, opponentScore, result,
      goals: r.goals, assists: r.assists, points: r.points,
      gwg: r.gwg, ppg: r.ppg, shg: r.shg,
      eng: r.eng, hatTricks: r.hat_tricks, pen: r.pen, pim: r.pim,
    }
  })

  // Populate goalie stats if data exists
  if (goalieSeasonRows.length > 0 && goalieSeasonRows[0].gp > 0) {
    goalieSeasonStats = buildGoalieStats(goalieSeasonRows[0])
  }
  if (goalieAllTimeRows.length > 0 && goalieAllTimeRows[0].gp > 0) {
    allTimeGoalieStats = buildGoalieStats(goalieAllTimeRows[0])
  }
  perSeasonGoalieStats = goaliePerSeasonRows
    .filter((r) => r.gp > 0)
    .map((r) => ({
      seasonId: r.season_id,
      seasonName: getSeasonById(r.season_id)?.name ?? r.season_id,
      stats: buildGoalieStats(r),
    }))
  goalieGames = goalieGameRows.map((r) => {
    const isHome = r.home_team === player.team_slug
    return {
      gameId: r.game_id, date: r.date,
      opponent: isHome ? r.away_name : r.home_name,
      opponentSlug: isHome ? r.away_team : r.home_team,
      isHome,
      teamScore: isHome ? r.home_score : r.away_score,
      opponentScore: isHome ? r.away_score : r.home_score,
      minutes: r.minutes, goalsAgainst: r.goals_against,
      shotsAgainst: r.shots_against, saves: r.saves,
      savePercentage: r.shots_against > 0 ? (r.saves / r.shots_against).toFixed(3) : "0.000",
      shutouts: r.shutouts, goalieAssists: r.goalie_assists,
      result: r.result,
    }
  })

  return {
    id: player.id, name: player.name,
    team: player.team_name, teamSlug: player.team_slug,
    isGoalie: player.is_goalie,
    seasonStats, allTimeStats, perSeasonStats,
    goalieSeasonStats, allTimeGoalieStats, perSeasonGoalieStats,
    games, goalieGames,
  }
}
