import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getCurrentSeason } from "@/lib/seasons"
import { computeStandings } from "@/lib/standings"

export interface BashGame {
  id: string
  date: string
  time: string
  homeTeam: string
  homeSlug: string
  awayTeam: string
  awaySlug: string
  homeScore: number | null
  awayScore: number | null
  status: "final" | "upcoming" | "live"
  isOvertime: boolean
  isPlayoff: boolean
  isForfeit: boolean
  location: string
  hasBoxscore: boolean
  hasLiveStats: boolean
  livePeriod: number | null
  liveClockSeconds: number | null
  liveClockRunning: boolean | null
  liveClockStartedAt: number | null
  gameType: string
  hasShootout: boolean
  homePlaceholder: string | null
  awayPlaceholder: string | null
  seriesId: string | null
  seriesGameNumber: number | null
  bracketRound: string | null
  title?: string | null
}

export interface Standing {
  team: string
  slug: string
  gp: number
  w: number
  otw: number
  l: number
  otl: number
  gf: number
  ga: number
  gd: number
  pts: number
}

export interface BashApiData {
  games: BashGame[]
  standings: Standing[]
  lastUpdated: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBashGameRow(r: any): BashGame {
  return {
    id: r.id,
    date: r.date,
    time: r.time,
    homeTeam: r.home_team,
    homeSlug: r.home_slug,
    awayTeam: r.away_team,
    awaySlug: r.away_slug,
    homeScore: r.status === "final" || r.status === "live" ? r.home_score : null,
    awayScore: r.status === "final" || r.status === "live" ? r.away_score : null,
    status: r.status as "final" | "upcoming" | "live",
    isOvertime: r.is_overtime,
    isPlayoff: r.is_playoff,
    isForfeit: r.is_forfeit,
    location: r.location,
    hasBoxscore: r.has_boxscore,
    hasLiveStats: r.has_live_stats,
    livePeriod: r.live_state?.period ?? null,
    liveClockSeconds: r.live_state?.clockSeconds ?? null,
    liveClockRunning: r.live_state?.clockRunning ?? null,
    liveClockStartedAt: r.live_state?.clockStartedAt ?? null,
    gameType: r.game_type ?? "regular",
    hasShootout: r.has_shootout ?? false,
    homePlaceholder: r.home_placeholder ?? null,
    awayPlaceholder: r.away_placeholder ?? null,
    seriesId: r.series_id ?? null,
    seriesGameNumber: r.series_game_number ?? null,
    bracketRound: r.bracket_round ?? null,
    title: r.title ?? null,
  }
}

export async function fetchBashData(seasonParam?: string | null): Promise<BashApiData> {
  const seasonId = seasonParam && seasonParam !== "all" ? seasonParam : (await getCurrentSeason()).id

  const rows = await rawSql(sql`
    SELECT
      g.id, g.date, g.time, g.home_score, g.away_score,
      g.status, g.is_overtime, g.is_playoff, g.is_forfeit, g.location, g.has_boxscore,
      g.game_type, g.has_shootout, g.home_placeholder, g.away_placeholder,
      g.series_id, g.series_game_number, g.bracket_round, g.title,
      COALESCE(ht.name, g.home_team) as home_team, ht.slug as home_slug,
      COALESCE(awt.name, g.away_team) as away_team, awt.slug as away_slug,
      (gl.game_id IS NOT NULL) as has_live_stats,
      gl.state as live_state
    FROM games g
    LEFT JOIN teams ht ON g.home_team = ht.slug
    LEFT JOIN teams awt ON g.away_team = awt.slug
    LEFT JOIN game_live gl ON gl.game_id = g.id
    WHERE g.season_id = ${seasonId}
      AND g.id NOT LIKE 'test-%'
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
  `)

  const games = rows.map(mapBashGameRow)
  const standings = computeStandings(games)

  return { games, standings, lastUpdated: new Date().toISOString() }
}
