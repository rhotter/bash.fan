import { sql, type SQL } from "drizzle-orm"
import { rawSql } from "@/lib/db"

/** One fresh read, sharing each player's source rows across the stat sections. */
export async function fetchPlayerQueryGroup(playerId: number, queries: SQL[]): Promise<Awaited<ReturnType<typeof rawSql>>[]> {
  const sections = queries.map((query, index) => sql`
    (SELECT COALESCE(json_agg(section), '[]'::json) FROM (${query}) section)
      AS ${sql.identifier(`section_${index}`)}
  `)
  const [result] = await rawSql(sql`
    WITH player_stats AS MATERIALIZED (
      SELECT * FROM player_game_stats WHERE player_id = ${playerId} AND NOT is_sub
    ), goalie_stats AS MATERIALIZED (
      SELECT * FROM goalie_game_stats WHERE player_id = ${playerId} AND NOT is_sub
    ), historical_stats AS MATERIALIZED (
      SELECT * FROM player_season_stats WHERE player_id = ${playerId}
    )
    SELECT ${sql.join(sections, sql`, `)}
  `)
  return queries.map((_, index) => result[`section_${index}`])
}
