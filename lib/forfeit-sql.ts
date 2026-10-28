import { sql, type SQL } from "drizzle-orm"

/**
 * Predicate for `JOIN games g ON ...` that allows:
 * - Any non-forfeited game (`NOT g.is_forfeit`)
 * - Finalized single-team forfeited games where the player/goalie row belongs
 *   to the winning (non-forfeiting) team (`home_score > away_score` -> `home_team`,
 *   `away_score > home_score` -> `away_team`).
 * Double forfeits (`home_score = away_score`) and losing-team rows are excluded.
 */
export function forfeitEligibleGamePredicate(teamSlugExpr: SQL): SQL {
  return sql`(
    NOT g.is_forfeit
    OR (
      g.status = 'final'
      AND (
        (g.home_score > g.away_score AND ${teamSlugExpr} = g.home_team)
        OR (g.away_score > g.home_score AND ${teamSlugExpr} = g.away_team)
      )
    )
  )`
}

/**
 * Resolves a stat row's effective team slug for a game, falling back to
 * `player_seasons` for the game's season when `team_slug` is null on legacy rows.
 */
export function effectiveRowTeamSlugSql(statAlias: "pgs" | "ggs"): SQL {
  const tableRef = sql.raw(statAlias)
  return sql`COALESCE(${tableRef}.team_slug, (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = ${tableRef}.player_id AND ps.season_id = g.season_id LIMIT 1))`
}
