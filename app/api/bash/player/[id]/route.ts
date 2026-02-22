import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export interface PlayerDetail {
  id: number
  name: string
  team: string
  teamSlug: string
  isGoalie: boolean
  seasonStats: {
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
  } | null
  goalieSeasonStats: {
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
  } | null
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
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const playerRows = await sql`
      SELECT p.id, p.name, ps.team_slug, ps.is_goalie, t.name as team_name
      FROM players p
      JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = '2025-2026'
      JOIN teams t ON ps.team_slug = t.slug
      WHERE p.id = ${parseInt(id)}
    `

    if (playerRows.length === 0) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 })
    }

    const player = playerRows[0]

    let seasonStats: PlayerDetail["seasonStats"] = null
    let goalieSeasonStats: PlayerDetail["goalieSeasonStats"] = null
    let games: PlayerDetail["games"] = []
    let goalieGames: PlayerDetail["goalieGames"] = []

    if (!player.is_goalie) {
      // Skater season totals
      const statRows = await sql`
        SELECT
          COUNT(*)::int as gp,
          SUM(goals)::int as goals, SUM(assists)::int as assists, SUM(points)::int as points,
          SUM(gwg)::int as gwg, SUM(ppg)::int as ppg, SUM(shg)::int as shg,
          SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
          SUM(pen)::int as pen, SUM(pim)::int as pim
        FROM player_game_stats WHERE player_id = ${player.id}
      `
      if (statRows.length > 0) {
        const s = statRows[0]
        seasonStats = {
          gp: s.gp, goals: s.goals, assists: s.assists, points: s.points,
          ptsPg: s.gp > 0 ? (s.points / s.gp).toFixed(2) : "0.00",
          gwg: s.gwg, ppg: s.ppg, shg: s.shg, eng: s.eng,
          hatTricks: s.hat_tricks, pen: s.pen, pim: s.pim,
        }
      }

      // Game-by-game skater stats
      const gameRows = await sql`
        SELECT
          pgs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score, g.is_overtime,
          ht.name as home_name, awt.name as away_name,
          pgs.goals, pgs.assists, pgs.points, pgs.gwg, pgs.ppg, pgs.shg,
          pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id
        JOIN teams ht ON g.home_team = ht.slug
        JOIN teams awt ON g.away_team = awt.slug
        WHERE pgs.player_id = ${player.id}
        ORDER BY g.date DESC
      `

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
      // Goalie season totals
      const statRows = await sql`
        SELECT
          COUNT(*)::int as gp,
          SUM(goals_against)::int as ga, SUM(saves)::int as saves,
          SUM(shots_against)::int as sa, SUM(minutes)::int as minutes,
          SUM(shutouts)::int as shutouts, SUM(goalie_assists)::int as goalie_assists,
          COUNT(*) FILTER (WHERE result = 'W')::int as wins,
          COUNT(*) FILTER (WHERE result = 'L')::int as losses
        FROM goalie_game_stats WHERE player_id = ${player.id}
      `
      if (statRows.length > 0) {
        const s = statRows[0]
        const svPct = s.sa > 0 ? (s.saves / s.sa) : 0
        const gaa = s.minutes > 0 ? (s.ga / s.minutes) * 60 : 0
        goalieSeasonStats = {
          gp: s.gp, wins: s.wins, losses: s.losses,
          gaa: gaa.toFixed(2), savePercentage: svPct.toFixed(3),
          saves: s.saves, goalsAgainst: s.ga, shotsAgainst: s.sa,
          shutouts: s.shutouts, goalieAssists: s.goalie_assists, minutes: s.minutes,
        }
      }

      // Game-by-game goalie stats
      const gameRows = await sql`
        SELECT
          ggs.game_id, g.date, g.home_team, g.away_team, g.home_score, g.away_score,
          ht.name as home_name, awt.name as away_name,
          ggs.minutes, ggs.goals_against, ggs.shots_against, ggs.saves,
          ggs.shutouts, ggs.goalie_assists, ggs.result
        FROM goalie_game_stats ggs
        JOIN games g ON ggs.game_id = g.id
        JOIN teams ht ON g.home_team = ht.slug
        JOIN teams awt ON g.away_team = awt.slug
        WHERE ggs.player_id = ${player.id}
        ORDER BY g.date DESC
      `

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
      seasonStats, goalieSeasonStats, games, goalieGames,
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("Failed to fetch player detail:", error)
    return NextResponse.json({ error: "Failed to fetch player detail" }, { status: 500 })
  }
}
