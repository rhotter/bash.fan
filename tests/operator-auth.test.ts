import { beforeEach, afterEach, describe, it, expect, vi } from "vitest"
const mocks = vi.hoisted(() => ({ cookie: vi.fn(), rawSql: vi.fn() }))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }))
vi.mock("@/lib/db", () => ({ rawSql: mocks.rawSql }))
import { createSessionToken, signToken, verifyToken, getSession, getOperatorRole } from "@/lib/admin-session"
import { checkCredential, authorizeScorekeeper } from "@/lib/operator-auth"
import { scorekeeperDateAllowed } from "@/lib/auth-policy"
import { POST as login } from "@/app/api/bash/admin/login/route"
import { POST as scoreLogin } from "@/app/api/bash/admin/validate-pin/route"

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("ADMIN_PIN", "test-admin")
  vi.stubEnv("SCOREKEEPER_PIN", "test-scorekeeper")
  vi.stubEnv("SESSION_SECRET", "test-only-random-session-key-longer-than-32")
  vi.stubEnv("VERCEL", "1")
  mocks.rawSql.mockResolvedValue([{ allowed: true }])
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-26T12:00:00Z"))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
const request = (pin?: string) => new Request("https://example.test/api", { headers: pin ? { "x-pin": pin } : {} })
describe("operator roles and brute-force protection", () => {
  it("issues a scorekeeper-only cookie at the legacy validation URL", async () => {
    const res = await scoreLogin(request("test-scorekeeper"))
    expect(res.status).toBe(200)
    const token = res.headers.get("set-cookie")!.split(";")[0].split("=")[1]
    mocks.cookie.mockReturnValue({ value: token })
    expect(await getOperatorRole()).toBe("scorekeeper")
    expect(await getSession()).toBe(false)
  })
  it("rejects the scorekeeper credential at admin login", async () => {
    const res = await login(new Request("https://example.test/api/bash/admin/login", { method: "POST", body: JSON.stringify({ pin: "test-scorekeeper" }) }) as never)
    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toBeNull()
  })
  it("accepts the separate admin credential", async () => {
    expect(await checkCredential(request(), "test-admin", true)).toBe("admin")
    mocks.cookie.mockReturnValue({ value: createSessionToken("admin") })
    expect(await getSession()).toBe(true)
  })
  it("requires the limiter on raw PINs and returns 429 even for a correct PIN during cooldown", async () => {
    mocks.rawSql.mockResolvedValue([{ allowed: false }])
    const res = await authorizeScorekeeper(request("test-scorekeeper"), "g1")
    expect(res?.status).toBe(429)
    expect(res?.headers.get("retry-after")).toBe("900")
    expect(mocks.rawSql).toHaveBeenCalledTimes(1)
  })
  it("fails closed if the limiter is unavailable", async () => {
    mocks.rawSql.mockRejectedValue(new Error("offline"))
    expect((await checkCredential(request(), "test-admin") as Response).status).toBe(503)
  })
  it("lets existing sessions continue without the PIN limiter but checks scorekeeper dates", async () => {
    mocks.cookie.mockReturnValue({ value: createSessionToken("scorekeeper") })
    mocks.rawSql.mockResolvedValue([{ date: "2026-10-25" }])
    expect(await authorizeScorekeeper(request(), "g1")).toBeNull()
    mocks.rawSql.mockResolvedValue([{ date: "2026-10-24" }])
    expect((await authorizeScorekeeper(request(), "g1"))?.status).toBe(403)
    mocks.rawSql.mockResolvedValue([{ date: "2026-10-27" }])
    expect((await authorizeScorekeeper(request(), "g1"))?.status).toBe(403)
  })
  it("allows admins to correct historical games", async () => {
    mocks.cookie.mockReturnValue({ value: createSessionToken("admin") })
    expect(await authorizeScorekeeper(request(), "g1")).toBeNull()
    expect(mocks.rawSql).not.toHaveBeenCalled()
  })
  it("invalidates old unscoped cookies and sessions after credential rotation", async () => {
    mocks.cookie.mockReturnValue({ value: signToken({ authenticated: true, iat: Math.floor(Date.now()/1000) }) })
    expect(await getSession()).toBe(false)
    mocks.cookie.mockReturnValue({ value: createSessionToken("admin") })
    vi.stubEnv("ADMIN_PIN", "rotated-admin")
    expect(await getSession()).toBe(false)
  })
  it("rejects missing, future, and expired session timestamps", () => {
    for (const iat of [undefined, Math.floor(Date.now()/1000) + 60, Math.floor(Date.now()/1000) - 14400]) {
      expect(verifyToken(signToken({ role: "admin", iat }))).toBeNull()
    }
  })
})
describe("Pacific calendar edit window", () => {
  it.each([
    ["2026-10-25", "2026-10-27T06:59:59Z", true],
    ["2026-10-25", "2026-10-27T07:00:00Z", false],
    ["2026-10-26", "2026-10-26T06:59:59Z", false],
    ["2026-10-26", "2026-10-26T07:00:00Z", true],
    ["2026-10-31", "2026-11-02T07:59:59Z", true],
    ["2026-10-31", "2026-11-02T08:00:00Z", false],
    ["2026-03-07", "2026-03-09T06:59:59Z", true],
    ["2026-03-07", "2026-03-09T07:00:00Z", false],
    ["invalid", "2026-10-26T07:00:00Z", false],
  ])("%s at %s => %s", (date, now, expected) => {
    expect(scorekeeperDateAllowed(date, new Date(now))).toBe(expected)
  })
})
