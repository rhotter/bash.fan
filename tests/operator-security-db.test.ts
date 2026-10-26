import { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"
import { beforeAll, afterAll, describe, it, expect } from "vitest"

const db = new PGlite()
beforeAll(async () => {
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
})
