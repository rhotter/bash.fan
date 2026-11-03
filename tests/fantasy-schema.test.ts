import { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createTestDb } from "./helpers/pglite-db"

const COLUMNS = `
  SELECT table_name, column_name, data_type, udt_name, is_nullable
  FROM information_schema.columns
  WHERE table_name LIKE 'fantasy_%'
  ORDER BY table_name, column_name`
const INDEXES = `SELECT indexdef FROM pg_indexes WHERE tablename LIKE 'fantasy_%' ORDER BY indexdef`
// Primary keys, foreign keys with their ON DELETE, uniques and checks.
const CONSTRAINTS = `
  SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
  WHERE conrelid::regclass::text LIKE 'fantasy_%' AND contype IN ('p', 'f', 'u', 'c')
  ORDER BY conrelid::regclass::text, conname`
const DEFAULTS = `
  SELECT table_name, column_name, column_default
  FROM information_schema.columns
  WHERE table_name LIKE 'fantasy_%' AND column_default NOT LIKE 'nextval%'
  ORDER BY table_name, column_name`

describe("the Fantasy deploy script", () => {
  it("builds what schema.ts declares, and can run twice", async () => {
    const declared = await createTestDb()
    const deployed = new PGlite()
    await deployed.exec(`
      CREATE TABLE seasons (id text PRIMARY KEY);
      CREATE TABLE players (id serial PRIMARY KEY);`)
    const script = readFileSync("scripts/fantasy-schema.sql", "utf8")
    await deployed.exec(script)
    await deployed.exec(script)

    expect((await deployed.query(COLUMNS)).rows).toEqual((await declared.client.query(COLUMNS)).rows)
    expect((await deployed.query(INDEXES)).rows).toEqual((await declared.client.query(INDEXES)).rows)
    expect((await deployed.query(DEFAULTS)).rows).toEqual((await declared.client.query(DEFAULTS)).rows)
    const constraints = (await declared.client.query(CONSTRAINTS)).rows
    expect(constraints.length).toBeGreaterThan(10)
    expect((await deployed.query(CONSTRAINTS)).rows).toEqual(constraints)

    await Promise.all([deployed.close(), declared.client.close()])
  })

  it("keeps Managers and Team Names apart per contest", async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE TABLE seasons (id text PRIMARY KEY);
      CREATE TABLE players (id serial PRIMARY KEY);
      INSERT INTO seasons VALUES ('s1');`)
    await db.exec(readFileSync("scripts/fantasy-schema.sql", "utf8"))
    const manager = (contest: string, team: string, hash: string) =>
      db.exec(
        `INSERT INTO fantasy_managers (season_id, contest, team_name, first_name, last_name, token_hash) VALUES ('s1', '${contest}', '${team}', 'A', 'B', '${hash}')`
      )
    await db.exec("INSERT INTO fantasy_seasons (season_id, config) VALUES ('s1', '{}')")
    await db.exec("INSERT INTO fantasy_seasons (season_id, contest, config) VALUES ('s1', 'playoffs', '{}')")

    await manager("regular", "Oracle", "h1")
    await manager("playoffs", "Oracle", "h2")
    await expect(manager("playoffs", "oracle", "h3")).rejects.toThrow()
    await expect(manager("nope", "X", "h4")).rejects.toThrow()

    await db.exec("DELETE FROM fantasy_seasons WHERE contest = 'playoffs'")
    expect((await db.query("SELECT count(*)::int AS n FROM fantasy_managers")).rows).toEqual([{ n: 1 }])
    await db.close()
  })

  it("refuses malformed rows and removes a Manager's Lineups and Predictions with them", async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE TABLE seasons (id text PRIMARY KEY);
      CREATE TABLE players (id serial PRIMARY KEY);
      INSERT INTO seasons VALUES ('s1');`)
    await db.exec(readFileSync("scripts/fantasy-schema.sql", "utf8"))
    await db.exec("INSERT INTO fantasy_seasons (season_id, config) VALUES ('s1', '{}')")
    await expect(db.exec("INSERT INTO fantasy_seasons (season_id, contest, config) VALUES ('s1', 'Bad Key', '{}')")).rejects.toThrow()
    const insertManager = (team: string) =>
      db.exec(
        `INSERT INTO fantasy_managers (season_id, team_name, first_name, last_name, token_hash) VALUES ('s1', '${team}', 'A', 'B', 'h${team.length}')`
      )
    await expect(insertManager("")).rejects.toThrow()
    await expect(insertManager("x".repeat(41))).rejects.toThrow()
    await insertManager("Oracle")
    const lineup = (week: string) =>
      db.exec(`INSERT INTO fantasy_lineups SELECT id, '${week}', '{}', '{}', '{}', '{}' FROM fantasy_managers`)
    await expect(lineup("next saturday")).rejects.toThrow()
    await lineup("2026-11-07")
    const prediction = (home: number, away: number, game = "g1") =>
      db.exec(`INSERT INTO fantasy_predictions (manager_id, game_id, home_score, away_score) SELECT id, '${game}', ${home}, ${away} FROM fantasy_managers`)
    await expect(prediction(3, 3)).rejects.toThrow()
    await expect(prediction(-1, 2)).rejects.toThrow()
    await prediction(4, 2)

    await db.exec("DELETE FROM fantasy_managers")

    expect((await db.query("SELECT (SELECT count(*) FROM fantasy_lineups)::int AS l, (SELECT count(*) FROM fantasy_predictions)::int AS p")).rows).toEqual([{ l: 0, p: 0 }])
    await db.close()
  })
})
