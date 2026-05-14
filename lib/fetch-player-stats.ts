import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getCurrentSeason, isStatsOnlySeason } from "@/lib/seasons"

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
  seconds: number
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
  const seasonId = !isAllTime ? (seasonParam || (await getCurrentSeason()).id) : null
  const isPlayoff = playoff === true

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let skaterRows: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let goalieRows: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let teamRows: any[]
  let hasPlayoffs = false

  // Check if the selected season has playoff games (only for season-specific, non-playoff views)
  if (!isAllTime && !isPlayoff && seasonId) {
    const playoffCheck = await rawSql(sql`
      SELECT EXISTS(SELECT 1 FROM games WHERE season_id = ${seasonId} AND is_playoff AND status = 'final') as has_playoffs
    `)
    hasPlayoffs = playoffCheck[0]?.has_playoffs ?? false
  }

  if (isAllTime) {
    ;[skaterRows, goalieRows, teamRows] = await Promise.all([
      rawSql(sql`
        WITH game_stats AS (
          SELECT
            pgs.player_id,
            COUNT(DISTINCT pgs.game_id)::int as gp,
            SUM(pgs.goals)::int as goals, SUM(pgs.assists)::int as assists,
            SUM(pgs.points)::int as points, SUM(pgs.gwg)::int as gwg,
            SUM(pgs.ppg)::int as ppg, SUM(pgs.shg)::int as shg,
            SUM(pgs.eng)::int as eng, SUM(pgs.hat_tricks)::int as hat_tricks,
            SUM(pgs.pen)::int as pen, SUM(pgs.pim)::int as pim,
            COUNT(DISTINCT g.season_id)::int as seasons_played
          FROM player_game_stats pgs
          JOIN games g ON pgs.game_id = g.id AND NOT g.is_playoff AND g.game_type = 'regular'
          JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
          GROUP BY pgs.player_id
        ), hist_stats AS (
          SELECT
            player_id,
            SUM(gp)::int as gp,
            SUM(goals)::int as goals, SUM(assists)::int as assists,
            SUM(points)::int as points, SUM(gwg)::int as gwg,
            SUM(ppg)::int as ppg, SUM(shg)::int as shg,
            SUM(eng)::int as eng, SUM(hat_tricks)::int as hat_tricks,
            SUM(pen)::int as pen, SUM(pim)::int as pim,
            COUNT(DISTINCT season_id)::int as seasons_played
          FROM player_season_stats
          WHERE NOT is_playoff
          GROUP BY player_id
        ), combined AS (
          SELECT
            COALESCE(gs.player_id, hs.player_id) as player_id,
            COALESCE(gs.gp, 0) + COALESCE(hs.gp, 0) as gp,
            COALESCE(gs.goals, 0) + COALESCE(hs.goals, 0) as goals,
            COALESCE(gs.assists, 0) + COALESCE(hs.assists, 0) as assists,
            COALESCE(gs.points, 0) + COALESCE(hs.points, 0) as points,
            COALESCE(gs.gwg, 0) + COALESCE(hs.gwg, 0) as gwg,
            COALESCE(gs.ppg, 0) + COALESCE(hs.ppg, 0) as ppg,
            COALESCE(gs.shg, 0) + COALESCE(hs.shg, 0) as shg,
            COALESCE(gs.eng, 0) + COALESCE(hs.eng, 0) as eng,
            COALESCE(gs.hat_tricks, 0) + COALESCE(hs.hat_tricks, 0) as hat_tricks,
            COALESCE(gs.pen, 0) + COALESCE(hs.pen, 0) as pen,
            COALESCE(gs.pim, 0) + COALESCE(hs.pim, 0) as pim,
            COALESCE(gs.seasons_played, 0) + COALESCE(hs.seasons_played, 0) as seasons_played
          FROM game_stats gs
          FULL OUTER JOIN hist_stats hs ON gs.player_id = hs.player_id
        )
        SELECT
          c.player_id as id, p.name,
          (SELECT t2.name FROM player_seasons ps2 JOIN teams t2 ON ps2.team_slug = t2.slug
           WHERE ps2.player_id = c.player_id ORDER BY ps2.season_id DESC LIMIT 1) as team,
          (SELECT ps2.team_slug FROM player_seasons ps2
           WHERE ps2.player_id = c.player_id ORDER BY ps2.season_id DESC LIMIT 1) as team_slug,
          c.gp, c.goals, c.assists, c.points, c.gwg, c.ppg, c.shg, c.eng,
          c.hat_tricks, c.pen, c.pim, c.seasons_played
        FROM combined c
        JOIN players p ON c.player_id = p.id
        ORDER BY c.points DESC, c.goals DESC, p.name ASC
      `),
      rawSql(sql`
        SELECT
          p.id, p.name,
          (SELECT t2.name FROM player_seasons ps2 JOIN teams t2 ON ps2.team_slug = t2.slug
           WHERE ps2.player_id = p.id ORDER BY ps2.season_id DESC LIMIT 1) as team,
          (SELECT ps2.team_slug FROM player_seasons ps2
           WHERE ps2.player_id = p.id ORDER BY ps2.season_id DESC LIMIT 1) as team_slug,
          COUNT(DISTINCT ggs.game_id)::int as gp,
          SUM(ggs.seconds)::int as seconds,
          SUM(ggs.goals_against)::int as goals_against,
          SUM(ggs.shots_against)::int as shots_against,
          SUM(ggs.saves)::int as saves,
          SUM(ggs.shutouts)::int as shutouts,
          SUM(ggs.goalie_assists)::int as goalie_assists,
          CASE WHEN SUM(ggs.shots_against) > 0
            THEN SUM(ggs.saves)::float / SUM(ggs.shots_against)::float
            ELSE 0 END as save_pct,
          CASE WHEN SUM(ggs.seconds) > 0
            THEN (SUM(ggs.goals_against)::float / SUM(ggs.seconds)::float) * 3600
            ELSE 0 END as gaa,
          COUNT(*) FILTER (WHERE ggs.result = 'W')::int as wins,
          COUNT(*) FILTER (WHERE ggs.result = 'L')::int as losses,
          COUNT(DISTINCT g.season_id)::int as seasons_played
        FROM players p
        JOIN goalie_game_stats ggs ON p.id = ggs.player_id
        JOIN games g ON ggs.game_id = g.id AND g.game_type = 'regular'
        JOIN seasons s ON g.season_id = s.id AND s.season_type = 'fall'
        GROUP BY p.id, p.name
        ORDER BY save_pct DESC
      `),
      rawSql(sql`SELECT DISTINCT t.slug, t.name FROM teams t ORDER BY t.name`),
    ])
  } else if (seasonId && (await isStatsOnlySeason(seasonId))) {
    const playoffFragment = isPlayoff ? sql`pss.is_playoff` : sql`NOT pss.is_playoff`
    ;[skaterRows, goalieRows, teamRows] = await Promise.all([
      rawSql(sql`
        SELECT
          p.id, p.name,
          t.name as team, pss.team_slug,
          pss.gp, pss.goals, pss.assists, pss.points,
          pss.gwg, pss.ppg, pss.shg, pss.eng,
          pss.hat_tricks, pss.pen, pss.pim
        FROM player_season_stats pss
        JOIN players p ON pss.player_id = p.id
        JOIN teams t ON pss.team_slug = t.slug
        WHERE pss.season_id = ${seasonId} AND ${playoffFragment}
        ORDER BY pss.points DESC, pss.goals DESC, p.name ASC
      `),
      Promise.resolve([]),
      rawSql(sql`
        SELECT t.slug, t.name
        FROM season_teams st
        JOIN teams t ON st.team_slug = t.slug
        WHERE st.season_id = ${seasonId}
        ORDER BY t.name
      `),
    ])
  } else {
    const playoffFragment = isPlayoff ? sql`g.is_playoff` : sql`NOT g.is_playoff`
    ;[skaterRows, goalieRows, teamRows] = await Promise.all([
      rawSql(sql`
        SELECT
          p.id, p.name,
          (SELECT t2.name FROM player_seasons ps2 JOIN teams t2 ON ps2.team_slug = t2.slug
           WHERE ps2.player_id = p.id AND ps2.season_id = ${seasonId}
           ORDER BY ps2.season_id DESC LIMIT 1) as team,
          (SELECT ps2.team_slug FROM player_seasons ps2
           WHERE ps2.player_id = p.id AND ps2.season_id = ${seasonId}
           ORDER BY ps2.season_id DESC LIMIT 1) as team_slug,
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
        JOIN player_game_stats pgs ON p.id = pgs.player_id
        JOIN games g ON pgs.game_id = g.id AND g.season_id = ${seasonId} AND ${playoffFragment} AND g.game_type = ${isPlayoff ? 'playoff' : 'regular'}
        GROUP BY p.id, p.name
        ORDER BY points DESC, goals DESC, p.name ASC
      `),
      rawSql(sql`
        SELECT
          p.id, p.name,
          (SELECT t2.name FROM player_seasons ps2 JOIN teams t2 ON ps2.team_slug = t2.slug
           WHERE ps2.player_id = p.id AND ps2.season_id = ${seasonId}
           ORDER BY ps2.season_id DESC LIMIT 1) as team,
          (SELECT ps2.team_slug FROM player_seasons ps2
           WHERE ps2.player_id = p.id AND ps2.season_id = ${seasonId}
           ORDER BY ps2.season_id DESC LIMIT 1) as team_slug,
          COUNT(DISTINCT ggs.game_id)::int as gp,
          SUM(ggs.seconds)::int as seconds,
          SUM(ggs.goals_against)::int as goals_against,
          SUM(ggs.shots_against)::int as shots_against,
          SUM(ggs.saves)::int as saves,
          SUM(ggs.shutouts)::int as shutouts,
          SUM(ggs.goalie_assists)::int as goalie_assists,
          CASE WHEN SUM(ggs.shots_against) > 0
            THEN SUM(ggs.saves)::float / SUM(ggs.shots_against)::float
            ELSE 0 END as save_pct,
          CASE WHEN SUM(ggs.seconds) > 0
            THEN (SUM(ggs.goals_against)::float / SUM(ggs.seconds)::float) * 3600
            ELSE 0 END as gaa,
          COUNT(*) FILTER (WHERE ggs.result = 'W')::int as wins,
          COUNT(*) FILTER (WHERE ggs.result = 'L')::int as losses
        FROM players p
        JOIN goalie_game_stats ggs ON p.id = ggs.player_id
        JOIN games g ON ggs.game_id = g.id AND g.season_id = ${seasonId} AND ${playoffFragment} AND g.game_type = ${isPlayoff ? 'playoff' : 'regular'}
        GROUP BY p.id, p.name
        ORDER BY save_pct DESC
      `),
      rawSql(sql`
        SELECT t.slug, t.name
        FROM season_teams st
        JOIN teams t ON st.team_slug = t.slug
        WHERE st.season_id = ${seasonId}
        ORDER BY t.name
      `),
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
    seconds: r.seconds,
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

  // TODO: Remove seed-* filtering once legacy seed teams are cleaned from production
  const teams = teamRows
    .filter((r) => r.slug !== "tbd" && !r.slug.startsWith("seed-"))
    .map((r) => ({ slug: r.slug, name: r.name }))

  return { skaters, goalies, teams, lastUpdated: new Date().toISOString(), hasPlayoffs }
}
