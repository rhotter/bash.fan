import { sql } from "@/lib/db"
import { getCurrentSeason, getSeasonById } from "@/lib/seasons"
import type { PlayerDetail, SkaterStats, GoalieStats } from "@/app/api/bash/player/[id]/route"

export type { PlayerDetail }

export async function fetchPlayerDetail(id: string): Promise<PlayerDetail | null> {
  const currentSeasonId = getCurrentSeason().id

  const playerRows = await sql`
    SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name
    FROM players p
    JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = ${currentSeasonId}
    JOIN teams t ON ps.team_slug = t.slug
    WHERE p.id = ${parseInt(id)}
  `

  if (playerRows.length === 0) return null

  const player = playerRows[0]

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

  if (!player.is_goalie) {
    const [seasonStatRows, allTimeStatRows, perSeasonStatRows, gameRows] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND g.season_id = ${currentSeasonId}
        WHERE pgs.player_id = ${player.id}
      `,
      sql`
        SELECT
          COUNT(*)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM player_game_stats WHERE player_id = ${player.id}
      `,
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
      sql`
        SELECT
          pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime,
          ht.name as home_name, awt.name as away_name,
          pgs.goals, pgs.assists, pgs.points, pgs.gwg, pgs.ppg, pgs.shg,
          pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND g.season_id = ${currentSeasonId}
        JOIN teams ht ON g.home_team = ht.slug
        JOIN teams awt ON g.away_team = awt.slug
        WHERE pgs.player_id = ${player.id}
        ORDER BY g.date DESC
      `,
    ])

    if (seasonStatRows.length > 0 && seasonStatRows[0].gp > 0) {
      seasonStats = buildSkaterStats(seasonStatRows[0])
    }
    if (allTimeStatRows.length > 0 && allTimeStatRows[0].gp > 0) {
      allTimeStats = buildSkaterStats(allTimeStatRows[0])
    }

    perSeasonStats = perSeasonStatRows
      .filter((r) => r.gp > 0)
      .map((r) => ({
        seasonId: r.season_id,
        seasonName: getSeasonById(r.season_id)?.name ?? r.season_id,
        stats: buildSkaterStats(r),
      }))

    games = gameRows.map((r) => {
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
  } else {
    const [seasonStatRows, allTimeStatRows, perSeasonGoalieStatRows, gameRows] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int as gp,
          SUM(goals_against)::int as ga, SUM(saves)::int as saves,
          SUM(shots_against)::int as sa, SUM(minutes)::int as minutes,
          SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
          COUNT(*) FILTER (WHERE result = 'W')::int as wins,
          COUNT(*) FILTER (WHERE result = 'L')::int as losses
        FROM goalie_game_stats ggs
        JOIN games g ON ggs.game_id = g.id AND g.season_id = ${currentSeasonId}
        WHERE ggs.player_id = ${player.id}
      `,
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
      sql`
        SELECT
          ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score,
          ht.name as home_name, awt.name as away_name,
          ggs.minutes, ggs.goals_against, ggs.shots_against, ggs.saves,
          ggs.shutouts, ggs.goalie_assists, ggs.result
        FROM goalie_game_stats ggs
        JOIN games g ON ggs.game_id = g.id AND g.season_id = ${currentSeasonId}
        JOIN teams ht ON g.home_team = ht.slug
        JOIN teams awt ON g.away_team = awt.slug
        WHERE ggs.player_id = ${player.id}
        ORDER BY g.date DESC
      `,
    ])

    if (seasonStatRows.length > 0 && seasonStatRows[0].gp > 0) {
      goalieSeasonStats = buildGoalieStats(seasonStatRows[0])
    }
    if (allTimeStatRows.length > 0 && allTimeStatRows[0].gp > 0) {
      allTimeGoalieStats = buildGoalieStats(allTimeStatRows[0])
    }

    perSeasonGoalieStats = perSeasonGoalieStatRows
      .filter((r) => r.gp > 0)
      .map((r) => ({
        seasonId: r.season_id,
        seasonName: getSeasonById(r.season_id)?.name ?? r.season_id,
        stats: buildGoalieStats(r),
      }))

    goalieGames = gameRows.map((r) => {
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
  }

  return {
    id: player.id, name: player.name,
    team: player.team_name, teamSlug: player.team_slug,
    isGoalie: player.is_goalie,
    seasonStats, allTimeStats, perSeasonStats,
    goalieSeasonStats, allTimeGoalieStats, perSeasonGoalieStats,
    games, goalieGames,
  }
}
