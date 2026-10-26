import { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"
import { beforeAll, afterAll, describe, it, expect } from "vitest"
import { createInitialState } from "@/lib/scorekeeper-types"

const db = new PGlite()
beforeAll(async () => {
  await db.exec(`CREATE TABLE games(id text PRIMARY KEY, home_score integer, away_score integer, status text DEFAULT 'upcoming',
    is_overtime boolean DEFAULT false, is_forfeit boolean DEFAULT false, has_shootout boolean DEFAULT false, has_boxscore boolean DEFAULT false, notes text);
    CREATE TABLE game_live(game_id text PRIMARY KEY REFERENCES games(id), state jsonb, pin_hash text, updated_at timestamptz DEFAULT now());
    CREATE TABLE player_game_stats(game_id text REFERENCES games(id), player_id integer, goals integer, PRIMARY KEY(game_id, player_id));
    CREATE TABLE goalie_game_stats(game_id text REFERENCES games(id), player_id integer, saves integer, PRIMARY KEY(game_id, player_id));
    CREATE TABLE game_officials(id serial PRIMARY KEY, game_id text REFERENCES games(id), name text, role text);
    CREATE TABLE adhoc_game_rosters(game_id text REFERENCES games(id), player_id integer, team_side text, PRIMARY KEY(game_id, player_id));`)
  await db.exec(readFileSync("scripts/operator-security-schema.sql", "utf8"))
}, 30000)
afterAll(() => db.close())
const rows = async (q: string, p: unknown[] = []) => (await db.query<Record<string, any>>(q, p)).rows

describe("durable operator security", () => {
  it("allows 10 failures, blocks correct guesses during cooldown, shares global limits and expires", async () => {
    for (let i = 0; i < 10; i++) expect((await rows("SELECT * FROM check_operator_attempt('a', true)"))[0].allowed).toBe(true)
    expect((await rows("SELECT * FROM check_operator_attempt('a', false)"))[0].allowed).toBe(false)
    expect((await rows("SELECT * FROM check_operator_attempt('b', false)"))[0].allowed).toBe(true)
    await db.exec("UPDATE operator_auth_attempts SET expires_at = now() - interval '1 second'")
    expect((await rows("SELECT * FROM check_operator_attempt('a', false)"))[0].allowed).toBe(true)
    await db.exec("UPDATE operator_auth_attempts SET failures=500 WHERE bucket='global'")
    expect((await rows("SELECT * FROM check_operator_attempt('new-ip', true)"))[0].allowed).toBe(false)
  })
  it("records consistent before/after images and restores score, events, boxscore and officials atomically", async () => {
    await db.exec("INSERT INTO games(id, home_score, away_score, status) VALUES ('g1', 1, 0, 'final')")
    await db.query("INSERT INTO game_live(game_id, state, pin_hash) VALUES('g1', $1, '')", [JSON.stringify({ ...createInitialState(), revision: 3 })])
    await db.exec("INSERT INTO player_game_stats VALUES('g1', 7, 1); INSERT INTO goalie_game_stats VALUES('g1', 8, 12); INSERT INTO game_officials(game_id,name,role) VALUES('g1','Ref','ref')")
    const [before] = await rows("SELECT id FROM game_score_history WHERE game_id='g1' ORDER BY id DESC LIMIT 1")
    await db.exec(`BEGIN; UPDATE games SET home_score=9 WHERE id='g1'; UPDATE player_game_stats SET goals=9 WHERE game_id='g1'; UPDATE goalie_game_stats SET saves=2 WHERE game_id='g1'; DELETE FROM game_officials WHERE game_id='g1'; UPDATE game_live SET state=state || '{"revision":4}'::jsonb WHERE game_id='g1'; COMMIT;`)
    const [after] = await rows("SELECT * FROM game_score_history WHERE game_id='g1' ORDER BY id DESC LIMIT 1")
    expect(after.snapshot.game.home_score).toBe(9)
    expect(after.snapshot.skaters[0].goals).toBe(9)
    expect(after.snapshot.officials).toEqual([])
    const [prior] = await rows("SELECT snapshot FROM game_score_history WHERE transaction_id=$1 AND phase='before'", [after.transaction_id])
    expect(prior.snapshot.game.home_score).toBe(1)
    expect(prior.snapshot.skaters[0].goals).toBe(1)
    await rows("SELECT restore_game_score('g1',$1,$2,$3)", [before.id, after.id, JSON.stringify(createInitialState())])
    const [restored] = await rows("SELECT * FROM game_score_history WHERE game_id='g1' ORDER BY id DESC LIMIT 1")
    expect(restored.restored_from).toBe(before.id)
    expect(restored.snapshot.game.home_score).toBe(1)
    expect(restored.snapshot.skaters[0].goals).toBe(1)
    expect(restored.snapshot.goalies[0].saves).toBe(12)
    expect(restored.snapshot.officials[0].name).toBe('Ref')
    expect(restored.snapshot.live.revision).toBe(5)
    await expect(rows("SELECT restore_game_score('g1',$1,$2,$3)", [before.id, after.id, '{}'])).rejects.toThrow('Game changed')
  })
  it("rejects incomplete finalization snapshots and active finalization", async () => {
    await db.exec(`UPDATE game_live SET state=state || '{"finalizationPending":{"phase":"running"}}'::jsonb WHERE game_id='g1'`)
    const [latest] = await rows("SELECT id FROM game_score_history WHERE game_id='g1' ORDER BY id DESC LIMIT 1")
    await expect(rows("SELECT restore_game_score('g1',$1,$1,$2)", [latest.id, '{}'])).rejects.toThrow('Finalization is running')
    await db.exec(`UPDATE game_live SET state=state - 'finalizationPending' WHERE game_id='g1'`)
    const [current] = await rows("SELECT id FROM game_score_history WHERE game_id='g1' ORDER BY id DESC LIMIT 1")
    await expect(rows("SELECT restore_game_score('g1',$1,$2,$3)", [latest.id, current.id, '{}'])).rejects.toThrow('incomplete finalization')
  })
  it("reruns migration without losing history", async () => {
    const [before] = await rows("SELECT count(*) AS n FROM game_score_history")
    await db.exec(readFileSync("scripts/operator-security-schema.sql", "utf8"))
    expect((await rows("SELECT count(*) AS n FROM game_score_history"))[0].n).toBe(before.n)
  })
})
