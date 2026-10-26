import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ cookie: vi.fn(), query: vi.fn() }))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }))
vi.mock("@/lib/db", () => ({ rawSql: mocks.query }))
import { signToken, getSession } from "@/lib/admin-session"
import { reviewPinMatches, reviewSessionId } from "@/lib/video/review-access"
import { POST as login } from "@/app/api/bash/admin/login/route"
import { adminVideo } from "@/lib/video/server"
const id = "171d2d66-7c1c-49ef-aa75-9b6a79e495c2"
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("ADMIN_PIN", "unit-test-admin-key")
  vi.stubEnv("SCOREKEEPER_PIN", "unit-test-scorekeeper-key")
  vi.stubEnv("SESSION_SECRET", "unit-test-session-secret-longer-than-32-characters")
  mocks.query.mockResolvedValue([{ allowed: true }])
  vi.stubEnv("VIDEO_REVIEW_PIN", "unit-test-review-key")
  vi.stubEnv("VIDEO_REVIEW_SESSION_ID", id)
  vi.stubEnv("VIDEO_ENABLED", "1")
})
afterEach(() => vi.unstubAllEnvs())
describe("isolated review access", () => {
  it("rejects missing, wrong, and non-string review PINs", () => {
    expect(reviewPinMatches(undefined)).toBe(false)
    expect(reviewPinMatches({})).toBe(false)
    expect(reviewPinMatches("wrong")).toBe(false)
    expect(reviewPinMatches("unit-test-review-key")).toBe(true)
  })
  it("allows only the dedicated session and never grants admin access", async () => {
    const value = signToken({ scope: "video-review", sessionId: id, iat: Math.floor(Date.now() / 1000) })
    mocks.cookie.mockImplementation((name: string) => name === "video_review_session" ? { value } : undefined)
    expect(await reviewSessionId()).toBe(id)
    expect(await getSession()).toBe(false)
    await expect(adminVideo(id)).resolves.toBeUndefined()
    await expect(adminVideo("other-session")).rejects.toMatchObject({ status: 401 })
    await expect(adminVideo()).rejects.toMatchObject({ status: 401 })
  })
  it("keeps reviewer login isolated from operator privileges after the merge", async () => {
    const response = await login(new Request("https://example.test/api/bash/admin/login", {
      method: "POST", body: JSON.stringify({ pin: "unit-test-review-key" }),
    }) as never)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const cookie = response.headers.get("set-cookie")!
    expect(cookie).toContain("video_review_session=")
    expect(cookie).not.toContain("admin_session=")
    const value = cookie.split(";")[0].split("=")[1]
    mocks.cookie.mockImplementation((name: string) => name === "video_review_session" ? { value } : undefined)
    expect(await reviewSessionId()).toBe(id)
    expect(await getSession()).toBe(false)
    await expect(adminVideo(id)).resolves.toBeUndefined()
    await expect(adminVideo()).rejects.toMatchObject({ status: 401 })
  })
  it("does not accept the reviewer passcode when video is disabled", async () => {
    vi.stubEnv("VIDEO_ENABLED", "0")
    const response = await login(new Request("https://example.test/api/bash/admin/login", {
      method: "POST", body: JSON.stringify({ pin: "unit-test-review-key" }),
    }) as never)
    expect(response.status).toBe(401)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(mocks.query).toHaveBeenCalledOnce()
  })
  it("rejects expired, tampered, and wrong-session cookies", async () => {
    for (const value of [signToken({ scope: "video-review", sessionId: id, iat: Math.floor(Date.now() / 1000) - 15000 }),
      signToken({ scope: "video-review", sessionId: "other", iat: Math.floor(Date.now() / 1000) }), "invalid"]) {
      mocks.cookie.mockReturnValue({ value })
      expect(await reviewSessionId()).toBeNull()
    }
  })
})
