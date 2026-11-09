import { cache } from "react"
import { fetchPlayerQueryGroup } from "@/lib/fetch-player-query-group"
import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getCurrentSeason, getAllSeasons, compareSeasonsDesc } from "@/lib/seasons"
import { playerSlugSql } from "@/lib/player-slug-sql"
import { computeGaa, DEFAULT_GAME_LENGTH_MIN } from "@/lib/game-rules"
import { forfeitEligibleGamePredicate, effectiveRowTeamSlugSql } from "@/lib/forfeit-sql"

export type SkaterStats = {
  gp: number
  goals: number
  assists: number
  points: number
  ptsPg: string
  gwg: number
  ppg: number
  shg: number
  eng: number
  hatTricks: number
  pen: number
  pim: number
}

export type GoalieStats = {
  gp: number
  wins: number
  losses: number
  gaa: string
  savePercentage: string
  saves: number
  goalsAgainst: number
  shotsAgainst: number
  shutouts: number
  goalieAssists: number
  seconds: number
}

export type SeasonSkaterStats = { seasonId: string; seasonName: string; teamName: string; teamSlug: string; stats: SkaterStats }
export type SeasonGoalieStats = { seasonId: string; seasonName: string; teamName: string; teamSlug: string; stats: GoalieStats }

export type SkaterGameLog = {
  gameId: string
  date: string
  opponent: string
  opponentSlug: string
  isHome: boolean
  teamScore: number | null
  opponentScore: number | null
  result: string | null
  goals: number
  assists: number
  points: number
  gwg: number
  ppg: number
  shg: number
  eng: number
  hatTricks: number
  pen: number
  pim: number
  gameType?: string
  isForfeit?: boolean
}

export type GoalieGameLog = {
  gameId: string
  date: string
  opponent: string
  opponentSlug: string
  isHome: boolean
  teamScore: number | null
  opponentScore: number | null
  seconds: number
  goalsAgainst: number
  shotsAgainst: number
  saves: number
  savePercentage: string
  shutouts: number
  goalieAssists: number
  result: string | null
  gameType?: string
  isForfeit?: boolean
}

export type Championship = {
  seasonId: string
  seasonName: string
}

export type PlayerAward = {
  awardType: string
  seasonId: string
  seasonName: string
}

export type HallOfFameEntry = {
  classYear: number
  wing: string
  yearsActive: string | null
  achievements: string | null
}

export interface PlayerDetail {
  id: number
  name: string
  team: string
  teamSlug: string
  isGoalie: boolean
  seasonStats: SkaterStats | null
  allTimeStats: SkaterStats | null
  allTimeAllSeasonsStats: SkaterStats | null
  perSeasonStats: SeasonSkaterStats[]
  goalieSeasonStats: GoalieStats | null
  allTimeGoalieStats: GoalieStats | null
  allTimeAllSeasonsGoalieStats: GoalieStats | null
  perSeasonGoalieStats: SeasonGoalieStats[]
  games: SkaterGameLog[]
  goalieGames: GoalieGameLog[]
  playoffPerSeasonStats: SeasonSkaterStats[]
  playoffAllTimeStats: SkaterStats | null
  playoffAllTimeAllSeasonsStats: SkaterStats | null
  playoffGames: SkaterGameLog[]
  playoffPerSeasonGoalieStats: SeasonGoalieStats[]
  playoffAllTimeGoalieStats: GoalieStats | null
  playoffAllTimeAllSeasonsGoalieStats: GoalieStats | null
  playoffGoalieGames: GoalieGameLog[]
  exhibitionGames: SkaterGameLog[]
  exhibitionGoalieGames: GoalieGameLog[]
  championships: Championship[]
  awards: PlayerAward[]
  hallOfFame: HallOfFameEntry | null
}

async function fetchPlayerDetailInternal(slug: string): Promise<PlayerDetail | null> {
  const [currentSeason, allSeasons, allMatches] = await Promise.all([
    getCurrentSeason(),
    getAllSeasons(),
    rawSql(sql`
      SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name, ps.season_id
      FROM players p
      LEFT JOIN player_seasons ps ON p.id = ps.player_id
      LEFT JOIN teams t ON ps.team_slug = t.slug
      WHERE ${playerSlugSql(sql`p.name`)} = ${slug}
      ORDER BY p.id
    `),
  ])
  const currentSeasonId = currentSeason.id
  const seasonMap = new Map(allSeasons.map(s => [s.id, s.name]))
  const seasonRanks = new Map(allSeasons.map((season, index) => [season.id, index]))
  const matchedPlayer = allMatches[0]
  if (!matchedPlayer) return null
  // Prefer the featured season; otherwise use the newest membership. The
  // memberships arrived with the identity read, avoiding a serial DB request.
  let playerRows = allMatches
    .filter((row) => row.id === matchedPlayer.id && row.team_name != null)
    .sort((a, b) => {
      if (a.season_id === currentSeasonId && b.season_id !== currentSeasonId) return -1
      if (b.season_id === currentSeasonId && a.season_id !== currentSeasonId) return 1
      return (seasonRanks.get(a.season_id) ?? Infinity) - (seasonRanks.get(b.season_id) ?? Infinity)
    })

  // Tryout-only player fallback — no player_seasons record exists
  if (playerRows.length === 0) {
    playerRows = [{
      id: matchedPlayer.id,
      name: matchedPlayer.name,
      team_slug: null,
      team_name: "Tryout Player",
      is_goalie: false,
      season_id: currentSeasonId,
    }]
  }

  const player = playerRows[0]
  const playerSeasonId = player.season_id

  let seasonStats: PlayerDetail["seasonStats"] = null
  let allTimeStats: PlayerDetail["allTimeStats"] = null
  let allTimeAllSeasonsStats: PlayerDetail["allTimeAllSeasonsStats"] = null
  let goalieSeasonStats: PlayerDetail["goalieSeasonStats"] = null
  let allTimeGoalieStats: PlayerDetail["allTimeGoalieStats"] = null
  let allTimeAllSeasonsGoalieStats: PlayerDetail["allTimeAllSeasonsGoalieStats"] = null
  let playoffAllTimeStats: PlayerDetail["playoffAllTimeStats"] = null
  let playoffAllTimeAllSeasonsStats: PlayerDetail["playoffAllTimeAllSeasonsStats"] = null
  let playoffAllTimeGoalieStats: PlayerDetail["playoffAllTimeGoalieStats"] = null
  let playoffAllTimeAllSeasonsGoalieStats: PlayerDetail["playoffAllTimeAllSeasonsGoalieStats"] = null
  let hallOfFame: PlayerDetail["hallOfFame"] = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildSkaterStats(s: any): SkaterStats {
    const playedGp = (s.played_gp !== undefined ? Number(s.played_gp) : Number(s.gp)) || 0
    return {
      gp: s.gp, goals: s.goals, assists: s.assists, points: s.points,
      ptsPg: playedGp > 0 ? (s.points / playedGp).toFixed(2) : "0.00",
      gwg: s.gwg, ppg: s.ppg, shg: s.shg, eng: s.eng,
      hatTricks: s.hat_tricks, pen: s.pen, pim: s.pim,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildGoalieStats(s: any, gameLength: number = DEFAULT_GAME_LENGTH_MIN): GoalieStats {
    const svPct = s.sa > 0 ? (s.saves / s.sa) : 0
    const gaa = computeGaa(s.ga, s.seconds, gameLength)
    return {
      gp: s.gp, wins: s.wins, losses: s.losses,
      gaa: gaa.toFixed(2), savePercentage: svPct.toFixed(3),
      saves: s.saves, goalsAgainst: s.ga, shotsAgainst: s.sa,
      shutouts: s.shutouts, goalieAssists: s.goalie_assists, seconds: s.seconds,
    }
  }

  const pid = player.id
  const skaterForfeitPred = forfeitEligibleGamePredicate(effectiveRowTeamSlugSql("pgs"))
  const goalieForfeitPred = forfeitEligibleGamePredicate(effectiveRowTeamSlugSql("ggs"))

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
    exhSkaterGameRows, exhGoalieGameRows,
  ] = await fetchPlayerQueryGroup(pid, [
    // Skater season stats (regular season)
    sql`
      SELECT
        COUNT(*)::int as gp,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit)::int as played_gp,
        COALESCE(SUM(goals) FILTER (WHERE NOT g.is_forfeit), 0)::int as goals,
        COALESCE(SUM(assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as assists,
        COALESCE(SUM(points) FILTER (WHERE NOT g.is_forfeit), 0)::int as points,
        COALESCE(SUM(gwg) FILTER (WHERE NOT g.is_forfeit), 0)::int as gwg,
        COALESCE(SUM(ppg) FILTER (WHERE NOT g.is_forfeit), 0)::int as ppg,
        COALESCE(SUM(shg) FILTER (WHERE NOT g.is_forfeit), 0)::int as shg,
        COALESCE(SUM(eng) FILTER (WHERE NOT g.is_forfeit), 0)::int as eng,
        COALESCE(SUM(hat_tricks) FILTER (WHERE NOT g.is_forfeit), 0)::int as hat_tricks,
        COALESCE(SUM(pen) FILTER (WHERE NOT g.is_forfeit), 0)::int as pen,
        COALESCE(SUM(pim) FILTER (WHERE NOT g.is_forfeit), 0)::int as pim
      FROM player_stats pgs
      JOIN games g ON pgs.game_id = g.id AND ${skaterForfeitPred} AND g.season_id = ${playerSeasonId} AND NOT g.is_playoff AND g.game_type = 'regular'
      WHERE pgs.player_id = ${pid} AND NOT pgs.is_sub
    `,
    // Skater all-time stats (regular season, fall only — includes historical)
    sql`
      WITH game_totals AS (
        SELECT
          COUNT(*)::int as gp,
          COUNT(*) FILTER (WHERE NOT g.is_forfeit)::int as played_gp,
          COALESCE(SUM(goals) FILTER (WHERE NOT g.is_forfeit), 0)::int as goals,
          COALESCE(SUM(assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as assists,
          COALESCE(SUM(points) FILTER (WHERE NOT g.is_forfeit), 0)::int as points,
          COALESCE(SUM(gwg) FILTER (WHERE NOT g.is_forfeit), 0)::int as gwg,
          COALESCE(SUM(ppg) FILTER (WHERE NOT g.is_forfeit), 0)::int as ppg,
          COALESCE(SUM(shg) FILTER (WHERE NOT g.is_forfeit), 0)::int as shg,
          COALESCE(SUM(eng) FILTER (WHERE NOT g.is_forfeit), 0)::int as eng,
          COALESCE(SUM(hat_tricks) FILTER (WHERE NOT g.is_forfeit), 0)::int as hat_tricks,
          COALESCE(SUM(pen) FILTER (WHERE NOT g.is_forfeit), 0)::int as pen,
          COALESCE(SUM(pim) FILTER (WHERE NOT g.is_forfeit), 0)::int as pim
        FROM player_stats pgs
        JOIN games g ON pgs.game_id = g.id AND ${skaterForfeitPred} AND NOT g.is_playoff AND g.game_type = 'regular'
        JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
        WHERE pgs.player_id = ${pid} AND NOT pgs.is_sub
      ), hist_totals AS (
        SELECT
          SUM(gp)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM historical_stats
        WHERE player_id = ${pid} AND NOT is_playoff
      )
      SELECT
        COALESCE(g.gp, 0) + COALESCE(h.gp, 0) as gp,
        COALESCE(g.played_gp, 0) + COALESCE(h.gp, 0) as played_gp,
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
    `,
    // Skater per-season stats (regular season — includes historical)
    sql`
      SELECT season_id, team_slug, team_name, gp, played_gp, goals, assists, points,
             gwg, ppg, shg, eng, hat_tricks, pen, pim
      FROM (
        SELECT
          g.season_id,
          COALESCE(
            pgs.team_slug,
            (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = pgs.player_id AND ps.season_id = g.season_id LIMIT 1)
          ) AS team_slug,
          t.name as team_name,
          COUNT(*)::int as gp,
          COUNT(*) FILTER (WHERE NOT g.is_forfeit)::int as played_gp,
          COALESCE(SUM(pgs.goals) FILTER (WHERE NOT g.is_forfeit), 0)::int as goals,
          COALESCE(SUM(pgs.assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as assists,
          COALESCE(SUM(pgs.points) FILTER (WHERE NOT g.is_forfeit), 0)::int as points,
          COALESCE(SUM(pgs.gwg) FILTER (WHERE NOT g.is_forfeit), 0)::int as gwg,
          COALESCE(SUM(pgs.ppg) FILTER (WHERE NOT g.is_forfeit), 0)::int as ppg,
          COALESCE(SUM(pgs.shg) FILTER (WHERE NOT g.is_forfeit), 0)::int as shg,
          COALESCE(SUM(pgs.eng) FILTER (WHERE NOT g.is_forfeit), 0)::int as eng,
          COALESCE(SUM(pgs.hat_tricks) FILTER (WHERE NOT g.is_forfeit), 0)::int as hat_tricks,
          COALESCE(SUM(pgs.pen) FILTER (WHERE NOT g.is_forfeit), 0)::int as pen,
          COALESCE(SUM(pgs.pim) FILTER (WHERE NOT g.is_forfeit), 0)::int as pim
        FROM player_stats pgs
        JOIN games g ON pgs.game_id = g.id AND ${skaterForfeitPred} AND NOT g.is_playoff AND g.game_type = 'regular'
        LEFT JOIN teams t ON t.slug = COALESCE(
          pgs.team_slug,
          (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = pgs.player_id AND ps.season_id = g.season_id LIMIT 1)
        )
        WHERE pgs.player_id = ${pid} AND NOT pgs.is_sub
        GROUP BY g.season_id, COALESCE(
          pgs.team_slug,
          (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = pgs.player_id AND ps.season_id = g.season_id LIMIT 1)
        ), t.name
        UNION ALL
        SELECT
          pss.season_id, pss.team_slug, t.name as team_name,
          pss.gp, pss.gp as played_gp, pss.goals, pss.assists, pss.points,
          pss.gwg, pss.ppg, pss.shg, pss.eng, pss.hat_tricks, pss.pen, pss.pim
        FROM historical_stats pss
        JOIN teams t ON pss.team_slug = t.slug
        WHERE pss.player_id = ${pid} AND NOT pss.is_playoff
      ) combined
      ORDER BY season_id DESC
    `,
    // Skater game log (regular season)
    sql`
      SELECT
        pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime, g.is_forfeit,
        COALESCE(ht.name, g.home_team) as home_name, COALESCE(awt.name, g.away_team) as away_name,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.goals END as goals,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.assists END as assists,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.points END as points,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.gwg END as gwg,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.ppg END as ppg,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.shg END as shg,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.eng END as eng,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.hat_tricks END as hat_tricks,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.pen END as pen,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.pim END as pim,
        pgs.team_slug AS player_team_slug
      FROM player_stats pgs
      JOIN games g ON pgs.game_id = g.id AND ${skaterForfeitPred} AND g.season_id = ${playerSeasonId} AND NOT g.is_playoff AND g.game_type = 'regular'
      LEFT JOIN teams ht ON g.home_team = ht.slug
      LEFT JOIN teams awt ON g.away_team = awt.slug
      WHERE pgs.player_id = ${pid} AND NOT pgs.is_sub
      ORDER BY g.date DESC
    `,
    // Goalie season stats (regular season)
    sql`
      SELECT
        COUNT(*)::int as gp,
        COALESCE(SUM(goals_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as ga,
        COALESCE(SUM(saves) FILTER (WHERE NOT g.is_forfeit), 0)::int as saves,
        COALESCE(SUM(shots_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as sa,
        COALESCE(SUM(seconds) FILTER (WHERE NOT g.is_forfeit), 0)::int as seconds,
        COALESCE(SUM(shutouts) FILTER (WHERE NOT g.is_forfeit), 0)::int as shutouts,
        COALESCE(SUM(goalie_assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as goalie_assists,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'L')::int as losses,
        COALESCE(MAX(s.game_length), ${DEFAULT_GAME_LENGTH_MIN})::int as game_length
      FROM goalie_stats ggs
      JOIN games g ON ggs.game_id = g.id AND ${goalieForfeitPred} AND g.season_id = ${playerSeasonId} AND NOT g.is_playoff AND g.game_type = 'regular'
      LEFT JOIN seasons s ON g.season_id = s.id
      WHERE ggs.player_id = ${pid} AND NOT ggs.is_sub
    `,
    // Goalie all-time stats (regular season, fall only)
    sql`
      SELECT
        COUNT(*)::int as gp,
        COALESCE(SUM(goals_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as ga,
        COALESCE(SUM(saves) FILTER (WHERE NOT g.is_forfeit), 0)::int as saves,
        COALESCE(SUM(shots_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as sa,
        COALESCE(SUM(seconds) FILTER (WHERE NOT g.is_forfeit), 0)::int as seconds,
        COALESCE(SUM(shutouts) FILTER (WHERE NOT g.is_forfeit), 0)::int as shutouts,
        COALESCE(SUM(goalie_assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as goalie_assists,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'L')::int as losses
      FROM goalie_stats ggs
      JOIN games g ON ggs.game_id = g.id AND ${goalieForfeitPred} AND NOT g.is_playoff AND g.game_type = 'regular'
      JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
      WHERE ggs.player_id = ${pid} AND NOT ggs.is_sub
    `,
    // Goalie per-season stats (regular season)
    sql`
      SELECT
        g.season_id,
        COALESCE(
          ggs.team_slug,
          (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = ggs.player_id AND ps.season_id = g.season_id LIMIT 1)
        ) AS team_slug,
        t.name as team_name,
        COUNT(*)::int as gp,
        COALESCE(SUM(goals_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as ga,
        COALESCE(SUM(saves) FILTER (WHERE NOT g.is_forfeit), 0)::int as saves,
        COALESCE(SUM(shots_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as sa,
        COALESCE(SUM(seconds) FILTER (WHERE NOT g.is_forfeit), 0)::int as seconds,
        COALESCE(SUM(shutouts) FILTER (WHERE NOT g.is_forfeit), 0)::int as shutouts,
        COALESCE(SUM(goalie_assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as goalie_assists,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'L')::int as losses,
        COALESCE(MAX(s.game_length), ${DEFAULT_GAME_LENGTH_MIN})::int as game_length
      FROM goalie_stats ggs
      JOIN games g ON ggs.game_id = g.id AND ${goalieForfeitPred} AND NOT g.is_playoff AND g.game_type = 'regular'
      LEFT JOIN teams t ON t.slug = COALESCE(
        ggs.team_slug,
        (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = ggs.player_id AND ps.season_id = g.season_id LIMIT 1)
      )
      LEFT JOIN seasons s ON g.season_id = s.id
      WHERE ggs.player_id = ${pid} AND NOT ggs.is_sub
      GROUP BY g.season_id, COALESCE(
        ggs.team_slug,
        (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = ggs.player_id AND ps.season_id = g.season_id LIMIT 1)
      ), t.name
      ORDER BY g.season_id DESC
    `,
    // Goalie game log (regular season)
    sql`
      SELECT
        ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_forfeit,
        COALESCE(ht.name, g.home_team) as home_name, COALESCE(awt.name, g.away_team) as away_name,
        CASE WHEN g.is_forfeit THEN 0 ELSE ggs.seconds END as seconds,
        CASE WHEN g.is_forfeit THEN 0 ELSE ggs.goals_against END as goals_against,
        CASE WHEN g.is_forfeit THEN 0 ELSE ggs.shots_against END as shots_against,
        CASE WHEN g.is_forfeit THEN 0 ELSE ggs.saves END as saves,
        CASE WHEN g.is_forfeit THEN 0 ELSE ggs.shutouts END as shutouts,
        CASE WHEN g.is_forfeit THEN 0 ELSE ggs.goalie_assists END as goalie_assists,
        CASE WHEN g.is_forfeit THEN NULL ELSE ggs.result END as result,
        ggs.team_slug AS player_team_slug
      FROM goalie_stats ggs
      JOIN games g ON ggs.game_id = g.id AND ${goalieForfeitPred} AND g.season_id = ${playerSeasonId} AND NOT g.is_playoff AND g.game_type = 'regular'
      LEFT JOIN teams ht ON g.home_team = ht.slug
      LEFT JOIN teams awt ON g.away_team = awt.slug
      WHERE ggs.player_id = ${pid} AND NOT ggs.is_sub
      ORDER BY g.date DESC
    `,
    // Playoff skater all-time stats (fall only — includes historical)
    sql`
      WITH game_totals AS (
        SELECT
          COUNT(*)::int as gp,
          COUNT(*) FILTER (WHERE NOT g.is_forfeit)::int as played_gp,
          COALESCE(SUM(goals) FILTER (WHERE NOT g.is_forfeit), 0)::int as goals,
          COALESCE(SUM(assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as assists,
          COALESCE(SUM(points) FILTER (WHERE NOT g.is_forfeit), 0)::int as points,
          COALESCE(SUM(gwg) FILTER (WHERE NOT g.is_forfeit), 0)::int as gwg,
          COALESCE(SUM(ppg) FILTER (WHERE NOT g.is_forfeit), 0)::int as ppg,
          COALESCE(SUM(shg) FILTER (WHERE NOT g.is_forfeit), 0)::int as shg,
          COALESCE(SUM(eng) FILTER (WHERE NOT g.is_forfeit), 0)::int as eng,
          COALESCE(SUM(hat_tricks) FILTER (WHERE NOT g.is_forfeit), 0)::int as hat_tricks,
          COALESCE(SUM(pen) FILTER (WHERE NOT g.is_forfeit), 0)::int as pen,
          COALESCE(SUM(pim) FILTER (WHERE NOT g.is_forfeit), 0)::int as pim
        FROM player_stats pgs
        JOIN games g ON pgs.game_id = g.id AND ${skaterForfeitPred} AND g.is_playoff AND g.game_type IN ('playoff', 'championship', 'regular')
        JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
        WHERE pgs.player_id = ${pid} AND NOT pgs.is_sub
      ), hist_totals AS (
        SELECT
          SUM(gp)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM historical_stats
        WHERE player_id = ${pid} AND is_playoff
      )
      SELECT
        COALESCE(g.gp, 0) + COALESCE(h.gp, 0) as gp,
        COALESCE(g.played_gp, 0) + COALESCE(h.gp, 0) as played_gp,
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
    `,
    // Playoff skater per-season stats (includes historical)
    sql`
      SELECT season_id, team_slug, team_name, gp, played_gp, goals, assists, points,
             gwg, ppg, shg, eng, hat_tricks, pen, pim
      FROM (
        SELECT
          g.season_id,
          COALESCE(
            pgs.team_slug,
            (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = pgs.player_id AND ps.season_id = g.season_id LIMIT 1)
          ) AS team_slug,
          t.name as team_name,
          COUNT(*)::int as gp,
          COUNT(*) FILTER (WHERE NOT g.is_forfeit)::int as played_gp,
          COALESCE(SUM(pgs.goals) FILTER (WHERE NOT g.is_forfeit), 0)::int as goals,
          COALESCE(SUM(pgs.assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as assists,
          COALESCE(SUM(pgs.points) FILTER (WHERE NOT g.is_forfeit), 0)::int as points,
          COALESCE(SUM(pgs.gwg) FILTER (WHERE NOT g.is_forfeit), 0)::int as gwg,
          COALESCE(SUM(pgs.ppg) FILTER (WHERE NOT g.is_forfeit), 0)::int as ppg,
          COALESCE(SUM(pgs.shg) FILTER (WHERE NOT g.is_forfeit), 0)::int as shg,
          COALESCE(SUM(pgs.eng) FILTER (WHERE NOT g.is_forfeit), 0)::int as eng,
          COALESCE(SUM(pgs.hat_tricks) FILTER (WHERE NOT g.is_forfeit), 0)::int as hat_tricks,
          COALESCE(SUM(pgs.pen) FILTER (WHERE NOT g.is_forfeit), 0)::int as pen,
          COALESCE(SUM(pgs.pim) FILTER (WHERE NOT g.is_forfeit), 0)::int as pim
        FROM player_stats pgs
        JOIN games g ON pgs.game_id = g.id AND ${skaterForfeitPred} AND g.is_playoff AND g.game_type IN ('playoff', 'championship', 'regular')
        LEFT JOIN teams t ON t.slug = COALESCE(
          pgs.team_slug,
          (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = pgs.player_id AND ps.season_id = g.season_id LIMIT 1)
        )
        WHERE pgs.player_id = ${pid} AND NOT pgs.is_sub
        GROUP BY g.season_id, COALESCE(
          pgs.team_slug,
          (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = pgs.player_id AND ps.season_id = g.season_id LIMIT 1)
        ), t.name
        UNION ALL
        SELECT
          pss.season_id, pss.team_slug, t.name as team_name,
          pss.gp, pss.gp as played_gp, pss.goals, pss.assists, pss.points,
          pss.gwg, pss.ppg, pss.shg, pss.eng, pss.hat_tricks, pss.pen, pss.pim
        FROM historical_stats pss
        JOIN teams t ON pss.team_slug = t.slug
        WHERE pss.player_id = ${pid} AND pss.is_playoff
      ) combined
      ORDER BY season_id DESC
    `,
    // Playoff skater game log
    sql`
      SELECT
        pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime, g.is_forfeit,
        COALESCE(ht.name, g.home_team) as home_name, COALESCE(awt.name, g.away_team) as away_name,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.goals END as goals,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.assists END as assists,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.points END as points,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.gwg END as gwg,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.ppg END as ppg,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.shg END as shg,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.eng END as eng,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.hat_tricks END as hat_tricks,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.pen END as pen,
        CASE WHEN g.is_forfeit THEN 0 ELSE pgs.pim END as pim,
        pgs.team_slug AS player_team_slug
      FROM player_stats pgs
      JOIN games g ON pgs.game_id = g.id AND ${skaterForfeitPred} AND g.season_id = ${playerSeasonId} AND g.is_playoff AND g.game_type IN ('playoff', 'championship', 'regular')
      LEFT JOIN teams ht ON g.home_team = ht.slug
      LEFT JOIN teams awt ON g.away_team = awt.slug
      WHERE pgs.player_id = ${pid} AND NOT pgs.is_sub
      ORDER BY g.date DESC
    `,
    // Playoff goalie all-time stats (fall only)
    sql`
      SELECT
        COUNT(*)::int as gp,
        COALESCE(SUM(goals_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as ga,
        COALESCE(SUM(saves) FILTER (WHERE NOT g.is_forfeit), 0)::int as saves,
        COALESCE(SUM(shots_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as sa,
        COALESCE(SUM(seconds) FILTER (WHERE NOT g.is_forfeit), 0)::int as seconds,
        COALESCE(SUM(shutouts) FILTER (WHERE NOT g.is_forfeit), 0)::int as shutouts,
        COALESCE(SUM(goalie_assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as goalie_assists,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'L')::int as losses
      FROM goalie_stats ggs
      JOIN games g ON ggs.game_id = g.id AND ${goalieForfeitPred} AND g.is_playoff AND g.game_type IN ('playoff', 'championship', 'regular')
      JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
      WHERE ggs.player_id = ${pid} AND NOT ggs.is_sub
    `,
    // Playoff goalie per-season stats
    sql`
      SELECT
        g.season_id,
        COALESCE(
          ggs.team_slug,
          (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = ggs.player_id AND ps.season_id = g.season_id LIMIT 1)
        ) AS team_slug,
        t.name as team_name,
        COUNT(*)::int as gp,
        COALESCE(SUM(goals_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as ga,
        COALESCE(SUM(saves) FILTER (WHERE NOT g.is_forfeit), 0)::int as saves,
        COALESCE(SUM(shots_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as sa,
        COALESCE(SUM(seconds) FILTER (WHERE NOT g.is_forfeit), 0)::int as seconds,
        COALESCE(SUM(shutouts) FILTER (WHERE NOT g.is_forfeit), 0)::int as shutouts,
        COALESCE(SUM(goalie_assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as goalie_assists,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'L')::int as losses,
        COALESCE(MAX(s.game_length), ${DEFAULT_GAME_LENGTH_MIN})::int as game_length
      FROM goalie_stats ggs
      JOIN games g ON ggs.game_id = g.id AND ${goalieForfeitPred} AND g.is_playoff AND g.game_type IN ('playoff', 'championship', 'regular')
      LEFT JOIN teams t ON t.slug = COALESCE(
        ggs.team_slug,
        (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = ggs.player_id AND ps.season_id = g.season_id LIMIT 1)
      )
      LEFT JOIN seasons s ON g.season_id = s.id
      WHERE ggs.player_id = ${pid} AND NOT ggs.is_sub
      GROUP BY g.season_id, COALESCE(
        ggs.team_slug,
        (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = ggs.player_id AND ps.season_id = g.season_id LIMIT 1)
      ), t.name
      ORDER BY g.season_id DESC
    `,
    // Playoff goalie game log
    sql`
      SELECT
        ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_forfeit,
        COALESCE(ht.name, g.home_team) as home_name, COALESCE(awt.name, g.away_team) as away_name,
        CASE WHEN g.is_forfeit THEN 0 ELSE ggs.seconds END as seconds,
        CASE WHEN g.is_forfeit THEN 0 ELSE ggs.goals_against END as goals_against,
        CASE WHEN g.is_forfeit THEN 0 ELSE ggs.shots_against END as shots_against,
        CASE WHEN g.is_forfeit THEN 0 ELSE ggs.saves END as saves,
        CASE WHEN g.is_forfeit THEN 0 ELSE ggs.shutouts END as shutouts,
        CASE WHEN g.is_forfeit THEN 0 ELSE ggs.goalie_assists END as goalie_assists,
        CASE WHEN g.is_forfeit THEN NULL ELSE ggs.result END as result,
        ggs.team_slug AS player_team_slug
      FROM goalie_stats ggs
      JOIN games g ON ggs.game_id = g.id AND ${goalieForfeitPred} AND g.season_id = ${playerSeasonId} AND g.is_playoff AND g.game_type IN ('playoff', 'championship', 'regular')
      LEFT JOIN teams ht ON g.home_team = ht.slug
      LEFT JOIN teams awt ON g.away_team = awt.slug
      WHERE ggs.player_id = ${pid} AND NOT ggs.is_sub
      ORDER BY g.date DESC
    `,
    // Championships
    sql`
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
    `,
    // Player awards
    sql`SELECT award_type AS "awardType", season_id AS "seasonId"
      FROM player_awards WHERE player_id = ${pid} ORDER BY season_id DESC`,
    // Hall of Fame
    sql`
      SELECT class_year, wing, years_active, achievements FROM hall_of_fame
      WHERE player_id = ${pid}
      LIMIT 1
    `,
    // Skater all-time stats (regular season, ALL seasons — includes historical)
    sql`
      WITH game_totals AS (
        SELECT
          COUNT(*)::int as gp,
          COUNT(*) FILTER (WHERE NOT g.is_forfeit)::int as played_gp,
          COALESCE(SUM(goals) FILTER (WHERE NOT g.is_forfeit), 0)::int as goals,
          COALESCE(SUM(assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as assists,
          COALESCE(SUM(points) FILTER (WHERE NOT g.is_forfeit), 0)::int as points,
          COALESCE(SUM(gwg) FILTER (WHERE NOT g.is_forfeit), 0)::int as gwg,
          COALESCE(SUM(ppg) FILTER (WHERE NOT g.is_forfeit), 0)::int as ppg,
          COALESCE(SUM(shg) FILTER (WHERE NOT g.is_forfeit), 0)::int as shg,
          COALESCE(SUM(eng) FILTER (WHERE NOT g.is_forfeit), 0)::int as eng,
          COALESCE(SUM(hat_tricks) FILTER (WHERE NOT g.is_forfeit), 0)::int as hat_tricks,
          COALESCE(SUM(pen) FILTER (WHERE NOT g.is_forfeit), 0)::int as pen,
          COALESCE(SUM(pim) FILTER (WHERE NOT g.is_forfeit), 0)::int as pim
        FROM player_stats pgs
        JOIN games g ON pgs.game_id = g.id AND ${skaterForfeitPred} AND NOT g.is_playoff AND g.game_type = 'regular'
        WHERE pgs.player_id = ${pid} AND NOT pgs.is_sub
      ), hist_totals AS (
        SELECT
          SUM(gp)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM historical_stats
        WHERE player_id = ${pid} AND NOT is_playoff
      )
      SELECT
        COALESCE(g.gp, 0) + COALESCE(h.gp, 0) as gp,
        COALESCE(g.played_gp, 0) + COALESCE(h.gp, 0) as played_gp,
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
    `,
    // Goalie all-time stats (regular season, ALL seasons)
    sql`
      SELECT
        COUNT(*)::int as gp,
        COALESCE(SUM(goals_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as ga,
        COALESCE(SUM(saves) FILTER (WHERE NOT g.is_forfeit), 0)::int as saves,
        COALESCE(SUM(shots_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as sa,
        COALESCE(SUM(seconds) FILTER (WHERE NOT g.is_forfeit), 0)::int as seconds,
        COALESCE(SUM(shutouts) FILTER (WHERE NOT g.is_forfeit), 0)::int as shutouts,
        COALESCE(SUM(goalie_assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as goalie_assists,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'L')::int as losses
      FROM goalie_stats ggs
      JOIN games g ON ggs.game_id = g.id AND ${goalieForfeitPred} AND NOT g.is_playoff AND g.game_type = 'regular'
      WHERE ggs.player_id = ${pid} AND NOT ggs.is_sub
    `,
    // Playoff skater all-time stats (ALL seasons — includes historical)
    sql`
      WITH game_totals AS (
        SELECT
          COUNT(*)::int as gp,
          COUNT(*) FILTER (WHERE NOT g.is_forfeit)::int as played_gp,
          COALESCE(SUM(goals) FILTER (WHERE NOT g.is_forfeit), 0)::int as goals,
          COALESCE(SUM(assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as assists,
          COALESCE(SUM(points) FILTER (WHERE NOT g.is_forfeit), 0)::int as points,
          COALESCE(SUM(gwg) FILTER (WHERE NOT g.is_forfeit), 0)::int as gwg,
          COALESCE(SUM(ppg) FILTER (WHERE NOT g.is_forfeit), 0)::int as ppg,
          COALESCE(SUM(shg) FILTER (WHERE NOT g.is_forfeit), 0)::int as shg,
          COALESCE(SUM(eng) FILTER (WHERE NOT g.is_forfeit), 0)::int as eng,
          COALESCE(SUM(hat_tricks) FILTER (WHERE NOT g.is_forfeit), 0)::int as hat_tricks,
          COALESCE(SUM(pen) FILTER (WHERE NOT g.is_forfeit), 0)::int as pen,
          COALESCE(SUM(pim) FILTER (WHERE NOT g.is_forfeit), 0)::int as pim
        FROM player_stats pgs
        JOIN games g ON pgs.game_id = g.id AND ${skaterForfeitPred} AND g.is_playoff AND g.game_type IN ('playoff', 'championship', 'regular')
        WHERE pgs.player_id = ${pid} AND NOT pgs.is_sub
      ), hist_totals AS (
        SELECT
          SUM(gp)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM historical_stats
        WHERE player_id = ${pid} AND is_playoff
      )
      SELECT
        COALESCE(g.gp, 0) + COALESCE(h.gp, 0) as gp,
        COALESCE(g.played_gp, 0) + COALESCE(h.gp, 0) as played_gp,
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
    `,
    // Playoff goalie all-time stats (ALL seasons)
    sql`
      SELECT
        COUNT(*)::int as gp,
        COALESCE(SUM(goals_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as ga,
        COALESCE(SUM(saves) FILTER (WHERE NOT g.is_forfeit), 0)::int as saves,
        COALESCE(SUM(shots_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as sa,
        COALESCE(SUM(seconds) FILTER (WHERE NOT g.is_forfeit), 0)::int as seconds,
        COALESCE(SUM(shutouts) FILTER (WHERE NOT g.is_forfeit), 0)::int as shutouts,
        COALESCE(SUM(goalie_assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as goalie_assists,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE NOT g.is_forfeit AND result = 'L')::int as losses
      FROM goalie_stats ggs
      JOIN games g ON ggs.game_id = g.id AND ${goalieForfeitPred} AND g.is_playoff AND g.game_type IN ('playoff', 'championship', 'regular')
      WHERE ggs.player_id = ${pid} AND NOT ggs.is_sub
    `,
    // Exhibition/tryout skater game log
    sql`
      SELECT
        pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime,
        COALESCE(ht.name, g.home_team) as home_name, COALESCE(awt.name, g.away_team) as away_name,
        pgs.goals, pgs.assists, pgs.points, pgs.gwg, pgs.ppg, pgs.shg,
        pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim,
        g.game_type,
        pgs.team_slug AS player_team_slug
      FROM player_stats pgs
      JOIN games g ON pgs.game_id = g.id AND NOT g.is_forfeit AND g.game_type IN ('exhibition', 'tryout')
      LEFT JOIN teams ht ON g.home_team = ht.slug
      LEFT JOIN teams awt ON g.away_team = awt.slug
      WHERE pgs.player_id = ${pid} AND NOT pgs.is_sub
      ORDER BY g.date DESC
    `,
    // Exhibition/tryout goalie game log
    sql`
      SELECT
        ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score,
        COALESCE(ht.name, g.home_team) as home_name, COALESCE(awt.name, g.away_team) as away_name,
        ggs.seconds, ggs.goals_against, ggs.shots_against, ggs.saves,
        ggs.shutouts, ggs.goalie_assists, ggs.result,
        g.game_type,
        ggs.team_slug AS player_team_slug
      FROM goalie_stats ggs
      JOIN games g ON ggs.game_id = g.id AND NOT g.is_forfeit AND g.game_type IN ('exhibition', 'tryout')
      LEFT JOIN teams ht ON g.home_team = ht.slug
      LEFT JOIN teams awt ON g.away_team = awt.slug
      WHERE ggs.player_id = ${pid} AND NOT ggs.is_sub
      ORDER BY g.date DESC
    `,
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
  const perSeasonStats = skaterPerSeasonRows
    .filter((r) => r.gp > 0)
    .map((r) => ({
      seasonId: r.season_id,
      seasonName: seasonMap.get(r.season_id) ?? r.season_id,
      teamName: r.team_name ?? "",
      teamSlug: r.team_slug ?? "",
      stats: buildSkaterStats(r),
    })).sort(compareSeasonsDesc)
  const games = skaterGameRows.map((r) => {
    const effectiveTeamSlug = r.player_team_slug ?? teamSlug
    const isHome = effectiveTeamSlug ? r.home_team === effectiveTeamSlug : true
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
      isForfeit: Boolean(r.is_forfeit),
    }
  })

  // Populate goalie stats if data exists
  if (goalieSeasonRows.length > 0 && goalieSeasonRows[0].gp > 0) {
    goalieSeasonStats = buildGoalieStats(goalieSeasonRows[0], goalieSeasonRows[0].game_length)
  }
  if (goalieAllTimeRows.length > 0 && goalieAllTimeRows[0].gp > 0) {
    allTimeGoalieStats = buildGoalieStats(goalieAllTimeRows[0])
  }
  if (goalieAllSeasonsRows.length > 0 && goalieAllSeasonsRows[0].gp > 0) {
    allTimeAllSeasonsGoalieStats = buildGoalieStats(goalieAllSeasonsRows[0])
  }
  const perSeasonGoalieStats = goaliePerSeasonRows
    .filter((r) => r.gp > 0)
    .map((r) => ({
      seasonId: r.season_id,
      seasonName: seasonMap.get(r.season_id) ?? r.season_id,
      teamName: r.team_name ?? "",
      teamSlug: r.team_slug ?? "",
      stats: buildGoalieStats(r, r.game_length),
    })).sort(compareSeasonsDesc)
  const goalieGames = goalieGameRows.map((r) => {
    const effectiveTeamSlug = r.player_team_slug ?? teamSlug
    const isHome = effectiveTeamSlug ? r.home_team === effectiveTeamSlug : true
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
      isForfeit: Boolean(r.is_forfeit),
    }
  })

  // Populate playoff skater stats
  if (poSkaterAllTimeRows.length > 0 && poSkaterAllTimeRows[0].gp > 0) {
    playoffAllTimeStats = buildSkaterStats(poSkaterAllTimeRows[0])
  }
  if (poSkaterAllSeasonsRows.length > 0 && poSkaterAllSeasonsRows[0].gp > 0) {
    playoffAllTimeAllSeasonsStats = buildSkaterStats(poSkaterAllSeasonsRows[0])
  }
  const playoffPerSeasonStats = poSkaterPerSeasonRows
    .filter((r) => r.gp > 0)
    .map((r) => ({
      seasonId: r.season_id,
      seasonName: seasonMap.get(r.season_id) ?? r.season_id,
      teamName: r.team_name ?? "",
      teamSlug: r.team_slug ?? "",
      stats: buildSkaterStats(r),
    })).sort(compareSeasonsDesc)
  const playoffGames = poSkaterGameRows.map((r) => {
    const effectiveTeamSlug = r.player_team_slug ?? teamSlug
    const isHome = effectiveTeamSlug ? r.home_team === effectiveTeamSlug : true
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
      isForfeit: Boolean(r.is_forfeit),
    }
  })

  // Populate playoff goalie stats
  if (poGoalieAllTimeRows.length > 0 && poGoalieAllTimeRows[0].gp > 0) {
    playoffAllTimeGoalieStats = buildGoalieStats(poGoalieAllTimeRows[0])
  }
  if (poGoalieAllSeasonsRows.length > 0 && poGoalieAllSeasonsRows[0].gp > 0) {
    playoffAllTimeAllSeasonsGoalieStats = buildGoalieStats(poGoalieAllSeasonsRows[0])
  }
  const playoffPerSeasonGoalieStats = poGoaliePerSeasonRows
    .filter((r) => r.gp > 0)
    .map((r) => ({
      seasonId: r.season_id,
      seasonName: seasonMap.get(r.season_id) ?? r.season_id,
      teamName: r.team_name ?? "",
      teamSlug: r.team_slug ?? "",
      stats: buildGoalieStats(r, r.game_length),
    })).sort(compareSeasonsDesc)
  const playoffGoalieGames = poGoalieGameRows.map((r) => {
    const effectiveTeamSlug = r.player_team_slug ?? teamSlug
    const isHome = effectiveTeamSlug ? r.home_team === effectiveTeamSlug : true
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
      isForfeit: Boolean(r.is_forfeit),
    }
  })

  // Populate championships
  const championships = championshipRows.map((r) => ({
    seasonId: r.season_id,
    seasonName: seasonMap.get(r.season_id) ?? r.season_id,
  })).sort(compareSeasonsDesc)

  // Populate awards
  const awards = awardRows.map((r) => ({
    awardType: r.awardType,
    seasonId: r.seasonId,
    seasonName: seasonMap.get(r.seasonId) ?? r.seasonId,
  })).sort(compareSeasonsDesc)

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

  // Populate exhibition/tryout game logs
  const exhibitionGames = exhSkaterGameRows.map((r) => {
    const effectiveTeamSlug = r.player_team_slug ?? teamSlug
    const isHome = effectiveTeamSlug ? r.home_team === effectiveTeamSlug : true
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
      gameType: r.game_type,
    }
  })
  const exhibitionGoalieGames = exhGoalieGameRows.map((r) => {
    const effectiveTeamSlug = r.player_team_slug ?? teamSlug
    const isHome = effectiveTeamSlug ? r.home_team === effectiveTeamSlug : true
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
      gameType: r.game_type,
    }
  })

  return {
    id: player.id, name: player.name,
    team: player.team_name ?? "Unrostered", teamSlug: player.team_slug ?? "",
    isGoalie: player.is_goalie ?? false,
    seasonStats, allTimeStats, allTimeAllSeasonsStats, perSeasonStats,
    goalieSeasonStats, allTimeGoalieStats, allTimeAllSeasonsGoalieStats, perSeasonGoalieStats,
    games, goalieGames,
    playoffPerSeasonStats, playoffAllTimeStats, playoffAllTimeAllSeasonsStats, playoffGames,
    playoffPerSeasonGoalieStats, playoffAllTimeGoalieStats, playoffAllTimeAllSeasonsGoalieStats, playoffGoalieGames,
    exhibitionGames, exhibitionGoalieGames,
    championships,
    awards,
    hallOfFame,
  }
}

// Share metadata and page reads within a render; do not cache across requests.
export const fetchPlayerDetail = cache(fetchPlayerDetailInternal)
