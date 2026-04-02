import { NextRequest, NextResponse } from "next/server"

// BASH MCP Server — Streamable HTTP transport
// Tools for querying BASH hockey league data across all seasons

const BASE_URL = "https://www.bash.fan/api/bash"

const TOOLS = [
  {
    name: "get_seasons",
    description:
      "List all available BASH (Bay Area Street Hockey) seasons. Returns season IDs, names, and whether they have game data. Use this to discover which seasons exist before querying other tools. Seasons go back to 1991-1992. Fall seasons are the main league; summer seasons are a separate shorter league.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_standings",
    description:
      "Get league standings and game results for a specific season. Returns team records (W/L/OTW/OTL/PTS/GF/GA) and all game scores. If no season is provided, returns the current season.",
    inputSchema: {
      type: "object" as const,
      properties: {
        season: {
          type: "string",
          description:
            'Season ID, e.g. "2025-2026", "2024-summer", "1999-2000". Use get_seasons to find valid IDs.',
        },
      },
    },
  },
  {
    name: "get_team",
    description:
      "Get detailed team info including full roster with player stats (G/A/PTS/PPG/SHG/GWG/PIM), goalie stats (W/L/SV%/GAA/SO), and schedule/results for a specific season.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team: {
          type: "string",
          description:
            'Team slug, e.g. "yetis", "seals", "rink-rats", "landsharks", "loons", "reign", "no-regretzkys". Use get_standings to find team slugs.',
        },
        season: {
          type: "string",
          description:
            'Season ID. If omitted, returns current season.',
        },
      },
      required: ["team"],
    },
  },
  {
    name: "get_game",
    description:
      "Get a detailed boxscore for a specific game including player stats, goalie stats, and officials.",
    inputSchema: {
      type: "object" as const,
      properties: {
        game_id: {
          type: "string",
          description:
            "Game ID. Get game IDs from get_standings or get_team results.",
        },
      },
      required: ["game_id"],
    },
  },
  {
    name: "get_player",
    description:
      "Get a player's career stats across all seasons, including per-season breakdowns by team.",
    inputSchema: {
      type: "object" as const,
      properties: {
        player: {
          type: "string",
          description:
            'Player slug (lowercase, hyphenated name), e.g. "john-smith". Get player slugs from team rosters.',
        },
      },
      required: ["player"],
    },
  },
]

async function fetchJSON(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

async function handleToolCall(name: string, args: Record<string, string>) {
  switch (name) {
    case "get_seasons": {
      const data = await fetchJSON(`${BASE_URL}/seasons`)
      return JSON.stringify(data)
    }
    case "get_standings": {
      const season = args.season ? `?season=${args.season}` : ""
      const data = await fetchJSON(`${BASE_URL}${season}`)
      // Return standings + recent/upcoming games (last 5 + next 5) to keep response small
      const games = (data.games || []).map((g: Record<string, unknown>) => ({
        id: g.id,
        date: g.date,
        time: g.time,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        status: g.status,
        isOvertime: g.isOvertime,
        isPlayoff: g.isPlayoff,
      }))
      const final = games.filter((g: Record<string, unknown>) => g.status === "final")
      const upcoming = games.filter((g: Record<string, unknown>) => g.status !== "final")
      return JSON.stringify({
        standings: data.standings,
        recentGames: final.slice(-10),
        upcomingGames: upcoming.slice(0, 10),
        totalGames: games.length,
        totalFinal: final.length,
        note: "Use get_team for full game history of a specific team.",
      })
    }
    case "get_team": {
      const season = args.season ? `?season=${args.season}` : ""
      const data = await fetchJSON(`${BASE_URL}/team/${args.team}${season}`)
      return JSON.stringify(data)
    }
    case "get_game": {
      const data = await fetchJSON(`${BASE_URL}/game/${args.game_id}`)
      return JSON.stringify(data)
    }
    case "get_player": {
      const data = await fetchJSON(`${BASE_URL}/player/${args.player}`)
      return JSON.stringify(data)
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

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
        try {
          const result = await handleToolCall(name, args || {})
          return NextResponse.json(
            jsonrpcResponse(id, {
              content: [{ type: "text", text: result }],
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
        // Notifications don't need a response
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

// GET for SSE transport discovery (optional)
export async function GET() {
  return NextResponse.json({
    name: "bash-hockey",
    version: "1.0.0",
    description:
      "Bay Area Street Hockey (BASH) league data — standings, stats, boxscores, and player history across 30+ years of seasons since 1991.",
  })
}
