import { cache } from "react"
import { formatSeasonName } from "@/lib/season-name"
import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"

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
  isSub: boolean
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
  isSub: boolean
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
  isPlayoff: boolean
  isForfeit: boolean
  location: string
  gameType: string
  title?: string | null
  homePlayers: PlayerBoxScore[]
  awayPlayers: PlayerBoxScore[]
  homeGoalies: GoalieBoxScore[]
  awayGoalies: GoalieBoxScore[]
  officials: { name: string; role: string }[]
  notes: string | null
  seasonName?: string
  seasonLocation?: string | null
  gameLength?: number | null
}

async function fetchGameDetailInternal(id: string): Promise<BashGameDetail | null> {
  const gameResult = await rawSql(sql`
    SELECT g.*,
      COALESCE(ht.name, g.home_team) as home_team_name,
      COALESCE(awt.name, g.away_team) as away_team_name
    FROM games g
    LEFT JOIN teams ht ON g.home_team = ht.slug
    LEFT JOIN teams awt ON g.away_team = awt.slug
    WHERE g.id = ${id}
  `)

  if (gameResult.length === 0) return null

  const game = gameResult[0]
  const isAdhocGame = game.game_type === 'exhibition' || game.game_type === 'tryout'
  const isForfeit = Boolean(game.is_forfeit) && game.status === 'final'
  const forfeitWinnerSlug = isForfeit
    ? game.home_score != null && game.away_score != null && game.home_score > game.away_score
      ? game.home_team
      : game.home_score != null && game.away_score != null && game.away_score > game.home_score
        ? game.away_team
        : null
    : null

  async function getPlayerStats(gameId: string, teamSlug: string, seasonId: string, teamSide: 'home' | 'away'): Promise<PlayerBoxScore[]> {
    if (isForfeit && teamSlug !== forfeitWinnerSlug) {
      return []
    }
    // For adhoc games (exhibition/tryout), the per-game roster is the only
    // source of truth. For regular games, players belong via player_seasons,
    // but any adhoc roster entry (a sub for this game) is also included.
    const result = isAdhocGame
      ? await rawSql(sql`
          SELECT p.id, p.name,
            pgs.goals, pgs.assists, pgs.points,
            pgs.gwg, pgs.ppg, pgs.shg, pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim,
            pgs.is_sub
          FROM player_game_stats pgs
          JOIN players p ON pgs.player_id = p.id
          JOIN adhoc_game_rosters agr ON agr.player_id = p.id AND agr.game_id = ${gameId}
          WHERE pgs.game_id = ${gameId} AND agr.team_side = ${teamSide}
          ORDER BY pgs.is_sub ASC, pgs.points DESC, pgs.goals DESC, p.name ASC
        `)
      : await rawSql(sql`
          SELECT p.id, p.name,
            pgs.goals, pgs.assists, pgs.points,
            pgs.gwg, pgs.ppg, pgs.shg, pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim,
            pgs.is_sub
          FROM player_game_stats pgs
          JOIN players p ON pgs.player_id = p.id
          WHERE pgs.game_id = ${gameId}
            AND (
              pgs.team_slug = ${teamSlug}
              OR (
                pgs.team_slug IS NULL
                AND (
                  EXISTS (
                    SELECT 1 FROM player_seasons ps
                    WHERE ps.player_id = p.id AND ps.season_id = ${seasonId} AND ps.team_slug = ${teamSlug}
                  )
                  OR EXISTS (
                    SELECT 1 FROM adhoc_game_rosters agr
                    WHERE agr.game_id = ${gameId} AND agr.player_id = p.id AND agr.team_side = ${teamSide}
                  )
                )
              )
            )
          ORDER BY pgs.is_sub ASC, pgs.points DESC, pgs.goals DESC, p.name ASC
        `)
    return result
      .filter((r) => !isForfeit || !r.is_sub)
      .map((r) => ({
        id: r.id, name: r.name,
        goals: isForfeit ? 0 : r.goals,
        assists: isForfeit ? 0 : r.assists,
        points: isForfeit ? 0 : r.points,
        gwg: isForfeit ? 0 : r.gwg,
        ppg: isForfeit ? 0 : r.ppg,
        shg: isForfeit ? 0 : r.shg,
        eng: isForfeit ? 0 : r.eng,
        hatTricks: isForfeit ? 0 : r.hat_tricks,
        pen: isForfeit ? 0 : r.pen,
        pim: isForfeit ? 0 : r.pim,
        isSub: !!r.is_sub,
      }))
  }

  async function getGoalieStats(gameId: string, teamSlug: string, seasonId: string, teamSide: 'home' | 'away'): Promise<GoalieBoxScore[]> {
    if (isForfeit && teamSlug !== forfeitWinnerSlug) {
      return []
    }
    const result = isAdhocGame
      ? await rawSql(sql`
          SELECT p.id, p.name,
            ggs.seconds, ggs.goals_against, ggs.shots_against, ggs.saves,
            ggs.shutouts, ggs.goalie_assists, ggs.result, ggs.is_sub
          FROM goalie_game_stats ggs
          JOIN players p ON ggs.player_id = p.id
          JOIN adhoc_game_rosters agr ON agr.player_id = p.id AND agr.game_id = ${gameId}
          WHERE ggs.game_id = ${gameId} AND agr.team_side = ${teamSide}
        `)
      : await rawSql(sql`
          SELECT p.id, p.name,
            ggs.seconds, ggs.goals_against, ggs.shots_against, ggs.saves,
            ggs.shutouts, ggs.goalie_assists, ggs.result, ggs.is_sub
          FROM goalie_game_stats ggs
          JOIN players p ON ggs.player_id = p.id
          WHERE ggs.game_id = ${gameId}
            AND (
              ggs.team_slug = ${teamSlug}
              OR (
                ggs.team_slug IS NULL
                AND (
                  EXISTS (
                    SELECT 1 FROM player_seasons ps
                    WHERE ps.player_id = p.id AND ps.season_id = ${seasonId} AND ps.team_slug = ${teamSlug}
                  )
                  OR EXISTS (
                    SELECT 1 FROM adhoc_game_rosters agr
                    WHERE agr.game_id = ${gameId} AND agr.player_id = p.id AND agr.team_side = ${teamSide}
                  )
                )
              )
            )
        `)
    return result
      .filter((r) => !isForfeit || !r.is_sub)
      .map((r) => {
        const shotsAgainst = isForfeit ? 0 : r.shots_against
        const saves = isForfeit ? 0 : r.saves
        return {
          id: r.id, name: r.name,
          seconds: isForfeit ? 0 : r.seconds,
          goalsAgainst: isForfeit ? 0 : r.goals_against,
          shotsAgainst,
          saves,
          savePercentage: shotsAgainst > 0
            ? (saves / shotsAgainst).toFixed(3)
            : "0.000",
          shutouts: isForfeit ? 0 : r.shutouts,
          goalieAssists: isForfeit ? 0 : r.goalie_assists,
          result: isForfeit ? null : r.result,
          isSub: !!r.is_sub,
        }
      })
  }

  const [homePlayers, awayPlayers, homeGoalies, awayGoalies, officialRows, seasonRows] = await Promise.all([
    getPlayerStats(id, game.home_team, game.season_id, 'home'),
    getPlayerStats(id, game.away_team, game.season_id, 'away'),
    getGoalieStats(id, game.home_team, game.season_id, 'home'),
    getGoalieStats(id, game.away_team, game.season_id, 'away'),
    rawSql(sql`
      SELECT name, role FROM game_officials
      WHERE game_id = ${id}
      ORDER BY role ASC, name ASC
    `),
    rawSql(sql`
      SELECT name, default_location as "defaultLocation", game_length as "gameLength"
      FROM seasons
      WHERE id = ${game.season_id}
    `),
  ])
  const seasonName = formatSeasonName(seasonRows.length > 0 ? seasonRows[0].name : game.season_id)
  const seasonLocation = seasonRows.length > 0 ? seasonRows[0].defaultLocation : null
  const gameLength = seasonRows.length > 0 ? seasonRows[0].gameLength : 60

  return {
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
    isPlayoff: game.is_playoff,
    isForfeit: game.is_forfeit,
    location: game.location,
    gameType: game.game_type,
    title: game.title ?? null,
    homePlayers,
    awayPlayers,
    homeGoalies,
    awayGoalies,
    officials: officialRows.map((r) => ({ name: r.name, role: r.role })),
    notes: game.notes ?? null,
    seasonName,
    seasonLocation,
    gameLength,
  }
}

// Share metadata and page reads within a render; do not cache across requests.
export const fetchGameDetail = cache(fetchGameDetailInternal)
