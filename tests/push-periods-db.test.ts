import { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"
import { expect, it } from "vitest"

it("queues each new period once, honors subscriptions, and ignores historical/final saves", async () => {
 const db = new PGlite()
 try {
  await db.exec(`
   CREATE TABLE games(id text PRIMARY KEY, home_team text, away_team text, status text, date date, is_forfeit boolean);
   CREATE TABLE game_live(game_id text PRIMARY KEY REFERENCES games(id), state jsonb);
   INSERT INTO games VALUES ('g1','seals','yetis','live',(now() AT TIME ZONE 'America/Los_Angeles')::date,false);
  `)
  const migration = readFileSync("lib/push/schema.sql", "utf8")
  await db.exec(migration)
  await db.exec(migration) // Re-running must be safe.
  await db.exec(`INSERT INTO push_devices(id,secret_hash,token,environment,teams,kinds) VALUES
   ('00000000-0000-4000-8000-000000000001','hash','token','sandbox',ARRAY['seals'],ARRAY['start']),
   ('00000000-0000-4000-8000-000000000002','hash','token','sandbox',ARRAY['seals'],ARRAY['goal']);
   INSERT INTO game_live VALUES ('g1','{"period":0}');`)
  const update = (period: number, extra = {}) => db.query("UPDATE game_live SET state=$1::jsonb WHERE game_id='g1'", [JSON.stringify({ period, goals: [], ...extra })])
  await update(1)
  await update(1, { clockRunning: true })
  await update(2)
  await update(2, { clockRunning: true })
  await update(1)
  await update(2) // Correction must not duplicate the period alert.
  await update(3)
  await update(4)
  await update(5)
  expect((await db.query("SELECT event_key FROM push_events ORDER BY event_key")).rows).toEqual(
   ["period:2", "period:3", "period:4", "period:5", "start"].map(event_key => ({ event_key })))
  expect((await db.query("SELECT count(*)::int AS count FROM push_deliveries")).rows).toEqual([{ count: 5 }])
  await db.exec("UPDATE games SET status='final'")
  await update(6)
  await db.exec("UPDATE games SET status='live',date='2020-01-01'")
  await update(7)
  expect((await db.query("SELECT count(*)::int AS count FROM push_events")).rows).toEqual([{ count: 5 }])
 } finally { await db.close() }
}, 20000)
