import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ query: vi.fn(), auth: vi.fn(), playback: vi.fn(), stream: vi.fn() }))
vi.mock("@neondatabase/serverless", () => ({ neon: () => mocks.query }))
vi.mock("@/lib/admin-session", () => ({ requireAdminSession: mocks.auth }))
vi.mock("@/lib/db", () => ({ rawSql: vi.fn() }))
vi.mock("@/lib/video/review-access", () => ({ reviewSessionId: vi.fn() }))
vi.mock("@/lib/video/cloudflare", () => ({ playbackUrl: mocks.playback, streamRequest: mocks.stream }))
import { GET, POST } from "@/app/api/bash/recordings/route"
const id = "171d2d66-7c1c-49ef-aa75-9b6a79e495c2"
const get = (suffix = "") => GET(new Request(`https://example.com/api/bash/recordings${suffix}`))
const post = (body: unknown) => POST(new Request("https://example.com/api/bash/recordings", { method: "POST", body: JSON.stringify(body) }))
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("VIDEO_ENABLED", "1")
  vi.stubEnv("VERCEL_ENV", "preview")
  vi.stubEnv("VIDEO_VIEWER_DATABASE_URL", "postgres://readonly")
})
describe("development recording library", () => {
  it("blocks both handlers in production before accessing data", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    expect((await get()).status).toBe(404)
    expect((await post({ action: "playback", segmentId: id })).status).toBe(404)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it("requires operator authentication for metadata and playback", async () => {
    mocks.auth.mockRejectedValue(new Response(null, { status: 401 }))
    expect((await get()).status).toBe(401)
    expect((await post({ action: "playback", segmentId: id })).status).toBe(401)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it("does not fall back to a writable or development database", async () => {
    vi.stubEnv("VIDEO_VIEWER_DATABASE_URL", "")
    expect((await get()).status).toBe(503)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it("returns day summaries without caching private data", async () => {
    const days = [{ day: "2026-10-31", uploaded: 6, pending: 14, seconds: 360, live: false }]
    mocks.query.mockResolvedValue(days)
    const response = await get()
    expect(await response.json()).toEqual({ days })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
  it("validates day input before querying", async () => {
    expect((await get("?day=anything")).status).toBe(400)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it("loads both cameras and clips for a day", async () => {
    mocks.query.mockResolvedValueOnce([{ side: "left", live: false }]).mockResolvedValueOnce([{ id }])
    expect(await (await get("?day=2026-10-31")).json()).toEqual({ cameras: [{ side: "left", live: false }], segments: [{ id }] })
  })
  it("does not sign missing or unfinished uploads", async () => {
    mocks.query.mockResolvedValue([])
    expect((await post({ action: "playback", segmentId: id })).status).toBe(404)
    expect(mocks.playback).not.toHaveBeenCalled()
    expect(mocks.query.mock.calls[0][0].join("")).toContain("uploaded_at IS NOT NULL")
  })
  it("signs stored object keys, not client-provided paths", async () => {
    mocks.query.mockResolvedValue([{ object_key: "stored/clip.mp4" }])
    mocks.playback.mockResolvedValue("https://storage.example/signed")
    expect((await post({ action: "playback", segmentId: id, object_key: "injected" })).status).toBe(200)
    expect(mocks.playback).toHaveBeenCalledWith("stored/clip.mp4")
  })
  it("refuses stale live feeds", async () => {
    mocks.query.mockResolvedValue([])
    expect((await post({ action: "livePlayback", sessionId: id, side: "right" })).status).toBe(404)
    expect(mocks.stream).not.toHaveBeenCalled()
    expect(mocks.query.mock.calls[0][0].join("")).toContain("interval '25 seconds'")
  })
  it("returns a signed HLS URL for a current camera", async () => {
    mocks.query.mockResolvedValue([{ stream_input_id: "input" }])
    mocks.stream.mockResolvedValueOnce({ playback: { hls: "https://customer-test.cloudflarestream.com/input/manifest/video.m3u8" } }).mockResolvedValueOnce({ token: "signed" })
    expect(await (await post({ action: "livePlayback", sessionId: id, side: "left" })).json()).toEqual({ url: "https://customer-test.cloudflarestream.com/signed/manifest/video.m3u8" })
  })
})
