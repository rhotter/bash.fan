import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getCurrentSeason } from "@/lib/seasons"
import { SiteHeader } from "@/components/site-header"
import { ScorekeeperGameList } from "./scorekeeper-game-list"
import type { BashGame } from "@/lib/hockey-data"

export const dynamic = "force-dynamic"

export default async function ScorekeeperIndexPage() {
  const season = getCurrentSeason()

  const rows = await rawSql(sql`
    SELECT g.id, g.date, g.time, g.status,
      g.home_score, g.away_score,
      g.home_team, g.away_team,
      g.is_overtime, g.is_playoff, g.is_forfeit,
      g.location, g.has_boxscore,
      ht.name as home_team_name,
      awt.name as away_team_name,
      gl.game_id IS NOT NULL as has_live_stats,
      (gl.state->>'period')::int as live_period,
      (gl.state->>'clockSeconds')::float as live_clock_seconds,
      (gl.state->>'clockRunning')::boolean as live_clock_running,
      (gl.state->>'clockStartedAt')::float as live_clock_started_at
    FROM games g
    JOIN teams ht ON g.home_team = ht.slug
    JOIN teams awt ON g.away_team = awt.slug
    LEFT JOIN game_live gl ON gl.game_id = g.id
    WHERE g.season_id = ${season.id}
    ORDER BY g.date ASC, CASE WHEN g.time = 'TBD' THEN '23:59'::time ELSE to_timestamp(CASE WHEN g.time LIKE '%a' THEN replace(g.time, 'a', ' AM') ELSE replace(g.time, 'p', ' PM') END, 'HH:MI AM')::time END ASC
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
  }))

  return (
    <div className="flex flex-1 flex-col bg-background">
      <SiteHeader />
      <div className="mx-auto w-full max-w-6xl px-4 py-5 md:py-8">
        <h1 className="text-lg font-semibold mb-2">Scorekeeper</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Select a game to scorekeep.
        </p>
        <ScorekeeperGameList games={games} />
      </div>
    </div>
  )
}
