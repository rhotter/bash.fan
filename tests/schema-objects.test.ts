import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestDb, type TestDb } from "./helpers/pglite-db"

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
  await db.client.exec(`
    INSERT INTO teams (slug, name) VALUES ('seals', 'Seals'), ('yetis', 'Yetis');
    INSERT INTO seasons (id, name, season_type) VALUES ('s1', 'Season 1', 'fall');
    INSERT INTO games (id, season_id, date, time, home_team, away_team, status)
      VALUES ('g1', 's1', (now() AT TIME ZONE 'America/Los_Angeles')::date::text, '9:00 AM', 'seals', 'yetis', 'live');
    INSERT INTO game_live (game_id, pin_hash, state) VALUES ('g1', 'secret', '{"period":0,"goals":[]}');
  `)
}, 30000)
afterAll(() => db.client.close())

describe("objects defined outside schema.ts", () => {
  it("never persists a legacy game pin", async () => {
    const { rows } = await db.client.query("SELECT pin_hash FROM game_live WHERE game_id = 'g1'")

    expect(rows).toEqual([{ pin_hash: "" }])
  })

  it("queues a push for subscribed devices when a live goal is saved", async () => {
    await db.client.exec(`
      INSERT INTO push_devices (id, secret_hash, token, environment, teams)
        VALUES ('00000000-0000-4000-8000-000000000001', 'hash', 'token', 'sandbox', '{seals}');
      UPDATE game_live SET state = '{"period":1,"goals":[{"id":"goal-1"}]}' WHERE game_id = 'g1';
    `)

    const { rows } = await db.client.query(`
      SELECT e.event_key FROM push_deliveries d JOIN push_events e ON e.id = d.event_id ORDER BY e.event_key
    `)

    expect(rows).toEqual([{ event_key: "goal:goal-1" }, { event_key: "start" }])
  })

  it("throttles operator login attempts", async () => {
    for (let i = 0; i < 10; i++) await db.client.query("SELECT * FROM check_operator_attempt('ip', true)")

    const { rows } = await db.client.query("SELECT * FROM check_operator_attempt('ip', false)")

    expect(rows).toEqual([{ allowed: false }])
  })
})
