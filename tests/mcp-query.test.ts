import { describe, expect, it } from "vitest"
import { publicStatsQuery } from "@/lib/mcp-query"

describe("public stats SQL boundary", () => {
  it.each([
    "SELECT * FROM game_live",
    "SELECT pin_hash FROM public.game_live",
    "SELECT * FROM (SELECT * FROM accounts) stolen",
    "SELECT id FROM players UNION SELECT user_id FROM sessions",
    "SELECT * FROM pg_catalog.pg_authid",
    "SELECT * FROM information_schema.tables",
    "SELECT query_to_xml('SELECT * FROM game_live', true, false, '')",
    "SELECT set_config('role', 'neondb_owner', false)",
    "SELECT pg_sleep(10)",
    "SELECT public.count(*) FROM games",
    "SELECT 'game_live'::regclass",
    "SELECT * FROM games FOR UPDATE",
    "SELECT 1; SELECT * FROM game_live",
    "SELECT (WITH stolen AS (DELETE FROM games RETURNING *) SELECT count(*) FROM stolen)",
    "WITH x AS (SELECT * FROM games) SELECT * FROM x",
  ])("rejects unsafe or unsupported SQL: %s", query => {
    expect(() => publicStatsQuery(query)).toThrow()
  })

  it.each([
    "SELECT p.name, SUM(s.goals) FROM players p JOIN player_game_stats s ON s.player_id = p.id GROUP BY p.name ORDER BY SUM(s.goals) DESC",
    "SELECT count(*) FROM public.games WHERE status = 'final'",
    "SELECT * FROM games WHERE season_id IN (SELECT id FROM seasons WHERE is_current)",
    "SELECT round(avg(goals)::numeric, 2) FROM player_game_stats",
    "SELECT 'LIMIT 100' AS note FROM games LIMIT 10000 -- trailing comment",
    "SELECT id FROM players UNION SELECT player_id FROM player_awards",
  ])("allows bounded public statistics: %s", query => {
    expect(publicStatsQuery(query)).toMatch(/^SELECT \* FROM \([\s\S]+\) AS public_stats LIMIT 100$/)
  })
})
