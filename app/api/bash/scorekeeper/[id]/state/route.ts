import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and, ne, sql } from "drizzle-orm"
import type { LiveGameState } from "@/lib/scorekeeper-types"
import { getSession } from "@/lib/admin-session"

async function validateAuth(request: Request): Promise<boolean> {
  const pin = request.headers.get("x-pin")
  if (pin && pin === process.env.SCOREKEEPER_PIN) return true
  // Fallback: check query params (for sendBeacon)
  const url = new URL(request.url)
  const qpin = url.searchParams.get("pin")
  if (qpin && qpin === process.env.SCOREKEEPER_PIN) return true
  
  return await getSession()
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await validateAuth(request))) {
    return NextResponse.json({ error: "Invalid PIN or session" }, { status: 401 })
  }

  const { id } = await params

  try {
    const state: LiveGameState = await request.json()

    // Compute current scores from goals (excluding shootout goals in period 5)
    let homeScore = 0
    let awayScore = 0
    const gameRows = await db
      .select({ homeTeam: schema.games.homeTeam, awayTeam: schema.games.awayTeam })
      .from(schema.games)
      .where(eq(schema.games.id, id))
    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    const homeSlug = gameRows[0].homeTeam
    const awaySlug = gameRows[0].awayTeam

    for (const goal of state.goals) {
      if (goal.period <= 4) {
        if (goal.team === homeSlug) homeScore++
        else if (goal.team === awaySlug) awayScore++
      }
    }

    // If shootout, add 1 to the winner
    if (state.shootout) {
      const homeSOGoals = state.shootout.homeAttempts.filter((a) => a.scored).length
      const awaySOGoals = state.shootout.awayAttempts.filter((a) => a.scored).length
      if (homeSOGoals > awaySOGoals) homeScore++
      else if (awaySOGoals > homeSOGoals) awayScore++
    }

    // Update game_live state
    await db
      .update(schema.gameLive)
      .set({ state, updatedAt: sql`NOW()` })
      .where(eq(schema.gameLive.gameId, id))

    // Set game to live once play starts (period >= 1), update scores
    if (state.period >= 1) {
      await db
        .update(schema.games)
        .set({ status: "live", homeScore, awayScore })
        .where(and(eq(schema.games.id, id), ne(schema.games.status, "final")))
    } else {
      await db
        .update(schema.games)
        .set({ homeScore, awayScore })
        .where(eq(schema.games.id, id))
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Failed to update live state:", error)
    return NextResponse.json({ error: "Failed to update state" }, { status: 500 })
  }
}

// POST handler for sendBeacon (which can only send POST)
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return PUT(request, ctx)
}
