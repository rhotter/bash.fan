import { cache } from "react"
import { formatSeasonName } from "@/lib/season-name"
import { db, schema, rawSql } from "@/lib/db"
import { sql, eq } from "drizzle-orm"
import { getCurrentSeason } from "@/lib/seasons"
import { computeGaa, DEFAULT_GAME_LENGTH_MIN } from "@/lib/game-rules"

export interface GoalieRoster {
  id: number
  name: string
  isGoalie: true
  gp: number
  wins: number
  losses: number
  gaa: string
  savePercentage: string
  shutouts: number
  saves: number
  goalsAgainst: number
  shotsAgainst: number
  goalieAssists: number
}

export interface SkaterRoster {
  id: number
  name: string
  isGoalie: false
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

export interface TeamRecord {
  gp: number
  w: number
  otw: number
  l: number
  otl: number
  pts: number
  gf: number
  ga: number
  rank: number
  totalTeams: number
}

export interface TeamDetail {
  slug: string
  name: string
  seasonName: string
  seasonLocation: string | null
  gameLength?: number | null
  record: TeamRecord
  skaters: SkaterRoster[]
  goalies: GoalieRoster[]
  games: {
    id: string
    date: string
    time: string
    opponent: string
    opponentSlug: string
    isHome: boolean
    teamScore: number | null
    opponentScore: number | null
    status: string
    isOvertime: boolean
    result: "W" | "L" | "OTW" | "OTL" | null
    location: string | null
  }[]
}

async function fetchTeamDetailInternal(slug: string, seasonParam?: string | null): Promise<TeamDetail | null> {
  const seasonId = seasonParam && seasonParam !== "all" ? seasonParam : (await getCurrentSeason()).id
  const [seasonRows, teamRows, skaterRows, goalieRows, gameRows, allTeamResults, totalTeams] = await Promise.all([
    db.select({
      name: schema.seasons.name,
      defaultLocation: schema.seasons.defaultLocation,
      gameLength: schema.seasons.gameLength,
    }).from(schema.seasons).where(eq(schema.seasons.id, seasonId)),
    db.select().from(schema.teams).where(eq(schema.teams.slug, slug)),
    rawSql(sql`
      WITH team_game_stats AS (
        SELECT pgs.*
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND NOT g.is_forfeit AND g.season_id = ${seasonId} AND g.game_type IN ('regular', 'playoff', 'championship')
        WHERE NOT pgs.is_sub
          AND COALESCE(
            pgs.team_slug,
            (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = pgs.player_id AND ps.season_id = ${seasonId} LIMIT 1)
          ) = ${slug}
      ), eligible_skaters AS (
        SELECT ps.player_id FROM player_seasons ps
        WHERE ps.season_id = ${seasonId} AND ps.team_slug = ${slug} AND NOT ps.is_goalie
        UNION
        SELECT tgs.player_id FROM team_game_stats tgs
      )
      SELECT
        p.id, p.name,
        COUNT(tgs.game_id)::int as gp,
        COALESCE(SUM(tgs.goals), 0)::int as goals,
        COALESCE(SUM(tgs.assists), 0)::int as assists,
        COALESCE(SUM(tgs.points), 0)::int as points,
        COALESCE(SUM(tgs.gwg), 0)::int as gwg,
        COALESCE(SUM(tgs.ppg), 0)::int as ppg,
        COALESCE(SUM(tgs.shg), 0)::int as shg,
        COALESCE(SUM(tgs.eng), 0)::int as eng,
        COALESCE(SUM(tgs.hat_tricks), 0)::int as hat_tricks,
        COALESCE(SUM(tgs.pen), 0)::int as pen,
        COALESCE(SUM(tgs.pim), 0)::int as pim
      FROM eligible_skaters es
      JOIN players p ON p.id = es.player_id
      LEFT JOIN team_game_stats tgs ON tgs.player_id = p.id
      GROUP BY p.id, p.name
      ORDER BY points DESC, goals DESC, p.name ASC
    `),
    rawSql(sql`
      WITH team_goalie_stats AS (
        SELECT ggs.*, s.game_length
        FROM goalie_game_stats ggs
        JOIN games g ON ggs.game_id = g.id AND NOT g.is_forfeit AND g.season_id = ${seasonId} AND g.game_type IN ('regular', 'playoff', 'championship')
        LEFT JOIN seasons s ON g.season_id = s.id
        WHERE NOT ggs.is_sub
          AND COALESCE(
            ggs.team_slug,
            (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = ggs.player_id AND ps.season_id = ${seasonId} LIMIT 1)
          ) = ${slug}
      ), eligible_goalies AS (
        SELECT ps.player_id FROM player_seasons ps
        WHERE ps.season_id = ${seasonId} AND ps.team_slug = ${slug} AND ps.is_goalie
        UNION
        SELECT tgs.player_id FROM team_goalie_stats tgs
      )
      SELECT
        p.id, p.name,
        COUNT(tgs.game_id)::int as gp,
        COALESCE(SUM(tgs.goals_against), 0)::int as ga,
        COALESCE(SUM(tgs.saves), 0)::int as saves,
        COALESCE(SUM(tgs.shots_against), 0)::int as sa,
        COALESCE(SUM(tgs.seconds), 0)::int as seconds,
        COALESCE(SUM(tgs.shutouts), 0)::int as shutouts,
        COALESCE(SUM(tgs.goalie_assists), 0)::int as goalie_assists,
        COUNT(*) FILTER (WHERE tgs.result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE tgs.result = 'L')::int as losses,
        COALESCE(MAX(tgs.game_length), (SELECT se.game_length FROM seasons se WHERE se.id = ${seasonId}), ${DEFAULT_GAME_LENGTH_MIN})::int as game_length
      FROM eligible_goalies eg
      JOIN players p ON p.id = eg.player_id
      LEFT JOIN team_goalie_stats tgs ON tgs.player_id = p.id
      GROUP BY p.id, p.name
      ORDER BY gp DESC, p.name ASC
    `),
    rawSql(sql`
      SELECT
        g.id, g.date, g.time, g.home_score, g.away_score,
        g.status, g.is_overtime,
        g.home_team, g.away_team, g.location,
        ht.name as home_name, awt.name as away_name
      FROM games g
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE g.season_id = ${seasonId}
        AND (g.home_team = ${slug} OR g.away_team = ${slug})
        AND g.is_playoff = false
        AND g.game_type = 'regular'
      ORDER BY g.date ASC,
        CASE
          WHEN g.time = 'TBD' THEN '23:59'::time
          WHEN g.time ILIKE '%a%' OR g.time ILIKE '%p%' THEN
            to_timestamp(
              replace(replace(lower(g.time), 'a', ' AM'), 'p', ' PM'),
              'HH:MI AM'
            )::time
          ELSE
            g.time::time
        END ASC
    `),
    rawSql(sql`
      SELECT
        t.team_slug,
        SUM(CASE
          WHEN g.home_team = t.team_slug AND g.home_score > g.away_score AND NOT g.is_overtime THEN 3
          WHEN g.away_team = t.team_slug AND g.away_score > g.home_score AND NOT g.is_overtime THEN 3
          WHEN g.home_team = t.team_slug AND g.home_score > g.away_score AND g.is_overtime THEN 2
          WHEN g.away_team = t.team_slug AND g.away_score > g.home_score AND g.is_overtime THEN 2
          WHEN g.home_team = t.team_slug AND g.home_score < g.away_score AND g.is_overtime THEN 1
          WHEN g.away_team = t.team_slug AND g.away_score < g.home_score AND g.is_overtime THEN 1
          ELSE 0
        END)::int as pts,
        SUM(CASE WHEN g.home_team = t.team_slug THEN g.home_score ELSE g.away_score END)::int as gf,
        SUM(CASE WHEN g.home_team = t.team_slug THEN g.away_score ELSE g.home_score END)::int as ga
      FROM season_teams t
      CROSS JOIN LATERAL (
        SELECT * FROM games g2
        WHERE g2.season_id = ${seasonId} AND g2.status = 'final' AND NOT g2.is_playoff AND g2.game_type = 'regular'
          AND (g2.home_team = t.team_slug OR g2.away_team = t.team_slug)
      ) g
      WHERE t.season_id = ${seasonId}
      GROUP BY t.team_slug
      ORDER BY pts DESC, (SUM(CASE WHEN g.home_team = t.team_slug THEN g.home_score ELSE g.away_score END) - SUM(CASE WHEN g.home_team = t.team_slug THEN g.away_score ELSE g.home_score END)) DESC
    `),
    rawSql(sql`SELECT COUNT(*)::int as count FROM season_teams WHERE season_id = ${seasonId}`),
  ])

  if (teamRows.length === 0) return null
  const team = teamRows[0]
  const seasonName = formatSeasonName(seasonRows.length > 0 ? seasonRows[0].name : seasonId)
  const seasonLocation = seasonRows.length > 0 ? seasonRows[0].defaultLocation : null
  const gameLength = seasonRows.length > 0 ? seasonRows[0].gameLength : 60

  const skaters: SkaterRoster[] = skaterRows.map((r) => ({
    id: r.id,
    name: r.name,
    isGoalie: false as const,
    gp: r.gp,
    goals: r.goals,
    assists: r.assists,
    points: r.points,
    ptsPg: r.gp > 0 ? (r.points / r.gp).toFixed(2) : "0.00",
    gwg: r.gwg,
    ppg: r.ppg,
    shg: r.shg,
    eng: r.eng,
    hatTricks: r.hat_tricks,
    pen: r.pen,
    pim: r.pim,
  }))

  const goalies: GoalieRoster[] = goalieRows.map((r) => {
    const svPct = r.sa > 0 ? (r.saves / r.sa) : 0
    const gaa = computeGaa(r.ga, r.seconds, r.game_length || DEFAULT_GAME_LENGTH_MIN)
    return {
      id: r.id,
      name: r.name,
      isGoalie: true as const,
      gp: r.gp,
      wins: r.wins,
      losses: r.losses,
      gaa: gaa.toFixed(2),
      savePercentage: svPct.toFixed(3),
      shutouts: r.shutouts,
      saves: r.saves,
      goalsAgainst: r.ga,
      shotsAgainst: r.sa,
      goalieAssists: r.goalie_assists,
    }
  })

  const games = gameRows.map((r) => {
    const isHome = r.home_team === slug
    const teamScore = isHome ? r.home_score : r.away_score
    const opponentScore = isHome ? r.away_score : r.home_score
    let result: "W" | "L" | "OTW" | "OTL" | null = null
    if (r.status === "final" && teamScore != null && opponentScore != null) {
      if (teamScore > opponentScore) {
        result = r.is_overtime ? "OTW" : "W"
      } else {
        result = r.is_overtime ? "OTL" : "L"
      }
    }
    return {
      id: r.id,
      date: r.date,
      time: r.time,
      opponent: isHome ? r.away_name : r.home_name,
      opponentSlug: isHome ? r.away_team : r.home_team,
      isHome,
      teamScore,
      opponentScore,
      status: r.status,
      isOvertime: r.is_overtime,
      result,
      location: r.location,
    }
  })

  const record: TeamRecord = { gp: 0, w: 0, otw: 0, l: 0, otl: 0, pts: 0, gf: 0, ga: 0, rank: 0, totalTeams: 0 }
  for (const g of games) {
    if (g.result) {
      record.gp++
      record.gf += g.teamScore ?? 0
      record.ga += g.opponentScore ?? 0
      if (g.result === "W") { record.w++; record.pts += 3 }
      else if (g.result === "OTW") { record.otw++; record.pts += 2 }
      else if (g.result === "OTL") { record.otl++; record.pts += 1 }
      else if (g.result === "L") { record.l++ }
    }
  }

  record.totalTeams = totalTeams[0].count
  const rankIdx = allTeamResults.findIndex((r) => r.team_slug === slug)
  record.rank = rankIdx >= 0 ? rankIdx + 1 : 0

  return { slug: team.slug, name: team.name, seasonName, seasonLocation, gameLength, record, skaters, goalies, games }
}

// Share metadata and page reads within a render; do not cache across requests.
export const fetchTeamDetail = cache(fetchTeamDetailInternal)
