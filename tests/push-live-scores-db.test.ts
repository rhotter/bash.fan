import { PGlite } from "@electric-sql/pglite"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { expect, it, vi } from "vitest"
const storage = vi.hoisted(() => ({ db: null as PGlite | null, send: vi.fn() }))
vi.mock("@/lib/db", () => ({ rawSql: async (value: SQL) => {
 const query = new PgDialect().sqlToQuery(value)
 return (await storage.db!.query(query.sql, query.params)).rows
} }))
vi.mock("@/lib/push/apns", () => ({ pushConfigured: () => true, sendLiveScore: storage.send }))
import { PUT, DELETE } from "@/app/api/bash/notifications/activities/route"
import { dispatchLiveScores } from "@/lib/push/live-scores"

it("authenticates activity tokens, delivers committed scores, deduplicates, and retires final activities", async () => {
 const db = new PGlite(); storage.db = db
 try {
  await db.exec(`
   CREATE TABLE games(id text PRIMARY KEY, home_team text, away_team text, status text, date date, is_forfeit boolean, is_playoff boolean, home_score int, away_score int);
   CREATE TABLE game_live(game_id text PRIMARY KEY REFERENCES games(id), state jsonb);
   CREATE TABLE players(id int PRIMARY KEY,name text);
   INSERT INTO games VALUES ('g1','seals','yetis','live',current_date,false,false,1,0);
   INSERT INTO players VALUES (1,'Scorer'),(2,'Assistant');
  `)
  await db.exec(readFileSync("lib/push/schema.sql", "utf8"))
  await db.query("INSERT INTO game_live VALUES ('g1',$1::jsonb)", [JSON.stringify({ period: 1, clockSeconds: 100, clockRunning: false, goals: [{ id: "goal", period: 1, clock: "18:35", team: "seals", scorerId: 1, assist1Id: 2 }] })])
  const body = { id: "00000000-0000-4000-8000-000000000001", activityID: "test-activity", gameID: "g1", token: "a".repeat(64), environment: "sandbox" }
  const req = (secret = "b".repeat(64)) => new Request("http://localhost/", { method: "PUT", headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(body) })
  expect((await PUT(req())).status).toBe(200)
  expect((await PUT(req("c".repeat(64)))).status).toBe(409)
  storage.send.mockResolvedValue({ status: 200 })
  expect(await dispatchLiveScores()).toEqual({ sent: 1 })
  expect(storage.send).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.objectContaining({ scorer: "Scorer · P1 18:35", assists: "Assists: Assistant" }) }))
  expect(await dispatchLiveScores()).toEqual({ sent: 0 })
  await DELETE(req("c".repeat(64)))
  expect((await db.query("SELECT count(*)::int n FROM push_activities")).rows).toEqual([{ n: 1 }])
  await db.exec("UPDATE games SET status='final'; UPDATE push_activities SET next_attempt_at=now()-interval '10 seconds'")
  expect(await dispatchLiveScores()).toEqual({ sent: 1 })
  expect(storage.send).toHaveBeenLastCalledWith(expect.objectContaining({ final: true }))
  expect((await db.query("SELECT count(*)::int n FROM push_activities WHERE expires_at>now()")).rows).toEqual([{ n: 0 }])
  await DELETE(req())
  expect((await db.query("SELECT count(*)::int n FROM push_activities")).rows).toEqual([{ n: 0 }])
 } finally { await db.close(); storage.db = null }
}, 20000)
