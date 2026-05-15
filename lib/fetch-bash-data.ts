import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getCurrentSeason } from "@/lib/seasons"
import type { BashGame, Standing, BashApiData } from "@/app/api/bash/route"

export type { BashGame, Standing, BashApiData }

function computeStandings(games: BashGame[]): Standing[] {
  const teamMap = new Map<string, Standing>()

  const regularGames = games.filter((g) => g.gameType === "regular" && !g.isPlayoff)

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

  // TODO: Remove seed-* filtering once legacy seed teams are cleaned from production
  teamMap.delete("tbd")
  const seedKeys = [...teamMap.keys()].filter(k => k.startsWith("seed-"))
  seedKeys.forEach(k => teamMap.delete(k))

  return [...teamMap.values()].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
}

export async function fetchBashData(seasonParam?: string | null): Promise<BashApiData> {
  const currentSeason = await getCurrentSeason()
  const seasonId = seasonParam && seasonParam !== "all" ? seasonParam : currentSeason.id

  const rows = await rawSql(sql`
    SELECT
      g.id, g.date, g.time, g.home_score, g.away_score,
      g.status, g.is_overtime, g.is_playoff, g.is_forfeit, g.location, g.has_boxscore,
      g.game_type, g.has_shootout, g.home_placeholder, g.away_placeholder,
      g.series_id, g.series_game_number, g.bracket_round,
      COALESCE(ht.name, g.home_team) as home_team, ht.slug as home_slug,
      COALESCE(awt.name, g.away_team) as away_team, awt.slug as away_slug,
      (gl.game_id IS NOT NULL) as has_live_stats
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

  const games: BashGame[] = rows.map((r) => ({
    id: r.id,
    date: r.date,
    time: r.time,
    homeTeam: r.home_team,
    homeSlug: r.home_slug,
    awayTeam: r.away_team,
    awaySlug: r.away_slug,
    homeScore: r.status === "final" ? r.home_score : null,
    awayScore: r.status === "final" ? r.away_score : null,
    status: r.status as "final" | "upcoming",
    isOvertime: r.is_overtime,
    isPlayoff: r.is_playoff,
    isForfeit: r.is_forfeit,
    location: r.location,
    hasBoxscore: r.has_boxscore,
    hasLiveStats: r.has_live_stats,
    livePeriod: null,
    liveClockSeconds: null,
    liveClockRunning: null,
    liveClockStartedAt: null,
    gameType: r.game_type ?? "regular",
    hasShootout: r.has_shootout ?? false,
    homePlaceholder: r.home_placeholder ?? null,
    awayPlaceholder: r.away_placeholder ?? null,
    seriesId: r.series_id ?? null,
    seriesGameNumber: r.series_game_number ?? null,
    bracketRound: r.bracket_round ?? null,
  }))

  const standings = computeStandings(games)

  return { games, standings, lastUpdated: new Date().toISOString() }
}
