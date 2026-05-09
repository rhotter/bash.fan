import { db, schema, rawSql } from "@/lib/db"
import { sql, eq } from "drizzle-orm"
import { getCurrentSeason } from "@/lib/seasons"
import type { TeamDetail, TeamRecord, SkaterRoster, GoalieRoster } from "@/app/api/bash/team/[slug]/route"

export type { TeamDetail, TeamRecord, SkaterRoster, GoalieRoster }

export async function fetchTeamDetail(slug: string, seasonParam?: string | null): Promise<TeamDetail | null> {
  const seasonId = seasonParam && seasonParam !== "all" ? seasonParam : (await getCurrentSeason()).id

  const teamRows = await db.select().from(schema.teams).where(eq(schema.teams.slug, slug))
  if (teamRows.length === 0) return null
  const team = teamRows[0]

  const [skaterRows, goalieRows, gameRows] = await Promise.all([
    rawSql(sql`
      SELECT
        p.id, p.name,
        COUNT(*)::int as gp,
        SUM(pgs.goals)::int as goals,
        SUM(pgs.assists)::int as assists,
        SUM(pgs.points)::int as points,
        SUM(pgs.gwg)::int as gwg,
        SUM(pgs.ppg)::int as ppg,
        SUM(pgs.shg)::int as shg,
        SUM(pgs.eng)::int as eng,
        SUM(pgs.hat_tricks)::int as hat_tricks,
        SUM(pgs.pen)::int as pen,
        SUM(pgs.pim)::int as pim
      FROM players p
      JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = ${seasonId}
      JOIN player_game_stats pgs ON pgs.player_id = p.id
      JOIN games g ON pgs.game_id = g.id AND g.season_id = ${seasonId}
      WHERE ps.team_slug = ${slug}
      GROUP BY p.id, p.name
      ORDER BY points DESC, goals DESC, p.name ASC
    `),
    rawSql(sql`
      SELECT
        p.id, p.name,
        COUNT(*)::int as gp,
        SUM(ggs.goals_against)::int as ga,
        SUM(ggs.saves)::int as saves,
        SUM(ggs.shots_against)::int as sa,
        SUM(ggs.seconds)::int as seconds,
        SUM(ggs.shutouts)::int as shutouts,
        SUM(ggs.goalie_assists)::int as goalie_assists,
        COUNT(*) FILTER (WHERE ggs.result = 'W')::int as wins,
        COUNT(*) FILTER (WHERE ggs.result = 'L')::int as losses
      FROM players p
      JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = ${seasonId}
      JOIN goalie_game_stats ggs ON ggs.player_id = p.id
      JOIN games g ON ggs.game_id = g.id AND g.season_id = ${seasonId}
      WHERE ps.team_slug = ${slug}
      GROUP BY p.id, p.name
      ORDER BY gp DESC, p.name ASC
    `),
    rawSql(sql`
      SELECT
        g.id, g.date, g.time, g.home_score, g.away_score,
        g.status, g.is_overtime,
        g.home_team, g.away_team,
        ht.name as home_name, awt.name as away_name
      FROM games g
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE g.season_id = ${seasonId}
        AND (g.home_team = ${slug} OR g.away_team = ${slug})
        AND g.is_playoff = false
        AND g.game_type = 'regular'
      ORDER BY g.date DESC, CASE WHEN g.time = 'TBD' THEN '23:59'::time ELSE to_timestamp(CASE WHEN g.time LIKE '%a' THEN replace(g.time, 'a', ' AM') ELSE replace(g.time, 'p', ' PM') END, 'HH:MI AM')::time END DESC
    `),
  ])

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
    const gaa = r.seconds > 0 ? (r.ga / r.seconds) * 3600 : 0
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

  const [allTeamResults, totalTeams] = await Promise.all([
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

  record.totalTeams = totalTeams[0].count
  const rankIdx = allTeamResults.findIndex((r) => r.team_slug === slug)
  record.rank = rankIdx >= 0 ? rankIdx + 1 : 0

  return { slug: team.slug, name: team.name, record, skaters, goalies, games }
}
