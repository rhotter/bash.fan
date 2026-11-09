import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"

import {
  resolveForfeitOutcome,
  applyForfeitPreset,
  inferForfeitingSide,
  type ForfeitingSide,
  type ForfeitOutcome,
} from "@/lib/forfeit-helpers"

// Re-export the pure helpers so existing server-side callers can keep importing
// from here. Client components must import from `@/lib/forfeit-helpers` instead,
// because this module pulls in `@/lib/db`.
export { resolveForfeitOutcome, applyForfeitPreset, inferForfeitingSide }
export type { ForfeitingSide, ForfeitOutcome }

/**
 * Stamps 0-stat attendance rows (`ON CONFLICT DO NOTHING`) in `player_game_stats`
 * and `goalie_game_stats` for the winning team's active roster on single-team
 * forfeits so rostered players receive +1 GP when no boxscore was played.
 *
 * Purely additive: never deletes or updates existing stat rows. SQL read queries
 * (`forfeitEligibleGamePredicate` + `FILTER (WHERE NOT g.is_forfeit)`) ignore
 * counting stats, losing-team rows, substitutes, double forfeits, and unplayed
 * upcoming games at query time.
 */
export async function syncForfeitRosterStats(gameId: string): Promise<void> {
  const rows = await rawSql(sql`
    SELECT id, season_id, date, home_team, away_team, home_score, away_score, status, is_forfeit, game_type
    FROM games WHERE id = ${gameId}
  `)
  if (rows.length === 0) return

  const g = rows[0]
  if (g.game_type === "exhibition" || g.game_type === "tryout") return

  const outcome = resolveForfeitOutcome({
    isForfeit: Boolean(g.is_forfeit),
    status: String(g.status ?? ""),
    homeTeam: String(g.home_team ?? ""),
    awayTeam: String(g.away_team ?? ""),
    homeScore: g.home_score != null ? Number(g.home_score) : null,
    awayScore: g.away_score != null ? Number(g.away_score) : null,
  })

  if (outcome.kind !== "single_forfeit") return

  const { winnerTeamSlug } = outcome
  const seasonId = String(g.season_id)
  const gameDate = String(g.date ?? "")
  const teamAtGameDate = sql`COALESCE(
    (
      SELECT sti.from_team_slug
      FROM season_trade_items sti
      JOIN season_trades st ON st.id = sti.trade_id
      WHERE st.season_id = ${seasonId}
        AND sti.item_type = 'player'
        AND sti.player_id = ps.player_id
        AND to_char(st.traded_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') > ${gameDate}
      ORDER BY st.traded_at ASC, st.id ASC
      LIMIT 1
    ),
    ps.team_slug
  )`

  await rawSql(sql`
    WITH winners AS MATERIALIZED (
      SELECT ps.player_id, bool_or(ps.is_goalie) AS is_goalie
      FROM player_seasons ps
      WHERE ps.season_id = ${seasonId}
        AND ${teamAtGameDate} = ${winnerTeamSlug}
      GROUP BY ps.player_id
    ),
    inserted_skaters AS (
      INSERT INTO player_game_stats (
        player_id, game_id, team_slug, goals, assists, points,
        gwg, ppg, shg, eng, hat_tricks, pen, pim, is_sub
      )
      SELECT w.player_id, ${gameId}, ${winnerTeamSlug}, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false
      FROM winners w WHERE NOT w.is_goalie
      ON CONFLICT (player_id, game_id) DO NOTHING
      RETURNING 1
    ),
    inserted_goalies AS (
      INSERT INTO goalie_game_stats (
        player_id, game_id, team_slug, seconds, goals_against, shots_against,
        saves, shutouts, goalie_assists, result, is_sub
      )
      SELECT w.player_id, ${gameId}, ${winnerTeamSlug}, 0, 0, 0, 0, 0, 0, NULL, false
      FROM winners w WHERE w.is_goalie
      ON CONFLICT (player_id, game_id) DO NOTHING
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM inserted_skaters)::int AS inserted_skaters,
      (SELECT count(*) FROM inserted_goalies)::int AS inserted_goalies
  `)
}
