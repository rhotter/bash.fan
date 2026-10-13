import { describe, expect, it, vi } from "vitest"
import { writeFile, readFile } from "node:fs/promises"
import { fetchPlayerDetail } from "@/lib/fetch-player-detail"
import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { playerSlugSql } from "@/lib/player-slug-sql"
import { playerSlug } from "@/lib/player-slug"

// Opt-in, read-only integration benchmark. Bypass both React request memoization
// and Next's cross-request cache, including the season catalog.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock("react", () => ({ cache: (fn: unknown) => fn }))

describe.skipIf(!process.env.PLAYER_BENCHMARK)("Uncached player reads", () => {
  it("measures fresh reads and compares complete player payloads", async () => {
    const directory = await rawSql(sql`SELECT name, ${playerSlugSql(sql`name`)} AS slug FROM players`)
    for (const row of directory) expect(row.slug).toBe(playerSlug(row.name))
    const players = ["alex-muhn", "jarrod-hatfield", "joseph-guillemette"]
    const label = process.env.PLAYER_BENCHMARK!
    const samples: { slug: string; ms: number }[] = []
    const snapshots: Record<string, unknown> = {}
    for (let iteration = 0; iteration < 12; iteration++) {
      for (const slug of players) {
        const start = performance.now()
        const data = await fetchPlayerDetail(slug)
        const ms = performance.now() - start
        expect(data).not.toBeNull()
        if (iteration >= 2) samples.push({ slug, ms })
        snapshots[slug] = data
      }
    }
    if (label !== "before") {
      const baseline = JSON.parse(await readFile("/tmp/bash-player-uncached-before.json", "utf8"))
      expect(snapshots).toEqual(baseline.snapshots)
    }
    await writeFile(`/tmp/bash-player-uncached-${label}.json`, JSON.stringify({ samples, snapshots }, null, 2))
    for (const slug of players) {
      const values = samples.filter((s) => s.slug === slug).map((s) => s.ms).sort((a, b) => a - b)
      console.log(JSON.stringify({ label, slug, medianMs: (values[4] + values[5]) / 2, minMs: values[0], maxMs: values[9] }))
    }
  }, 120_000)
})
