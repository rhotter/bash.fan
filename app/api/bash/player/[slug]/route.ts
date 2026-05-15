import { NextResponse } from "next/server"
import { db, schema, rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getCurrentSeason, getAllSeasons } from "@/lib/seasons"
import { playerSlug } from "@/lib/player-slug"

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const { searchParams } = new URL(request.url)
  const seasonParam = searchParams.get("season")
  const isAllTime = seasonParam === "all"
  const currentSeasonId = (await getCurrentSeason()).id
  const seasonId = !isAllTime ? (seasonParam || currentSeasonId) : null
  const allSeasons = await getAllSeasons()
  const seasonMap = new Map(allSeasons.map(s => [s.id, s.name]))

  try {
    // Look up player by slug (derived from name)
    const allPlayers = await db.select({ id: schema.players.id, name: schema.players.name }).from(schema.players)
    const matchedPlayer = allPlayers.find(
      (p) => playerSlug(p.name) === slug
    )
    if (!matchedPlayer) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 })
    }
    const playerId = matchedPlayer.id

    // Look up the player — use requested season or fall back to most recent
    let playerRows
    if (isAllTime) {
      playerRows = await rawSql(sql`
        SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name
        FROM players p
        JOIN player_seasons ps ON p.id = ps.player_id
        JOIN teams t ON ps.team_slug = t.slug
        WHERE p.id = ${playerId}
        ORDER BY ps.season_id DESC
        LIMIT 1
      `)
    } else {
      playerRows = await rawSql(sql`
        SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name
        FROM players p
        JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = ${seasonId}
        JOIN teams t ON ps.team_slug = t.slug
        WHERE p.id = ${playerId}
        ORDER BY ps.season_id DESC
        LIMIT 1
      `)
      // Fall back to most recent season if not found in requested season
      if (playerRows.length === 0) {
        playerRows = await rawSql(sql`
          SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name
          FROM players p
          JOIN player_seasons ps ON p.id = ps.player_id
          JOIN teams t ON ps.team_slug = t.slug
          WHERE p.id = ${playerId}
          ORDER BY ps.season_id DESC
          LIMIT 1
        `)
      }
    }

    // Tryout-only player fallback — no player_seasons record exists
    if (playerRows.length === 0) {
      playerRows = [{
        id: matchedPlayer.id,
        name: matchedPlayer.name,
        team_slug: null,
        team_name: "Tryout Player",
        is_goalie: false,
      }]
    }

    const player = playerRows[0]

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
    let exhibitionGames: PlayerDetail["exhibitionGames"] = []
    let exhibitionGoalieGames: PlayerDetail["exhibitionGoalieGames"] = []
    let championships: PlayerDetail["championships"] = []
    let awards: PlayerDetail["awards"] = []
    let hallOfFame: PlayerDetail["hallOfFame"] = null

    const gameLogSeasonId = seasonParam && !isAllTime ? seasonParam : currentSeasonId

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
      const gaa = s.seconds > 0 ? (s.ga / s.seconds) * 3600 : 0
      return {
        gp: s.gp, wins: s.wins, losses: s.losses,
        gaa: gaa.toFixed(2), savePercentage: svPct.toFixed(3),
        saves: s.saves, goalsAgainst: s.ga, shotsAgainst: s.sa,
        shutouts: s.shutouts, goalieAssists: s.goalie_assists, seconds: s.seconds,
      }
    }

    // Always fetch both skater and goalie stats — a player can play both roles
    // Regular season queries exclude playoffs; playoff queries are separate
    const [
      skaterSeasonRows, skaterAllTimeRows, skaterPerSeasonRows, skaterGameRows,
      goalieSeasonRows, goalieAllTimeRows, goaliePerSeasonRows, goalieGameRows,
      poSkaterAllTimeRows, poSkaterPerSeasonRows, poSkaterGameRows,
      poGoalieAllTimeRows, poGoaliePerSeasonRows, poGoalieGameRows,
      exhSkaterGameRows, exhGoalieGameRows,
      championshipRows,
      awardRows,
      hofRows,
    ] = await Promise.all([
      // Skater season stats (regular season)
      rawSql(sql`
        SELECT
          COUNT(*)::int as gp,
          SUM(pgs.goals)::int as goals, SUM(pgs.assists)::int as assists, SUM(pgs.points)::int as points,
          SUM(pgs.gwg)::int as gwg, SUM(pgs.ppg)::int as ppg, SUM(pgs.shg)::int as shg,
          SUM(pgs.eng)::int as eng, SUM(pgs.hat_tricks)::int as hat_tricks,
          SUM(pgs.pen)::int as pen, SUM(pgs.pim)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND g.season_id = ${gameLogSeasonId} AND NOT g.is_playoff
        WHERE pgs.player_id = ${player.id}
      `),
      // Skater all-time stats (regular season, fall only)
      rawSql(sql`
        SELECT
          COUNT(*)::int as gp,
          SUM(pgs.goals)::int as goals, SUM(pgs.assists)::int as assists, SUM(pgs.points)::int as points,
          SUM(pgs.gwg)::int as gwg, SUM(pgs.ppg)::int as ppg, SUM(pgs.shg)::int as shg,
          SUM(pgs.eng)::int as eng, SUM(pgs.hat_tricks)::int as hat_tricks,
          SUM(pgs.pen)::int as pen, SUM(pgs.pim)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND NOT g.is_playoff
        JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
        WHERE pgs.player_id = ${player.id}
      `),
      // Skater per-season stats (regular season)
      rawSql(sql`
        SELECT
          g.season_id, ps.team_slug, t.name as team_name,
          COUNT(*)::int as gp,
          SUM(pgs.goals)::int as goals, SUM(pgs.assists)::int as assists, SUM(pgs.points)::int as points,
          SUM(pgs.gwg)::int as gwg, SUM(pgs.ppg)::int as ppg, SUM(pgs.shg)::int as shg,
          SUM(pgs.eng)::int as eng, SUM(pgs.hat_tricks)::int as hat_tricks,
          SUM(pgs.pen)::int as pen, SUM(pgs.pim)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND NOT g.is_playoff
        JOIN player_seasons ps ON ps.player_id = pgs.player_id AND ps.season_id = g.season_id
        JOIN teams t ON ps.team_slug = t.slug
        WHERE pgs.player_id = ${player.id}
        GROUP BY g.season_id, ps.team_slug, t.name
        ORDER BY g.season_id DESC
      `),
      // Skater game log (regular season)
      rawSql(sql`
        SELECT
          pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime,
          COALESCE(ht.name, g.home_team) as home_name, COALESCE(awt.name, g.away_team) as away_name,
          pgs.goals, pgs.assists, pgs.points, pgs.gwg, pgs.ppg, pgs.shg,
          pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND g.season_id = ${gameLogSeasonId} AND NOT g.is_playoff
        LEFT JOIN teams ht ON g.home_team = ht.slug
        LEFT JOIN teams awt ON g.away_team = awt.slug
        WHERE pgs.player_id = ${player.id}
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
        JOIN games g ON ggs.game_id = g.id AND g.season_id = ${gameLogSeasonId} AND NOT g.is_playoff
        WHERE ggs.player_id = ${player.id}
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
        WHERE ggs.player_id = ${player.id}
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
        JOIN player_seasons ps ON ps.player_id = ggs.player_id AND ps.season_id = g.season_id
        JOIN teams t ON ps.team_slug = t.slug
        WHERE ggs.player_id = ${player.id}
        GROUP BY g.season_id, ps.team_slug, t.name
        ORDER BY g.season_id DESC
      `),
      // Goalie game log (regular season)
      rawSql(sql`
        SELECT
          ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score,
          COALESCE(ht.name, g.home_team) as home_name, COALESCE(awt.name, g.away_team) as away_name,
          ggs.seconds, ggs.goals_against, ggs.shots_against, ggs.saves,
          ggs.shutouts, ggs.goalie_assists, ggs.result
        FROM goalie_game_stats ggs
        JOIN games g ON ggs.game_id = g.id AND g.season_id = ${gameLogSeasonId} AND NOT g.is_playoff
        LEFT JOIN teams ht ON g.home_team = ht.slug
        LEFT JOIN teams awt ON g.away_team = awt.slug
        WHERE ggs.player_id = ${player.id}
        ORDER BY g.date DESC
      `),
      // Playoff skater all-time stats (fall only)
      rawSql(sql`
        SELECT
          COUNT(*)::int as gp,
          SUM(pgs.goals)::int as goals, SUM(pgs.assists)::int as assists, SUM(pgs.points)::int as points,
          SUM(pgs.gwg)::int as gwg, SUM(pgs.ppg)::int as ppg, SUM(pgs.shg)::int as shg,
          SUM(pgs.eng)::int as eng, SUM(pgs.hat_tricks)::int as hat_tricks,
          SUM(pgs.pen)::int as pen, SUM(pgs.pim)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND g.is_playoff
        JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
        WHERE pgs.player_id = ${player.id}
      `),
      // Playoff skater per-season stats
      rawSql(sql`
        SELECT
          g.season_id, ps.team_slug, t.name as team_name,
          COUNT(*)::int as gp,
          SUM(pgs.goals)::int as goals, SUM(pgs.assists)::int as assists, SUM(pgs.points)::int as points,
          SUM(pgs.gwg)::int as gwg, SUM(pgs.ppg)::int as ppg, SUM(pgs.shg)::int as shg,
          SUM(pgs.eng)::int as eng, SUM(pgs.hat_tricks)::int as hat_tricks,
          SUM(pgs.pen)::int as pen, SUM(pgs.pim)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND g.is_playoff
        JOIN player_seasons ps ON ps.player_id = pgs.player_id AND ps.season_id = g.season_id
        JOIN teams t ON ps.team_slug = t.slug
        WHERE pgs.player_id = ${player.id}
        GROUP BY g.season_id, ps.team_slug, t.name
        ORDER BY g.season_id DESC
      `),
      // Playoff skater game log
      rawSql(sql`
        SELECT
          pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime,
          COALESCE(ht.name, g.home_team) as home_name, COALESCE(awt.name, g.away_team) as away_name,
          pgs.goals, pgs.assists, pgs.points, pgs.gwg, pgs.ppg, pgs.shg,
          pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND g.season_id = ${gameLogSeasonId} AND g.is_playoff
        LEFT JOIN teams ht ON g.home_team = ht.slug
        LEFT JOIN teams awt ON g.away_team = awt.slug
        WHERE pgs.player_id = ${player.id}
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
        WHERE ggs.player_id = ${player.id}
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
        JOIN player_seasons ps ON ps.player_id = ggs.player_id AND ps.season_id = g.season_id
        JOIN teams t ON ps.team_slug = t.slug
        WHERE ggs.player_id = ${player.id}
        GROUP BY g.season_id, ps.team_slug, t.name
        ORDER BY g.season_id DESC
      `),
      // Playoff goalie game log
      rawSql(sql`
        SELECT
          ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score,
          COALESCE(ht.name, g.home_team) as home_name, COALESCE(awt.name, g.away_team) as away_name,
          ggs.seconds, ggs.goals_against, ggs.shots_against, ggs.saves,
          ggs.shutouts, ggs.goalie_assists, ggs.result
        FROM goalie_game_stats ggs
        JOIN games g ON ggs.game_id = g.id AND g.season_id = ${gameLogSeasonId} AND g.is_playoff
        LEFT JOIN teams ht ON g.home_team = ht.slug
        LEFT JOIN teams awt ON g.away_team = awt.slug
        WHERE ggs.player_id = ${player.id}
        ORDER BY g.date DESC
      `),
      // Championships
      rawSql(sql`
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
      `),
      // Player awards
      rawSql(sql`
        SELECT award_type, season_id FROM player_awards
        WHERE player_id = ${player.id}
        ORDER BY season_id DESC
      `),
      // Hall of Fame
      rawSql(sql`
        SELECT class_year, wing, years_active, achievements FROM hall_of_fame
        WHERE player_id = ${player.id}
        LIMIT 1
      `),
      // Exhibition/tryout skater game log
      rawSql(sql`
        SELECT
          pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime,
          COALESCE(ht.name, g.home_team) as home_name, COALESCE(awt.name, g.away_team) as away_name,
          pgs.goals, pgs.assists, pgs.points, pgs.gwg, pgs.ppg, pgs.shg,
          pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim,
          g.game_type
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND g.game_type IN ('exhibition', 'tryout')
        LEFT JOIN teams ht ON g.home_team = ht.slug
        LEFT JOIN teams awt ON g.away_team = awt.slug
        WHERE pgs.player_id = ${player.id}
        ORDER BY g.date DESC
      `),
      // Exhibition/tryout goalie game log
      rawSql(sql`
        SELECT
          ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score,
          COALESCE(ht.name, g.home_team) as home_name, COALESCE(awt.name, g.away_team) as away_name,
          ggs.seconds, ggs.goals_against, ggs.shots_against, ggs.saves,
          ggs.shutouts, ggs.goalie_assists, ggs.result,
          g.game_type
        FROM goalie_game_stats ggs
        JOIN games g ON ggs.game_id = g.id AND g.game_type IN ('exhibition', 'tryout')
        LEFT JOIN teams ht ON g.home_team = ht.slug
        LEFT JOIN teams awt ON g.away_team = awt.slug
        WHERE ggs.player_id = ${player.id}
        ORDER BY g.date DESC
      `),
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
        seasonName: seasonMap.get(r.season_id) ?? r.season_id,
        teamName: r.team_name,
        teamSlug: r.team_slug,
        stats: buildSkaterStats(r),
      }))
    games = skaterGameRows.map((r) => {
      const isHome = player.team_slug ? r.home_team === player.team_slug : true
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
        seasonName: seasonMap.get(r.season_id) ?? r.season_id,
        teamName: r.team_name,
        teamSlug: r.team_slug,
        stats: buildGoalieStats(r),
      }))
    goalieGames = goalieGameRows.map((r) => {
      const isHome = player.team_slug ? r.home_team === player.team_slug : true
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
    playoffPerSeasonStats = poSkaterPerSeasonRows
      .filter((r) => r.gp > 0)
      .map((r) => ({
        seasonId: r.season_id,
        seasonName: seasonMap.get(r.season_id) ?? r.season_id,
        teamName: r.team_name,
        teamSlug: r.team_slug,
        stats: buildSkaterStats(r),
      }))
    playoffGames = poSkaterGameRows.map((r) => {
      const isHome = player.team_slug ? r.home_team === player.team_slug : true
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
        seasonName: seasonMap.get(r.season_id) ?? r.season_id,
        teamName: r.team_name,
        teamSlug: r.team_slug,
        stats: buildGoalieStats(r),
      }))
    playoffGoalieGames = poGoalieGameRows.map((r) => {
      const isHome = player.team_slug ? r.home_team === player.team_slug : true
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
      awardType: r.award_type,
      seasonId: r.season_id,
      seasonName: seasonMap.get(r.season_id) ?? r.season_id,
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

    // Populate exhibition/tryout game logs
    exhibitionGames = exhSkaterGameRows.map((r) => {
      const isHome = player.team_slug ? r.home_team === player.team_slug : true
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
    exhibitionGoalieGames = exhGoalieGameRows.map((r) => {
      const isHome = player.team_slug ? r.home_team === player.team_slug : true
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

    const result: PlayerDetail = {
      id: player.id, name: player.name,
      team: player.team_name ?? "Unrostered", teamSlug: player.team_slug ?? "",
      isGoalie: player.is_goalie ?? false,
      seasonStats, allTimeStats, allTimeAllSeasonsStats: null, perSeasonStats,
      goalieSeasonStats, allTimeGoalieStats, allTimeAllSeasonsGoalieStats: null, perSeasonGoalieStats,
      games, goalieGames,
      playoffPerSeasonStats, playoffAllTimeStats, playoffAllTimeAllSeasonsStats: null, playoffGames,
      playoffPerSeasonGoalieStats, playoffAllTimeGoalieStats, playoffAllTimeAllSeasonsGoalieStats: null, playoffGoalieGames,
      exhibitionGames, exhibitionGoalieGames,
      championships,
      awards,
      hallOfFame,
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("Failed to fetch player detail:", error)
    return NextResponse.json({ error: "Failed to fetch player detail" }, { status: 500 })
  }
}
