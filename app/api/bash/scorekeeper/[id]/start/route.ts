import { NextResponse } from "next/server"
import { db, schema, rawSql } from "@/lib/db"
import { eq, sql } from "drizzle-orm"
import { createInitialState } from "@/lib/scorekeeper-types"

function validatePin(request: Request): boolean {
  const pin = request.headers.get("x-pin")
  return !!pin && pin === process.env.SCOREKEEPER_PIN
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validatePin(request)) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 })
  }

  const { id } = await params

  try {
    // Verify game exists and is upcoming
    const gameRows = await db
      .select({ id: schema.games.id, status: schema.games.status })
      .from(schema.games)
      .where(eq(schema.games.id, id))
    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }
    // Check if game_live row already exists (scorekeeper re-auth or editing finalized game)
    const existingLive = await db
      .select({ state: schema.gameLive.state })
      .from(schema.gameLive)
      .where(eq(schema.gameLive.gameId, id))
    if (existingLive.length > 0) {
      return NextResponse.json({ ok: true, state: existingLive[0].state })
    }

    const initialState = createInitialState()

    // Default goalies: player with most goalie games in this season for each team
    const game = gameRows[0] as { id: string; status: string }
    const gameInfo = await rawSql(sql`
      SELECT home_team, away_team, season_id FROM games WHERE id = ${id}
    `)
    if (gameInfo.length > 0) {
      const { home_team, away_team, season_id } = gameInfo[0]
      for (const [teamSlug, key] of [[home_team, "homeGoalieId"], [away_team, "awayGoalieId"]] as const) {
        const rows = await rawSql(sql`
          SELECT ggs.player_id, COUNT(*) as game_count
          FROM goalie_game_stats ggs
          JOIN player_seasons ps ON ggs.player_id = ps.player_id
            AND ps.season_id = ${season_id} AND ps.team_slug = ${teamSlug}
          JOIN games g ON ggs.game_id = g.id AND g.is_playoff = false
          GROUP BY ggs.player_id
          ORDER BY game_count DESC
          LIMIT 1
        `)
        if (rows.length > 0) {
          ;(initialState as unknown as Record<string, unknown>)[key] = rows[0].player_id
        }
      }
    }

    const pinHash = process.env.SCOREKEEPER_PIN!

    // Create game_live row (don't set game status to live yet — that happens when period 1 starts)
    await db.insert(schema.gameLive).values({
      gameId: id,
      state: initialState,
      pinHash,
    })

    return NextResponse.json({ ok: true, state: initialState })
  } catch (error) {
    console.error("Failed to start live game:", error)
    return NextResponse.json({ error: "Failed to start game" }, { status: 500 })
  }
}
