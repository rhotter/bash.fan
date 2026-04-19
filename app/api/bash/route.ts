import { NextResponse } from "next/server"
import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getCurrentSeason } from "@/lib/seasons"

// ─── Shared output types ────────────────────────────────────────────────────

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

function computeStandings(games: BashGame[]): Standing[] {
  const teamMap = new Map<string, Standing>()

  const regularGames = games.filter((g) => !g.isPlayoff)

  for (const game of regularGames) {
    if (!teamMap.has(game.homeSlug)) {
      teamMap.set(game.homeSlug, {
        team: game.homeTeam, slug: game.homeSlug,
        gp: 0, w: 0, otw: 0, l: 0, otl: 0, gf: 0, ga: 0, gd: 0, pts: 0,
      })
    }
    if (!teamMap.has(game.awaySlug)) {
      teamMap.set(game.awaySlug, {
        team: game.awayTeam, slug: game.awaySlug,
        gp: 0, w: 0, otw: 0, l: 0, otl: 0, gf: 0, ga: 0, gd: 0, pts: 0,
      })
    }
  }

  for (const game of regularGames) {
    if (game.status !== "final") continue
    if (game.homeScore === null || game.awayScore === null) continue

    const home = teamMap.get(game.homeSlug)!
    const away = teamMap.get(game.awaySlug)!

    home.gp++; away.gp++
    home.gf += game.homeScore; home.ga += game.awayScore
    away.gf += game.awayScore; away.ga += game.homeScore

    if (game.homeScore > game.awayScore) {
      if (game.isOvertime) {
        home.otw++; home.pts += 2
        away.otl++; away.pts += 1
      } else {
        home.w++; home.pts += 3
        away.l++
      }
    } else {
      if (game.isOvertime) {
        away.otw++; away.pts += 2
        home.otl++; home.pts += 1
      } else {
        away.w++; away.pts += 3
        home.l++
      }
    }
  }

  for (const t of teamMap.values()) {
    t.gd = t.gf - t.ga
  }

  return [...teamMap.values()].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const seasonParam = searchParams.get("season")
    const seasonId = seasonParam && seasonParam !== "all" ? seasonParam : (await getCurrentSeason()).id

    const rows = await rawSql(sql`
      SELECT
        g.id, g.date, g.time, g.home_score, g.away_score,
        g.status, g.is_overtime, g.is_playoff, g.is_forfeit, g.location, g.has_boxscore,
        ht.name as home_team, ht.slug as home_slug,
        awt.name as away_team, awt.slug as away_slug,
        (gl.game_id IS NOT NULL) as has_live_stats,
        gl.state as live_state
      FROM games g
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      LEFT JOIN game_live gl ON gl.game_id = g.id
      WHERE g.season_id = ${seasonId}
        AND g.id NOT LIKE 'test-%'
      ORDER BY g.date ASC, CASE WHEN g.time = 'TBD' THEN '23:59'::time ELSE to_timestamp(CASE WHEN g.time LIKE '%a' THEN replace(g.time, 'a', ' AM') ELSE replace(g.time, 'p', ' PM') END, 'HH:MI AM')::time END ASC
    `)

    const games: BashGame[] = rows.map((r) => ({
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
    }))

    const standings = computeStandings(games)

    const result: BashApiData = { games, standings, lastUpdated: new Date().toISOString() }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    })
  } catch (error) {
    console.error("Failed to fetch BASH data:", error)
    return NextResponse.json(
      { error: "Failed to fetch data", games: [], standings: [], lastUpdated: new Date().toISOString() },
      { status: 500 },
    )
  }
}
