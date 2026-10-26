import { astVisitor, parse, toSql } from "pgsql-ast-parser"

// Keep in sync with scripts/secure-mcp-access.sql. No authentication, live
// scoring, registration, or arbitrary future tables belong in this SQL API.
export const PUBLIC_STATS_TABLES = new Set([
  "seasons", "teams", "season_teams", "games", "players", "player_seasons",
  "player_game_stats", "player_season_stats", "goalie_game_stats",
  "adhoc_game_rosters", "player_awards", "hall_of_fame", "game_officials",
])
const functions = new Set([
  "count", "sum", "avg", "min", "max", "round", "abs", "ceil", "ceiling", "floor",
  "coalesce", "nullif", "greatest", "least", "lower", "upper", "length", "trim",
  "concat", "concat_ws", "string_agg", "array_agg", "bool_and", "bool_or",
  "row_number", "rank", "dense_rank", "lag", "lead", "date_part", "date_trunc",
])
const types = new Set([
  "int", "int2", "int4", "int8", "integer", "smallint", "bigint", "numeric",
  "decimal", "real", "float", "float4", "float8", "double precision", "text",
  "varchar", "character varying", "boolean", "bool", "date", "timestamp",
  "timestamp with time zone", "timestamp without time zone", "timestamptz", "interval",
])

/** Parse and regenerate SQL: a keyword blacklist cannot enforce a read boundary. */
export function publicStatsQuery(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.length > 20000) {
    throw new Error("Provide a SELECT query of at most 20,000 characters.")
  }
  let statements
  try { statements = parse(input) } catch { throw new Error("Unsupported SQL. Use a SELECT query on the documented stats tables.") }
  if (statements.length !== 1) throw new Error("Only one SELECT query is allowed.")
  const visitor = astVisitor(v => ({
    select(s) {
      if (!["select", "union", "union all"].includes(s.type)) throw new Error("Only SELECT queries are allowed.")
      if (s.type === "select" && (s.for || s.skip)) throw new Error("Locking queries are not allowed.")
      v.super().select(s)
    },
    selection(s) {
      if (s.for || s.skip) throw new Error("Locking queries are not allowed.")
      v.super().selection(s)
    },
    cast(c) {
      v.dataType(c.to)
      v.super().cast(c)
    },
    statement(s) {
      if (!["select", "union", "union all"].includes(s.type)) throw new Error("Only SELECT queries are allowed.")
      v.super().statement(s)
    },
    tableRef(t) {
      if ((t.schema && t.schema !== "public") || !PUBLIC_STATS_TABLES.has(t.name)) {
        throw new Error("Only the documented public stats tables are available.")
      }
    },
    call(c) {
      if ((c.function.schema && c.function.schema !== "pg_catalog") || !functions.has(c.function.name)) {
        throw new Error("Only standard stats aggregation and formatting functions are allowed.")
      }
      v.super().call(c)
    },
    dataType(t) {
      if (t.kind === "array" || (t.schema && t.schema !== "pg_catalog") || !types.has(t.name)) {
        throw new Error("Unsupported cast type.")
      }
    },
  }))
  visitor.statement(statements[0])
  // An outer limit remains effective with nested limits, comments, and UNIONs.
  return `SELECT * FROM (${toSql.statement(statements[0])}) AS public_stats LIMIT 100`
}
