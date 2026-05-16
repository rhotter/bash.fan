import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"

let sequenceEnsured = false

async function ensureSequence() {
  if (sequenceEnsured) return
  await rawSql(sql`CREATE SEQUENCE IF NOT EXISTS games_gen_seq START 1`)
  sequenceEnsured = true
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
