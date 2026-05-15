import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getCurrentSeason, getSeasonById } from "@/lib/seasons"
import { SiteHeader } from "@/components/site-header"
import { ScorekeeperGameList } from "./scorekeeper-game-list"
import type { BashGame } from "@/lib/hockey-data"

export const dynamic = "force-dynamic"

export default async function ScorekeeperIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>
}) {
  const { season: seasonParam } = await searchParams

  // Support ?season= override so admins can score tryout games during draft
  let season = await getCurrentSeason()
  if (seasonParam) {
    const override = await getSeasonById(seasonParam)
    if (override) season = override
  }

  const rows = await rawSql(sql`
    SELECT g.id, g.date, g.time, g.status,
      g.home_score, g.away_score,
      g.home_team, g.away_team,
      g.is_overtime, g.is_playoff, g.is_forfeit,
      g.location, g.has_boxscore,
      g.game_type,
      COALESCE(ht.name, g.home_team) as home_team_name,
      COALESCE(awt.name, g.away_team) as away_team_name,
      gl.game_id IS NOT NULL as has_live_stats,
      (gl.state->>'period')::int as live_period,
      (gl.state->>'clockSeconds')::float as live_clock_seconds,
      (gl.state->>'clockRunning')::boolean as live_clock_running,
      (gl.state->>'clockStartedAt')::float as live_clock_started_at
    FROM games g
    LEFT JOIN teams ht ON g.home_team = ht.slug
    LEFT JOIN teams awt ON g.away_team = awt.slug
    LEFT JOIN game_live gl ON gl.game_id = g.id
    WHERE g.season_id = ${season.id}
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

  const games: BashGame[] = rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    date: r.date as string,
    time: r.time as string,
    homeTeam: r.home_team_name as string,
    homeSlug: r.home_team as string,
    awayTeam: r.away_team_name as string,
    awaySlug: r.away_team as string,
    homeScore: r.home_score as number | null,
    awayScore: r.away_score as number | null,
    status: r.status as "final" | "upcoming" | "live",
    isOvertime: r.is_overtime as boolean,
    isPlayoff: r.is_playoff as boolean,
    isForfeit: r.is_forfeit as boolean,
    location: r.location as string,
    hasBoxscore: r.has_boxscore as boolean,
    hasLiveStats: r.has_live_stats as boolean,
    livePeriod: r.live_period as number | null,
    liveClockSeconds: r.live_clock_seconds as number | null,
    liveClockRunning: r.live_clock_running as boolean | null,
    liveClockStartedAt: r.live_clock_started_at as number | null,
    gameType: (r.game_type as string) || "regular",
    hasShootout: false,
    homePlaceholder: null,
    awayPlaceholder: null,
    seriesId: null,
    seriesGameNumber: null,
    bracketRound: null,
  }))

  return (
    <div className="flex flex-1 flex-col bg-background">
      <SiteHeader />
      <div className="mx-auto w-full max-w-6xl px-4 py-5 md:py-8">
        <h1 className="text-lg font-semibold mb-1">Scorekeeper</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {season.name} · Select a game to scorekeep.
        </p>
        <ScorekeeperGameList games={games} />
      </div>
    </div>
  )
}
