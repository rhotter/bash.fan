import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"

let sequenceEnsured = false

export async function syncGameIdSequence(): Promise<void> {
  await rawSql(sql`
    DO $$
    DECLARE
      max_id bigint;
      cur_seq bigint;
    BEGIN
      CREATE SEQUENCE IF NOT EXISTS games_gen_seq START 1;
      SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 2) AS bigint)), 0)
        INTO max_id
        FROM games
        WHERE id ~ '^g[0-9]+$';
      SELECT last_value INTO cur_seq FROM games_gen_seq;
      IF max_id >= cur_seq THEN
        PERFORM setval('games_gen_seq', max_id, true);
      END IF;
    END $$;
  `)
  sequenceEnsured = true
}

export async function ensureSequence(force = false): Promise<void> {
  if (sequenceEnsured && !force) return
  await syncGameIdSequence()
}

export async function nextGameId(): Promise<string> {
  await ensureSequence()
  const rows = await rawSql(sql`SELECT nextval('games_gen_seq') AS n`)
  return `g${rows[0].n}`
}

export async function nextGameIds(count: number): Promise<string[]> {
  await ensureSequence()
  const rows = await rawSql(sql`
    SELECT nextval('games_gen_seq') AS n FROM generate_series(1, ${count})
  `)
  return rows.map((r) => `g${r.n}`)
}

