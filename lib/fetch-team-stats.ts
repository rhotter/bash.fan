import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getCurrentSeason } from "@/lib/seasons"
import { filterLegacyTeams, isLegacyTeamSlug } from "@/lib/team-filters"
import { DEFAULT_GAME_LENGTH_MIN, computeGaa } from "@/lib/game-rules"
import { formatSeasonName, compareTeamSeasonDesc } from "@/lib/season-name"

export interface TeamSkaterStat {
  team: string
  teamSlug: string
  seasonId?: string
  seasonName?: string
  isChampion?: boolean
  isFinalist?: boolean
  franchiseSlug?: string
  franchiseName?: string
  gp: number
  pgp: number
  goals: number
  goalsAgainst?: number | null
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

export interface TeamGoalieStat {
  team: string
  teamSlug: string
  seasonId?: string
  seasonName?: string
  isChampion?: boolean
  isFinalist?: boolean
  franchiseSlug?: string
  franchiseName?: string
  gp: number
  pgp: number
  seconds: number
  goalsAgainst: number
  shotsAgainst: number
  saPg?: string
  saves: number
  savePercentage: number
  gaa: number
  wins: number
  losses: number
  shutouts: number
  goalieAssists: number
}

export interface TeamStatsData {
  teamSkaters: TeamSkaterStat[]
  teamGoalies: TeamGoalieStat[]
}

export async function fetchTeamStats(
  seasonParam?: string | null,
  playoff?: boolean,
  seasonTypeParam?: string | null,
  gameTypeParam?: string | null
): Promise<TeamStatsData> {
  const isAllTime = seasonParam === "all"
  const seasonId = !isAllTime ? (seasonParam ?? null) : null
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
  const franchiseFilter = seasonType === "fall" ? sql` AND st.franchise_slug IS NOT NULL` : sql``

  let resolvedSeasonId = seasonId
  let statsOnly = false
  let seasonName: string | undefined
  let seasonGameLength = DEFAULT_GAME_LENGTH_MIN

  if (!isAllTime) {
    if (!resolvedSeasonId) {
      try {
        const currentSeason = await getCurrentSeason()
        resolvedSeasonId = currentSeason.id
        seasonName = formatSeasonName(currentSeason.name || currentSeason.id)
        statsOnly = currentSeason.statsOnly === true
      } catch {
        resolvedSeasonId = null
      }
    }
    if (resolvedSeasonId) {
      const seasonRows = await rawSql(sql`SELECT id, name, game_length, stats_only FROM seasons WHERE id = ${resolvedSeasonId}`)
      if (seasonRows.length > 0) {
        resolvedSeasonId = seasonRows[0].id
        seasonName = formatSeasonName(seasonRows[0].name || seasonRows[0].id)
        statsOnly = seasonRows[0].stats_only === true
        if (seasonRows[0].game_length) {
          seasonGameLength = Number(seasonRows[0].game_length) || DEFAULT_GAME_LENGTH_MIN
        }
      }
    }
  }

  // Count opponent scores once per game, including goals conceded into an empty net.
  const goalsAgainstQuery = sql`
    SELECT g.season_id, side.team_slug, SUM(side.goals_against)::int AS goals_against
    FROM games g
    JOIN seasons s ON s.id = g.season_id
    CROSS JOIN LATERAL (VALUES
      (g.home_team, g.away_score), (g.away_team, g.home_score)
    ) AS side(team_slug, goals_against)
    WHERE g.status = 'final' AND NOT g.is_forfeit
      AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
      AND ${playoffFilter} AND ${gameTypeFragment}
      AND ${isAllTime ? seasonTypeFragment : sql`g.season_id = ${resolvedSeasonId}`}
    GROUP BY g.season_id, side.team_slug
  `

  if (isAllTime) {
    const [skaterRows, histSkaterRows, goalieRows, championRows, franchiseRows, goalsAgainstRows] = await Promise.all([
      rawSql(sql`
        SELECT
          COALESCE(pgs.team_slug, ps.team_slug) as team_slug,
          COALESCE(gt.name, ct.name) as team,
          s.id as season_id,
          s.name as season_name,
          COUNT(DISTINCT pgs.game_id)::int as gp,
          COUNT(*)::int as pgp,
          COALESCE(SUM(pgs.goals), 0)::int as goals,
          COALESCE(SUM(pgs.assists), 0)::int as assists,
          COALESCE(SUM(pgs.points), 0)::int as points,
          COALESCE(SUM(pgs.gwg), 0)::int as gwg,
          COALESCE(SUM(pgs.ppg), 0)::int as ppg,
          COALESCE(SUM(pgs.shg), 0)::int as shg,
          COALESCE(SUM(pgs.eng), 0)::int as eng,
          COALESCE(SUM(pgs.hat_tricks), 0)::int as hat_tricks,
          COALESCE(SUM(pgs.pen), 0)::int as pen,
          COALESCE(SUM(pgs.pim), 0)::int as pim
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.id AND NOT g.is_forfeit AND ${playoffFilter} AND ${gameTypeFragment}
        JOIN seasons s ON g.season_id = s.id AND ${seasonTypeFragment}
        LEFT JOIN LATERAL (
          SELECT ps2.team_slug FROM player_seasons ps2
          WHERE ps2.player_id = pgs.player_id AND ps2.season_id = s.id
          ORDER BY ps2.season_id DESC LIMIT 1
        ) ps ON true
        LEFT JOIN teams gt ON gt.slug = COALESCE(pgs.team_slug, ps.team_slug)
        LEFT JOIN teams ct ON ct.slug = ps.team_slug
        GROUP BY COALESCE(pgs.team_slug, ps.team_slug), COALESCE(gt.name, ct.name), s.id, s.name
      `),
      rawSql(sql`
        SELECT
          pss.team_slug,
          t.name as team,
          s.id as season_id,
          s.name as season_name,
          (COALESCE(MAX(pss.gp) FILTER (WHERE NOT pss.is_playoff), 0) + COALESCE(MAX(pss.gp) FILTER (WHERE pss.is_playoff), 0))::int as gp,
          COALESCE(SUM(pss.gp), 0)::int as pgp,
          COALESCE(SUM(pss.goals), 0)::int as goals,
          COALESCE(SUM(pss.assists), 0)::int as assists,
          COALESCE(SUM(pss.points), 0)::int as points,
          COALESCE(SUM(pss.gwg), 0)::int as gwg,
          COALESCE(SUM(pss.ppg), 0)::int as ppg,
          COALESCE(SUM(pss.shg), 0)::int as shg,
          COALESCE(SUM(pss.eng), 0)::int as eng,
          COALESCE(SUM(pss.hat_tricks), 0)::int as hat_tricks,
          COALESCE(SUM(pss.pen), 0)::int as pen,
          COALESCE(SUM(pss.pim), 0)::int as pim
        FROM player_season_stats pss
        JOIN seasons s ON pss.season_id = s.id AND s.stats_only AND ${seasonTypeFragment}
        JOIN teams t ON pss.team_slug = t.slug
        WHERE ${histPlayoffFilter}
        GROUP BY pss.team_slug, t.name, s.id, s.name
      `),
      rawSql(sql`
        SELECT
          COALESCE(ggs.team_slug, ps.team_slug) as team_slug,
          COALESCE(gt.name, ct.name) as team,
          s.id as season_id,
          s.name as season_name,
          COUNT(DISTINCT ggs.game_id)::int as gp,
          COUNT(*)::int as pgp,
          COALESCE(SUM(ggs.seconds), 0)::int as seconds,
          COALESCE(SUM(ggs.goals_against), 0)::int as goals_against,
          COALESCE(SUM(ggs.shots_against), 0)::int as shots_against,
          COALESCE(SUM(ggs.saves), 0)::int as saves,
          COALESCE(SUM(ggs.shutouts), 0)::int as shutouts,
          COALESCE(SUM(ggs.goalie_assists), 0)::int as goalie_assists,
          COALESCE(MAX(s.game_length), ${DEFAULT_GAME_LENGTH_MIN})::int as game_length,
          COUNT(DISTINCT ggs.game_id) FILTER (WHERE ggs.result = 'W')::int as wins,
          COUNT(DISTINCT ggs.game_id) FILTER (WHERE ggs.result = 'L')::int as losses
        FROM goalie_game_stats ggs
        JOIN games g ON ggs.game_id = g.id AND NOT g.is_forfeit AND ${playoffFilter} AND ${gameTypeFragment}
        JOIN seasons s ON g.season_id = s.id AND ${seasonTypeFragment}
        LEFT JOIN LATERAL (
          SELECT ps2.team_slug FROM player_seasons ps2
          WHERE ps2.player_id = ggs.player_id AND ps2.season_id = s.id
          ORDER BY ps2.season_id DESC LIMIT 1
        ) ps ON true
        LEFT JOIN teams gt ON gt.slug = COALESCE(ggs.team_slug, ps.team_slug)
        LEFT JOIN teams ct ON ct.slug = ps.team_slug
        GROUP BY COALESCE(ggs.team_slug, ps.team_slug), COALESCE(gt.name, ct.name), s.id, s.name
      `),
      rawSql(sql`
        SELECT DISTINCT ON (g.season_id)
          g.season_id,
          CASE
            WHEN g.home_score > g.away_score THEN g.home_team
            WHEN g.away_score > g.home_score THEN g.away_team
            ELSE NULL
          END as champion_slug,
          CASE
            WHEN g.home_score > g.away_score THEN g.away_team
            WHEN g.away_score > g.home_score THEN g.home_team
            ELSE NULL
          END as finalist_slug
        FROM games g
        WHERE g.is_playoff AND g.status = 'final'
          AND (g.bracket_round IS NULL OR g.bracket_round NOT IN ('play-in', 'quarterfinal', 'semifinal'))
          AND NOT EXISTS (
            SELECT 1 FROM games g_later
            WHERE g_later.season_id = g.season_id
              AND g_later.is_playoff
              AND g_later.status != 'final'
              AND (g_later.date = '' OR g_later.date > g.date OR (g_later.date = g.date AND g_later.id > g.id))
          )
        ORDER BY g.season_id, (g.game_type = 'championship' OR g.bracket_round IN ('final', 'finals')) DESC, g.date DESC, g.id DESC
      `),
      rawSql(sql`
        SELECT st.season_id, st.team_slug, st.franchise_slug, f.name as franchise_name
        FROM season_teams st
        JOIN franchises f ON st.franchise_slug = f.slug
        WHERE st.franchise_slug IS NOT NULL
      `),
      rawSql(goalsAgainstQuery),
    ])

    const goalsAgainstByTeam = new Map((goalsAgainstRows ?? []).map((r) => [`${r.season_id}:${r.team_slug}`, Number(r.goals_against)]))

    const championBySeason = new Map<string, string>()
    const finalistBySeason = new Map<string, string>()
    for (const c of championRows ?? []) {
      if (c.season_id && c.champion_slug) {
        championBySeason.set(c.season_id, c.champion_slug)
      }
      if (c.season_id && c.finalist_slug) {
        finalistBySeason.set(c.season_id, c.finalist_slug)
      }
    }

    const franchiseBySeasonTeam = new Map<string, { slug: string; name: string }>()
    for (const f of franchiseRows ?? []) {
      if (f.season_id && f.team_slug && f.franchise_slug) {
        franchiseBySeasonTeam.set(`${f.season_id}:${f.team_slug}`, {
          slug: f.franchise_slug,
          name: f.franchise_name || f.franchise_slug,
        })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allSkaterRows: any[] = [...skaterRows, ...histSkaterRows]

    const teamSkaters: TeamSkaterStat[] = allSkaterRows
      .filter((r) => r.team_slug && !isLegacyTeamSlug(r.team_slug))
      .map((r) => {
        const teamName = r.team || r.team_slug
        const gp = Number(r.gp) || 0
        const pgp = r.pgp !== undefined ? Number(r.pgp) || 0 : gp
        const points = Number(r.points) || 0
        const isChampion = championBySeason.get(r.season_id) === r.team_slug
        const isFinalist = finalistBySeason.get(r.season_id) === r.team_slug
        const franchise = franchiseBySeasonTeam.get(`${r.season_id}:${r.team_slug}`)
        return {
          team: teamName,
          teamSlug: r.team_slug,
          seasonId: r.season_id,
          seasonName: formatSeasonName(r.season_name || r.season_id),
          ...(isChampion ? { isChampion: true } : {}),
          ...(isFinalist ? { isFinalist: true } : {}),
          ...(franchise ? { franchiseSlug: franchise.slug, franchiseName: franchise.name } : {}),
          gp,
          pgp,
          goals: Number(r.goals) || 0,
          goalsAgainst: goalsAgainstByTeam.get(`${r.season_id}:${r.team_slug}`) ?? (gp === 0 ? 0 : null),
          assists: Number(r.assists) || 0,
          points,
          ptsPg: gp > 0 ? (points / gp).toFixed(2) : "0.00",
          gwg: Number(r.gwg) || 0,
          ppg: Number(r.ppg) || 0,
          shg: Number(r.shg) || 0,
          eng: Number(r.eng) || 0,
          hatTricks: Number(r.hat_tricks) || 0,
          pen: Number(r.pen) || 0,
          pim: Number(r.pim) || 0,
        }
      })
      .sort((a, b) => b.points - a.points || b.goals - a.goals || a.team.localeCompare(b.team) || compareTeamSeasonDesc(a, b))

    const teamGoalies: TeamGoalieStat[] = goalieRows
      .filter((r) => r.team_slug && !isLegacyTeamSlug(r.team_slug))
      .map((r) => {
        const teamName = r.team || r.team_slug
        const gp = Number(r.gp) || 0
        const pgp = r.pgp !== undefined ? Number(r.pgp) || 0 : gp
        const seconds = Number(r.seconds) || 0
        const goalsAgainst = Number(r.goals_against) || 0
        const shotsAgainst = Number(r.shots_against) || 0
        const saves = Number(r.saves) || 0
        const gameLength = Number(r.game_length) || DEFAULT_GAME_LENGTH_MIN
        const savePercentage = shotsAgainst > 0 ? saves / shotsAgainst : 0
        const gaa = computeGaa(goalsAgainst, seconds, gameLength)
        const isChampion = championBySeason.get(r.season_id) === r.team_slug
        const isFinalist = finalistBySeason.get(r.season_id) === r.team_slug
        const franchise = franchiseBySeasonTeam.get(`${r.season_id}:${r.team_slug}`)

        return {
          team: teamName,
          teamSlug: r.team_slug,
          seasonId: r.season_id,
          seasonName: formatSeasonName(r.season_name || r.season_id),
          ...(isChampion ? { isChampion: true } : {}),
          ...(isFinalist ? { isFinalist: true } : {}),
          ...(franchise ? { franchiseSlug: franchise.slug, franchiseName: franchise.name } : {}),
          gp,
          pgp,
          seconds,
          goalsAgainst,
          shotsAgainst,
          saPg: gp > 0 ? (shotsAgainst / gp).toFixed(2) : "0.00",
          saves,
          savePercentage,
          gaa,
          wins: Number(r.wins) || 0,
          losses: Number(r.losses) || 0,
          shutouts: Number(r.shutouts) || 0,
          goalieAssists: Number(r.goalie_assists) || 0,
        }
      })
      .sort((a, b) => b.savePercentage - a.savePercentage || a.gaa - b.gaa || a.team.localeCompare(b.team) || compareTeamSeasonDesc(a, b))

    return { teamSkaters, teamGoalies }
  }

  // Single season mode
  if (statsOnly) {
    const playoffFragment = isPlayoff ? sql`pss.is_playoff` : sql`NOT pss.is_playoff`
    const [skaterRows, seasonTeamRows, goalsAgainstRows] = await Promise.all([
      rawSql(sql`
        SELECT
          pss.team_slug,
          t.name as team,
          COALESCE(MAX(pss.gp), 0)::int as gp,
          COALESCE(SUM(pss.gp), 0)::int as pgp,
          COALESCE(SUM(pss.goals), 0)::int as goals,
          COALESCE(SUM(pss.assists), 0)::int as assists,
          COALESCE(SUM(pss.points), 0)::int as points,
          COALESCE(SUM(pss.gwg), 0)::int as gwg,
          COALESCE(SUM(pss.ppg), 0)::int as ppg,
          COALESCE(SUM(pss.shg), 0)::int as shg,
          COALESCE(SUM(pss.eng), 0)::int as eng,
          COALESCE(SUM(pss.hat_tricks), 0)::int as hat_tricks,
          COALESCE(SUM(pss.pen), 0)::int as pen,
          COALESCE(SUM(pss.pim), 0)::int as pim
        FROM player_season_stats pss
        JOIN teams t ON pss.team_slug = t.slug
        WHERE pss.season_id = ${resolvedSeasonId} AND ${playoffFragment}
        GROUP BY pss.team_slug, t.name
      `),
      rawSql(sql`
        SELECT t.slug, t.name
        FROM season_teams st
        JOIN teams t ON st.team_slug = t.slug
        WHERE st.season_id = ${resolvedSeasonId}${franchiseFilter}
        ORDER BY t.name
      `),
      rawSql(goalsAgainstQuery),
    ])

    const goalsAgainstByTeam = new Map((goalsAgainstRows ?? []).map((r) => [`${r.season_id}:${r.team_slug}`, Number(r.goals_against)]))

    const activeTeams = filterLegacyTeams(seasonTeamRows as { slug: string; name: string }[])
    const teamSlugSet = new Set(activeTeams.map((t) => t.slug))
    for (const r of skaterRows) {
      if (r.team_slug && !teamSlugSet.has(r.team_slug) && !isLegacyTeamSlug(r.team_slug)) {
        activeTeams.push({ slug: r.team_slug, name: r.team || r.team_slug })
        teamSlugSet.add(r.team_slug)
      }
    }

    const skaterRowMap = new Map<string, typeof skaterRows[0]>()
    for (const r of skaterRows) {
      if (r.team_slug) skaterRowMap.set(r.team_slug, r)
    }

    const teamSkaters: TeamSkaterStat[] = activeTeams.map((t) => {
      const r = skaterRowMap.get(t.slug)
      const gp = r ? Number(r.gp) || 0 : 0
      const pgp = r ? (r.pgp !== undefined ? Number(r.pgp) || 0 : gp) : 0
      const points = r ? Number(r.points) || 0 : 0
      return {
        team: t.name,
        teamSlug: t.slug,
        seasonId: resolvedSeasonId ?? undefined,
        seasonName,
        gp,
        pgp,
        goals: r ? Number(r.goals) || 0 : 0,
        goalsAgainst: goalsAgainstByTeam.get(`${resolvedSeasonId}:${t.slug}`) ?? (gp === 0 ? 0 : null),
        assists: r ? Number(r.assists) || 0 : 0,
        points,
        ptsPg: gp > 0 ? (points / gp).toFixed(2) : "0.00",
        gwg: r ? Number(r.gwg) || 0 : 0,
        ppg: r ? Number(r.ppg) || 0 : 0,
        shg: r ? Number(r.shg) || 0 : 0,
        eng: r ? Number(r.eng) || 0 : 0,
        hatTricks: r ? Number(r.hat_tricks) || 0 : 0,
        pen: r ? Number(r.pen) || 0 : 0,
        pim: r ? Number(r.pim) || 0 : 0,
      }
    }).sort((a, b) => b.points - a.points || b.goals - a.goals || a.team.localeCompare(b.team))

    return { teamSkaters, teamGoalies: [] }
  }

  // Normal single season mode
  const playoffFragment = isPlayoff ? sql`g.is_playoff` : sql`NOT g.is_playoff`
  const [skaterRows, goalieRows, seasonTeamRows, goalsAgainstRows] = await Promise.all([
    rawSql(sql`
      SELECT
        COALESCE(pgs.team_slug, ps.team_slug) as team_slug,
        COALESCE(gt.name, ct.name) as team,
        COUNT(DISTINCT pgs.game_id)::int as gp,
        COUNT(*)::int as pgp,
        COALESCE(SUM(pgs.goals), 0)::int as goals,
        COALESCE(SUM(pgs.assists), 0)::int as assists,
        COALESCE(SUM(pgs.points), 0)::int as points,
        COALESCE(SUM(pgs.gwg), 0)::int as gwg,
        COALESCE(SUM(pgs.ppg), 0)::int as ppg,
        COALESCE(SUM(pgs.shg), 0)::int as shg,
        COALESCE(SUM(pgs.eng), 0)::int as eng,
        COALESCE(SUM(pgs.hat_tricks), 0)::int as hat_tricks,
        COALESCE(SUM(pgs.pen), 0)::int as pen,
        COALESCE(SUM(pgs.pim), 0)::int as pim
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND NOT g.is_forfeit AND g.season_id = ${resolvedSeasonId} AND ${playoffFragment} AND ${gameTypeFragment}
      LEFT JOIN LATERAL (
        SELECT ps2.team_slug FROM player_seasons ps2
        WHERE ps2.player_id = pgs.player_id AND ps2.season_id = ${resolvedSeasonId}
        ORDER BY ps2.season_id DESC LIMIT 1
      ) ps ON true
      LEFT JOIN teams gt ON gt.slug = COALESCE(pgs.team_slug, ps.team_slug)
      LEFT JOIN teams ct ON ct.slug = ps.team_slug
      GROUP BY COALESCE(pgs.team_slug, ps.team_slug), COALESCE(gt.name, ct.name)
    `),
    rawSql(sql`
      SELECT
        COALESCE(ggs.team_slug, ps.team_slug) as team_slug,
        COALESCE(gt.name, ct.name) as team,
        COUNT(DISTINCT ggs.game_id)::int as gp,
        COUNT(*)::int as pgp,
        COALESCE(SUM(ggs.seconds), 0)::int as seconds,
        COALESCE(SUM(ggs.goals_against), 0)::int as goals_against,
        COALESCE(SUM(ggs.shots_against), 0)::int as shots_against,
        COALESCE(SUM(ggs.saves), 0)::int as saves,
        COALESCE(SUM(ggs.shutouts), 0)::int as shutouts,
        COALESCE(SUM(ggs.goalie_assists), 0)::int as goalie_assists,
        COALESCE(MAX(s.game_length), ${seasonGameLength})::int as game_length,
        COUNT(DISTINCT ggs.game_id) FILTER (WHERE ggs.result = 'W')::int as wins,
        COUNT(DISTINCT ggs.game_id) FILTER (WHERE ggs.result = 'L')::int as losses
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND NOT g.is_forfeit AND g.season_id = ${resolvedSeasonId} AND ${playoffFragment} AND ${gameTypeFragment}
      LEFT JOIN seasons s ON g.season_id = s.id
      LEFT JOIN LATERAL (
        SELECT ps2.team_slug FROM player_seasons ps2
        WHERE ps2.player_id = ggs.player_id AND ps2.season_id = ${resolvedSeasonId}
        ORDER BY ps2.season_id DESC LIMIT 1
      ) ps ON true
      LEFT JOIN teams gt ON gt.slug = COALESCE(ggs.team_slug, ps.team_slug)
      LEFT JOIN teams ct ON ct.slug = ps.team_slug
      GROUP BY COALESCE(ggs.team_slug, ps.team_slug), COALESCE(gt.name, ct.name)
    `),
    rawSql(sql`
      SELECT t.slug, t.name
      FROM season_teams st
      JOIN teams t ON st.team_slug = t.slug
      WHERE st.season_id = ${resolvedSeasonId}${franchiseFilter}
      ORDER BY t.name
    `),
    rawSql(goalsAgainstQuery),
  ])

  const goalsAgainstByTeam = new Map((goalsAgainstRows ?? []).map((r) => [`${r.season_id}:${r.team_slug}`, Number(r.goals_against)]))

  const activeTeams = filterLegacyTeams(seasonTeamRows as { slug: string; name: string }[])
  const teamSlugSet = new Set(activeTeams.map((t) => t.slug))
  for (const r of skaterRows) {
    if (r.team_slug && !teamSlugSet.has(r.team_slug) && !isLegacyTeamSlug(r.team_slug)) {
      activeTeams.push({ slug: r.team_slug, name: r.team || r.team_slug })
      teamSlugSet.add(r.team_slug)
    }
  }
  for (const r of goalieRows) {
    if (r.team_slug && !teamSlugSet.has(r.team_slug) && !isLegacyTeamSlug(r.team_slug)) {
      activeTeams.push({ slug: r.team_slug, name: r.team || r.team_slug })
      teamSlugSet.add(r.team_slug)
    }
  }
  const defaultSeasonGameLength = seasonGameLength

  const skaterRowMap = new Map<string, typeof skaterRows[0]>()
  for (const r of skaterRows) {
    if (r.team_slug) skaterRowMap.set(r.team_slug, r)
  }

  const teamSkaters: TeamSkaterStat[] = activeTeams.map((t) => {
    const r = skaterRowMap.get(t.slug)
    const gp = r ? Number(r.gp) || 0 : 0
    const pgp = r ? (r.pgp !== undefined ? Number(r.pgp) || 0 : gp) : 0
    const points = r ? Number(r.points) || 0 : 0
    return {
      team: t.name,
      teamSlug: t.slug,
      seasonId: resolvedSeasonId ?? undefined,
      seasonName,
      gp,
      pgp,
      goals: r ? Number(r.goals) || 0 : 0,
      goalsAgainst: goalsAgainstByTeam.get(`${resolvedSeasonId}:${t.slug}`) ?? (gp === 0 ? 0 : null),
      assists: r ? Number(r.assists) || 0 : 0,
      points,
      ptsPg: gp > 0 ? (points / gp).toFixed(2) : "0.00",
      gwg: r ? Number(r.gwg) || 0 : 0,
      ppg: r ? Number(r.ppg) || 0 : 0,
      shg: r ? Number(r.shg) || 0 : 0,
      eng: r ? Number(r.eng) || 0 : 0,
      hatTricks: r ? Number(r.hat_tricks) || 0 : 0,
      pen: r ? Number(r.pen) || 0 : 0,
      pim: r ? Number(r.pim) || 0 : 0,
    }
  }).sort((a, b) => b.points - a.points || b.goals - a.goals || a.team.localeCompare(b.team))

  const goalieRowMap = new Map<string, typeof goalieRows[0]>()
  for (const r of goalieRows) {
    if (r.team_slug) goalieRowMap.set(r.team_slug, r)
  }

  // Acceptance criteria: Every active non-legacy team in the selected season appears once in Goalie table (when goalie stats exist)
  const teamGoalies: TeamGoalieStat[] = activeTeams
    .filter((t) => goalieRowMap.has(t.slug))
    .map((t) => {
      const r = goalieRowMap.get(t.slug)!
      const gp = Number(r.gp) || 0
      const pgp = r.pgp !== undefined ? Number(r.pgp) || 0 : gp
      const seconds = Number(r.seconds) || 0
      const goalsAgainst = Number(r.goals_against) || 0
      const shotsAgainst = Number(r.shots_against) || 0
      const saves = Number(r.saves) || 0
      const gameLength = Number(r.game_length) || defaultSeasonGameLength
      const savePercentage = shotsAgainst > 0 ? saves / shotsAgainst : 0
      const gaa = computeGaa(goalsAgainst, seconds, gameLength)

      return {
        team: t.name,
        teamSlug: t.slug,
        seasonId: resolvedSeasonId ?? undefined,
        seasonName,
        gp,
        pgp,
        seconds,
        goalsAgainst,
        shotsAgainst,
        saPg: gp > 0 ? (shotsAgainst / gp).toFixed(2) : "0.00",
        saves,
        savePercentage,
        gaa,
        wins: Number(r.wins) || 0,
        losses: Number(r.losses) || 0,
        shutouts: Number(r.shutouts) || 0,
        goalieAssists: Number(r.goalie_assists) || 0,
      }
    })
    .sort((a, b) => b.savePercentage - a.savePercentage || a.gaa - b.gaa || a.team.localeCompare(b.team))

  return { teamSkaters, teamGoalies }
}
