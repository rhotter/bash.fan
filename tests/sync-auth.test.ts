import { beforeEach, afterEach, describe, it, expect, vi } from "vitest"
const mocks = vi.hoisted(() => ({ insert: vi.fn(), select: vi.fn(), rawSql: vi.fn(), getSession: vi.fn(), getSeason: vi.fn() }))
vi.mock("@/lib/db", async () => ({ db: mocks, rawSql: mocks.rawSql, schema: await import("@/lib/db/schema") }))
vi.mock("@/lib/admin-session", () => ({ getSession: mocks.getSession }))
vi.mock("@/lib/seasons", () => ({ getSeasonById: mocks.getSeason, getCurrentSeason: mocks.getSeason }))
vi.mock("@/lib/merge-duplicates", () => ({ mergeDuplicatePlayers: vi.fn() }))
import { GET } from "@/app/api/bash/sync/route"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CRON_SECRET", "test-cron-secret")
  mocks.getSession.mockResolvedValue(false)
  mocks.getSeason.mockResolvedValue({ id: "test-season", leagueId: "test", name: "Test", enableSync: false })
  vi.stubGlobal("fetch", vi.fn())
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const request = (auth?: string, query = "?seasonId=test-season&scheduleOnly=true") => new Request(`https://bash.fan/api/bash/sync${query}`, {
  headers: auth ? { authorization: auth } : {},
})

describe("sync authorization and season opt-out", () => {
  it.each([undefined, "Bearer wrong", "Bearer undefined"])("rejects unauthenticated requests (%s) before reading or writing", async auth => {
    expect((await GET(request(auth))).status).toBe(401)
    expect(mocks.getSeason).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it("fails closed when the cron secret is absent", async () => {
    vi.stubEnv("CRON_SECRET", "")
    expect((await GET(request("Bearer "))).status).toBe(401)
  })
  it.each(["", "?seasonId=test-season"])("honors disabled sync for cron calls: %s", async query => {
    const res = await GET(request("Bearer test-cron-secret", query))
    expect(await res.json()).toMatchObject({ ok: true, skipped: true })
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("allows admins but still honors disabled sync", async () => {
    mocks.getSession.mockResolvedValue(true)
    expect(await (await GET(request())).json()).toMatchObject({ ok: true, skipped: true })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(["-1", "garbage", "1.5"])("rejects invalid work limits: %s", async limit => {
    expect((await GET(request("Bearer test-cron-secret", `?boxscoreLimit=${limit}`))).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
  it("runs an enabled season for the authenticated scheduler", async () => {
    mocks.getSeason.mockResolvedValue({ id: "test-season", leagueId: "test", name: "Test", enableSync: true })
    mocks.select.mockImplementation(() => ({ from: () => ({
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
      where: async () => [{ count: 0 }],
    }) }))
    vi.mocked(fetch).mockImplementation(async () => new Response(""))
    const res = await GET(request("Bearer test-cron-secret"))
    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalled()
  })
})
