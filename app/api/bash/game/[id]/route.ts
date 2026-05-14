import { NextResponse } from "next/server"
import { db, schema, rawSql } from "@/lib/db"
import { sql, eq, asc } from "drizzle-orm"

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
  seconds: number
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
  isForfeit: boolean
  location: string
  gameType: string
  homePlayers: PlayerBoxScore[]
  awayPlayers: PlayerBoxScore[]
  homeGoalies: GoalieBoxScore[]
  awayGoalies: GoalieBoxScore[]
  officials: { name: string; role: string }[]
  notes: string | null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const gameRows = await rawSql(sql`
      SELECT g.*,
        ht.name as home_team_name,
        awt.name as away_team_name
      FROM games g
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE g.id = ${id}
    `)

    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    const game = gameRows[0]
    const isAdhocGame = game.game_type === 'exhibition' || game.game_type === 'tryout'

    // Get player stats for each team
    async function getPlayerStats(gameId: string, teamSlug: string, seasonId: string, teamSide: 'home' | 'away'): Promise<PlayerBoxScore[]> {
      // Exhibition/tryout games use adhoc_game_rosters instead of player_seasons
      const rows = isAdhocGame
        ? await rawSql(sql`
            SELECT p.id, p.name,
              pgs.goals, pgs.assists, pgs.points,
              pgs.gwg, pgs.ppg, pgs.shg, pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
            FROM player_game_stats pgs
            JOIN players p ON pgs.player_id = p.id
            JOIN adhoc_game_rosters agr ON agr.player_id = p.id AND agr.game_id = ${gameId}
            WHERE pgs.game_id = ${gameId} AND agr.team_side = ${teamSide}
            ORDER BY pgs.points DESC, pgs.goals DESC, p.name ASC
          `)
        : await rawSql(sql`
            SELECT p.id, p.name,
              pgs.goals, pgs.assists, pgs.points,
              pgs.gwg, pgs.ppg, pgs.shg, pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
            FROM player_game_stats pgs
            JOIN players p ON pgs.player_id = p.id
            JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = ${seasonId}
            WHERE pgs.game_id = ${gameId} AND ps.team_slug = ${teamSlug}
            ORDER BY pgs.points DESC, pgs.goals DESC, p.name ASC
          `)
      return rows.map((r) => ({
        id: r.id, name: r.name,
        goals: r.goals, assists: r.assists, points: r.points,
        gwg: r.gwg, ppg: r.ppg, shg: r.shg, eng: r.eng,
        hatTricks: r.hat_tricks, pen: r.pen, pim: r.pim,
      }))
    }

    async function getGoalieStats(gameId: string, teamSlug: string, seasonId: string, teamSide: 'home' | 'away'): Promise<GoalieBoxScore[]> {
      const rows = isAdhocGame
        ? await rawSql(sql`
            SELECT p.id, p.name,
              ggs.seconds, ggs.goals_against, ggs.shots_against, ggs.saves,
              ggs.shutouts, ggs.goalie_assists, ggs.result
            FROM goalie_game_stats ggs
            JOIN players p ON ggs.player_id = p.id
            JOIN adhoc_game_rosters agr ON agr.player_id = p.id AND agr.game_id = ${gameId}
            WHERE ggs.game_id = ${gameId} AND agr.team_side = ${teamSide}
          `)
        : await rawSql(sql`
            SELECT p.id, p.name,
              ggs.seconds, ggs.goals_against, ggs.shots_against, ggs.saves,
              ggs.shutouts, ggs.goalie_assists, ggs.result
            FROM goalie_game_stats ggs
            JOIN players p ON ggs.player_id = p.id
            JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = ${seasonId}
            WHERE ggs.game_id = ${gameId} AND ps.team_slug = ${teamSlug}
          `)
      return rows.map((r) => ({
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

    const [homePlayers, awayPlayers, homeGoalies, awayGoalies] = await Promise.all([
      getPlayerStats(id, game.home_team, game.season_id, 'home'),
      getPlayerStats(id, game.away_team, game.season_id, 'away'),
      getGoalieStats(id, game.home_team, game.season_id, 'home'),
      getGoalieStats(id, game.away_team, game.season_id, 'away'),
    ])

    // Officials — simple query using Drizzle query builder
    const officialRows = await db
      .select({ name: schema.gameOfficials.name, role: schema.gameOfficials.role })
      .from(schema.gameOfficials)
      .where(eq(schema.gameOfficials.gameId, id))
      .orderBy(asc(schema.gameOfficials.role), asc(schema.gameOfficials.name))

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
      isForfeit: game.is_forfeit,
      location: game.location,
      gameType: game.game_type,
      homePlayers,
      awayPlayers,
      homeGoalies,
      awayGoalies,
      officials: officialRows.map((r) => ({ name: r.name, role: r.role })),
      notes: game.notes ?? null,
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    })
  } catch (error) {
    console.error("Failed to fetch game detail:", error)
    return NextResponse.json({ error: "Failed to fetch game detail" }, { status: 500 })
  }
}
