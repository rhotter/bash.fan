import { NextResponse } from "next/server"
import { db, schema, rawSql } from "@/lib/db"
import { eq, and, ne, sql } from "drizzle-orm"
import type { LiveGameState } from "@/lib/scorekeeper-types"
import { getSession } from "@/lib/admin-session"
import { validateShotArray } from "@/lib/goalie-shot-validation"
import { isDeepStrictEqual } from "node:util"
import { finalShotUpdateSql, planFinalShotCorrection, type FinalShotContext, type ShotCorrection } from "@/lib/final-game-shots"

async function validateAuth(request: Request): Promise<boolean> {
  const pin = request.headers.get("x-pin")
  if (pin && pin === process.env.SCOREKEEPER_PIN) return true
  // Fallback: check query params (for sendBeacon)
  const url = new URL(request.url)
  const qpin = url.searchParams.get("pin")
  if (qpin && qpin === process.env.SCOREKEEPER_PIN) return true
  
  return await getSession()
}

function forfeitResponse() {
  return NextResponse.json({
    error: "This game was forfeited. Live scoring has stopped; view the official game result.",
    code: "GAME_FORFEITED",
    finalizationCanceled: true,
  }, { status: 409 })
}

async function gameIsForfeited(id: string) {
  const [game] = await db.select({ isForfeit: schema.games.isForfeit })
    .from(schema.games).where(eq(schema.games.id, id))
  return game?.isForfeit === true
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
    const body = await request.json()
    const state: LiveGameState = { ...(body.state ?? body) }
    // Rebuild coordination is server-owned, never supplied by a client.
    delete state.finalizationPending

    const shotError = validateShotArray(state.homeShots, "Home shots") || validateShotArray(state.awayShots, "Away shots")
    if (shotError) return NextResponse.json({ error: shotError }, { status: 422 })

    // Compute current scores from goals (excluding shootout goals in period 5)
    let homeScore = 0
    let awayScore = 0
    const gameRows = await db
      .select({ homeTeam: schema.games.homeTeam, awayTeam: schema.games.awayTeam, status: schema.games.status, isForfeit: schema.games.isForfeit })
      .from(schema.games)
      .where(eq(schema.games.id, id))
    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    if (gameRows[0].isForfeit) {
      return forfeitResponse()
    }

    if (gameRows[0].status === "final") {
      return NextResponse.json({ error: "Use shot-only correction or validated finalization to edit a completed game." }, { status: 409 })
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

    // A delayed autosave must not replace the state of a now-final game.
    const savedRows = await rawSql(sql`
      INSERT INTO game_live (game_id, state, pin_hash)
      SELECT ${id}, ${JSON.stringify(state)}::jsonb, ${process.env.SCOREKEEPER_PIN || "unknown"}
      WHERE EXISTS (SELECT 1 FROM games WHERE id = ${id} AND status <> 'final' AND NOT is_forfeit)
      ON CONFLICT (game_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
      WHERE NOT (game_live.state ? 'finalizationPending')
        AND COALESCE((game_live.state->>'updatedAt')::bigint, 0) <= ${state.updatedAt}
        AND EXISTS (SELECT 1 FROM games WHERE id = ${id} AND status <> 'final' AND NOT is_forfeit)
      RETURNING game_id
    `)
    if (!savedRows.length) {
      if (await gameIsForfeited(id)) return forfeitResponse()
      return NextResponse.json({ error: "A newer state or final result has already been saved. Reload the game." }, { status: 409 })
    }

    // Set game to live once play starts (period >= 1), update scores
    if (state.period >= 1) {
      await db
        .update(schema.games)
        .set({ status: "live", homeScore, awayScore })
        .where(and(eq(schema.games.id, id), ne(schema.games.status, "final"), eq(schema.games.isForfeit, false)))
    } else {
      await db
        .update(schema.games)
        .set({ homeScore, awayScore })
        .where(and(eq(schema.games.id, id), ne(schema.games.status, "final"), eq(schema.games.isForfeit, false)))
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


// Shot-only edits are deliberately separate from replaying the event history.
// Imported/older final games can have a valid boxscore but no live events.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await validateAuth(request))) return NextResponse.json({ error: "Invalid PIN or session" }, { status: 401 })
  const { id } = await params
  try {
    const body = await request.json()
    const [context] = await rawSql(sql`
      SELECT g.status, g.season_id AS "seasonId", se.game_length AS "gameLength", g.is_overtime AS "isOvertime", g.is_forfeit AS "isForfeit", g.home_team AS "homeTeam", g.away_team AS "awayTeam",
        g.home_score AS "homeScore", g.away_score AS "awayScore", l.state,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'playerId', s.player_id, 'goalsAgainst', s.goals_against, 'shotsAgainst', s.shots_against,
          'saves', s.saves, 'seconds', s.seconds,
          'sides', COALESCE((SELECT jsonb_agg(DISTINCT r.team_side) FROM adhoc_game_rosters r
            WHERE r.game_id = g.id AND r.player_id = s.player_id),
            (SELECT jsonb_agg(DISTINCT CASE WHEN ps.team_slug = g.home_team THEN 'home' ELSE 'away' END)
              FROM player_seasons ps WHERE ps.player_id = s.player_id AND ps.season_id = g.season_id
                AND ps.team_slug IN (g.home_team, g.away_team)), '[]'::jsonb)) ORDER BY s.player_id)
          FROM goalie_game_stats s WHERE s.game_id = g.id), '[]'::jsonb) AS goalies
      FROM games g JOIN game_live l ON l.game_id = g.id LEFT JOIN seasons se ON se.id = g.season_id WHERE g.id = ${id}
    `) as FinalShotContext[]
    if (!context) return NextResponse.json({ error: "Game or saved live state not found" }, { status: 404 })
    if (context.isForfeit) return forfeitResponse()
    if (!body.expectedState || !isDeepStrictEqual(body.expectedState, context.state)) {
      return NextResponse.json({ error: "Game changed since you opened it. Reload before saving shot corrections." }, { status: 409 })
    }
    // PATCH allows only these fields. Goals, scores, attendance, goalie time,
    // sub status, officials and the original event history are never rewritten.
    const correction: ShotCorrection = {
      homeShots: body.homeShots,
      awayShots: body.awayShots,
      ...(body.goalieShotsAgainst !== undefined ? { goalieShotsAgainst: body.goalieShotsAgainst } : {}),
    }
    let updates: ReturnType<typeof planFinalShotCorrection>
    try {
      updates = planFinalShotCorrection(context, correction)
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid shot correction" }, { status: 422 })
    }
    const rows = await rawSql(finalShotUpdateSql(id, context, correction, updates, Date.now()))
    if (!rows.length) {
      if (await gameIsForfeited(id)) return forfeitResponse()
      return NextResponse.json({ error: "Game or goalie stats changed while saving. Reload and try again." }, { status: 409 })
    }
    return NextResponse.json({ ok: true, requiresFinalization: false, state: rows[0].state })
  } catch (error) {
    console.error("Failed to correct final game shots:", error)
    return NextResponse.json({ error: "Could not confirm the shot correction. Reload the game before retrying." }, { status: 500 })
  }
}
