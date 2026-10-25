import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ query: vi.fn(), admin: vi.fn() }))
vi.mock("@/lib/db", () => ({ rawSql: mocks.query }))
vi.mock("@/lib/admin-session", () => ({ requireAdminSession: mocks.admin }))
import { POST } from "@/app/api/bash/video/capture/route"
import { digestToken } from "@/lib/video/server"
const id = "171d2d66-7c1c-49ef-aa75-9b6a79e495c2"
const token = "a".repeat(43)
const request = (body: object) => new Request("http://localhost/api/bash/video/capture", { method: "POST", body: JSON.stringify(body) })
beforeEach(() => { vi.resetAllMocks(); process.env.VIDEO_ENABLED = "1" })
describe("automatic camera joining", () => {
  it("requires operator login before any session writes", async () => {
    mocks.admin.mockRejectedValue(new Response("Unauthorized", { status: 401 }))
    expect((await POST(request({ side: "left" }))).status).toBe(401)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it("joins the daily recording without a game ID", async () => {
    mocks.query.mockResolvedValueOnce([{ id }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ side: "left" }])
    const response = await POST(request({ side: "left" }))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ sessionId: id, side: "left", token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) })
  })
  it("reuses the same phone credential without rotating it", async () => {
    mocks.query.mockResolvedValueOnce([{ id }]).mockResolvedValueOnce([{ token_hash: digestToken(token), token_expires_at: new Date(Date.now() + 86400000).toISOString() }])
    const response = await POST(request({ side: "left", sessionId: id, token }))
    expect(await response.json()).toEqual({ sessionId: id, side: "left", token })
    expect(mocks.query).toHaveBeenCalledTimes(2)
  })
  it("refuses to take over another phone's position silently", async () => {
    mocks.query.mockResolvedValueOnce([{ id }]).mockResolvedValueOnce([{ token_hash: digestToken(token) }]).mockResolvedValueOnce([])
    expect((await POST(request({ side: "left" }))).status).toBe(409)
  })
  it("rejects invalid sides without database access", async () => {
    expect((await POST(request({ side: "middle" }))).status).toBe(400)
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
