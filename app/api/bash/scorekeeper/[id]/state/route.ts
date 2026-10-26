import { after } from "next/server"
import { dispatchGameAlerts } from "@/lib/push/dispatch"
import { saveLiveStateSql, validateGameTiming } from "@/lib/scorekeeper-timing-db"
import { NextResponse } from "next/server"
import { db, schema, rawSql } from "@/lib/db"
import { eq, sql } from "drizzle-orm"
import type { LiveGameState } from "@/lib/scorekeeper-types"
import { getSession } from "@/lib/admin-session"
import { validateShotArray } from "@/lib/goalie-shot-validation"
import { withoutGameTiming } from "@/lib/scorekeeper-timing"
import { isDeepStrictEqual } from "node:util"
import { finalShotUpdateSql, planFinalShotCorrection, type FinalShotContext, type ShotCorrection } from "@/lib/final-game-shots"

async function validateAuth(request: Request): Promise<boolean> {
  const pin = request.headers.get("x-pin")
  if (pin && pin === process.env.SCOREKEEPER_PIN) return true
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
    const body = await request.json()
    const state: LiveGameState = { ...(body.state ?? body) }
    // Rebuild coordination is server-owned, never supplied by a client.
    delete state.finalizationPending
    delete state.revision
    delete state.lastMutationId
    const timingError = validateGameTiming(state)
    if (timingError) return NextResponse.json({ error: timingError }, { status: 422 })

    const shotError = validateShotArray(state.homeShots, "Home shots") || validateShotArray(state.awayShots, "Away shots")
    if (shotError) return NextResponse.json({ error: shotError }, { status: 422 })

    // Compute current scores from goals (excluding shootout goals in period 5)
    let homeScore = 0
    let awayScore = 0
    const gameRows = await db
      .select({ homeTeam: schema.games.homeTeam, awayTeam: schema.games.awayTeam, isPlayoff: schema.games.isPlayoff, status: schema.games.status, isForfeit: schema.games.isForfeit })
      .from(schema.games)
      .where(eq(schema.games.id, id))
    if (gameRows.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    if (gameRows[0].isForfeit) {
      return NextResponse.json({ error: "Forfeited games cannot be edited from live scoring" }, { status: 409 })
    }

    if (gameRows[0].status === "final") {
      return NextResponse.json({ error: "Use shot-only correction or validated finalization to edit a completed game." }, { status: 409 })
    }

    const homeSlug = gameRows[0].homeTeam
    const awaySlug = gameRows[0].awayTeam

    for (const goal of state.goals) {
      if (gameRows[0].isPlayoff || goal.period <= 4) {
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

    const expectedRevision = body.expectedRevision ?? Number(request.headers.get("x-state-revision") ?? NaN)
    const mutationId = body.mutationId ?? request.headers.get("x-mutation-id")
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER ||
      typeof mutationId !== "string" || !/^[0-9a-f-]{36}$/i.test(mutationId)) {
      return NextResponse.json({ error: "This scorekeeper needs to reload before saving. Your local draft is preserved." }, { status: 409 })
    }
    if (gameRows[0].isPlayoff && state.shootout) {
      return NextResponse.json({ error: "Playoff games use overtime, not a shootout" }, { status: 422 })
    }
    // The snapshot, timing journal, and public score commit together. Device
    // timestamps never determine whether an editor may replace a saved revision.
    const savedRows = await rawSql(saveLiveStateSql(id, state, expectedRevision, mutationId, { home: homeScore, away: awayScore }))
    if (!savedRows.length) return NextResponse.json({ error: "Another editor saved this game. Your draft is preserved on this device. Reload the saved game before making further edits." }, { status: 409 })
    after(() => dispatchGameAlerts().catch(error => console.error("Game alert dispatch failed", error)))
    return NextResponse.json({ ok: true, revision: Number(savedRows[0].revision), timingAckIds: state.timing?.entries.map(e => e.id) ?? [] })
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
      SELECT g.status, g.season_id AS "seasonId", se.game_length AS "gameLength", g.is_overtime AS "isOvertime", g.is_playoff AS "isPlayoff", g.is_forfeit AS "isForfeit", g.home_team AS "homeTeam", g.away_team AS "awayTeam",
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
    if (!body.expectedState || !isDeepStrictEqual(withoutGameTiming(body.expectedState), withoutGameTiming(context.state))) {
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
    if (!rows.length) return NextResponse.json({ error: "Game or goalie stats changed while saving. Reload and try again." }, { status: 409 })
    return NextResponse.json({ ok: true, requiresFinalization: false, state: rows[0].state })
  } catch (error) {
    console.error("Failed to correct final game shots:", error)
    return NextResponse.json({ error: "Could not confirm the shot correction. Reload the game before retrying." }, { status: 500 })
  }
}
