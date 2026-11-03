import { eq, sql } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin-session", () => ({ getSession: async () => true }))

import { POST as mergeManual } from "@/app/api/bash/admin/players/merge-manual/route"
import { db, schema } from "@/lib/db"
import { DEFAULT_FANTASY_CONFIG } from "@/lib/fantasy/config"
import { reassignLineupPlayer, replaceInLineup } from "@/lib/fantasy/lineups"
import { mergeDuplicatePlayers } from "@/lib/merge-duplicates"
import { setupPlayer } from "./factories/setupPlayer"
import { setupSeason } from "./factories/setupSeason"

const lineup = (overrides: object = {}) => ({
  skaters: [1, 2, 3],
  goalies: [7],
  skaterBackups: [4],
  goalieBackups: [8],
  ...overrides,
})

describe("replaceInLineup", () => {
  it("swaps the merged Player into their slot", () => {
    expect(replaceInLineup(lineup(), 4, 5)).toEqual(lineup({ skaterBackups: [5] }))
  })

  it("leaves a Lineup without the merged Player alone", () => {
    expect(replaceInLineup(lineup(), 99, 5)).toEqual(lineup())
  })

  it("drops a Backup the Lineup already holds as a Backup elsewhere", () => {
    expect(replaceInLineup(lineup(), 4, 1)).toEqual(lineup({ skaterBackups: [] }))
  })

  it("promotes the surviving Player into the starting slot the merged Player held", () => {
    expect(replaceInLineup(lineup({ skaterBackups: [5] }), 1, 5)).toEqual(
      lineup({ skaters: [5, 2, 3], skaterBackups: [] })
    )
  })

  it("keeps the surviving Player where they already started", () => {
    expect(replaceInLineup(lineup({ skaters: [1, 2, 5], skaterBackups: [4] }), 4, 5)).toEqual(
      lineup({ skaters: [1, 2, 5], skaterBackups: [] })
    )
  })
})

describe("merging Players", () => {
  let managerId: number
  let ids: { keep: number; dupe: number }

  beforeEach(async () => {
    const { season } = await setupSeason({ isCurrent: true })
    await db.insert(schema.fantasySeasons).values({ seasonId: season.id, contest: "regular", config: DEFAULT_FANTASY_CONFIG })
    const [manager] = await db
      .insert(schema.fantasyManagers)
      .values({
        seasonId: season.id,
        contest: "regular",
        teamName: "Puck Norris",
        firstName: "Ada",
        lastName: "Lovelace",
        tokenHash: "hash",
      })
      .returning()
    managerId = manager.id
    const keep = (await setupPlayer({ name: "Pat Kane" })).player.id
    const dupe = (await setupPlayer({ name: "Patrick Kane" })).player.id
    ids = { keep, dupe }
    await db.insert(schema.fantasyLineups).values({
      managerId,
      weekId: "2026-11-07",
      skaters: [dupe, 9002, 9003],
      goalies: [9007],
      skaterBackups: [keep],
      goalieBackups: [9008],
    })
  })

  const savedSkaters = async () =>
    (await db.select().from(schema.fantasyLineups).where(eq(schema.fantasyLineups.managerId, managerId)))[0]

  const request = () =>
    new Request("http://test/x", {
      method: "POST",
      body: JSON.stringify({ keepId: ids.keep, mergeId: ids.dupe }),
    })

  it("moves Lineups to the surviving Player in a manual merge", async () => {
    const response = await mergeManual(request())

    expect(response.status).toBe(200)
    const saved = await savedSkaters()
    expect(saved.skaters).toEqual([ids.keep, 9002, 9003])
    expect(saved.skaterBackups).toEqual([])
    expect(await db.select().from(schema.players).where(eq(schema.players.id, ids.dupe))).toHaveLength(0)
  })

  it("moves Lineups to the surviving Player in the automatic merge", async () => {
    await mergeDuplicatePlayers()

    const saved = await savedSkaters()
    const survivors = await db.select().from(schema.players)
    expect(survivors).toHaveLength(1)
    expect(saved.skaters).toEqual([survivors[0].id, 9002, 9003])
    expect(saved.skaterBackups).toEqual([])
  })

  it("updates every affected Lineup, leaves the rest alone, and can be re-run", async () => {
    const [second] = await db
      .insert(schema.fantasyManagers)
      .values({ seasonId: (await db.select().from(schema.fantasySeasons))[0].seasonId, contest: "regular", teamName: "Other", firstName: "G", lastName: "H", tokenHash: "hash2" })
      .returning()
    await db.insert(schema.fantasyLineups).values([
      { managerId: second.id, weekId: "2026-11-14", skaters: [ids.dupe, 9002, 9003], goalies: [9007], skaterBackups: [9004], goalieBackups: [9008] },
      { managerId: second.id, weekId: "2026-11-21", skaters: [9001, 9002, 9003], goalies: [ids.dupe], skaterBackups: [9004], goalieBackups: [9008] },
      { managerId: second.id, weekId: "2026-11-28", skaters: [9001, 9002, 9003], goalies: [9007], skaterBackups: [9004], goalieBackups: [9008] },
    ])

    await reassignLineupPlayer(ids.dupe, ids.keep)
    await reassignLineupPlayer(ids.dupe, ids.keep)

    const rows = await db.select().from(schema.fantasyLineups)
    const byWeek = (weekId: string, managerId = second.id) => rows.find((r) => r.weekId === weekId && r.managerId === managerId)!
    expect(byWeek("2026-11-07", managerId).skaters).toEqual([ids.keep, 9002, 9003])
    expect(byWeek("2026-11-14").skaters).toEqual([ids.keep, 9002, 9003])
    expect(byWeek("2026-11-21").goalies).toEqual([ids.keep])
    expect(byWeek("2026-11-28").skaters).toEqual([9001, 9002, 9003])
    expect(rows.flatMap((r) => [...r.skaters, ...r.goalies, ...r.skaterBackups, ...r.goalieBackups])).not.toContain(ids.dupe)
  })

  it("swaps a goalie and leaves the other slots as they were", async () => {
    await db.update(schema.fantasyLineups).set({ skaters: [9001, 9002, 9003], goalies: [ids.dupe] }).where(eq(schema.fantasyLineups.managerId, managerId))

    await reassignLineupPlayer(ids.dupe, ids.keep)

    const saved = await savedSkaters()
    expect(saved.goalies).toEqual([ids.keep])
    expect(saved.skaters).toEqual([9001, 9002, 9003])
    expect(saved.skaterBackups).toEqual([])
  })

  it("keeps the merged Player until their Lineups are updated", async () => {
    await db.execute(sql`DROP TABLE fantasy_lineups`)
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await mergeManual(request())

    expect(response.status).toBe(500)
    expect(await db.select().from(schema.players).where(eq(schema.players.id, ids.dupe))).toHaveLength(1)
  })
})
