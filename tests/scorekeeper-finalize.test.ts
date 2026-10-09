import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getTableName, type SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { isDeepStrictEqual } from "node:util"
import { createInitialState, type GoalEvent, type LiveGameState } from "@/lib/scorekeeper-types"

const mocks = vi.hoisted(() => ({
  select: vi.fn(), insert: vi.fn(), delete: vi.fn(), update: vi.fn(),
  getSession: vi.fn(), rawSql: vi.fn(),
}))

vi.mock("@/lib/db", async () => ({
  db: mocks,
  rawSql: mocks.rawSql,
  schema: await import("@/lib/db/schema"),
}))
vi.mock("@/lib/admin-session", () => ({ getSession: mocks.getSession }))

import { POST } from "@/app/api/bash/scorekeeper/[id]/finalize/route"

const dialect = new PgDialect()
const state = createInitialState()
let isForfeit = false
let officialGame = { status: "live", hasBoxscore: false, homeScore: null as number | null, awayScore: null as number | null }
let forfeitDuringFinalization = false
let casFails = false
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

async function finalize(expectedUpdatedAt?: string, proposal?: { state: LiveGameState; expectedState: LiveGameState }) {
  return POST(new Request("https://bash.fan/api/bash/scorekeeper/g55/finalize", {
    method: "POST",
    headers: expectedUpdatedAt === undefined ? undefined : { "x-state-updated-at": expectedUpdatedAt },
    body: proposal === undefined ? undefined : JSON.stringify(proposal),
  }), {
    params: Promise.resolve({ id: "g55" }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[key]
  Object.assign(state, createInitialState(), {
    period: 3, homeGoalieId: 1, awayGoalieId: 2,
    homeAttendance: [1, 10, 11], awayAttendance: [2, 20],
    homeShots: [5, 5, 5], awayShots: [4, 4, 4], goals: [goal()],
  })
  isForfeit = false
  officialGame = { status: "live", hasBoxscore: false, homeScore: null, awayScore: null }
  delete state.goalieShotsAgainst
  forfeitDuringFinalization = false
  casFails = false
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
          if (name === "game_live") return [{ state: structuredClone(state) }]
          if (name === "games") return [{ id: "g55", seasonId: "2026-summer", homeTeam: "home", awayTeam: "away", isPlayoff: false, isForfeit, gameLength: 45, ...officialGame }]
          if (name === "players") return [1, 2, 3, 10, 11, 20].map((id) => ({ id }))
          if (name === "adhoc_game_rosters") return subIds.map((playerId) => ({ playerId, isSub: true }))
          throw new Error(`Unexpected select: ${name}`)
        },
      }
      return query
    },
  }))
  mocks.rawSql.mockImplementation(async (query: SQL) => {
    if (casFails) return []
    const { sql, params } = dialect.sqlToQuery(query)
    const [proposedJson, expectedJson] = params.filter((value) => typeof value === "string" && value.startsWith("{")) as string[]
    if (!isDeepStrictEqual(JSON.parse(expectedJson), state)) return []
    if (!sql.includes("WITH eligible_game") &&
      (state.finalizationPending?.phase !== "running" || !params.includes(state.finalizationPending.attemptId))) return []
    const accepted = JSON.parse(proposedJson)
    if (Object.hasOwn(state, "shotCorrections")) accepted.shotCorrections = (state as any).shotCorrections
    else delete accepted.shotCorrections
    for (const key of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[key]
    Object.assign(state, accepted)
    return [{ state: structuredClone(state) }]
  })
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

afterEach(() => { vi.restoreAllMocks() })

describe("scorekeeper finalization", () => {
  it("rejects an existing forfeit before any writes, preserving its official result and history", async () => {
    isForfeit = true
    const response = await finalize()
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "Forfeited games cannot be finalized from live scoring" })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.rawSql).not.toHaveBeenCalled()
  })

  it("does not overwrite the official result if an admin marks a forfeit during finalization", async () => {
    forfeitDuringFinalization = true
    const response = await finalize()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ stateSaved: true, state: { finalizationPending: { phase: "failed" } } })
    expect(state.finalizationPending?.phase).toBe("failed")
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
    expect(await response.json()).toEqual({ ok: true, homeScore: 1, awayScore: 0, isOvertime: false, state })
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
    state.goalieShotsAgainst = { "1": 5, "3": 7 }
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

  function expectNoWrites() {
    expect(mocks.rawSql).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  }

  function splitHomeGoalies() {
    state.homeAttendance.push(3)
    state.homeGoalieId = 3
    state.goalieChanges = [{ id: "change", team: "home", period: 3, clock: "1:00", outGoalieId: 1, inGoalieId: 3 }]
    state.goals.push(goal({ id: "away-goal", team: "away", clock: "0:30", scorerId: 20, assist1Id: null, assist2Id: null }))
  }

  it.each([
    ["negative", [-1, 5, 5]],
    ["fractional", [1.5, 5, 5]],
    ["string", ["5", 5, 5]],
    ["nonfinite", [Infinity, 5, 5]],
    ["missing", undefined],
    ["empty", []],
    ["short", [5, 5]],
    ["extra periods", [5, 5, 5, 5, 5]],
    ["out of range", [2_147_483_647, 1, 0]],
  ])("rejects %s shot totals before any writes", async (_name, shots) => {
    state.homeShots = shots as number[]
    expect((await finalize()).status).toBe(400)
    expectNoWrites()
  })

  it("rejects shots below goals against before creating even a missing player", async () => {
    state.homeShots = [0, 0, 0]
    state.homeAttendance.push(999)
    const response = await finalize()
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain("cannot be less than goals against")
    expectNoWrites()
  })

  it("allows zero saves when every shot faced is a goal", async () => {
    state.homeShots = [0, 0, 1]
    expect((await finalize()).status).toBe(200)
    expect(rows("goalie_game_stats").find((row) => row.playerId === 2)).toMatchObject({ shotsAgainst: 1, goalsAgainst: 1, saves: 0 })
  })

  it("requires actual shot allocations after a goalie substitution instead of inventing proportional saves", async () => {
    splitHomeGoalies()
    state.awayShots = [0, 0, 1]
    const response = await finalize()
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain("explicit shots-against total for every goalie")
    expectNoWrites()
  })

  it("keeps goalie time segments and actual goals against with a valid explicit allocation", async () => {
    splitHomeGoalies()
    state.goalieShotsAgainst = { "1": 2, "3": 10 }
    expect((await finalize()).status).toBe(200)
    expect(rows("goalie_game_stats").find((row) => row.playerId === 1)).toMatchObject({ seconds: 2640, goalsAgainst: 0, shotsAgainst: 2, saves: 2 })
    expect(rows("goalie_game_stats").find((row) => row.playerId === 3)).toMatchObject({ seconds: 60, goalsAgainst: 1, shotsAgainst: 10, saves: 9 })
  })

  it.each([
    ["incomplete", { "1": 12 }],
    ["wrong sum", { "1": 6, "3": 5 }],
    ["below individual GA", { "1": 12, "3": 0 }],
    ["negative", { "1": -1, "3": 13 }],
    ["fractional", { "1": 5.5, "3": 6.5 }],
    ["unassigned", { "1": 5, "3": 7, "999": 0 }],
    ["noncanonical ID", { "1": 5, "3": 7, "03": 0 }],
  ])("rejects %s multiple-goalie allocations without writing", async (_name, allocation) => {
    splitHomeGoalies()
    state.goalieShotsAgainst = allocation
    expect((await finalize()).status).toBe(400)
    expectNoWrites()
  })

  it.each([null, [], "12", { "2": "15" }, { "2": NaN }])("rejects malformed goalie allocations without writing (%j)", async (allocation) => {
    state.goalieShotsAgainst = allocation as unknown as Record<string, number>
    expect((await finalize()).status).toBe(400)
    expectNoWrites()
  })

  it("validates explicit allocations even for a single goalie", async () => {
    state.goalieShotsAgainst = { "2": 14 }
    expect((await finalize()).status).toBe(400)
    expectNoWrites()
  })

  it("subtracts empty-net goals from goalie shots without manufacturing saves", async () => {
    state.goals.push(goal({ id: "empty-net", flags: ["ENG"], assist1Id: null, assist2Id: null }))
    state.homeShots = [0, 0, 2]
    expect((await finalize()).status).toBe(200)
    expect(rows("goalie_game_stats").find((row) => row.playerId === 2)).toMatchObject({ shotsAgainst: 1, goalsAgainst: 1, saves: 0 })
    expect(updates[0].values.homeScore).toBe(2)
  })

  it("rejects team shots that omit an empty-net goal", async () => {
    state.goals = [goal({ flags: ["ENG"] })]
    state.homeShots = [0, 0, 0]
    expect((await finalize()).status).toBe(400)
    expectNoWrites()
  })

  it("requires multi-goalie allocations to exclude empty-net goals", async () => {
    splitHomeGoalies()
    state.goals.push(goal({ id: "away-eng", team: "away", clock: "0:10", scorerId: 20, assist1Id: null, assist2Id: null, flags: ["ENG"] }))
    state.goalieShotsAgainst = { "1": 5, "3": 7 }
    expect((await finalize()).status).toBe(400)
    expectNoWrites()
    state.goalieShotsAgainst = { "1": 5, "3": 6 }
    expect((await finalize()).status).toBe(200)
    expect(rows("goalie_game_stats").filter((row) => [1, 3].includes(row.playerId)).reduce((sum, row) => sum + row.shotsAgainst, 0)).toBe(11)
  })

  it.each(["attendance", "goalie", "goal history", "pregame"])("preserves the official boxscore when live %s is missing", async (missing) => {
    officialGame = { status: "final", hasBoxscore: true, homeScore: 5, awayScore: 2 }
    if (missing === "attendance") state.homeAttendance = []
    if (missing === "goalie") state.homeGoalieId = null
    if (missing === "goal history") state.goals = []
    if (missing === "pregame") state.period = 0
    expect((await finalize()).status).toBe(409)
    expectNoWrites()
  })

  it("protects an existing boxscore even if its status is no longer final", async () => {
    officialGame = { status: "live", hasBoxscore: true, homeScore: 5, awayScore: 2 }
    state.goals = []
    expect((await finalize()).status).toBe(409)
    expectNoWrites()
  })

  it("allows nonempty goal corrections to change an official score", async () => {
    officialGame = { status: "final", hasBoxscore: true, homeScore: 2, awayScore: 0 }
    expect((await finalize()).status).toBe(200)
    expect(updates[0].values.homeScore).toBe(1)
  })

  it("rejects an assigned goalie omitted from attendance", async () => {
    state.homeAttendance = [10, 11]
    expect((await finalize()).status).toBe(400)
    expectNoWrites()
  })

  it("rejects ambiguous team memberships before any writes", async () => {
    state.awayAttendance.push(1)
    expect((await finalize()).status).toBe(400)
    expectNoWrites()
  })

  it("rejects goalie changes that omit a goalie from attendance", async () => {
    splitHomeGoalies()
    state.homeAttendance = [3, 10, 11]
    state.goalieShotsAgainst = { "1": 5, "3": 7 }
    expect((await finalize()).status).toBe(400)
    expectNoWrites()
  })

  it("rejects a stale finalization snapshot before any writes", async () => {
    state.updatedAt = 12345
    expect((await finalize("12344")).status).toBe(409)
    expectNoWrites()
  })

  it("finalizes when the requested live snapshot matches", async () => {
    state.updatedAt = 12345
    expect((await finalize("12345")).status).toBe(200)
  })

  function completedGame() {
    officialGame = { status: "final", hasBoxscore: true, homeScore: 1, awayScore: 0 }
    return structuredClone(state)
  }

  it("validates and saves mixed goal/shot edits before rebuilding their statistics", async () => {
    const expectedState = completedGame()
    const proposed = structuredClone(expectedState)
    proposed.goals.push(goal({ id: "second-goal", assist1Id: null, assist2Id: null }))
    proposed.homeShots = [6, 5, 5]
    const response = await finalize("outdated-header-is-ignored-for-proposals", { state: proposed, expectedState })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({ homeScore: 2, awayScore: 0, state: { homeShots: [6, 5, 5], goals: proposed.goals } })
    expect(data.state).toEqual(state)
    expect(data.state.updatedAt).toBeGreaterThan(expectedState.updatedAt)
    expect(rows("goalie_game_stats").find((row) => row.playerId === 2)).toMatchObject({ shotsAgainst: 16, goalsAgainst: 2, saves: 14 })
    expect(mocks.rawSql).toHaveBeenCalledTimes(2)
    expect(mocks.rawSql.mock.invocationCallOrder[0]).toBeLessThan(mocks.delete.mock.invocationCallOrder[0])
    const query = dialect.sqlToQuery(mocks.rawSql.mock.calls[0][0])
    expect(query.sql).toMatch(/status = \$\d+ AND NOT is_forfeit/)
    expect(query.params).toContain("final")
    expect(query.sql).toContain("FOR UPDATE")
    expect(query.sql).toContain("l.state =")
    expect(query.params).toContain(JSON.stringify(expectedState))
  })

  it("accepts a new goalie substitution and explicit allocation in the same proposed edit", async () => {
    const expectedState = completedGame()
    const proposed = structuredClone(expectedState)
    proposed.homeAttendance.push(3)
    proposed.homeGoalieId = 3
    proposed.goalieChanges = [{ id: "new-goalie", team: "home", period: 3, clock: "1:00", outGoalieId: 1, inGoalieId: 3 }]
    proposed.goals.push(goal({ id: "away-goal", team: "away", clock: "0:30", scorerId: 20, assist1Id: null, assist2Id: null }))
    proposed.goalieShotsAgainst = { "1": 5, "3": 7 }
    expect((await finalize(undefined, { state: proposed, expectedState })).status).toBe(200)
    expect(rows("goalie_game_stats").find((row) => row.playerId === 1)).toMatchObject({ shotsAgainst: 5, saves: 5, seconds: 2640 })
    expect(rows("goalie_game_stats").find((row) => row.playerId === 3)).toMatchObject({ shotsAgainst: 7, goalsAgainst: 1, saves: 6, seconds: 60 })
  })

  it.each(["shots", "allocation", "penalties", "officials", "notes"])("rejects invalid proposed %s before saving state or writing statistics", async (invalid) => {
    const expectedState = completedGame()
    const proposed = structuredClone(expectedState)
    proposed.homeAttendance.push(999)
    if (invalid === "shots") proposed.homeShots = [0, 0, 0]
    if (invalid === "allocation") proposed.goalieShotsAgainst = { "2": 0 }
    if (invalid === "penalties") proposed.penalties = [{ id: "penalty", team: "home", period: 3, clock: "1:00", playerId: 10, infraction: "Minor", minutes: -2 }]
    if (invalid === "officials") proposed.officials = null as any
    if (invalid === "notes") proposed.notes = 12 as any
    const response = await finalize(undefined, { state: proposed, expectedState })
    expect(response.status).toBe(400)
    expect((await response.json()).stateSaved).toBeUndefined()
    expect(state).toEqual(expectedState)
    expectNoWrites()
  })

  it("rejects stale expected snapshots even if their timestamp is unchanged", async () => {
    const expectedState = completedGame()
    const proposed = structuredClone(expectedState)
    state.notes = "Another editor saved this"
    const response = await finalize(undefined, { state: proposed, expectedState })
    expect(response.status).toBe(409)
    expect((await response.json()).stateSaved).toBeUndefined()
    expectNoWrites()
  })

  it("does not create missing players or rebuild stats if the state CAS loses a race", async () => {
    const expectedState = completedGame()
    const proposed = { ...structuredClone(expectedState), homeAttendance: [...expectedState.homeAttendance, 999] }
    casFails = true
    const response = await finalize(undefined, { state: proposed, expectedState })
    expect(response.status).toBe(409)
    expect((await response.json()).stateSaved).toBeUndefined()
    expect(mocks.rawSql).toHaveBeenCalledTimes(1)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(state).toEqual(expectedState)
  })

  it.each(["attendance", "goalie", "period", "events"])("cannot rewrite an incomplete legacy game by supplying missing %s in the proposal", async (missing) => {
    completedGame()
    const proposed = structuredClone(state)
    if (missing === "attendance") state.homeAttendance = []
    if (missing === "goalie") state.homeGoalieId = null
    if (missing === "period") state.period = 0
    if (missing === "events") state.goals = []
    const expectedState = structuredClone(state)
    expect((await finalize(undefined, { state: proposed, expectedState })).status).toBe(409)
    expectNoWrites()
    expect(state).toEqual(expectedState)
  })

  it("rejects proposed snapshots for a game that is not final", async () => {
    const expectedState = structuredClone(state)
    expect((await finalize(undefined, { state: structuredClone(state), expectedState })).status).toBe(409)
    expectNoWrites()
  })

  it("permits an explicit correction removing the last goal from a complete original history", async () => {
    const expectedState = completedGame()
    const proposed = { ...structuredClone(expectedState), goals: [] }
    const response = await finalize(undefined, { state: proposed, expectedState })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ homeScore: 0, awayScore: 0 })
  })

  it("preserves the server-owned shot audit instead of accepting a client's replacement", async () => {
    completedGame()
    const audit = [{ correctedAt: 456, previousHomeShots: [1, 1, 1] }]
    Object.assign(state, { shotCorrections: audit })
    const expectedState = structuredClone(state)
    const proposed = { ...structuredClone(expectedState), notes: "Corrected", shotCorrections: [{ forged: true }] }
    const response = await finalize(undefined, { state: proposed, expectedState })
    expect(response.status).toBe(200)
    expect((await response.json()).state.shotCorrections).toEqual(audit)
    const query = dialect.sqlToQuery(mocks.rawSql.mock.calls[0][0])
    expect(query.sql).toContain("- 'shotCorrections'")
    expect(query.sql).toContain("l.state->'shotCorrections'")
  })

  it("reports the accepted snapshot after a later rebuild failure so the same edit can be retried", async () => {
    const expectedState = completedGame()
    const proposed = { ...structuredClone(expectedState), notes: "Approved correction" }
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.delete.mockImplementationOnce(() => ({ where: async () => { throw new Error("Temporary database failure") } }))
    const response = await finalize(undefined, { state: proposed, expectedState })
    expect(response.status).toBe(500)
    const failure = await response.json()
    expect(failure).toMatchObject({ stateSaved: true, state: { notes: "Approved correction", finalizationPending: { phase: "failed" } } })
    expect(failure.state).toEqual(state)
    expect((await finalize(undefined, { state: failure.state, expectedState: failure.state })).status).toBe(200)
  })

  it("includes the accepted snapshot if the game becomes forfeited during the rebuild", async () => {
    const expectedState = completedGame()
    forfeitDuringFinalization = true
    const response = await finalize(undefined, { state: structuredClone(expectedState), expectedState })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ stateSaved: true, state })
  })

  it.each(["bodyless", "proposed"] as const)("rejects an existing running attempt before writes on the %s path", async (path) => {
    completedGame()
    state.finalizationPending = { attemptId: "an-interrupted-attempt", phase: "running" }
    // A stale timestamp must never turn into permission to steal the claim.
    state.updatedAt = 1
    const expectedState = structuredClone(state)
    const response = await finalize(undefined, path === "proposed" ? { state: expectedState, expectedState } : undefined)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain("already in progress")
    expectNoWrites()
    expect(state).toEqual(expectedState)
  })

  it("claims the exact bodyless snapshot and clears its own marker only after the official result is saved", async () => {
    const expectedState = structuredClone(state)
    const response = await finalize()
    expect(response.status).toBe(200)
    expect(mocks.rawSql).toHaveBeenCalledTimes(2)
    const claim = dialect.sqlToQuery(mocks.rawSql.mock.calls[0][0])
    const claimed = JSON.parse(claim.params.find((value) => typeof value === "string" && value.startsWith("{")) as string)
    expect(claim.params).toContain(JSON.stringify(expectedState))
    expect(claimed.finalizationPending).toEqual({ attemptId: expect.any(String), phase: "running" })
    expect(claimed.finalizationPending.attemptId.length).toBeGreaterThan(0)
    expect(mocks.rawSql.mock.invocationCallOrder[0]).toBeLessThan(mocks.delete.mock.invocationCallOrder[0])
    expect(mocks.rawSql.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.update.mock.invocationCallOrder[0])
    const clear = dialect.sqlToQuery(mocks.rawSql.mock.calls[1][0])
    expect(clear.sql).toContain("l.state =")
    expect(clear.sql).toContain("->>'attemptId'")
    expect(clear.sql).toContain("->>'phase' = 'running'")
    expect(clear.params).toContain(claimed.finalizationPending.attemptId)
    expect(state.finalizationPending).toBeUndefined()
    expect((await response.json()).state).toEqual(state)
  })

  it("does not rebuild a bodyless request whose snapshot loses the claim race", async () => {
    state.homeAttendance.push(999)
    casFails = true
    expect((await finalize()).status).toBe(409)
    expect(mocks.rawSql).toHaveBeenCalledTimes(1)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(state.finalizationPending).toBeUndefined()
  })

  it("rejects a shot correction that wins after validation but before the finalization claim", async () => {
    const expectedState = completedGame()
    const save = mocks.rawSql.getMockImplementation()!
    mocks.rawSql.mockImplementationOnce(async (query: SQL) => {
      state.awayShots = [5, 5, 5]
      return save(query)
    })
    const response = await finalize(undefined, { state: { ...expectedState, notes: "Edited note" }, expectedState })
    expect(response.status).toBe(409)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(state.awayShots).toEqual([5, 5, 5])
    expect(state.finalizationPending).toBeUndefined()
  })

  it("returns a canonical failed snapshot and retries bodyless finalization for an originally live game", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.delete.mockImplementationOnce(() => ({ where: async () => { throw new Error("Temporary database failure") } }))
    const failedResponse = await finalize(String(state.updatedAt))
    expect(failedResponse.status).toBe(500)
    const failed = await failedResponse.json()
    expect(failed).toMatchObject({ stateSaved: true, state: { finalizationPending: { phase: "failed" } } })
    expect(failed.state).toEqual(state)
    expect(officialGame.status).toBe("live")
    const retry = await finalize(String(failed.state.updatedAt))
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ homeScore: 1, awayScore: 0, state })
    expect(state.finalizationPending).toBeUndefined()
  })

  it("rejects an overlapping rebuild while the first request owns its running claim", async () => {
    let release!: () => void
    let signalClaimed!: () => void
    const paused = new Promise<void>((resolve) => { release = resolve })
    const claimed = new Promise<void>((resolve) => { signalClaimed = resolve })
    mocks.delete.mockImplementationOnce(() => ({ where: async () => { signalClaimed(); await paused } }))
    const first = finalize()
    await claimed
    const attemptId = state.finalizationPending?.attemptId
    const overlap = await finalize()
    expect(overlap.status).toBe(409)
    expect((await overlap.json()).error).toContain("already in progress")
    expect(mocks.rawSql).toHaveBeenCalledTimes(1)
    expect(mocks.delete).toHaveBeenCalledTimes(1)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(state.finalizationPending).toEqual({ attemptId, phase: "running" })
    release()
    expect((await first).status).toBe(200)
    expect(state.finalizationPending).toBeUndefined()
  })

  it.each(["bodyless", "proposed"] as const)("retries a failed last-goal removal through the %s path", async (path) => {
    const expectedState = completedGame()
    const proposed = { ...structuredClone(expectedState), goals: [] }
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.delete.mockImplementationOnce(() => ({ where: async () => { throw new Error("Temporary database failure") } }))
    const failure = await finalize(undefined, { state: proposed, expectedState })
    expect(failure.status).toBe(500)
    const data = await failure.json()
    expect(data).toMatchObject({ stateSaved: true, state: { goals: [], finalizationPending: { phase: "failed" } } })
    expect(data.state).toEqual(state)
    expect(officialGame.homeScore).toBe(1)
    const oldAttemptId = state.finalizationPending!.attemptId
    const retry = await finalize(undefined, path === "proposed" ? { state: data.state, expectedState: data.state } : undefined)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ homeScore: 0, awayScore: 0 })
    const claimParams = dialect.sqlToQuery(mocks.rawSql.mock.calls[2][0]).params
    const retriedState = JSON.parse(claimParams.find((value) => typeof value === "string" && value.startsWith("{")) as string)
    expect(retriedState.finalizationPending.attemptId).not.toBe(oldAttemptId)
    expect(state.finalizationPending).toBeUndefined()
  })

  it("retains all other validation for a failed attempt with empty goal history", async () => {
    const expectedState = completedGame()
    state.goals = []
    state.finalizationPending = { attemptId: "failed-attempt", phase: "failed" }
    state.homeAttendance = []
    const response = await finalize(undefined, { state: expectedState, expectedState: structuredClone(state) })
    expect(response.status).toBe(409)
    expectNoWrites()
  })

  it("strips a proposed marker and never treats a forged failed marker as retry provenance", async () => {
    completedGame()
    state.goals = []
    const expectedState = structuredClone(state)
    const proposed = { ...structuredClone(expectedState), finalizationPending: { attemptId: "forged", phase: "failed" as const } }
    expect((await finalize(undefined, { state: proposed, expectedState })).status).toBe(409)
    expectNoWrites()
    state.goals = [goal()]
    const validExpectedState = structuredClone(state)
    const response = await finalize(undefined, { state: { ...validExpectedState, finalizationPending: proposed.finalizationPending }, expectedState: validExpectedState })
    expect(response.status).toBe(200)
    const claimParams = dialect.sqlToQuery(mocks.rawSql.mock.calls[0][0]).params
    const claimed = JSON.parse(claimParams.find((value) => typeof value === "string" && value.startsWith("{")) as string)
    expect(claimed.finalizationPending.phase).toBe("running")
    expect(claimed.finalizationPending.attemptId).not.toBe("forged")
    expect((await response.json()).state.finalizationPending).toBeUndefined()
  })

  it.each(["CAS conflict", "database error"])("requires reload without promising a retryable snapshot when failure marking has a %s", async (failure) => {
    const save = mocks.rawSql.getMockImplementation()!
    mocks.rawSql.mockImplementationOnce(save).mockImplementationOnce(async () => {
      if (failure === "database error") throw new Error("Cannot mark failure")
      return []
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.delete.mockImplementationOnce(() => ({ where: async () => { throw new Error("Temporary database failure") } }))
    const response = await finalize()
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.reloadRequired).toBe(true)
    expect(data.stateSaved).toBeUndefined()
    expect(data.state).toBeUndefined()
    expect(data.error).toContain("administrator review")
    expect(state.finalizationPending?.phase).toBe("running")
    expect(mocks.rawSql).toHaveBeenCalledTimes(2)
  })

  it("does not mark or clear another attempt when its own final clear CAS loses ownership", async () => {
    const save = mocks.rawSql.getMockImplementation()!
    mocks.rawSql.mockImplementationOnce(save).mockImplementationOnce(async () => {
      state.finalizationPending = { attemptId: "another-attempt", phase: "running" }
      return []
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    const response = await finalize()
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ reloadRequired: true })
    expect(state.finalizationPending).toEqual({ attemptId: "another-attempt", phase: "running" })
    expect(mocks.rawSql).toHaveBeenCalledTimes(3)
  })

  it("marks a failed final clear retryable when it still owns the claim", async () => {
    const save = mocks.rawSql.getMockImplementation()!
    mocks.rawSql.mockImplementationOnce(save).mockRejectedValueOnce(new Error("Temporary clear failure"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const response = await finalize()
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ stateSaved: true, state: { finalizationPending: { phase: "failed" } } })
    expect(state.finalizationPending?.phase).toBe("failed")
    expect((await finalize()).status).toBe(200)
  })

  it("still requires authentication", async () => {
    mocks.getSession.mockResolvedValue(false)
    expect((await finalize()).status).toBe(401)
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
