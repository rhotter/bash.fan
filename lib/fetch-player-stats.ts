import { sql } from "@/lib/db"
import { getCurrentSeason } from "@/lib/seasons"

export interface SkaterStat {
  id: number
  name: string
  team: string
  teamSlug: string
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
  seasonsPlayed?: number
}

export interface GoalieStat {
  id: number
  name: string
  team: string
  teamSlug: string
  gp: number
  minutes: number
  goalsAgainst: number
  shotsAgainst: number
  saves: number
  savePercentage: number
  gaa: number
  wins: number
  losses: number
  shutouts: number
  goalieAssists: number
  seasonsPlayed?: number
}

export interface PlayerStatsData {
  skaters: SkaterStat[]
  goalies: GoalieStat[]
  teams: { slug: string; name: string }[]
  lastUpdated: string
  hasPlayoffs?: boolean
}

export async function fetchPlayerStats(seasonParam?: string | null, playoff?: boolean): Promise<PlayerStatsData> {
  const isAllTime = seasonParam === "all"
  const seasonId = !isAllTime ? (seasonParam || getCurrentSeason().id) : null
  const isPlayoff = playoff === true

  let skaterRows
  let goalieRows
  let teamRows
  let hasPlayoffs = false

  // Check if the selected season has playoff games (only for season-specific, non-playoff views)
  if (!isAllTime && !isPlayoff && seasonId) {
    const playoffCheck = await sql`
      SELECT EXISTS(SELECT 1 FROM games WHERE season_id = ${seasonId} AND is_playoff AND status = 'final') as has_playoffs
    `
    hasPlayoffs = playoffCheck[0]?.has_playoffs ?? false
  }

  if (isAllTime) {
    ;[skaterRows, goalieRows, teamRows] = await Promise.all([
      sql`
        SELECT
          p.id, p.name,
          (SELECT t2.name FROM player_seasons ps2 JOIN teams t2 ON ps2.team_slug = t2.slug
           WHERE ps2.player_id = p.id ORDER BY ps2.season_id DESC LIMIT 1) as team,
          (SELECT ps2.team_slug FROM player_seasons ps2
           WHERE ps2.player_id = p.id ORDER BY ps2.season_id DESC LIMIT 1) as team_slug,
          COUNT(DISTINCT pgs.game_id)::int as gp,
          SUM(pgs.goals)::int as goals,
          SUM(pgs.assists)::int as assists,
          SUM(pgs.points)::int as points,
          SUM(pgs.gwg)::int as gwg,
          SUM(pgs.ppg)::int as ppg,
          SUM(pgs.shg)::int as shg,
          SUM(pgs.eng)::int as eng,
          SUM(pgs.hat_tricks)::int as hat_tricks,
          SUM(pgs.pen)::int as pen,
          SUM(pgs.pim)::int as pim,
          COUNT(DISTINCT g.season_id)::int as seasons_played
        FROM players p
        JOIN player_game_stats pgs ON p.id = pgs.player_id
        JOIN games g ON pgs.game_id = g.id
        GROUP BY p.id, p.name
        ORDER BY points DESC, goals DESC, p.name ASC
      `,
      sql`
        SELECT
          p.id, p.name,
          (SELECT t2.name FROM player_seasons ps2 JOIN teams t2 ON ps2.team_slug = t2.slug
           WHERE ps2.player_id = p.id ORDER BY ps2.season_id DESC LIMIT 1) as team,
          (SELECT ps2.team_slug FROM player_seasons ps2
           WHERE ps2.player_id = p.id ORDER BY ps2.season_id DESC LIMIT 1) as team_slug,
          COUNT(DISTINCT ggs.game_id)::int as gp,
          SUM(ggs.minutes)::int as minutes,
          SUM(ggs.goals_against)::int as goals_against,
          SUM(ggs.shots_against)::int as shots_against,
          SUM(ggs.saves)::int as saves,
          SUM(ggs.shutouts)::int as shutouts,
          SUM(ggs.goalie_assists)::int as goalie_assists,
          CASE WHEN SUM(ggs.shots_against) > 0
            THEN SUM(ggs.saves)::float / SUM(ggs.shots_against)::float
            ELSE 0 END as save_pct,
          CASE WHEN SUM(ggs.minutes) > 0
            THEN (SUM(ggs.goals_against)::float / SUM(ggs.minutes)::float) * 60
            ELSE 0 END as gaa,
          COUNT(*) FILTER (WHERE ggs.result = 'W')::int as wins,
          COUNT(*) FILTER (WHERE ggs.result = 'L')::int as losses,
          COUNT(DISTINCT g.season_id)::int as seasons_played
        FROM players p
        JOIN goalie_game_stats ggs ON p.id = ggs.player_id
        JOIN games g ON ggs.game_id = g.id
        GROUP BY p.id, p.name
        ORDER BY save_pct DESC
      `,
      sql`SELECT DISTINCT t.slug, t.name FROM teams t ORDER BY t.name`,
    ])
  } else {
    // Season-specific: join through games to properly scope stats
    ;[skaterRows, goalieRows, teamRows] = await Promise.all([
      sql`
        SELECT
          p.id, p.name,
          t.name as team, ps.team_slug,
          COUNT(DISTINCT pgs.game_id)::int as gp,
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
        JOIN teams t ON ps.team_slug = t.slug
        JOIN player_game_stats pgs ON p.id = pgs.player_id
        JOIN games g ON pgs.game_id = g.id AND g.season_id = ${seasonId} AND ${isPlayoff ? sql`g.is_playoff` : sql`NOT g.is_playoff`}
        GROUP BY p.id, p.name, t.name, ps.team_slug
        ORDER BY points DESC, goals DESC, p.name ASC
      `,
      sql`
        SELECT
          p.id, p.name,
          t.name as team, ps.team_slug,
          COUNT(DISTINCT ggs.game_id)::int as gp,
          SUM(ggs.minutes)::int as minutes,
          SUM(ggs.goals_against)::int as goals_against,
          SUM(ggs.shots_against)::int as shots_against,
          SUM(ggs.saves)::int as saves,
          SUM(ggs.shutouts)::int as shutouts,
          SUM(ggs.goalie_assists)::int as goalie_assists,
          CASE WHEN SUM(ggs.shots_against) > 0
            THEN SUM(ggs.saves)::float / SUM(ggs.shots_against)::float
            ELSE 0 END as save_pct,
          CASE WHEN SUM(ggs.minutes) > 0
            THEN (SUM(ggs.goals_against)::float / SUM(ggs.minutes)::float) * 60
            ELSE 0 END as gaa,
          COUNT(*) FILTER (WHERE ggs.result = 'W')::int as wins,
          COUNT(*) FILTER (WHERE ggs.result = 'L')::int as losses
        FROM players p
        JOIN player_seasons ps ON p.id = ps.player_id AND ps.season_id = ${seasonId}
        JOIN teams t ON ps.team_slug = t.slug
        JOIN goalie_game_stats ggs ON p.id = ggs.player_id
        JOIN games g ON ggs.game_id = g.id AND g.season_id = ${seasonId} AND ${isPlayoff ? sql`g.is_playoff` : sql`NOT g.is_playoff`}
        GROUP BY p.id, p.name, t.name, ps.team_slug
        ORDER BY save_pct DESC
      `,
      sql`
        SELECT t.slug, t.name
        FROM season_teams st
        JOIN teams t ON st.team_slug = t.slug
        WHERE st.season_id = ${seasonId}
        ORDER BY t.name
      `,
    ])
  }

  const skaters: SkaterStat[] = skaterRows.map((r) => ({
    id: r.id,
    name: r.name,
    team: r.team,
    teamSlug: r.team_slug,
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
    ...(isAllTime ? { seasonsPlayed: r.seasons_played } : {}),
  }))

  const goalies: GoalieStat[] = goalieRows.map((r) => ({
    id: r.id,
    name: r.name,
    team: r.team,
    teamSlug: r.team_slug,
    gp: r.gp,
    minutes: r.minutes,
    goalsAgainst: r.goals_against,
    shotsAgainst: r.shots_against,
    saves: r.saves,
    savePercentage: r.save_pct,
    gaa: r.gaa,
    wins: r.wins,
    losses: r.losses,
    shutouts: r.shutouts,
    goalieAssists: r.goalie_assists,
    ...(isAllTime ? { seasonsPlayed: r.seasons_played } : {}),
  }))

  const teams = teamRows.map((r) => ({ slug: r.slug, name: r.name }))

  return { skaters, goalies, teams, lastUpdated: new Date().toISOString(), hasPlayoffs }
}
