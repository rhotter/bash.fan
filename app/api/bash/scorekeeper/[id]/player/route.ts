import { NextResponse } from "next/server"
import { db, schema, rawSql } from "@/lib/db"
import { eq, sql } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

async function validateAuth(request: Request): Promise<boolean> {
  const pin = request.headers.get("x-pin")
  if (pin && pin === process.env.SCOREKEEPER_PIN) return true
  return await getSession()
}

// POST /api/bash/scorekeeper/[id]/player — inline player creation for exhibition/tryout games
// Body: { name: string, teamSide: "home" | "away" }
//
// Flow:
// 1. Verify game is exhibition/tryout (403 otherwise)
// 2. Search for existing player by name (case-insensitive)
// 3. If found, use existing player. If not, create new player record
// 4. Insert into adhoc_game_rosters
// 5. Patch game_live.state attendance array so player appears in live scoring
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await validateAuth(request))) {
    return NextResponse.json({ error: "Invalid PIN or session" }, { status: 401 })
  }

  const { id: gameId } = await params

  try {
    const { name, teamSide } = await request.json()

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }
    if (teamSide !== "home" && teamSide !== "away") {
      return NextResponse.json({ error: 'teamSide must be "home" or "away"' }, { status: 400 })
    }

    const trimmedName = name.trim()

    // Verify game exists and is exhibition/tryout
    const gameRows = await db
      .select({ gameType: schema.games.gameType })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }
    if (gameRows[0].gameType !== "exhibition" && gameRows[0].gameType !== "tryout") {
      return NextResponse.json(
        { error: "Inline player creation only available for exhibition/tryout games" },
        { status: 403 }
      )
    }

    // Search for existing player (case-insensitive exact match)
    const existingRows = await rawSql(sql`
      SELECT id, name FROM players WHERE LOWER(name) = LOWER(${trimmedName}) LIMIT 1
    `)

    let playerId: number
    let playerName: string
    let isNew = false

    if (existingRows.length > 0) {
      // Use existing player
      playerId = existingRows[0].id
      playerName = existingRows[0].name
    } else {
      // Create new player record
      const insertResult = await db
        .insert(schema.players)
        .values({ name: trimmedName })
        .returning({ id: schema.players.id, name: schema.players.name })
      playerId = insertResult[0].id
      playerName = insertResult[0].name
      isNew = true
    }

    // Add to adhoc_game_rosters (upsert — idempotent if already on roster)
    await db
      .insert(schema.adhocGameRosters)
      .values({ gameId, playerId, teamSide })
      .onConflictDoUpdate({
        target: [schema.adhocGameRosters.gameId, schema.adhocGameRosters.playerId],
        set: { teamSide },
      })

    // Patch game_live.state attendance array so player appears in live scoring UI
    const liveRows = await db
      .select({ state: schema.gameLive.state })
      .from(schema.gameLive)
      .where(eq(schema.gameLive.gameId, gameId))

    if (liveRows.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = liveRows[0].state as any
      if (state) {
        const attendanceKey = teamSide === "home" ? "homeAttendance" : "awayAttendance"
        const attendance: number[] = state[attendanceKey] || []
        if (!attendance.includes(playerId)) {
          attendance.push(playerId)
          state[attendanceKey] = attendance
          await db
            .update(schema.gameLive)
            .set({ state })
            .where(eq(schema.gameLive.gameId, gameId))
        }
      }
    }

    return NextResponse.json({
      ok: true,
      player: { id: playerId, name: playerName },
      isNew,
    }, { status: isNew ? 201 : 200 })
  } catch (error) {
    console.error("Failed to create/add player:", error)
    // Handle unique constraint violation on players.name
    if (error instanceof Error && error.message.includes("unique")) {
      // Race condition: player was created between our check and insert
      // Re-fetch and return existing
      try {
        const { name } = await request.json()
        const rows = await rawSql(sql`
          SELECT id, name FROM players WHERE LOWER(name) = LOWER(${name.trim()}) LIMIT 1
        `)
        if (rows.length > 0) {
          return NextResponse.json({
            ok: true,
            player: { id: rows[0].id, name: rows[0].name },
            isNew: false,
          })
        }
      } catch {
        // Fall through to generic error
      }
    }
    return NextResponse.json({ error: "Failed to create player" }, { status: 500 })
  }
}
