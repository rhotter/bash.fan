import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"

const mocks = vi.hoisted(() => ({ query: vi.fn(), admin: vi.fn() }))
vi.mock("@/lib/db", () => ({ rawSql: mocks.query }))
vi.mock("@/lib/admin-session", () => ({ requireAdminSession: mocks.admin }))
vi.mock("@/lib/video/cloudflare", () => ({ streamRequest: vi.fn(), videoConfiguration: () => ({ stream: true, r2: true }) }))
import { GET, POST } from "@/app/api/bash/video/games/route"
import { GET as cameraGet, POST as cameraPost } from "@/app/api/bash/video/camera/[id]/[side]/route"
import { digestToken } from "@/lib/video/server"

const context = { params: Promise.resolve({ id: "session", side: "left" }) }
const token = "a".repeat(43)
const camera = { title: "Game", game_id: "g70", token_hash: digestToken(token), token_expires_at: new Date(Date.now() + 86400000).toISOString() }
const game = { id: "g70", date: "2026-10-24", time: "9:00 AM", status: "upcoming", location: "Rink", homeTeam: "Home", awayTeam: "Away" }
function claim(side = "left") { return new Request("http://localhost/api/bash/video/games", { method: "POST", body: JSON.stringify({ gameId: "g70", side }) }) }
function device(body?: object) { return new Request("http://localhost/api/bash/video/camera/session/left", { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) }) }
const query = (i: number) => new PgDialect().sqlToQuery(mocks.query.mock.calls[i][0])

beforeEach(() => { vi.resetAllMocks(); process.env.VIDEO_ENABLED = "1" })
describe("native game selection", () => {
  it("requires operator login for both the schedule and camera claims", async () => {
    mocks.admin.mockRejectedValue(new Response("Unauthorized", { status: 401 }))
    expect((await GET()).status).toBe(401)
    expect((await POST(claim())).status).toBe(401)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it("returns the current league schedule without caching authenticated data", async () => {
    mocks.query.mockResolvedValueOnce([game])
    const response = await GET()
    expect(await response.json()).toEqual({ games: [game] })
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(query(0).sql).toContain("s.is_current = true")
  })
  it("reuses the game's open session and issues a side-scoped credential", async () => {
    mocks.query.mockResolvedValueOnce([{ id: "g70", home: "Home", away: "Away" }]).mockResolvedValueOnce([{ id: "shared-session" }]).mockResolvedValueOnce([{ side: "right" }])
    const response = await POST(claim("right"))
    expect(response.status).toBe(201)
    const result = await response.json()
    expect(result).toMatchObject({ sessionId: "shared-session", side: "right" })
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(query(1).sql).toContain("ON CONFLICT (game_id) WHERE ended_at IS NULL")
    expect(query(2).params).toEqual(["shared-session", "right", digestToken(result.token)])
  })
  it("does not rotate another phone's active credential", async () => {
    mocks.query.mockResolvedValueOnce([{ id: "g70", home: "Home", away: "Away" }]).mockResolvedValueOnce([{ id: "shared-session" }]).mockResolvedValueOnce([])
    const response = await POST(claim())
    expect(response.status).toBe(409)
    expect(query(2).sql).toContain("WHERE video_cameras.token_hash IS NULL OR video_cameras.token_expires_at <= now()")
    expect(await response.json()).not.toHaveProperty("token")
  })
  it("rejects missing games and invalid camera positions before creating sessions", async () => {
    expect((await POST(claim("middle"))).status).toBe(400)
    expect(mocks.query).not.toHaveBeenCalled()
    mocks.query.mockResolvedValueOnce([])
    expect((await POST(claim())).status).toBe(404)
    expect(mocks.query).toHaveBeenCalledTimes(1)
  })
  it("gives a paired camera only the game attached to its session", async () => {
    mocks.query.mockResolvedValueOnce([camera]).mockResolvedValueOnce([game])
    const response = await cameraGet(device(), context)
    expect(response.status).toBe(200)
    expect((await response.json()).game).toEqual(game)
    expect(query(0).params).toEqual(["session", "left"])
    expect(query(1).params).toEqual(["g70"])
  })
  it("timestamps both sides of server processing for an authenticated clock check", async () => {
    mocks.query.mockResolvedValueOnce([camera])
    const before = Date.now()
    const response = await cameraPost(device({ action: "clock" }), context)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.receivedAt).toBeGreaterThanOrEqual(before)
    expect(body.sentAt).toBeGreaterThanOrEqual(body.receivedAt)
    expect(body.sentAt).toBeLessThanOrEqual(Date.now())
    expect(mocks.query).toHaveBeenCalledTimes(1)
  })
})
