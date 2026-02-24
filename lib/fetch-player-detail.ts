import { sql } from "@/lib/db"
import { getCurrentSeason, getSeasonById } from "@/lib/seasons"
import { playerSlug } from "@/lib/player-slug"
import type { PlayerDetail, SkaterStats, GoalieStats } from "@/app/api/bash/player/[slug]/route"

export type { PlayerDetail }

export async function fetchPlayerDetail(slug: string): Promise<PlayerDetail | null> {
  const currentSeasonId = getCurrentSeason().id

  // Look up player by slug (derived from name) — find all players whose slug matches
  const allMatches = await sql`SELECT id, name FROM players`
  const matchedPlayer = allMatches.find(
    (p) => playerSlug(p.name) === slug
  )
  if (!matchedPlayer) return null
  const playerId = matchedPlayer.id

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
  let playoffPerSeasonStats: PlayerDetail["playoffPerSeasonStats"] = []
  let playoffAllTimeStats: PlayerDetail["playoffAllTimeStats"] = null
  let playoffGames: PlayerDetail["playoffGames"] = []
  let playoffPerSeasonGoalieStats: PlayerDetail["playoffPerSeasonGoalieStats"] = []
  let playoffAllTimeGoalieStats: PlayerDetail["playoffAllTimeGoalieStats"] = null
  let playoffGoalieGames: PlayerDetail["playoffGoalieGames"] = []
  let championships: PlayerDetail["championships"] = []
  let awards: PlayerDetail["awards"] = []
  let hallOfFame: PlayerDetail["hallOfFame"] = null

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
  // Regular season queries exclude playoffs; playoff queries are separate
  const [
    skaterSeasonRows, skaterAllTimeRows, skaterPerSeasonRows, skaterGameRows,
    goalieSeasonRows, goalieAllTimeRows, goaliePerSeasonRows, goalieGameRows,
    poSkaterAllTimeRows, poSkaterPerSeasonRows, poSkaterGameRows,
    poGoalieAllTimeRows, poGoaliePerSeasonRows, poGoalieGameRows,
    championshipRows,
    awardRows,
    hofRows,
  ] = await Promise.all([
    // Skater season stats (regular season)
    sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
        SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
        SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
        SUM(pen)::int as pen, SUM(pim)::int as pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND g.season_id = ${playerSeasonId} AND NOT g.is_playoff
      WHERE pgs.player_id = ${player.id}
    `,
    // Skater all-time stats (regular season)
    sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
        SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
        SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
        SUM(pen)::int as pen, SUM(pim)::int as pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND NOT g.is_playoff
      WHERE pgs.player_id = ${player.id}
    `,
    // Skater per-season stats (regular season)
    sql`
      SELECT
        g.season_id, ps.team_slug, t.name as team_name,
        COUNT(*)::int as gp,
        SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
        SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
        SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
        SUM(pen)::int as pen, SUM(pim)::int as pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND NOT g.is_playoff
      LEFT JOIN player_seasons ps ON ps.player_id = pgs.player_id AND ps.season_id = g.season_id
      LEFT JOIN teams t ON ps.team_slug = t.slug
      WHERE pgs.player_id = ${player.id}
      GROUP BY g.season_id, ps.team_slug, t.name
      ORDER BY g.season_id DESC
    `,
    // Skater game log (regular season)
    sql`
      SELECT
        pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime,
        ht.name as home_name, awt.name as away_name,
        pgs.goals, pgs.assists, pgs.points, pgs.gwg, pgs.ppg, pgs.shg,
        pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND g.season_id = ${playerSeasonId} AND NOT g.is_playoff
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE pgs.player_id = ${player.id}
      ORDER BY g.date DESC
    `,
    // Goalie season stats (regular season)
    sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(minutes)::int as minutes,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.season_id = ${playerSeasonId} AND NOT g.is_playoff
      WHERE ggs.player_id = ${player.id}
    `,
    // Goalie all-time stats (regular season)
    sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(minutes)::int as minutes,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND NOT g.is_playoff
      WHERE ggs.player_id = ${player.id}
    `,
    // Goalie per-season stats (regular season)
    sql`
      SELECT
        g.season_id, ps.team_slug, t.name as team_name,
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(minutes)::int as minutes,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND NOT g.is_playoff
      LEFT JOIN player_seasons ps ON ps.player_id = ggs.player_id AND ps.season_id = g.season_id
      LEFT JOIN teams t ON ps.team_slug = t.slug
      WHERE ggs.player_id = ${player.id}
      GROUP BY g.season_id, ps.team_slug, t.name
      ORDER BY g.season_id DESC
    `,
    // Goalie game log (regular season)
    sql`
      SELECT
        ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score,
        ht.name as home_name, awt.name as away_name,
        ggs.minutes, ggs.goals_against, ggs.shots_against, ggs.saves,
        ggs.shutouts, ggs.goalie_assists, ggs.result
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.season_id = ${playerSeasonId} AND NOT g.is_playoff
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE ggs.player_id = ${player.id}
      ORDER BY g.date DESC
    `,
    // Playoff skater all-time stats
    sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
        SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
        SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
        SUM(pen)::int as pen, SUM(pim)::int as pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND g.is_playoff
      WHERE pgs.player_id = ${player.id}
    `,
    // Playoff skater per-season stats
    sql`
      SELECT
        g.season_id, ps.team_slug, t.name as team_name,
        COUNT(*)::int as gp,
        SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
        SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
        SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
        SUM(pen)::int as pen, SUM(pim)::int as pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND g.is_playoff
      LEFT JOIN player_seasons ps ON ps.player_id = pgs.player_id AND ps.season_id = g.season_id
      LEFT JOIN teams t ON ps.team_slug = t.slug
      WHERE pgs.player_id = ${player.id}
      GROUP BY g.season_id, ps.team_slug, t.name
      ORDER BY g.season_id DESC
    `,
    // Playoff skater game log
    sql`
      SELECT
        pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime,
        ht.name as home_name, awt.name as away_name,
        pgs.goals, pgs.assists, pgs.points, pgs.gwg, pgs.ppg, pgs.shg,
        pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND g.season_id = ${playerSeasonId} AND g.is_playoff
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE pgs.player_id = ${player.id}
      ORDER BY g.date DESC
    `,
    // Playoff goalie all-time stats
    sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(minutes)::int as minutes,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.is_playoff
      WHERE ggs.player_id = ${player.id}
    `,
    // Playoff goalie per-season stats
    sql`
      SELECT
        g.season_id, ps.team_slug, t.name as team_name,
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(minutes)::int as minutes,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.is_playoff
      LEFT JOIN player_seasons ps ON ps.player_id = ggs.player_id AND ps.season_id = g.season_id
      LEFT JOIN teams t ON ps.team_slug = t.slug
      WHERE ggs.player_id = ${player.id}
      GROUP BY g.season_id, ps.team_slug, t.name
      ORDER BY g.season_id DESC
    `,
    // Playoff goalie game log
    sql`
      SELECT
        ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score,
        ht.name as home_name, awt.name as away_name,
        ggs.minutes, ggs.goals_against, ggs.shots_against, ggs.saves,
        ggs.shutouts, ggs.goalie_assists, ggs.result
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.season_id = ${playerSeasonId} AND g.is_playoff
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE ggs.player_id = ${player.id}
      ORDER BY g.date DESC
    `,
    // Championships: find seasons where this player was on the team that won the final playoff game
    sql`
      SELECT DISTINCT g.season_id
      FROM games g
      JOIN player_seasons ps ON ps.player_id = ${player.id} AND ps.season_id = g.season_id
      WHERE g.is_playoff AND g.status = 'final'
        AND (
          (g.home_score > g.away_score AND ps.team_slug = g.home_team)
          OR (g.away_score > g.home_score AND ps.team_slug = g.away_team)
        )
        AND g.id = (
          SELECT g2.id FROM games g2
          WHERE g2.season_id = g.season_id AND g2.is_playoff AND g2.status = 'final'
          ORDER BY g2.date DESC, g2.id DESC LIMIT 1
        )
    `,
    // Player awards
    sql`
      SELECT award_type, season_id FROM player_awards
      WHERE player_id = ${player.id}
      ORDER BY season_id DESC
    `,
    // Hall of Fame
    sql`
      SELECT class_year, wing, years_active, achievements FROM hall_of_fame
      WHERE player_id = ${player.id}
      LIMIT 1
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
      teamName: r.team_name ?? "",
      teamSlug: r.team_slug ?? "",
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
      teamName: r.team_name ?? "",
      teamSlug: r.team_slug ?? "",
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

  // Populate playoff skater stats
  if (poSkaterAllTimeRows.length > 0 && poSkaterAllTimeRows[0].gp > 0) {
    playoffAllTimeStats = buildSkaterStats(poSkaterAllTimeRows[0])
  }
  playoffPerSeasonStats = poSkaterPerSeasonRows
    .filter((r) => r.gp > 0)
    .map((r) => ({
      seasonId: r.season_id,
      seasonName: getSeasonById(r.season_id)?.name ?? r.season_id,
      teamName: r.team_name ?? "",
      teamSlug: r.team_slug ?? "",
      stats: buildSkaterStats(r),
    }))
  playoffGames = poSkaterGameRows.map((r) => {
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

  // Populate playoff goalie stats
  if (poGoalieAllTimeRows.length > 0 && poGoalieAllTimeRows[0].gp > 0) {
    playoffAllTimeGoalieStats = buildGoalieStats(poGoalieAllTimeRows[0])
  }
  playoffPerSeasonGoalieStats = poGoaliePerSeasonRows
    .filter((r) => r.gp > 0)
    .map((r) => ({
      seasonId: r.season_id,
      seasonName: getSeasonById(r.season_id)?.name ?? r.season_id,
      teamName: r.team_name ?? "",
      teamSlug: r.team_slug ?? "",
      stats: buildGoalieStats(r),
    }))
  playoffGoalieGames = poGoalieGameRows.map((r) => {
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

  // Populate championships
  championships = championshipRows.map((r) => ({
    seasonId: r.season_id,
    seasonName: getSeasonById(r.season_id)?.name ?? r.season_id,
  }))

  // Populate awards
  awards = awardRows.map((r) => ({
    awardType: r.award_type,
    seasonId: r.season_id,
    seasonName: getSeasonById(r.season_id)?.name ?? r.season_id,
  }))

  // Populate hall of fame
  if (hofRows.length > 0) {
    hallOfFame = {
      classYear: hofRows[0].class_year,
      wing: hofRows[0].wing,
      yearsActive: hofRows[0].years_active,
      achievements: hofRows[0].achievements,
    }
  }

  return {
    id: player.id, name: player.name,
    team: player.team_name, teamSlug: player.team_slug,
    isGoalie: player.is_goalie,
    seasonStats, allTimeStats, perSeasonStats,
    goalieSeasonStats, allTimeGoalieStats, perSeasonGoalieStats,
    games, goalieGames,
    playoffPerSeasonStats, playoffAllTimeStats, playoffGames,
    playoffPerSeasonGoalieStats, playoffAllTimeGoalieStats, playoffGoalieGames,
    championships,
    awards,
    hallOfFame,
  }
}
