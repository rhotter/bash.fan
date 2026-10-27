import { afterEach, beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ cookie: vi.fn() }))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }))
vi.mock("@/lib/db", () => ({ rawSql: vi.fn() }))
import { createSessionToken } from "@/lib/admin-session"
import { adminVideo, captureVideo } from "@/lib/video/server"
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("SESSION_SECRET", "unit-test-session-secret-longer-than-32-characters")
  vi.stubEnv("ADMIN_PIN", "unit-test-admin-key")
  vi.stubEnv("SCOREKEEPER_PIN", "unit-test-scorekeeper-key")
  vi.stubEnv("VIDEO_ENABLED", "1")
})
afterEach(() => vi.unstubAllEnvs())
it.each(["admin", "scorekeeper"] as const)("allows %s to record", async role => {
  const value = createSessionToken(role)
  mocks.cookie.mockImplementation((name: string) => name === "admin_session" ? { value } : undefined)
  await expect(captureVideo()).resolves.toBeUndefined()
  if (role === "scorekeeper") await expect(adminVideo()).rejects.toMatchObject({ status: 401 })
})
it("rejects signed-out recording access", async () => {
  await expect(captureVideo()).rejects.toMatchObject({ status: 401 })
})
it("honors the video feature switch for scorekeepers", async () => {
  const value = createSessionToken("scorekeeper")
  mocks.cookie.mockImplementation((name: string) => name === "admin_session" ? { value } : undefined)
  vi.stubEnv("VIDEO_ENABLED", "0")
  await expect(captureVideo()).rejects.toMatchObject({ status: 503 })
})
