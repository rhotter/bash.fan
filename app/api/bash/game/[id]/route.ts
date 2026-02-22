import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export interface PlayerBoxScore {
  id: number
  name: string
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
}

export interface GoalieBoxScore {
  id: number
  name: string
  minutes: number
  goalsAgainst: number
  shotsAgainst: number
  saves: number
  savePercentage: string
  shutouts: number
  goalieAssists: number
  result: string | null
}

export interface BashGameDetail {
  id: string
  date: string
  time: string
  homeTeam: string
  homeSlug: string
  awayTeam: string
  awaySlug: string
  homeScore: number | null
  awayScore: number | null
  status: string
  isOvertime: boolean
  location: string
  homePlayers: PlayerBoxScore[]
  awayPlayers: PlayerBoxScore[]
  homeGoalies: GoalieBoxScore[]
  awayGoalies: GoalieBoxScore[]
  officials: { name: string; role: string }[]
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const gameRows = await sql`
      SELECT g.*,
        ht.name as home_team_name,
        awt.name as away_team_name
      FROM games g
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE g.id = ${id}
    `

    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    const game = gameRows[0]

    // Get player stats for each team
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

    const [homePlayers, awayPlayers, homeGoalies, awayGoalies] = await Promise.all([
      getPlayerStats(id, game.home_team),
      getPlayerStats(id, game.away_team),
      getGoalieStats(id, game.home_team),
      getGoalieStats(id, game.away_team),
    ])

    // Officials
    const officialRows = await sql`
      SELECT name, role FROM game_officials WHERE game_id = ${id} ORDER BY role, name
    `

    const result: BashGameDetail = {
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

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    })
  } catch (error) {
    console.error("Failed to fetch game detail:", error)
    return NextResponse.json({ error: "Failed to fetch game detail" }, { status: 500 })
  }
}
