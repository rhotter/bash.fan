import { db, schema, rawSql } from "@/lib/db"
import { sql, eq, desc } from "drizzle-orm"
import { getCurrentSeason, getAllSeasons } from "@/lib/seasons"
import { playerSlug } from "@/lib/player-slug"
import type { PlayerDetail, SkaterStats, GoalieStats } from "@/app/api/bash/player/[slug]/route"

export type { PlayerDetail }

export async function fetchPlayerDetail(slug: string): Promise<PlayerDetail | null> {
  const currentSeasonId = (await getCurrentSeason()).id
  const allSeasons = await getAllSeasons()
  const seasonMap = new Map(allSeasons.map(s => [s.id, s.name]))

  // Look up player by slug (derived from name) — find all players whose slug matches
  const allMatches = await db.select({ id: schema.players.id, name: schema.players.name }).from(schema.players)
  const matchedPlayer = allMatches.find(
    (p) => playerSlug(p.name) === slug
  )
  if (!matchedPlayer) return null
  const playerId = matchedPlayer.id

  // Try current season first, then fall back to most recent season
  let playerRows = await rawSql(sql`
    SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name, ps.season_id
    FROM players p
    JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = ${currentSeasonId}
    JOIN teams t ON ps.team_slug = t.slug
    WHERE p.id = ${playerId}
    ORDER BY ps.season_id DESC
    LIMIT 1
  `)

  if (playerRows.length === 0) {
    playerRows = await rawSql(sql`
      SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name, ps.season_id
      FROM players p
      JOIN player_seasons ps ON p.id = ps.player_id
      JOIN teams t ON ps.team_slug = t.slug
      WHERE p.id = ${playerId}
      ORDER BY ps.season_id DESC
      LIMIT 1
    `)
  }

  if (playerRows.length === 0) return null

  const player = playerRows[0]
  const playerSeasonId = player.season_id

  let seasonStats: PlayerDetail["seasonStats"] = null
  let allTimeStats: PlayerDetail["allTimeStats"] = null
  let allTimeAllSeasonsStats: PlayerDetail["allTimeAllSeasonsStats"] = null
  let perSeasonStats: PlayerDetail["perSeasonStats"] = []
  let goalieSeasonStats: PlayerDetail["goalieSeasonStats"] = null
  let allTimeGoalieStats: PlayerDetail["allTimeGoalieStats"] = null
  let allTimeAllSeasonsGoalieStats: PlayerDetail["allTimeAllSeasonsGoalieStats"] = null
  let perSeasonGoalieStats: PlayerDetail["perSeasonGoalieStats"] = []
  let games: PlayerDetail["games"] = []
  let goalieGames: PlayerDetail["goalieGames"] = []
  let playoffPerSeasonStats: PlayerDetail["playoffPerSeasonStats"] = []
  let playoffAllTimeStats: PlayerDetail["playoffAllTimeStats"] = null
  let playoffAllTimeAllSeasonsStats: PlayerDetail["playoffAllTimeAllSeasonsStats"] = null
  let playoffGames: PlayerDetail["playoffGames"] = []
  let playoffPerSeasonGoalieStats: PlayerDetail["playoffPerSeasonGoalieStats"] = []
  let playoffAllTimeGoalieStats: PlayerDetail["playoffAllTimeGoalieStats"] = null
  let playoffAllTimeAllSeasonsGoalieStats: PlayerDetail["playoffAllTimeAllSeasonsGoalieStats"] = null
  let playoffGoalieGames: PlayerDetail["playoffGoalieGames"] = []
  let championships: PlayerDetail["championships"] = []
  let awards: PlayerDetail["awards"] = []
  let hallOfFame: PlayerDetail["hallOfFame"] = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildSkaterStats(s: any): SkaterStats {
    return {
      gp: s.gp, goals: s.goals, assists: s.assists, points: s.points,
      ptsPg: s.gp > 0 ? (s.points / s.gp).toFixed(2) : "0.00",
      gwg: s.gwg, ppg: s.ppg, shg: s.shg, eng: s.eng,
      hatTricks: s.hat_tricks, pen: s.pen, pim: s.pim,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildGoalieStats(s: any): GoalieStats {
    const svPct = s.sa > 0 ? (s.saves / s.sa) : 0
    const gaa = s.seconds > 0 ? (s.ga / s.seconds) * 3600 : 0
    return {
      gp: s.gp, wins: s.wins, losses: s.losses,
      gaa: gaa.toFixed(2), savePercentage: svPct.toFixed(3),
      saves: s.saves, goalsAgainst: s.ga, shotsAgainst: s.sa,
      shutouts: s.shutouts, goalieAssists: s.goalie_assists, seconds: s.seconds,
    }
  }

  const pid = player.id

  // Always fetch both skater and goalie stats — a player can play both roles
  const [
    skaterSeasonRows, skaterAllTimeRows, skaterPerSeasonRows, skaterGameRows,
    goalieSeasonRows, goalieAllTimeRows, goaliePerSeasonRows, goalieGameRows,
    poSkaterAllTimeRows, poSkaterPerSeasonRows, poSkaterGameRows,
    poGoalieAllTimeRows, poGoaliePerSeasonRows, poGoalieGameRows,
    championshipRows,
    awardRows,
    hofRows,
    skaterAllSeasonsRows, goalieAllSeasonsRows,
    poSkaterAllSeasonsRows, poGoalieAllSeasonsRows,
  ] = await Promise.all([
    // Skater season stats (regular season)
    rawSql(sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
        SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
        SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
        SUM(pen)::int as pen, SUM(pim)::int as pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND g.season_id = ${playerSeasonId} AND NOT g.is_playoff
      WHERE pgs.player_id = ${pid}
    `),
    // Skater all-time stats (regular season, fall only — includes historical)
    rawSql(sql`
      WITH game_totals AS (
        SELECT
          COUNT(*)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND NOT g.is_playoff
        JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
        WHERE pgs.player_id = ${pid}
      ), hist_totals AS (
        SELECT
          SUM(gp)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM player_season_stats
        WHERE player_id = ${pid} AND NOT is_playoff
      )
      SELECT
        COALESCE(g.gp, 0) + COALESCE(h.gp, 0) as gp,
        COALESCE(g.goals, 0) + COALESCE(h.goals, 0) as goals,
        COALESCE(g.assists, 0) + COALESCE(h.assists, 0) as assists,
        COALESCE(g.points, 0) + COALESCE(h.points, 0) as points,
        COALESCE(g.gwg, 0) + COALESCE(h.gwg, 0) as gwg,
        COALESCE(g.ppg, 0) + COALESCE(h.ppg, 0) as ppg,
        COALESCE(g.shg, 0) + COALESCE(h.shg, 0) as shg,
        COALESCE(g.eng, 0) + COALESCE(h.eng, 0) as eng,
        COALESCE(g.hat_tricks, 0) + COALESCE(h.hat_tricks, 0) as hat_tricks,
        COALESCE(g.pen, 0) + COALESCE(h.pen, 0) as pen,
        COALESCE(g.pim, 0) + COALESCE(h.pim, 0) as pim
      FROM game_totals g, hist_totals h
    `),
    // Skater per-season stats (regular season — includes historical)
    rawSql(sql`
      SELECT season_id, team_slug, team_name, gp, goals, assists, points,
             gwg, ppg, shg, eng, hat_tricks, pen, pim
      FROM (
        SELECT
          g.season_id, ps.team_slug, t.name as team_name,
          COUNT(*)::int as gp,
          SUM(pgs.goals)::int as goals, SUM(pgs.assists)::int as assists, SUM(pgs.points)::int as points,
          SUM(pgs.gwg)::int as gwg, SUM(pgs.ppg)::int as ppg, SUM(pgs.shg)::int as shg,
          SUM(pgs.eng)::int as eng, SUM(pgs.hat_tricks)::int as hat_tricks,
          SUM(pgs.pen)::int as pen, SUM(pgs.pim)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND NOT g.is_playoff
        LEFT JOIN player_seasons ps ON ps.player_id = pgs.player_id AND ps.season_id = g.season_id
        LEFT JOIN teams t ON ps.team_slug = t.slug
        WHERE pgs.player_id = ${pid}
        GROUP BY g.season_id, ps.team_slug, t.name
        UNION ALL
        SELECT
          pss.season_id, pss.team_slug, t.name as team_name,
          pss.gp, pss.goals, pss.assists, pss.points,
          pss.gwg, pss.ppg, pss.shg, pss.eng, pss.hat_tricks, pss.pen, pss.pim
        FROM player_season_stats pss
        JOIN teams t ON pss.team_slug = t.slug
        WHERE pss.player_id = ${pid} AND NOT pss.is_playoff
      ) combined
      ORDER BY season_id DESC
    `),
    // Skater game log (regular season)
    rawSql(sql`
      SELECT
        pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime,
        ht.name as home_name, awt.name as away_name,
        pgs.goals, pgs.assists, pgs.points, pgs.gwg, pgs.ppg, pgs.shg,
        pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND g.season_id = ${playerSeasonId} AND NOT g.is_playoff
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE pgs.player_id = ${pid}
      ORDER BY g.date DESC
    `),
    // Goalie season stats (regular season)
    rawSql(sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(seconds)::int as seconds,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.season_id = ${playerSeasonId} AND NOT g.is_playoff
      WHERE ggs.player_id = ${pid}
    `),
    // Goalie all-time stats (regular season, fall only)
    rawSql(sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(seconds)::int as seconds,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND NOT g.is_playoff
      JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
      WHERE ggs.player_id = ${pid}
    `),
    // Goalie per-season stats (regular season)
    rawSql(sql`
      SELECT
        g.season_id, ps.team_slug, t.name as team_name,
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(seconds)::int as seconds,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND NOT g.is_playoff
      LEFT JOIN player_seasons ps ON ps.player_id = ggs.player_id AND ps.season_id = g.season_id
      LEFT JOIN teams t ON ps.team_slug = t.slug
      WHERE ggs.player_id = ${pid}
      GROUP BY g.season_id, ps.team_slug, t.name
      ORDER BY g.season_id DESC
    `),
    // Goalie game log (regular season)
    rawSql(sql`
      SELECT
        ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score,
        ht.name as home_name, awt.name as away_name,
        ggs.seconds, ggs.goals_against, ggs.shots_against, ggs.saves,
        ggs.shutouts, ggs.goalie_assists, ggs.result
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.season_id = ${playerSeasonId} AND NOT g.is_playoff
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE ggs.player_id = ${pid}
      ORDER BY g.date DESC
    `),
    // Playoff skater all-time stats (fall only — includes historical)
    rawSql(sql`
      WITH game_totals AS (
        SELECT
          COUNT(*)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND g.is_playoff
        JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
        WHERE pgs.player_id = ${pid}
      ), hist_totals AS (
        SELECT
          SUM(gp)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM player_season_stats
        WHERE player_id = ${pid} AND is_playoff
      )
      SELECT
        COALESCE(g.gp, 0) + COALESCE(h.gp, 0) as gp,
        COALESCE(g.goals, 0) + COALESCE(h.goals, 0) as goals,
        COALESCE(g.assists, 0) + COALESCE(h.assists, 0) as assists,
        COALESCE(g.points, 0) + COALESCE(h.points, 0) as points,
        COALESCE(g.gwg, 0) + COALESCE(h.gwg, 0) as gwg,
        COALESCE(g.ppg, 0) + COALESCE(h.ppg, 0) as ppg,
        COALESCE(g.shg, 0) + COALESCE(h.shg, 0) as shg,
        COALESCE(g.eng, 0) + COALESCE(h.eng, 0) as eng,
        COALESCE(g.hat_tricks, 0) + COALESCE(h.hat_tricks, 0) as hat_tricks,
        COALESCE(g.pen, 0) + COALESCE(h.pen, 0) as pen,
        COALESCE(g.pim, 0) + COALESCE(h.pim, 0) as pim
      FROM game_totals g, hist_totals h
    `),
    // Playoff skater per-season stats (includes historical)
    rawSql(sql`
      SELECT season_id, team_slug, team_name, gp, goals, assists, points,
             gwg, ppg, shg, eng, hat_tricks, pen, pim
      FROM (
        SELECT
          g.season_id, ps.team_slug, t.name as team_name,
          COUNT(*)::int as gp,
          SUM(pgs.goals)::int as goals, SUM(pgs.assists)::int as assists, SUM(pgs.points)::int as points,
          SUM(pgs.gwg)::int as gwg, SUM(pgs.ppg)::int as ppg, SUM(pgs.shg)::int as shg,
          SUM(pgs.eng)::int as eng, SUM(pgs.hat_tricks)::int as hat_tricks,
          SUM(pgs.pen)::int as pen, SUM(pgs.pim)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND g.is_playoff
        LEFT JOIN player_seasons ps ON ps.player_id = pgs.player_id AND ps.season_id = g.season_id
        LEFT JOIN teams t ON ps.team_slug = t.slug
        WHERE pgs.player_id = ${pid}
        GROUP BY g.season_id, ps.team_slug, t.name
        UNION ALL
        SELECT
          pss.season_id, pss.team_slug, t.name as team_name,
          pss.gp, pss.goals, pss.assists, pss.points,
          pss.gwg, pss.ppg, pss.shg, pss.eng, pss.hat_tricks, pss.pen, pss.pim
        FROM player_season_stats pss
        JOIN teams t ON pss.team_slug = t.slug
        WHERE pss.player_id = ${pid} AND pss.is_playoff
      ) combined
      ORDER BY season_id DESC
    `),
    // Playoff skater game log
    rawSql(sql`
      SELECT
        pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime,
        ht.name as home_name, awt.name as away_name,
        pgs.goals, pgs.assists, pgs.points, pgs.gwg, pgs.ppg, pgs.shg,
        pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND g.season_id = ${playerSeasonId} AND g.is_playoff
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE pgs.player_id = ${pid}
      ORDER BY g.date DESC
    `),
    // Playoff goalie all-time stats (fall only)
    rawSql(sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(seconds)::int as seconds,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.is_playoff
      JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
      WHERE ggs.player_id = ${pid}
    `),
    // Playoff goalie per-season stats
    rawSql(sql`
      SELECT
        g.season_id, ps.team_slug, t.name as team_name,
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(seconds)::int as seconds,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.is_playoff
      LEFT JOIN player_seasons ps ON ps.player_id = ggs.player_id AND ps.season_id = g.season_id
      LEFT JOIN teams t ON ps.team_slug = t.slug
      WHERE ggs.player_id = ${pid}
      GROUP BY g.season_id, ps.team_slug, t.name
      ORDER BY g.season_id DESC
    `),
    // Playoff goalie game log
    rawSql(sql`
      SELECT
        ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score,
        ht.name as home_name, awt.name as away_name,
        ggs.seconds, ggs.goals_against, ggs.shots_against, ggs.saves,
        ggs.shutouts, ggs.goalie_assists, ggs.result
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.season_id = ${playerSeasonId} AND g.is_playoff
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE ggs.player_id = ${pid}
      ORDER BY g.date DESC
    `),
    // Championships
    rawSql(sql`
      SELECT DISTINCT g.season_id
      FROM games g
      JOIN player_seasons ps ON ps.player_id = ${pid} AND ps.season_id = g.season_id
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
    `),
    // Player awards
    db.select({ awardType: schema.playerAwards.awardType, seasonId: schema.playerAwards.seasonId })
      .from(schema.playerAwards)
      .where(eq(schema.playerAwards.playerId, pid))
      .orderBy(desc(schema.playerAwards.seasonId)),
    // Hall of Fame
    rawSql(sql`
      SELECT class_year, wing, years_active, achievements FROM hall_of_fame
      WHERE player_id = ${pid}
      LIMIT 1
    `),
    // Skater all-time stats (regular season, ALL seasons — includes historical)
    rawSql(sql`
      WITH game_totals AS (
        SELECT
          COUNT(*)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND NOT g.is_playoff
        WHERE pgs.player_id = ${pid}
      ), hist_totals AS (
        SELECT
          SUM(gp)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM player_season_stats
        WHERE player_id = ${pid} AND NOT is_playoff
      )
      SELECT
        COALESCE(g.gp, 0) + COALESCE(h.gp, 0) as gp,
        COALESCE(g.goals, 0) + COALESCE(h.goals, 0) as goals,
        COALESCE(g.assists, 0) + COALESCE(h.assists, 0) as assists,
        COALESCE(g.points, 0) + COALESCE(h.points, 0) as points,
        COALESCE(g.gwg, 0) + COALESCE(h.gwg, 0) as gwg,
        COALESCE(g.ppg, 0) + COALESCE(h.ppg, 0) as ppg,
        COALESCE(g.shg, 0) + COALESCE(h.shg, 0) as shg,
        COALESCE(g.eng, 0) + COALESCE(h.eng, 0) as eng,
        COALESCE(g.hat_tricks, 0) + COALESCE(h.hat_tricks, 0) as hat_tricks,
        COALESCE(g.pen, 0) + COALESCE(h.pen, 0) as pen,
        COALESCE(g.pim, 0) + COALESCE(h.pim, 0) as pim
      FROM game_totals g, hist_totals h
    `),
    // Goalie all-time stats (regular season, ALL seasons)
    rawSql(sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(seconds)::int as seconds,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND NOT g.is_playoff
      WHERE ggs.player_id = ${pid}
    `),
    // Playoff skater all-time stats (ALL seasons — includes historical)
    rawSql(sql`
      WITH game_totals AS (
        SELECT
          COUNT(*)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND g.is_playoff
        WHERE pgs.player_id = ${pid}
      ), hist_totals AS (
        SELECT
          SUM(gp)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM player_season_stats
        WHERE player_id = ${pid} AND is_playoff
      )
      SELECT
        COALESCE(g.gp, 0) + COALESCE(h.gp, 0) as gp,
        COALESCE(g.goals, 0) + COALESCE(h.goals, 0) as goals,
        COALESCE(g.assists, 0) + COALESCE(h.assists, 0) as assists,
        COALESCE(g.points, 0) + COALESCE(h.points, 0) as points,
        COALESCE(g.gwg, 0) + COALESCE(h.gwg, 0) as gwg,
        COALESCE(g.ppg, 0) + COALESCE(h.ppg, 0) as ppg,
        COALESCE(g.shg, 0) + COALESCE(h.shg, 0) as shg,
        COALESCE(g.eng, 0) + COALESCE(h.eng, 0) as eng,
        COALESCE(g.hat_tricks, 0) + COALESCE(h.hat_tricks, 0) as hat_tricks,
        COALESCE(g.pen, 0) + COALESCE(h.pen, 0) as pen,
        COALESCE(g.pim, 0) + COALESCE(h.pim, 0) as pim
      FROM game_totals g, hist_totals h
    `),
    // Playoff goalie all-time stats (ALL seasons)
    rawSql(sql`
      SELECT
        COUNT(*)::int as gp,
        SUM(goals_against)::int as ga, SUM(saves)::int as saves,
        SUM(shots_against)::int as sa, SUM(seconds)::int as seconds,
        SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.is_playoff
      WHERE ggs.player_id = ${pid}
    `),
  ])

  const teamSlug = player.team_slug

  // Populate skater stats if data exists
  if (skaterSeasonRows.length > 0 && skaterSeasonRows[0].gp > 0) {
    seasonStats = buildSkaterStats(skaterSeasonRows[0])
  }
  if (skaterAllTimeRows.length > 0 && skaterAllTimeRows[0].gp > 0) {
    allTimeStats = buildSkaterStats(skaterAllTimeRows[0])
  }
  if (skaterAllSeasonsRows.length > 0 && skaterAllSeasonsRows[0].gp > 0) {
    allTimeAllSeasonsStats = buildSkaterStats(skaterAllSeasonsRows[0])
  }
  perSeasonStats = skaterPerSeasonRows
    .filter((r) => r.gp > 0)
    .map((r) => ({
      seasonId: r.season_id,
      seasonName: seasonMap.get(r.season_id) ?? r.season_id,
      teamName: r.team_name ?? "",
      teamSlug: r.team_slug ?? "",
      stats: buildSkaterStats(r),
    }))
  games = skaterGameRows.map((r) => {
    const isHome = r.home_team === teamSlug
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
  if (goalieAllSeasonsRows.length > 0 && goalieAllSeasonsRows[0].gp > 0) {
    allTimeAllSeasonsGoalieStats = buildGoalieStats(goalieAllSeasonsRows[0])
  }
  perSeasonGoalieStats = goaliePerSeasonRows
    .filter((r) => r.gp > 0)
    .map((r) => ({
      seasonId: r.season_id,
      seasonName: seasonMap.get(r.season_id) ?? r.season_id,
      teamName: r.team_name ?? "",
      teamSlug: r.team_slug ?? "",
      stats: buildGoalieStats(r),
    }))
  goalieGames = goalieGameRows.map((r) => {
    const isHome = r.home_team === teamSlug
    return {
      gameId: r.game_id, date: r.date,
      opponent: isHome ? r.away_name : r.home_name,
      opponentSlug: isHome ? r.away_team : r.home_team,
      isHome,
      teamScore: isHome ? r.home_score : r.away_score,
      opponentScore: isHome ? r.away_score : r.home_score,
      seconds: r.seconds, goalsAgainst: r.goals_against,
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
  if (poSkaterAllSeasonsRows.length > 0 && poSkaterAllSeasonsRows[0].gp > 0) {
    playoffAllTimeAllSeasonsStats = buildSkaterStats(poSkaterAllSeasonsRows[0])
  }
  playoffPerSeasonStats = poSkaterPerSeasonRows
    .filter((r) => r.gp > 0)
    .map((r) => ({
      seasonId: r.season_id,
      seasonName: seasonMap.get(r.season_id) ?? r.season_id,
      teamName: r.team_name ?? "",
      teamSlug: r.team_slug ?? "",
      stats: buildSkaterStats(r),
    }))
  playoffGames = poSkaterGameRows.map((r) => {
    const isHome = r.home_team === teamSlug
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
  if (poGoalieAllSeasonsRows.length > 0 && poGoalieAllSeasonsRows[0].gp > 0) {
    playoffAllTimeAllSeasonsGoalieStats = buildGoalieStats(poGoalieAllSeasonsRows[0])
  }
  playoffPerSeasonGoalieStats = poGoaliePerSeasonRows
    .filter((r) => r.gp > 0)
    .map((r) => ({
      seasonId: r.season_id,
      seasonName: seasonMap.get(r.season_id) ?? r.season_id,
      teamName: r.team_name ?? "",
      teamSlug: r.team_slug ?? "",
      stats: buildGoalieStats(r),
    }))
  playoffGoalieGames = poGoalieGameRows.map((r) => {
    const isHome = r.home_team === teamSlug
    return {
      gameId: r.game_id, date: r.date,
      opponent: isHome ? r.away_name : r.home_name,
      opponentSlug: isHome ? r.away_team : r.home_team,
      isHome,
      teamScore: isHome ? r.home_score : r.away_score,
      opponentScore: isHome ? r.away_score : r.home_score,
      seconds: r.seconds, goalsAgainst: r.goals_against,
      shotsAgainst: r.shots_against, saves: r.saves,
      savePercentage: r.shots_against > 0 ? (r.saves / r.shots_against).toFixed(3) : "0.000",
      shutouts: r.shutouts, goalieAssists: r.goalie_assists,
      result: r.result,
    }
  })

  // Populate championships
  championships = championshipRows.map((r) => ({
    seasonId: r.season_id,
    seasonName: seasonMap.get(r.season_id) ?? r.season_id,
  }))

  // Populate awards
  awards = awardRows.map((r) => ({
    awardType: r.awardType,
    seasonId: r.seasonId,
    seasonName: seasonMap.get(r.seasonId) ?? r.seasonId,
  }))

  // Populate hall of fame
  if (hofRows.length > 0) {
    const h = hofRows[0]
    hallOfFame = {
      classYear: h.class_year,
      wing: h.wing,
      yearsActive: h.years_active,
      achievements: h.achievements,
    }
  }

  return {
    id: player.id, name: player.name,
    team: player.team_name, teamSlug: player.team_slug,
    isGoalie: player.is_goalie,
    seasonStats, allTimeStats, allTimeAllSeasonsStats, perSeasonStats,
    goalieSeasonStats, allTimeGoalieStats, allTimeAllSeasonsGoalieStats, perSeasonGoalieStats,
    games, goalieGames,
    playoffPerSeasonStats, playoffAllTimeStats, playoffAllTimeAllSeasonsStats, playoffGames,
    playoffPerSeasonGoalieStats, playoffAllTimeGoalieStats, playoffAllTimeAllSeasonsGoalieStats, playoffGoalieGames,
    championships,
    awards,
    hallOfFame,
  }
}
