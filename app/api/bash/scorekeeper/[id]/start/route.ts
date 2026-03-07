import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
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
    const gameRows = await sql`
      SELECT id, status FROM games WHERE id = ${id}
    `
    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }
    // Check if game_live row already exists (scorekeeper re-auth or editing finalized game)
    const existingLive = await sql`
      SELECT state FROM game_live WHERE game_id = ${id}
    `
    if (existingLive.length > 0) {
      return NextResponse.json({ ok: true, state: existingLive[0].state })
    }

    const initialState = createInitialState()
    const pinHash = process.env.SCOREKEEPER_PIN!

    // Create game_live row (don't set game status to live yet — that happens when period 1 starts)
    await sql`
      INSERT INTO game_live (game_id, state, pin_hash)
      VALUES (${id}, ${JSON.stringify(initialState)}, ${pinHash})
    `

    return NextResponse.json({ ok: true, state: initialState })
  } catch (error) {
    console.error("Failed to start live game:", error)
    return NextResponse.json({ error: "Failed to start game" }, { status: 500 })
  }
}
