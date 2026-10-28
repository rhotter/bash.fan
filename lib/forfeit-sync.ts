import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"

export type ForfeitingSide = "away" | "home" | "both"

export type ForfeitOutcome =
  | { kind: "not_forfeit" }
  | { kind: "double_forfeit" }
  | { kind: "single_forfeit"; winnerTeamSlug: string; loserTeamSlug: string }

export function resolveForfeitOutcome(input: {
  isForfeit: boolean
  status: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
}): ForfeitOutcome {
  if (!input.isForfeit || input.status !== "final") {
    return { kind: "not_forfeit" }
  }
  const homeScore = input.homeScore ?? 0
  const awayScore = input.awayScore ?? 0

  if (homeScore > awayScore) {
    return {
      kind: "single_forfeit",
      winnerTeamSlug: input.homeTeam,
      loserTeamSlug: input.awayTeam,
    }
  }
  if (awayScore > homeScore) {
    return {
      kind: "single_forfeit",
      winnerTeamSlug: input.awayTeam,
      loserTeamSlug: input.homeTeam,
    }
  }
  return { kind: "double_forfeit" }
}

export function applyForfeitPreset(forfeitingSide: ForfeitingSide): {
  isForfeit: true
  status: "final"
  homeScore: number
  awayScore: number
  isOvertime: false
  hasShootout: false
} {
  if (forfeitingSide === "away") {
    return {
      isForfeit: true,
      status: "final",
      homeScore: 5,
      awayScore: 0,
      isOvertime: false,
      hasShootout: false,
    }
  }
  if (forfeitingSide === "home") {
    return {
      isForfeit: true,
      status: "final",
      homeScore: 0,
      awayScore: 5,
      isOvertime: false,
      hasShootout: false,
    }
  }
  return {
    isForfeit: true,
    status: "final",
    homeScore: 0,
    awayScore: 0,
    isOvertime: false,
    hasShootout: false,
  }
}

export function inferForfeitingSide(input: {
  homeScore: number | null
  awayScore: number | null
  status?: string | null
}): ForfeitingSide {
  const { homeScore, awayScore, status } = input
  if (homeScore != null && awayScore != null) {
    if (homeScore > awayScore) return "away"
    if (awayScore > homeScore) return "home"
    if (status === "final" && homeScore === awayScore) return "both"
  }
  return "away"
}

/**
 * Ensures 0-stat attendance rows in `player_game_stats` and `goalie_game_stats`
 * match the forfeit state of a game:
 * - Single-team forfeit: stamps 0-stat rows for all active rostered players
 *   (`player_seasons`) on the winning team with `team_slug = winnerTeamSlug`.
 *   If the game was unplayed (`!has_boxscore`), removes any stale rows from
 *   the non-winning team.
 * - Double forfeit or non-forfeit: if the game was unplayed (`!has_boxscore`),
 *   removes any auto-stamped rows for that game.
 */
export async function syncForfeitRosterStats(gameId: string): Promise<void> {
  const rows = await rawSql(sql`
    SELECT id, season_id, date, home_team, away_team, home_score, away_score, status, is_forfeit, has_boxscore, game_type
    FROM games WHERE id = ${gameId}
  `)
  if (rows.length === 0) return

  const g = rows[0]
  if (g.game_type === "exhibition" || g.game_type === "tryout") {
    return
  }

  const outcome = resolveForfeitOutcome({
    isForfeit: Boolean(g.is_forfeit),
    status: String(g.status ?? ""),
    homeTeam: String(g.home_team ?? ""),
    awayTeam: String(g.away_team ?? ""),
    homeScore: g.home_score != null ? Number(g.home_score) : null,
    awayScore: g.away_score != null ? Number(g.away_score) : null,
  })

  if (outcome.kind !== "single_forfeit") {
    if (!g.has_boxscore) {
      await rawSql(sql`DELETE FROM player_game_stats WHERE game_id = ${gameId}`)
      await rawSql(sql`DELETE FROM goalie_game_stats WHERE game_id = ${gameId}`)
    } else {
      await rawSql(sql`DELETE FROM player_game_stats WHERE game_id = ${gameId} AND hat_tricks = -1`)
      await rawSql(sql`
        DELETE FROM goalie_game_stats
        WHERE game_id = ${gameId}
          AND seconds = 0 AND goals_against = 0 AND shots_against = 0
          AND saves = 0 AND shutouts = 0 AND goalie_assists = 0 AND result IS NULL
      `)
    }
    return
  }

  const { winnerTeamSlug } = outcome
  const seasonId = String(g.season_id)
  const gameDate = String(g.date ?? "")
  const playerTeamAtGameDateSql = sql`COALESCE(
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

  if (!g.has_boxscore) {
    await rawSql(sql`
      DELETE FROM player_game_stats
      WHERE game_id = ${gameId}
        AND (
          team_slug IS DISTINCT FROM ${winnerTeamSlug}
          OR is_sub = true
          OR NOT EXISTS (
            SELECT 1 FROM player_seasons ps
            WHERE ps.season_id = ${seasonId}
              AND ps.player_id = player_game_stats.player_id
              AND NOT ps.is_goalie
              AND ${playerTeamAtGameDateSql} = ${winnerTeamSlug}
          )
        )
    `)
    await rawSql(sql`
      DELETE FROM goalie_game_stats
      WHERE game_id = ${gameId}
        AND (
          team_slug IS DISTINCT FROM ${winnerTeamSlug}
          OR is_sub = true
          OR NOT EXISTS (
            SELECT 1 FROM player_seasons ps
            WHERE ps.season_id = ${seasonId}
              AND ps.player_id = goalie_game_stats.player_id
              AND ps.is_goalie
              AND ${playerTeamAtGameDateSql} = ${winnerTeamSlug}
          )
        )
    `)
  } else {
    await rawSql(sql`
      DELETE FROM player_game_stats
      WHERE game_id = ${gameId}
        AND hat_tricks = -1
        AND (
          team_slug IS DISTINCT FROM ${winnerTeamSlug}
          OR NOT EXISTS (
            SELECT 1 FROM player_seasons ps
            WHERE ps.season_id = ${seasonId}
              AND ps.player_id = player_game_stats.player_id
              AND NOT ps.is_goalie
              AND ${playerTeamAtGameDateSql} = ${winnerTeamSlug}
          )
        )
    `)
    await rawSql(sql`
      DELETE FROM goalie_game_stats
      WHERE game_id = ${gameId}
        AND seconds = 0 AND goals_against = 0 AND shots_against = 0
        AND saves = 0 AND shutouts = 0 AND goalie_assists = 0 AND result IS NULL
        AND (
          team_slug IS DISTINCT FROM ${winnerTeamSlug}
          OR NOT EXISTS (
            SELECT 1 FROM player_seasons ps
            WHERE ps.season_id = ${seasonId}
              AND ps.player_id = goalie_game_stats.player_id
              AND ps.is_goalie
              AND ${playerTeamAtGameDateSql} = ${winnerTeamSlug}
          )
        )
    `)
  }

  const hatTrickSentinel = g.has_boxscore ? -1 : 0

  await rawSql(sql`
    INSERT INTO player_game_stats (
      player_id, game_id, team_slug, goals, assists, points,
      gwg, ppg, shg, eng, hat_tricks, pen, pim, is_sub
    )
    SELECT
      ps.player_id, ${gameId}, ${winnerTeamSlug}, 0, 0, 0,
      0, 0, 0, 0, ${hatTrickSentinel}, 0, 0, false
    FROM player_seasons ps
    WHERE ps.season_id = ${seasonId}
      AND ${playerTeamAtGameDateSql} = ${winnerTeamSlug}
      AND NOT ps.is_goalie
    ON CONFLICT (player_id, game_id) DO UPDATE
    SET team_slug = COALESCE(player_game_stats.team_slug, EXCLUDED.team_slug)
  `)

  await rawSql(sql`
    INSERT INTO goalie_game_stats (
      player_id, game_id, team_slug, seconds, goals_against, shots_against,
      saves, shutouts, goalie_assists, result, is_sub
    )
    SELECT
      ps.player_id, ${gameId}, ${winnerTeamSlug}, 0, 0, 0,
      0, 0, 0, NULL, false
    FROM player_seasons ps
    WHERE ps.season_id = ${seasonId}
      AND ${playerTeamAtGameDateSql} = ${winnerTeamSlug}
      AND ps.is_goalie
    ON CONFLICT (player_id, game_id) DO UPDATE
    SET team_slug = COALESCE(goalie_game_stats.team_slug, EXCLUDED.team_slug)
  `)
}
