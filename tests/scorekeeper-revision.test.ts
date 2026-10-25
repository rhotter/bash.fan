import { describe, it, expect } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { PGlite } from "@electric-sql/pglite"
import { saveLiveStateSql } from "@/lib/scorekeeper-timing-db"
import { createInitialState, computeScore, clockToElapsed, getActivePenalties, findPenaltyToEnd, type GoalEvent } from "@/lib/scorekeeper-types"

// Regression coverage against real, isolated PostgreSQL semantics.
// Uses an isolated in-memory PostgreSQL instance and synthetic data only.
const goal: GoalEvent = { id: "goal-a", team: "home", period: 1, clock: "10:00", scorerId: 1, assist1Id: null, assist2Id: null, flags: [] }

describe("scorekeeping revision and playoff regressions", () => {
  it("counts a second-overtime goal and uses its full period length", () => {
    expect(computeScore([{ ...goal, period: 5 }], "home", "away", true)).toEqual({ home: 1, away: 0 })
    // Start of 2OT after four 20-minute periods should be 4800 seconds.
    expect(clockToElapsed(5, 1200, 1200, 1200)).toBe(4800)
  })

  it("carries an overtime penalty into 2OT and ends it on a power-play goal", () => {
    const penalties = [{ id: "minor", team: "away", period: 4, clock: "0:30", playerId: 1, infraction: "Tripping", minutes: 2 }]
    expect(getActivePenalties(penalties, 5, 1170, 1200, 1200, true)[0].remainingSeconds).toBe(60)
    expect(findPenaltyToEnd(penalties, "home", 5, 1170, 1200, 1200, true)).toEqual({ penaltyId: "minor", action: "end" })
    expect(getActivePenalties(penalties, 5, 0)).toEqual([]) // regular-season shootout
  })

  it("rejects an old tab even when its device timestamp is newer", async () => {
    const pg = new PGlite()
    try {
      await pg.exec(`
        CREATE TABLE games (id text primary key, status text, is_forfeit boolean, home_score integer, away_score integer);
        CREATE TABLE game_live (game_id text primary key, state jsonb, pin_hash text, updated_at timestamptz default now());
        CREATE TABLE game_timing_events (game_id text, entry_id text, kind text, action text, captured_at timestamptz, recorded_at timestamptz, source text, period int, clock_seconds float8, details jsonb, unique(game_id, entry_id));
        INSERT INTO games VALUES ('audit-game', 'live', false, 0, 0);
      `)
      const dialect = new PgDialect()
      const save = async (state: ReturnType<typeof createInitialState>, revision: number, mutation = crypto.randomUUID()) => {
        const q = dialect.sqlToQuery(saveLiveStateSql("audit-game", state, revision, mutation, computeScore(state.goals, "home", "away")))
        return pg.query(q.sql, q.params)
      }
      const base = { ...createInitialState(), period: 1, updatedAt: 100 }
      await save(base, 0)
      const winner = { ...base, updatedAt: 200, goals: [goal] }
      const mutation = crypto.randomUUID()
      expect((await save(winner, 1, mutation)).rows).toHaveLength(1)
      expect((await save(winner, 1, mutation)).rows).toHaveLength(1) // lost-response retry
      // Second tab was opened at t=100, then edits shots at t=300.
      const staleSave = await save({ ...base, updatedAt: 300, homeShots: [1, 0, 0, 0] }, 1)
      expect(staleSave.rows).toHaveLength(0)
      const stored = await pg.query<{ state: { goals: GoalEvent[]; homeShots: number[] } }>("SELECT state FROM game_live")
      expect(stored.rows[0].state.goals).toEqual([goal])
      expect(stored.rows[0].state.homeShots[0]).toBe(0)
      expect((await pg.query("SELECT home_score FROM games")).rows).toEqual([{ home_score: 1 }])
      expect((await pg.query("SELECT pin_hash FROM game_live")).rows).toEqual([{ pin_hash: "" }])
    } finally {
      await pg.close()
    }
  })
})
