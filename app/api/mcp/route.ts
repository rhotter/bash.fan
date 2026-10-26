import { NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { publicStatsQuery } from "@/lib/mcp-query"

// BASH MCP Server — Streamable HTTP transport
// Single tool: read-only SQL queries against the BASH hockey database

const TOOLS = [
  {
    name: "query_stats",
    description: `Run a read-only SQL query against the BASH (Bay Area Street Hockey) database. BASH is a street hockey league in San Francisco that has been running since 1991.

Database schema:
- seasons (id TEXT PK, name TEXT, league_id TEXT, is_current BOOL, season_type TEXT ['summer'|'fall'])
- teams (slug TEXT PK, name TEXT)
- season_teams (season_id TEXT, team_slug TEXT)
- games (id TEXT PK, season_id TEXT, date TEXT, time TEXT, home_team TEXT, away_team TEXT, home_score INT, away_score INT, status TEXT ['upcoming'|'final'|'live'], is_overtime BOOL, is_playoff BOOL, location TEXT, has_boxscore BOOL)
- players (id SERIAL PK, name TEXT UNIQUE)
- player_seasons (player_id INT, season_id TEXT, team_slug TEXT, is_goalie BOOL)
- player_game_stats (player_id INT, game_id TEXT, goals INT, assists INT, points INT, gwg INT, ppg INT, shg INT, eng INT, hat_tricks INT, pen INT, pim INT, is_sub BOOL)
- player_season_stats (player_id INT, season_id TEXT, team_slug TEXT, is_playoff BOOL, gp INT, goals INT, assists INT, points INT, gwg INT, ppg INT, shg INT, eng INT, hat_tricks INT, pen INT, pim INT)
- goalie_game_stats (player_id INT, game_id TEXT, seconds INT, goals_against INT, shots_against INT, saves INT, shutouts INT, goalie_assists INT, result TEXT, is_sub BOOL)
- adhoc_game_rosters (game_id TEXT, player_id INT, team_side TEXT ['home'|'away'], is_sub BOOL)
- player_awards (id SERIAL, player_name TEXT, player_id INT, season_id TEXT, award_type TEXT)
- hall_of_fame (id SERIAL, player_name TEXT, player_id INT, class_year INT, wing TEXT, years_active TEXT, achievements TEXT)
- game_officials (id SERIAL, game_id TEXT, name TEXT, role TEXT)

NOTE: Rows in player_game_stats / goalie_game_stats with is_sub = true represent
substitute appearances for a single game and are excluded from season-level stats.
Filter aggregations with 'AND NOT is_sub'.

Season IDs look like "2025-2026" (fall) or "2024-summer". The current season is marked with is_current=true.
Only SELECT queries are allowed. Results limited to 100 rows.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string",
          description: "A read-only SQL SELECT query.",
        },
      },
      required: ["sql"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
]

// JSON-RPC helpers
function jsonrpcResponse(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0", id, result }
}

function jsonrpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, method, params } = body

    switch (method) {
      case "initialize": {
        return NextResponse.json(
          jsonrpcResponse(id, {
            protocolVersion: "2025-03-26",
            capabilities: { tools: { listChanged: false } },
            serverInfo: {
              name: "bash-hockey",
              version: "1.0.0",
            },
          })
        )
      }

      case "tools/list": {
        return NextResponse.json(
          jsonrpcResponse(id, { tools: TOOLS })
        )
      }

      case "tools/call": {
        const { name, arguments: args } = params
        if (name !== "query_stats") {
          return NextResponse.json(
            jsonrpcResponse(id, {
              content: [{ type: "text", text: `Error: Unknown tool: ${name}` }],
              isError: true,
            })
          )
        }

        try {
          const limitedQuery = publicStatsQuery(args?.sql)
          const dbUrl = process.env.DATABASE_URL_READONLY
          if (!dbUrl) throw new Error("Database not configured.")
          const connection = neon(dbUrl)
          // Neon HTTP supports a non-interactive transaction here; this is not
          // the unsupported Drizzle db.transaction API.
          const [, , rows] = await connection.transaction([
            connection.query("SET LOCAL statement_timeout = '5s'"),
            connection.query("SET LOCAL search_path = pg_catalog, public"),
            connection.query(limitedQuery),
          ], { readOnly: true })
          return NextResponse.json(
            jsonrpcResponse(id, {
              content: [{ type: "text", text: JSON.stringify({ rows, rowCount: rows.length }) }],
            })
          )
        } catch (e) {
          return NextResponse.json(
            jsonrpcResponse(id, {
              content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
              isError: true,
            })
          )
        }
      }

      case "notifications/initialized":
      case "notifications/cancelled": {
        return new NextResponse(null, { status: 204 })
      }

      default: {
        return NextResponse.json(
          jsonrpcError(id, -32601, `Method not found: ${method}`)
        )
      }
    }
  } catch (e) {
    return NextResponse.json(
      jsonrpcError(null, -32700, `Parse error: ${(e as Error).message}`),
      { status: 400 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    name: "bash-hockey",
    version: "1.0.0",
    description:
      "Bay Area Street Hockey (BASH) league data — standings, stats, boxscores, and player history across 30+ years of seasons since 1991.",
  })
}
