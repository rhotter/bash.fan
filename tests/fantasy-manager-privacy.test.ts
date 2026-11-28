import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/cache", async (original) => ({ ...(await original<typeof import("next/cache")>()), revalidateTag: vi.fn() }))

import { db, schema } from "@/lib/db"
import { DEFAULT_FANTASY_CONFIG } from "@/lib/fantasy/config"
import { saveLineup } from "@/lib/fantasy/lineups"
import { createManager } from "@/lib/fantasy/managers"
import { savePredictions } from "@/lib/fantasy/predictions"
import { getFantasySeason, saveFantasyConfig } from "@/lib/fantasy/season"
import { fetchFantasyManager } from "@/lib/fetch-fantasy"
import { setupGame } from "./factories/setupGame"
import { setupPlayer } from "./factories/setupPlayer"
import { setupSeason } from "./factories/setupSeason"
import { setupTeam } from "./factories/setupTeam"

const BEFORE_LOCK = new Date("2026-11-04T12:00:00-08:00")
const AFTER_LOCK = new Date("2026-11-07T08:00:00-08:00")
const WEEK = "2026-11-07"

describe("a Manager's public page", () => {
  let seasonId: string
  let managerId: number
  let playerIds: number[]
  let gameId: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: BEFORE_LOCK })
    const { season } = await setupSeason({ isCurrent: true })
    seasonId = season.id
    const { team: seals } = await setupTeam()
    const { team: yetis } = await setupTeam()
    const players = []
    for (const [index, team] of [seals, seals, yetis, yetis].entries()) {
      players.push((await setupPlayer({ name: `Secret Skater ${index}`, roster: [{ season, team }] })).player)
    }
    const { player: goalie } = await setupPlayer({ name: "Secret Goalie", roster: [{ season, team: seals, isGoalie: true }] })
    playerIds = [...players.map((p) => p.id), goalie.id]
    gameId = (await setupGame({ season, homeTeam: seals, awayTeam: yetis, date: WEEK, time: "9:00a", status: "upcoming" })).game.id
    await saveFantasyConfig(season.id, "regular", DEFAULT_FANTASY_CONFIG, BEFORE_LOCK)

    await createManager(season.id, "regular", { teamName: "Puck Norris", firstName: "Hidden", lastName: "Realname" })
    const [manager] = await db.select().from(schema.fantasyManagers)
    managerId = manager.id
    const fantasy = (await getFantasySeason(season.id))!
    const lineup = { skaters: playerIds.slice(0, 3), goalies: [goalie.id], skaterBackups: [], goalieBackups: [] }
    expect(await saveLineup(manager, fantasy, WEEK, lineup)).toEqual({ outcome: "saved" })
    expect(await savePredictions(manager, fantasy, WEEK, [{ gameId, homeScore: 27, awayScore: 26 }])).toEqual({
      outcome: "saved",
    })
  })
  afterEach(() => vi.useRealTimers())

  it("shows nothing picked for a Week that hasn't locked", async () => {
    const page = (await fetchFantasyManager(managerId))!

    // Exact keys, so a new field has to be considered here before it can reach the public.
    expect(Object.keys(page).sort()).toEqual(["contest", "history", "pickemHistory", "teamName"])
    expect(page.history).toEqual({ points: 0, weeks: [] })
    expect(page.pickemHistory).toEqual({ correct: 0, goalError: 0, weeks: [] })
    expect(JSON.stringify(page)).not.toMatch(/Secret|Hidden|Realname/)
    expect(JSON.stringify(page)).not.toContain(gameId)
  })

  it("shows the picks once the Week locks, still without real names", async () => {
    vi.setSystemTime(AFTER_LOCK)

    const page = (await fetchFantasyManager(managerId))!

    expect(page.history.weeks.map((week) => week.id)).toEqual([WEEK])
    expect(page.history.weeks[0].selections.map((s) => s.playerId).sort()).toEqual(
      [...playerIds.slice(0, 3), playerIds[4]].sort()
    )
    expect(page.pickemHistory.weeks[0].predictions).toHaveLength(1)
    expect(JSON.stringify(page)).not.toMatch(/Hidden|Realname/)
  })

  it("doesn't exist for an unknown Manager", async () => {
    expect(await fetchFantasyManager(managerId + 1000)).toBeNull()
  })

  it("doesn't exist once its season is no longer the current one", async () => {
    await db.update(schema.seasons).set({ isCurrent: false }).where(eq(schema.seasons.id, seasonId))
    const { season: next } = await setupSeason({ isCurrent: true })
    await saveFantasyConfig(next.id, "regular", DEFAULT_FANTASY_CONFIG, BEFORE_LOCK)

    expect(next.id).not.toBe(seasonId)
    expect(await fetchFantasyManager(managerId)).toBeNull()
  })
})
