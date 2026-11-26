import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getCurrentSeason, getSeasonById } from "@/lib/seasons"
import { computePlayoffOdds, DEFAULT_ITERATIONS } from "@/lib/playoff-odds"
import type {
  PlayoffOddsMode,
  PlayoffOddsSnapshot,
  PlayoffSimGame,
  SeasonKind,
} from "@/lib/playoff-odds-types"
import { isLegacyTeamSlug } from "@/lib/team-filters"

interface RawScheduleRow {
  id: string
  date: string
  time: string
  location: string | null
  away_slug: string
  away_name: string
  home_slug: string
  home_name: string
  away_score: number | null
  home_score: number | null
  status: string
  is_overtime: boolean
  has_shootout: boolean
  is_forfeit: boolean
  is_playoff: boolean
  game_type: string | null
}

/**
 * Fetches regular-season games + playoff metadata for a season in one minimal
 * DB round-trip wave and computes a deterministic PlayoffOddsSnapshot.
 */
export async function fetchPlayoffOdds(
  seasonParam?: string | null,
  mode: PlayoffOddsMode = "weighted"
): Promise<PlayoffOddsSnapshot> {
  const season =
    seasonParam && seasonParam !== "all"
      ? (await getSeasonById(seasonParam)) ?? (await getCurrentSeason())
      : await getCurrentSeason()

  // Schedule + franchise/team colors + dressed boxscore attendance in one parallel wave (neon-http: no sequential waterfall)
  const [rawRows, colorRows, attendanceRows] = await Promise.all([rawSql(sql`
    SELECT
      g.id,
      g.date,
      g.time,
      g.location,
      g.away_team AS away_slug,
      COALESCE(awt.name, g.away_team) AS away_name,
      g.home_team AS home_slug,
      COALESCE(ht.name, g.home_team) AS home_name,
      g.away_score,
      g.home_score,
      g.status,
      g.is_overtime,
      g.has_shootout,
      g.is_forfeit,
      g.is_playoff,
      g.game_type
    FROM games g
    LEFT JOIN teams ht ON g.home_team = ht.slug
    LEFT JOIN teams awt ON g.away_team = awt.slug
    WHERE g.season_id = ${season.id}
      AND g.id NOT LIKE 'test-%'
      AND (
        (COALESCE(g.game_type, 'regular') = 'regular' AND NOT g.is_playoff)
        OR g.is_playoff = true
      )
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
      SELECT st.team_slug, COALESCE(st.color, f.color) AS color
      FROM season_teams st
      LEFT JOIN franchises f ON f.slug = st.franchise_slug
      WHERE st.season_id = ${season.id}
    `),
    rawSql(sql`
      SELECT
        u.game_id,
        u.team_slug,
        COUNT(DISTINCT CASE WHEN u.is_skater = 1 THEN u.player_id END)::int AS skaters,
        COUNT(DISTINCT u.player_id)::int AS dressed
      FROM (
        SELECT pgs.game_id, pgs.team_slug, pgs.player_id, 1 AS is_skater
        FROM player_game_stats pgs
        INNER JOIN games g ON g.id = pgs.game_id
        WHERE g.season_id = ${season.id}
          AND g.status = 'final'
          AND g.id NOT LIKE 'test-%'
          AND COALESCE(g.game_type, 'regular') = 'regular'
          AND NOT g.is_playoff
          AND NOT g.is_forfeit
          AND pgs.team_slug IS NOT NULL
        UNION ALL
        SELECT ggs.game_id, ggs.team_slug, ggs.player_id, 0 AS is_skater
        FROM goalie_game_stats ggs
        INNER JOIN games g ON g.id = ggs.game_id
        WHERE g.season_id = ${season.id}
          AND g.status = 'final'
          AND g.id NOT LIKE 'test-%'
          AND COALESCE(g.game_type, 'regular') = 'regular'
          AND NOT g.is_playoff
          AND NOT g.is_forfeit
          AND ggs.team_slug IS NOT NULL
      ) u
      GROUP BY u.game_id, u.team_slug
    `),
  ])
  const rows = rawRows as unknown as RawScheduleRow[]

  // Per-season team color takes priority over franchise color (matches draft board / team pages)
  const teamColors: Record<string, string> = {}
  for (const r of colorRows as unknown as Array<{ team_slug: string; color: string | null }>) {
    if (r.color && /^#?[0-9a-f]{6}$/i.test(r.color)) {
      teamColors[r.team_slug] = r.color.startsWith("#") ? r.color.toLowerCase() : `#${r.color.toLowerCase()}`
    }
  }

  const attendanceByGameTeam = new Map<string, number>()
  for (const r of attendanceRows as unknown as Array<{
    game_id: string
    team_slug: string
    skaters: number | string
    dressed: number | string
  }>) {
    const skaters = Number(r.skaters)
    const dressed = Number(r.dressed)
    if (skaters > 0 && dressed > 0) {
      attendanceByGameTeam.set(`${r.game_id}|${r.team_slug}`, dressed)
    }
  }

  const regularGames: PlayoffSimGame[] = []
  const actualPlayoffTeams = new Set<string>()

  for (const r of rows) {
    if (r.is_playoff) {
      if (r.status === "final") {
        if (!isLegacyTeamSlug(r.away_slug)) actualPlayoffTeams.add(r.away_slug)
        if (!isLegacyTeamSlug(r.home_slug)) actualPlayoffTeams.add(r.home_slug)
      }
      continue
    }
    if ((r.game_type ?? "regular") !== "regular") continue
    if (isLegacyTeamSlug(r.away_slug) || isLegacyTeamSlug(r.home_slug)) continue

    const isRealFinal = r.status === "final" && !r.is_forfeit

    regularGames.push({
      id: r.id,
      date: r.date,
      time: r.time || "TBD",
      location: r.location || "The Lick",
      awaySlug: r.away_slug,
      awayName: r.away_name,
      homeSlug: r.home_slug,
      homeName: r.home_name,
      awayScore: r.status === "final" ? r.away_score : null,
      homeScore: r.status === "final" ? r.home_score : null,
      awayAttendance: isRealFinal ? (attendanceByGameTeam.get(`${r.id}|${r.away_slug}`) ?? null) : null,
      homeAttendance: isRealFinal ? (attendanceByGameTeam.get(`${r.id}|${r.home_slug}`) ?? null) : null,
      status: (r.status === "final" || r.status === "live" ? r.status : "upcoming") as
        | "final"
        | "upcoming"
        | "live",
      isOvertime: Boolean(r.is_overtime),
      hasShootout: Boolean(r.has_shootout),
      isForfeit: Boolean(r.is_forfeit),
    })
  }

  const seasonType: SeasonKind = season.seasonType === "summer" ? "summer" : "fall"

  const snapshot = computePlayoffOdds({
    seasonId: season.id,
    seasonName: season.name,
    seasonType,
    seasonStatus: season.status,
    configuredPlayoffTeams: season.playoffTeams,
    actualPlayoffTeamCount: actualPlayoffTeams.size,
    games: regularGames,
    mode,
    iterations: DEFAULT_ITERATIONS,
    includeTimeline: true,
    includeTailProbes: true,
  })
  return { ...snapshot, teamColors }
}
