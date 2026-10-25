import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { neon, type NeonQueryFunction } from "@neondatabase/serverless"
import { PgDialect } from "drizzle-orm/pg-core"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { saveLiveStateSql } from "@/lib/scorekeeper-timing-db"
import { createInitialState, type LiveGameState } from "@/lib/scorekeeper-types"
import type { GameTimingEntry } from "@/lib/scorekeeper-timing"

// Explicit opt-in, dedicated fixtures, never the production endpoint.
describe.skipIf(process.env.RUN_TIMING_DB_TESTS !== "1")("append-only timing in Neon dev", () => {
  let db: NeonQueryFunction<false, false>
  const id = `timing-test-${randomUUID()}`
  const dialect = new PgDialect()
  const entry = (entryId: string): GameTimingEntry => ({ id: entryId, kind: "goal", action: "add", capturedAt: 1800000000123,
    recordedAt: 1800000010000, source: "device", period: 1, clockSeconds: 1190, details: { eventId: "g1" } })
  let state: LiveGameState
  const save = (s: LiveGameState, revision = 0, mutation = "00000000-0000-4000-8000-000000000001") => { const q = dialect.sqlToQuery(saveLiveStateSql(id, s, revision, mutation, { home: 0, away: 0 })); return db.query(q.sql, q.params) }
  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DEV
    if (!url) throw new Error("DATABASE_URL_DEV required")
    // Reject the known production endpoint without accepting a production
    // connection string in this mutation test's environment.
    const host = new URL(url).hostname.replace("-pooler", "")
    if (!process.env.TEST_DATABASE_HOST || host !== process.env.TEST_DATABASE_HOST || host.includes("ep-frosty-shadow")) {
      throw new Error("Must explicitly select a verified, non-production test endpoint")
    }
    db = neon(url)
    const inserted = await db.query(`INSERT INTO games (id, season_id, date, time, home_team, away_team, status)
      SELECT $1, season_id, date, time, home_team, away_team, 'upcoming' FROM games LIMIT 1 RETURNING id`, [id])
    if (!inserted.length) throw new Error("Dev fixture needs an existing season and teams")
    state = { ...createInitialState(), period: 1, updatedAt: 100, timing: { version: 1, firstPlayStartedAt: 1800000000000, entries: [entry("first")] } }
  }, 30000)
  afterAll(async () => {
    if (!db) return
    await db.query("DELETE FROM game_timing_events WHERE game_id=$1", [id])
    await db.query("DELETE FROM game_live WHERE game_id=$1", [id])
    await db.query("DELETE FROM games WHERE id=$1", [id])
  }, 30000)

  it("commits compact state and immutable entries together; retries cannot duplicate or replace events", async () => {
    expect(await save(state)).toHaveLength(1)
    expect(await save(state)).toHaveLength(1)
    const retry = { ...state, timing: { ...state.timing!, entries: [{ ...entry("first"), details: { tampered: true } }] } }
    expect(await save(retry)).toHaveLength(1)
    const stored = await db.query("SELECT state FROM game_live WHERE game_id=$1", [id])
    expect(stored[0].state.timing.entries).toEqual([])
    expect(stored[0].state.timing.firstPlayStartedAt).toBe(1800000000000)
    const events = await db.query("SELECT details, extract(epoch from captured_at)*1000 AS ms FROM game_timing_events WHERE game_id=$1", [id])
    expect(events).toHaveLength(1)
    expect(events[0].details).toEqual({ eventId: "g1" })
    expect(Number(events[0].ms)).toBe(1800000000123)
  })
  it("does not insert events for stale or final snapshots", async () => {
    const stale = { ...state, updatedAt: 99, timing: { ...state.timing!, entries: [entry("stale")] } }
    expect(await save(stale)).toHaveLength(0)
    await db.query("UPDATE games SET status='final' WHERE id=$1", [id])
    expect(await save({ ...stale, updatedAt: 101 })).toHaveLength(0)
    expect(await db.query("SELECT entry_id FROM game_timing_events WHERE game_id=$1 AND entry_id='stale'", [id])).toHaveLength(0)
    await db.query("UPDATE games SET status='upcoming' WHERE id=$1", [id])
  })
  it("rolls back the state write if event insertion fails", async () => {
    const invalid = { ...state, updatedAt: 102, notes: "must not persist", timing: { ...state.timing!, entries: [{ ...entry("bad"), details: null }] } }
    await expect(save(invalid as unknown as LiveGameState, 1, randomUUID())).rejects.toThrow()
    const [stored] = await db.query("SELECT state FROM game_live WHERE game_id=$1", [id])
    expect(stored.state.updatedAt).toBe(100)
    expect(stored.state.notes).toBe("")
  })
  it("preserves the opening timestamp when older clients omit timing or propose a replacement", async () => {
    const { timing: _timing, ...old } = state
    await save({ ...old, updatedAt: 103 }, 1, randomUUID())
    await save({ ...state, updatedAt: 104, timing: { version: 1, firstPlayStartedAt: 999, entries: [] } }, 2, randomUUID())
    const [stored] = await db.query("SELECT state FROM game_live WHERE game_id=$1", [id])
    expect(stored.state.timing.firstPlayStartedAt).toBe(1800000000000)
    expect(stored.state.timing.entries).toEqual([])
  })
  it("migrates inline history without changing original timestamps and can be rerun", async () => {
    await db.query("UPDATE game_live SET state=$2::jsonb WHERE game_id=$1", [id, JSON.stringify({ ...state, timing: { ...state.timing!, entries: [entry("legacy")] } })])
    const migration = readFileSync("scripts/scorekeeper-timing-schema.sql", "utf8").split(";").map(s => s.trim()).filter(Boolean)
    for (let run = 0; run < 2; run++) for (const statement of migration) await db.query(statement)
    expect(await db.query("SELECT entry_id FROM game_timing_events WHERE game_id=$1 AND entry_id='legacy'", [id])).toHaveLength(1)
    const [stored] = await db.query("SELECT state FROM game_live WHERE game_id=$1", [id])
    expect(stored.state.timing.entries).toEqual([])
    expect(stored.state.timing.firstPlayStartedAt).toBe(state.timing?.firstPlayStartedAt)
    expect(stored.state.timing.hasPlayStarted).toBe(true)
  }, 30000)
})
