import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getCurrentSeason, isStatsOnlySeason } from "@/lib/seasons"
import { filterLegacyTeams } from "@/lib/team-filters"
import { DEFAULT_GAME_LENGTH_MIN } from "@/lib/game-rules"
import { forfeitEligibleGamePredicate, effectiveRowTeamSlugSql } from "@/lib/forfeit-sql"

export type { TeamSkaterStat, TeamGoalieStat, TeamStatsData } from "@/lib/fetch-team-stats"
import type { TeamSkaterStat, TeamGoalieStat } from "@/lib/fetch-team-stats"

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
  skatersByTeam?: SkaterStat[]
  goaliesByTeam?: GoalieStat[]
  teamSkaters?: TeamSkaterStat[]
  teamGoalies?: TeamGoalieStat[]
  teams: { slug: string; name: string }[]
  lastUpdated: string
  hasPlayoffs?: boolean
}

export async function fetchPlayerStats(
  seasonParam?: string | null,
  playoff?: boolean,
  seasonTypeParam?: string | null,
  gameTypeParam?: string | null
): Promise<PlayerStatsData> {
  const isAllTime = seasonParam === "all"
  const seasonId = !isAllTime ? (seasonParam || (await getCurrentSeason()).id) : null
  const isPlayoff = playoff === true

  const gameType = isAllTime ? (gameTypeParam || (isPlayoff ? "playoffs" : "regular")) : (isPlayoff ? "playoffs" : "regular")

  let playoffFilter = sql`g.is_playoff = false`
  let gameTypeFragment = sql`g.game_type = 'regular'`
  let histPlayoffFilter = sql`pss.is_playoff = false`

  if (gameType === "playoffs") {
    playoffFilter = sql`g.is_playoff = true`
    gameTypeFragment = sql`g.game_type IN ('playoff', 'championship', 'regular')`
    histPlayoffFilter = sql`pss.is_playoff = true`
  } else if (gameType === "all") {
    playoffFilter = sql`1=1`
    gameTypeFragment = sql`g.game_type IN ('regular', 'playoff', 'championship')`
    histPlayoffFilter = sql`1=1`
  }

  const seasonType = seasonTypeParam || "fall"
  const seasonTypeFragment = seasonType === "all"
    ? sql`s.season_type IN ('fall', 'summer')`
    : sql`s.season_type = ${seasonType}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let skaterRows: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let goalieRows: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let teamRows: any[]
  // Season metadata and playoff availability are independent database reads.
  const [statsOnly, playoffCheck] = !isAllTime && seasonId
    ? await Promise.all([
        isStatsOnlySeason(seasonId),
        !isPlayoff ? rawSql(sql`
          SELECT EXISTS(SELECT 1 FROM games WHERE season_id = ${seasonId} AND is_playoff AND status = 'final') as has_playoffs
        `) : Promise.resolve([]),
      ])
    : [false, []]
  const hasPlayoffs = playoffCheck[0]?.has_playoffs ?? false

  if (isAllTime) {
    const skaterForfeitPred = forfeitEligibleGamePredicate(effectiveRowTeamSlugSql("pgs"))
    const goalieForfeitPred = forfeitEligibleGamePredicate(effectiveRowTeamSlugSql("ggs"))
    ;[skaterRows, goalieRows, teamRows] = await Promise.all([
      rawSql(sql`
        WITH game_stats AS (
          SELECT
            pgs.player_id,
            COUNT(DISTINCT pgs.game_id)::int as gp,
            COUNT(DISTINCT pgs.game_id) FILTER (WHERE NOT g.is_forfeit)::int as played_gp,
            COALESCE(SUM(pgs.goals) FILTER (WHERE NOT g.is_forfeit), 0)::int as goals,
            COALESCE(SUM(pgs.assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as assists,
            COALESCE(SUM(pgs.points) FILTER (WHERE NOT g.is_forfeit), 0)::int as points,
            COALESCE(SUM(pgs.gwg) FILTER (WHERE NOT g.is_forfeit), 0)::int as gwg,
            COALESCE(SUM(pgs.ppg) FILTER (WHERE NOT g.is_forfeit), 0)::int as ppg,
            COALESCE(SUM(pgs.shg) FILTER (WHERE NOT g.is_forfeit), 0)::int as shg,
            COALESCE(SUM(pgs.eng) FILTER (WHERE NOT g.is_forfeit), 0)::int as eng,
            COALESCE(SUM(pgs.hat_tricks) FILTER (WHERE NOT g.is_forfeit), 0)::int as hat_tricks,
            COALESCE(SUM(pgs.pen) FILTER (WHERE NOT g.is_forfeit), 0)::int as pen,
            COALESCE(SUM(pgs.pim) FILTER (WHERE NOT g.is_forfeit), 0)::int as pim,
            COUNT(DISTINCT g.season_id)::int as seasons_played
          FROM player_game_stats pgs
          JOIN games g ON pgs.game_id = g.id AND ${skaterForfeitPred} AND ${playoffFilter} AND ${gameTypeFragment}
          JOIN seasons s ON g.season_id = s.id AND ${seasonTypeFragment}
          WHERE NOT pgs.is_sub
          GROUP BY pgs.player_id
        ), hist_stats AS (
          SELECT
            pss.player_id,
            SUM(pss.gp)::int as gp,
            SUM(pss.goals)::int as goals, SUM(pss.assists)::int as assists,
            SUM(pss.points)::int as points, SUM(pss.gwg)::int as gwg,
            SUM(pss.ppg)::int as ppg, SUM(pss.shg)::int as shg,
            SUM(pss.eng)::int as eng, SUM(pss.hat_tricks)::int as hat_tricks,
            SUM(pss.pen)::int as pen, SUM(pss.pim)::int as pim,
            COUNT(DISTINCT pss.season_id)::int as seasons_played
          FROM player_season_stats pss
          JOIN seasons s ON pss.season_id = s.id AND ${seasonTypeFragment}
          WHERE ${histPlayoffFilter}
          GROUP BY pss.player_id
        ), combined AS (
          SELECT
            COALESCE(gs.player_id, hs.player_id) as player_id,
            COALESCE(gs.gp, 0) + COALESCE(hs.gp, 0) as gp,
            COALESCE(gs.played_gp, 0) + COALESCE(hs.gp, 0) as played_gp,
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
          c.gp, c.played_gp, c.goals, c.assists, c.points, c.gwg, c.ppg, c.shg, c.eng,
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
          COALESCE(SUM(ggs.seconds) FILTER (WHERE NOT g.is_forfeit), 0)::int as seconds,
          COALESCE(SUM(ggs.goals_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as goals_against,
          COALESCE(SUM(ggs.shots_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as shots_against,
          COALESCE(SUM(ggs.saves) FILTER (WHERE NOT g.is_forfeit), 0)::int as saves,
          COALESCE(SUM(ggs.shutouts) FILTER (WHERE NOT g.is_forfeit), 0)::int as shutouts,
          COALESCE(SUM(ggs.goalie_assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as goalie_assists,
          CASE WHEN COALESCE(SUM(ggs.shots_against) FILTER (WHERE NOT g.is_forfeit), 0) > 0
            THEN (COALESCE(SUM(ggs.saves) FILTER (WHERE NOT g.is_forfeit), 0))::float / (COALESCE(SUM(ggs.shots_against) FILTER (WHERE NOT g.is_forfeit), 0))::float
            ELSE 0 END as save_pct,
          CASE WHEN COALESCE(SUM(ggs.seconds) FILTER (WHERE NOT g.is_forfeit), 0) > 0
            THEN ((COALESCE(SUM(ggs.goals_against) FILTER (WHERE NOT g.is_forfeit), 0))::float / (COALESCE(SUM(ggs.seconds) FILTER (WHERE NOT g.is_forfeit), 0))::float) * 3600
            ELSE 0 END as gaa,
          COUNT(*) FILTER (WHERE NOT g.is_forfeit AND ggs.result = 'W')::int as wins,
          COUNT(*) FILTER (WHERE NOT g.is_forfeit AND ggs.result = 'L')::int as losses,
          COUNT(DISTINCT g.season_id)::int as seasons_played
        FROM players p
        JOIN goalie_game_stats ggs ON p.id = ggs.player_id
        JOIN games g ON ggs.game_id = g.id AND ${goalieForfeitPred} AND ${playoffFilter} AND ${gameTypeFragment}
        JOIN seasons s ON g.season_id = s.id AND ${seasonTypeFragment}
        WHERE NOT ggs.is_sub
        GROUP BY p.id, p.name
        ORDER BY save_pct DESC
      `),
      rawSql(sql`SELECT DISTINCT t.slug, t.name FROM teams t ORDER BY t.name`),
    ])
  } else if (seasonId && statsOnly) {
    const playoffFragment = isPlayoff ? sql`pss.is_playoff` : sql`NOT pss.is_playoff`
    ;[skaterRows, goalieRows, teamRows] = await Promise.all([
      rawSql(sql`
        SELECT
          p.id, p.name,
          t.name as team, pss.team_slug,
          pss.gp, pss.gp as played_gp, pss.goals, pss.assists, pss.points,
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
    const skaterForfeitPred = forfeitEligibleGamePredicate(effectiveRowTeamSlugSql("pgs"))
    const goalieForfeitPred = forfeitEligibleGamePredicate(effectiveRowTeamSlugSql("ggs"))
    ;[skaterRows, goalieRows, teamRows] = await Promise.all([
      rawSql(sql`
        SELECT
          p.id, p.name,
          gt.name as game_team,
          COALESCE(pgs.team_slug, ps.team_slug) as game_team_slug,
          COALESCE(ct.name, gt.name) as team,
          COALESCE(ps.team_slug, COALESCE(pgs.team_slug, ps.team_slug)) as team_slug,
          COUNT(DISTINCT pgs.game_id)::int as gp,
          COUNT(DISTINCT pgs.game_id) FILTER (WHERE NOT g.is_forfeit)::int as played_gp,
          COALESCE(SUM(pgs.goals) FILTER (WHERE NOT g.is_forfeit), 0)::int as goals,
          COALESCE(SUM(pgs.assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as assists,
          COALESCE(SUM(pgs.points) FILTER (WHERE NOT g.is_forfeit), 0)::int as points,
          COALESCE(SUM(pgs.gwg) FILTER (WHERE NOT g.is_forfeit), 0)::int as gwg,
          COALESCE(SUM(pgs.ppg) FILTER (WHERE NOT g.is_forfeit), 0)::int as ppg,
          COALESCE(SUM(pgs.shg) FILTER (WHERE NOT g.is_forfeit), 0)::int as shg,
          COALESCE(SUM(pgs.eng) FILTER (WHERE NOT g.is_forfeit), 0)::int as eng,
          COALESCE(SUM(pgs.hat_tricks) FILTER (WHERE NOT g.is_forfeit), 0)::int as hat_tricks,
          COALESCE(SUM(pgs.pen) FILTER (WHERE NOT g.is_forfeit), 0)::int as pen,
          COALESCE(SUM(pgs.pim) FILTER (WHERE NOT g.is_forfeit), 0)::int as pim
        FROM players p
        JOIN player_game_stats pgs ON p.id = pgs.player_id
        JOIN games g ON pgs.game_id = g.id AND ${skaterForfeitPred} AND g.season_id = ${seasonId} AND ${playoffFragment} AND ${gameTypeFragment}
        LEFT JOIN LATERAL (
          SELECT ps2.team_slug FROM player_seasons ps2
          WHERE ps2.player_id = p.id AND ps2.season_id = ${seasonId}
          ORDER BY ps2.season_id DESC LIMIT 1
        ) ps ON true
        LEFT JOIN teams gt ON gt.slug = COALESCE(pgs.team_slug, ps.team_slug)
        LEFT JOIN teams ct ON ct.slug = ps.team_slug
        WHERE NOT pgs.is_sub
        GROUP BY p.id, p.name, COALESCE(pgs.team_slug, ps.team_slug), gt.name, ps.team_slug, ct.name
        ORDER BY points DESC, goals DESC, p.name ASC
      `),
      rawSql(sql`
        SELECT
          p.id, p.name,
          gt.name as game_team,
          COALESCE(ggs.team_slug, ps.team_slug) as game_team_slug,
          COALESCE(ct.name, gt.name) as team,
          COALESCE(ps.team_slug, COALESCE(ggs.team_slug, ps.team_slug)) as team_slug,
          COUNT(DISTINCT ggs.game_id)::int as gp,
          COALESCE(SUM(ggs.seconds) FILTER (WHERE NOT g.is_forfeit), 0)::int as seconds,
          COALESCE(SUM(ggs.goals_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as goals_against,
          COALESCE(SUM(ggs.shots_against) FILTER (WHERE NOT g.is_forfeit), 0)::int as shots_against,
          COALESCE(SUM(ggs.saves) FILTER (WHERE NOT g.is_forfeit), 0)::int as saves,
          COALESCE(SUM(ggs.shutouts) FILTER (WHERE NOT g.is_forfeit), 0)::int as shutouts,
          COALESCE(SUM(ggs.goalie_assists) FILTER (WHERE NOT g.is_forfeit), 0)::int as goalie_assists,
          COALESCE(MAX(s.game_length), ${DEFAULT_GAME_LENGTH_MIN})::int as game_length,
          CASE WHEN COALESCE(SUM(ggs.shots_against) FILTER (WHERE NOT g.is_forfeit), 0) > 0
            THEN (COALESCE(SUM(ggs.saves) FILTER (WHERE NOT g.is_forfeit), 0))::float / (COALESCE(SUM(ggs.shots_against) FILTER (WHERE NOT g.is_forfeit), 0))::float
            ELSE 0 END as save_pct,
          CASE WHEN COALESCE(SUM(ggs.seconds) FILTER (WHERE NOT g.is_forfeit), 0) > 0
            THEN ((COALESCE(SUM(ggs.goals_against) FILTER (WHERE NOT g.is_forfeit), 0))::float / (COALESCE(SUM(ggs.seconds) FILTER (WHERE NOT g.is_forfeit), 0))::float) * (COALESCE(MAX(s.game_length), ${DEFAULT_GAME_LENGTH_MIN}) * 60)
            ELSE 0 END as gaa,
          COUNT(*) FILTER (WHERE NOT g.is_forfeit AND ggs.result = 'W')::int as wins,
          COUNT(*) FILTER (WHERE NOT g.is_forfeit AND ggs.result = 'L')::int as losses
        FROM players p
        JOIN goalie_game_stats ggs ON p.id = ggs.player_id
        JOIN games g ON ggs.game_id = g.id AND ${goalieForfeitPred} AND g.season_id = ${seasonId} AND ${playoffFragment} AND ${gameTypeFragment}
        LEFT JOIN seasons s ON g.season_id = s.id
        LEFT JOIN LATERAL (
          SELECT ps2.team_slug FROM player_seasons ps2
          WHERE ps2.player_id = p.id AND ps2.season_id = ${seasonId}
          ORDER BY ps2.season_id DESC LIMIT 1
        ) ps ON true
        LEFT JOIN teams gt ON gt.slug = COALESCE(ggs.team_slug, ps.team_slug)
        LEFT JOIN teams ct ON ct.slug = ps.team_slug
        WHERE NOT ggs.is_sub
        GROUP BY p.id, p.name, COALESCE(ggs.team_slug, ps.team_slug), gt.name, ps.team_slug, ct.name
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getPlayedGp = (r: any): number => (r.played_gp !== undefined ? Number(r.played_gp) : Number(r.gp)) || 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapSkaterRow = (r: any, useGameTeam = false): SkaterStat => {
    const playedGp = getPlayedGp(r)
    return {
      id: r.id,
      name: r.name,
      team: useGameTeam ? (r.game_team ?? r.team) : r.team,
      teamSlug: useGameTeam ? (r.game_team_slug ?? r.team_slug) : r.team_slug,
      gp: r.gp,
      goals: r.goals,
      assists: r.assists,
      points: r.points,
      ptsPg: playedGp > 0 ? (r.points / playedGp).toFixed(2) : "0.00",
      gwg: r.gwg,
      ppg: r.ppg,
      shg: r.shg,
      eng: r.eng,
      hatTricks: r.hat_tricks,
      pen: r.pen,
      pim: r.pim,
      ...(isAllTime ? { seasonsPlayed: r.seasons_played } : {}),
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapGoalieRow = (r: any, useGameTeam = false): GoalieStat => ({
    id: r.id,
    name: r.name,
    team: useGameTeam ? (r.game_team ?? r.team) : r.team,
    teamSlug: useGameTeam ? (r.game_team_slug ?? r.team_slug) : r.team_slug,
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
  })

  let skaters: SkaterStat[]
  let goalies: GoalieStat[]
  let skatersByTeam: SkaterStat[] | undefined
  let goaliesByTeam: GoalieStat[] | undefined

  if (!isAllTime && !statsOnly) {
    skatersByTeam = skaterRows.map((r) => mapSkaterRow(r, true))
    goaliesByTeam = goalieRows.map((r) => mapGoalieRow(r, true))

    const skaterById = new Map<number, { stat: SkaterStat; playedGp: number }>()
    for (const r of skaterRows) {
      const rowPlayedGp = getPlayedGp(r)
      const existing = skaterById.get(r.id)
      if (!existing) {
        skaterById.set(r.id, { stat: mapSkaterRow(r, false), playedGp: rowPlayedGp })
      } else {
        const s = existing.stat
        s.gp += r.gp
        existing.playedGp += rowPlayedGp
        s.goals += r.goals
        s.assists += r.assists
        s.points += r.points
        s.ptsPg = existing.playedGp > 0 ? (s.points / existing.playedGp).toFixed(2) : "0.00"
        s.gwg += r.gwg
        s.ppg += r.ppg
        s.shg += r.shg
        s.eng += r.eng
        s.hatTricks += r.hat_tricks
        s.pen += r.pen
        s.pim += r.pim
      }
    }
    skaters = [...skaterById.values()]
      .map((entry) => entry.stat)
      .sort(
        (a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name),
      )

    const goalieById = new Map<number, { stat: GoalieStat; gameLength: number }>()
    for (const r of goalieRows) {
      const gameLength = r.game_length || DEFAULT_GAME_LENGTH_MIN
      const existing = goalieById.get(r.id)
      if (!existing) {
        goalieById.set(r.id, { stat: mapGoalieRow(r, false), gameLength })
      } else {
        const s = existing.stat
        s.gp += r.gp
        s.seconds += r.seconds
        s.goalsAgainst += r.goals_against
        s.shotsAgainst += r.shots_against
        s.saves += r.saves
        s.shutouts += r.shutouts
        s.goalieAssists += r.goalie_assists
        s.wins += r.wins
        s.losses += r.losses
        s.savePercentage = s.shotsAgainst > 0 ? s.saves / s.shotsAgainst : 0
        s.gaa = s.seconds > 0 ? (s.goalsAgainst / s.seconds) * (existing.gameLength * 60) : 0
      }
    }
    goalies = [...goalieById.values()]
      .map((entry) => entry.stat)
      .sort((a, b) => b.savePercentage - a.savePercentage)
  } else {
    skaters = skaterRows.map((r) => mapSkaterRow(r, false))
    goalies = goalieRows.map((r) => mapGoalieRow(r, false))
  }

  const teams = filterLegacyTeams(teamRows).map((r) => ({ slug: r.slug, name: r.name }))

  return {
    skaters,
    goalies,
    ...(skatersByTeam ? { skatersByTeam } : {}),
    ...(goaliesByTeam ? { goaliesByTeam } : {}),
    teams,
    lastUpdated: new Date().toISOString(),
    hasPlayoffs,
  }
}
