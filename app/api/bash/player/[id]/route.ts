import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getCurrentSeason, getSeasonById } from "@/lib/seasons"

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
  minutes: number
}

export type SeasonSkaterStats = { seasonId: string; seasonName: string; stats: SkaterStats }
export type SeasonGoalieStats = { seasonId: string; seasonName: string; stats: GoalieStats }

export interface PlayerDetail {
  id: number
  name: string
  team: string
  teamSlug: string
  isGoalie: boolean
  seasonStats: SkaterStats | null
  allTimeStats: SkaterStats | null
  perSeasonStats: SeasonSkaterStats[]
  goalieSeasonStats: GoalieStats | null
  allTimeGoalieStats: GoalieStats | null
  perSeasonGoalieStats: SeasonGoalieStats[]
  games: {
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
  }[]
  goalieGames: {
    gameId: string
    date: string
    opponent: string
    opponentSlug: string
    isHome: boolean
    teamScore: number | null
    opponentScore: number | null
    minutes: number
    goalsAgainst: number
    shotsAgainst: number
    saves: number
    savePercentage: string
    shutouts: number
    goalieAssists: number
    result: string | null
  }[]
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const seasonParam = searchParams.get("season")
  const isAllTime = seasonParam === "all"
  const seasonId = !isAllTime ? (seasonParam || getCurrentSeason().id) : null

  try {
    // Look up the player — use requested season or fall back to most recent
    let playerRows
    if (isAllTime) {
      playerRows = await sql`
        SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name
        FROM players p
        JOIN player_seasons ps ON p.id = ps.player_id
        JOIN teams t ON ps.team_slug = t.slug
        WHERE p.id = ${parseInt(id)}
        ORDER BY ps.season_id DESC
        LIMIT 1
      `
    } else {
      playerRows = await sql`
        SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name
        FROM players p
        JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = ${seasonId}
        JOIN teams t ON ps.team_slug = t.slug
        WHERE p.id = ${parseInt(id)}
      `
      // Fall back to most recent season if not found in requested season
      if (playerRows.length === 0) {
        playerRows = await sql`
          SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name
          FROM players p
          JOIN player_seasons ps ON p.id = ps.player_id
          JOIN teams t ON ps.team_slug = t.slug
          WHERE p.id = ${parseInt(id)}
          ORDER BY ps.season_id DESC
          LIMIT 1
        `
      }
    }

    if (playerRows.length === 0) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 })
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

    // For game log, always use the specific season (current season by default)
    const gameLogSeasonId = seasonParam && !isAllTime ? seasonParam : getCurrentSeason().id

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
      // Fetch season stats + all-time stats + game log in parallel
      const [seasonStatRows, allTimeStatRows, perSeasonStatRows, gameRows] = await Promise.all([
        // Season stats (for the selected or current season)
        sql`
          SELECT
            COUNT(*)::int as gp,
            SUM(pgs.goals)::int as goals, SUM(pgs.assists)::int as assists, SUM(pgs.points)::int as points,
            SUM(pgs.gwg)::int as gwg, SUM(pgs.ppg)::int as ppg, SUM(pgs.shg)::int as shg,
            SUM(pgs.eng)::int as eng, SUM(pgs.hat_tricks)::int as hat_tricks,
            SUM(pgs.pen)::int as pen, SUM(pgs.pim)::int as pim
          FROM player_game_stats pgs
          JOIN games g ON pgs.game_id = g.id AND g.season_id = ${gameLogSeasonId}
          WHERE pgs.player_id = ${player.id}
        `,
        // All-time stats
        sql`
          SELECT
            COUNT(*)::int as gp,
            SUM(pgs.goals)::int as goals, SUM(pgs.assists)::int as assists, SUM(pgs.points)::int as points,
            SUM(pgs.gwg)::int as gwg, SUM(pgs.ppg)::int as ppg, SUM(pgs.shg)::int as shg,
            SUM(pgs.eng)::int as eng, SUM(pgs.hat_tricks)::int as hat_tricks,
            SUM(pgs.pen)::int as pen, SUM(pgs.pim)::int as pim
          FROM player_game_stats pgs
          WHERE pgs.player_id = ${player.id}
        `,
        // Per-season stats
        sql`
          SELECT
            g.season_id,
            COUNT(*)::int as gp,
            SUM(pgs.goals)::int as goals, SUM(pgs.assists)::int as assists, SUM(pgs.points)::int as points,
            SUM(pgs.gwg)::int as gwg, SUM(pgs.ppg)::int as ppg, SUM(pgs.shg)::int as shg,
            SUM(pgs.eng)::int as eng, SUM(pgs.hat_tricks)::int as hat_tricks,
            SUM(pgs.pen)::int as pen, SUM(pgs.pim)::int as pim
          FROM player_game_stats pgs
          JOIN games g ON pgs.game_id = g.id
          WHERE pgs.player_id = ${player.id}
          GROUP BY g.season_id
          ORDER BY g.season_id DESC
        `,
        // Game log — always scoped to the season
        sql`
          SELECT
            pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime,
            ht.name as home_name, awt.name as away_name,
            pgs.goals, pgs.assists, pgs.points, pgs.gwg, pgs.ppg, pgs.shg,
            pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
          FROM player_game_stats pgs
          JOIN games g ON pgs.game_id = g.id AND g.season_id = ${gameLogSeasonId}
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
      // Goalie: fetch season stats + all-time stats + game log in parallel
      const [seasonStatRows, allTimeStatRows, perSeasonGoalieStatRows, gameRows] = await Promise.all([
        // Season goalie stats
        sql`
          SELECT
            COUNT(*)::int as gp,
            SUM(goals_against)::int as ga, SUM(saves)::int as saves,
            SUM(shots_against)::int as sa, SUM(minutes)::int as minutes,
            SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
            COUNT(*) FILTER (WHERE result = 'W')::int as wins,
            COUNT(*) FILTER (WHERE result = 'L')::int as losses
          FROM goalie_game_stats ggs
          JOIN games g ON ggs.game_id = g.id AND g.season_id = ${gameLogSeasonId}
          WHERE ggs.player_id = ${player.id}
        `,
        // All-time goalie stats
        sql`
          SELECT
            COUNT(*)::int as gp,
            SUM(goals_against)::int as ga, SUM(saves)::int as saves,
            SUM(shots_against)::int as sa, SUM(minutes)::int as minutes,
            SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
            COUNT(*) FILTER (WHERE result = 'W')::int as wins,
            COUNT(*) FILTER (WHERE result = 'L')::int as losses
          FROM goalie_game_stats ggs
          WHERE ggs.player_id = ${player.id}
        `,
        // Per-season goalie stats
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
        // Game log — always scoped to the season
        sql`
          SELECT
            ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score,
            ht.name as home_name, awt.name as away_name,
            ggs.minutes, ggs.goals_against, ggs.shots_against, ggs.saves,
            ggs.shutouts, ggs.goalie_assists, ggs.result
          FROM goalie_game_stats ggs
          JOIN games g ON ggs.game_id = g.id AND g.season_id = ${gameLogSeasonId}
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

    const result: PlayerDetail = {
      id: player.id, name: player.name,
      team: player.team_name, teamSlug: player.team_slug,
      isGoalie: player.is_goalie,
      seasonStats, allTimeStats, perSeasonStats,
      goalieSeasonStats, allTimeGoalieStats, perSeasonGoalieStats,
      games, goalieGames,
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("Failed to fetch player detail:", error)
    return NextResponse.json({ error: "Failed to fetch player detail" }, { status: 500 })
  }
}
