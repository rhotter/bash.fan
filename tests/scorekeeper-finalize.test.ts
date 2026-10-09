import { beforeEach, describe, expect, it, vi } from "vitest"
import { getTableName, type SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { createInitialState, type GoalEvent } from "@/lib/scorekeeper-types"

const mocks = vi.hoisted(() => ({
  select: vi.fn(), insert: vi.fn(), delete: vi.fn(), update: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock("@/lib/db", async () => ({
  db: mocks,
  schema: await import("@/lib/db/schema"),
}))
vi.mock("@/lib/admin-session", () => ({ getSession: mocks.getSession }))

import { POST } from "@/app/api/bash/scorekeeper/[id]/finalize/route"

const dialect = new PgDialect()
const state = createInitialState()
let isForfeit = false
let forfeitDuringFinalization = false
let subIds: number[] = []
const inserted: { table: string; values: Record<string, any>; update?: Record<string, any> }[] = []
const deleted: string[] = []
const updates: { values: Record<string, any>; where: SQL }[] = []

function goal(overrides: Partial<GoalEvent> = {}): GoalEvent {
  return {
    id: "goal-1", team: "home", period: 3, clock: "9:02", scorerId: 10,
    assist1Id: 1, assist2Id: 11, flags: [], ...overrides,
  }
}

function rows(table: string) {
  return inserted.filter((entry) => entry.table === table).map((entry) => entry.values)
}

async function finalize() {
  return POST(new Request("https://bash.fan/api/bash/scorekeeper/g55/finalize", { method: "POST" }), {
    params: Promise.resolve({ id: "g55" }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(state, createInitialState(), {
    period: 3, homeGoalieId: 1, awayGoalieId: 2,
    homeAttendance: [1, 10, 11], awayAttendance: [2, 20],
    homeShots: [5, 5, 5], awayShots: [4, 4, 4], goals: [goal()],
  })
  isForfeit = false
  forfeitDuringFinalization = false
  subIds = []
  inserted.length = 0
  deleted.length = 0
  updates.length = 0
  mocks.getSession.mockResolvedValue(true)
  mocks.select.mockImplementation(() => ({
    from(table: Parameters<typeof getTableName>[0]) {
      const name = getTableName(table)
      const query = {
        leftJoin: () => query,
        where: async () => {
          if (name === "game_live") return [{ state }]
          if (name === "games") return [{ id: "g55", seasonId: "2026-summer", homeTeam: "home", awayTeam: "away", isPlayoff: false, isForfeit, gameLength: 45 }]
          if (name === "players") return [1, 2, 3, 10, 11, 20].map((id) => ({ id }))
          if (name === "adhoc_game_rosters") return subIds.map((playerId) => ({ playerId, isSub: true }))
          throw new Error(`Unexpected select: ${name}`)
        },
      }
      return query
    },
  }))
  mocks.insert.mockImplementation((table: Parameters<typeof getTableName>[0]) => ({
    values(values: Record<string, any>) {
      const entry = { table: getTableName(table), values, update: undefined as Record<string, any> | undefined }
      inserted.push(entry)
      return {
        onConflictDoUpdate: async ({ set }: { set: Record<string, any> }) => { entry.update = set },
        onConflictDoNothing: async () => {},
      }
    },
  }))
  mocks.delete.mockImplementation((table: Parameters<typeof getTableName>[0]) => ({
    where: async () => {
      const name = getTableName(table)
      deleted.push(name)
      for (let i = inserted.length - 1; i >= 0; i--) {
        if (inserted[i].table === name) inserted.splice(i, 1)
      }
    },
  }))
  mocks.update.mockImplementation(() => ({
    set: (values: Record<string, any>) => ({
      where: (where: SQL) => ({
        returning: async () => {
          updates.push({ values, where })
          return forfeitDuringFinalization ? [] : [{ id: "g55" }]
        },
      }),
    }),
  }))
})

describe("scorekeeper finalization", () => {
  it("rejects an existing forfeit before any writes, preserving its official result and history", async () => {
    isForfeit = true
    const response = await finalize()
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "Forfeited games cannot be finalized from live scoring" })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("does not overwrite the official result if an admin marks a forfeit during finalization", async () => {
    forfeitDuringFinalization = true
    expect((await finalize()).status).toBe(409)
    const query = dialect.sqlToQuery(updates[0].where)
    expect(query.sql).toContain('"games"."is_forfeit" =')
    expect(query.params).toEqual(["g55", false])
  })

  it.each(["assist1Id", "assist2Id"] as const)("credits a goalie %s without a runner appearance", async (slot) => {
    state.goals = [goal({ assist1Id: null, assist2Id: null, [slot]: 1 })]
    const response = await finalize()
    expect(response.status).toBe(200)
    expect(rows("player_game_stats").some((row) => row.playerId === 1)).toBe(false)
    expect(rows("goalie_game_stats").find((row) => row.playerId === 1)).toMatchObject({ goalieAssists: 1 })
    expect(inserted.find((entry) => entry.table === "goalie_game_stats" && entry.values.playerId === 1)?.update).toMatchObject({ goalieAssists: 1 })
  })

  it("retains the runner's assist and normal team score alongside a goalie assist", async () => {
    const response = await finalize()
    expect(await response.json()).toEqual({ ok: true, homeScore: 1, awayScore: 0, isOvertime: false })
    expect(rows("player_game_stats").find((row) => row.playerId === 11)).toMatchObject({ assists: 1, points: 1 })
    expect(rows("player_game_stats").find((row) => row.playerId === 10)).toMatchObject({ goals: 1, points: 1 })
    expect(rows("goalie_game_stats").find((row) => row.playerId === 1)).toMatchObject({ shotsAgainst: 12, saves: 12, goalieAssists: 1 })
  })

  it("keeps a sub goalie only in goalie stats with the sub flag", async () => {
    subIds = [1]
    expect((await finalize()).status).toBe(200)
    expect(rows("player_game_stats").some((row) => row.playerId === 1)).toBe(false)
    expect(rows("goalie_game_stats").find((row) => row.playerId === 1)).toMatchObject({ goalieAssists: 1, isSub: true })
  })

  it("excludes shootout assists from both goalie and runner stats", async () => {
    state.goals = [goal({ period: 5 })]
    await finalize()
    expect(rows("goalie_game_stats").find((row) => row.playerId === 1)?.goalieAssists).toBe(0)
    expect(rows("player_game_stats").find((row) => row.playerId === 11)?.assists).toBe(0)
  })

  it("classifies assists by the goalie assigned at the event, including mid-game switches", async () => {
    state.homeAttendance.push(3)
    state.homeGoalieId = 3
    state.goalieChanges = [{ id: "change", team: "home", period: 2, clock: "8:00", outGoalieId: 1, inGoalieId: 3 }]
    state.goals = [
      goal({ id: "before", period: 1, clock: "5:00", assist1Id: 1, assist2Id: 3 }),
      goal({ id: "after", period: 3, clock: "9:02", assist1Id: 3, assist2Id: 1 }),
    ]
    await finalize()
    for (const id of [1, 3]) {
      expect(rows("goalie_game_stats").find((row) => row.playerId === id)?.goalieAssists).toBe(1)
      expect(rows("player_game_stats").find((row) => row.playerId === id)).toMatchObject({ assists: 1, points: 1 })
    }
  })

  it("re-finalizes idempotently and removes stale goalie assists when a goal is corrected", async () => {
    await finalize()
    await finalize()
    expect(rows("goalie_game_stats").filter((row) => row.playerId === 1)).toHaveLength(1)
    expect(rows("goalie_game_stats").find((row) => row.playerId === 1)?.goalieAssists).toBe(1)
    state.goals[0].assist1Id = null
    await finalize()
    expect(rows("goalie_game_stats").find((row) => row.playerId === 1)?.goalieAssists).toBe(0)
    expect(rows("player_game_stats").some((row) => row.playerId === 1)).toBe(false)
  })

  it("still requires authentication", async () => {
    mocks.getSession.mockResolvedValue(false)
    expect((await finalize()).status).toBe(401)
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
