import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ query: vi.fn(), detail: vi.fn(), playback: vi.fn(), stream: vi.fn() }))
vi.mock("@/lib/db", () => ({ rawSql: mocks.query }))
vi.mock("@/lib/video/detail", () => ({ readVideoDetail: mocks.detail }))
vi.mock("@/lib/video/cloudflare", () => ({ playbackUrl: mocks.playback, streamRequest: mocks.stream }))
import { GET, POST } from "@/app/api/bash/game/[id]/video/route"
import { PgDialect } from "drizzle-orm/pg-core"
const sessionId = "171d2d66-7c1c-49ef-aa75-9b6a79e495c2"
const segmentId = "6f61ea24-d9eb-443f-8801-6fedf62187fa"
const session = { id: sessionId, game_id: "g70", title: "Game recording", created_at: "2026-10-24T20:00:00Z", ended_at: null }
const context = { params: Promise.resolve({ id: "g70" }) }
const request = (body: unknown) => new Request("http://localhost/api/bash/game/g70/video", { method: "POST", body: JSON.stringify(body) })
beforeEach(() => { vi.resetAllMocks(); process.env.VIDEO_ENABLED = "1" })
describe("game-scoped viewing", () => {
  it("disables viewing before reading any data when the feature is off", async () => {
    process.env.VIDEO_ENABLED = "0"
    expect((await GET(new Request("http://localhost/api/bash/game/g70/video"), context)).status).toBe(404)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it("returns an empty video section for games without recordings", async () => {
    mocks.query.mockResolvedValueOnce([])
    const response = await GET(new Request("http://localhost/api/bash/game/g70/video"), context)
    expect(await response.json()).toEqual({ sessions: [], session: null, cameras: [], segments: [], markers: [] })
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it("rejects a selected session outside this game's recording list", async () => {
    mocks.query.mockResolvedValueOnce([session])
    expect((await GET(new Request("http://localhost/api/bash/game/g70/video?session=other-game"), context)).status).toBe(404)
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it("exposes playback metadata without camera secrets or unverified segments", async () => {
    mocks.query.mockResolvedValueOnce([session])
    mocks.detail.mockResolvedValueOnce({ cameras: [{ side: "left", offset_ms: 0, streaming: true, last_seen_at: new Date().toISOString(), stream_input_id: "private-input", token_hash: "private-hash", device_name: "Private phone", error: "private-error" }],
      segments: [{ id: segmentId, side: "left", started_at: session.created_at, duration: 60, bytes: 100, uploaded_at: session.created_at, object_key: "private-key" }, { id: "pending", uploaded_at: null }],
      markers: [{ id: "goal", label: "Goal", occurred_at: session.created_at, source: "scorekeeper", goalId: "goal-1", details: { private: true } }, { id: "penalty", label: "Penalty", occurred_at: session.created_at, source: "scorekeeper", eventId: "penalty-1", eventKind: "penalty", details: { private: true } }],
    })
    const response = await GET(new Request("http://localhost/api/bash/game/g70/video"), context)
    const data = await response.json()
    expect(data.cameras).toEqual([{ side: "left", offset_ms: 0, live: true }])
    expect(data.segments).toHaveLength(1)
    expect(data.markers[0].goalId).toBe("goal-1")
    expect(data.markers[1]).toEqual({ id: "penalty", label: "Penalty", occurred_at: session.created_at, source: "scorekeeper", eventId: "penalty-1", eventKind: "penalty" })
    expect(JSON.stringify(data)).not.toMatch(/private|Private|pending/)
  })
  it("does not grant playback for a recording from another game", async () => {
    mocks.query.mockResolvedValueOnce([])
    const response = await POST(request({ action: "playback", sessionId, segmentId }), context)
    expect(response.status).toBe(404)
    const query = new PgDialect().sqlToQuery(mocks.query.mock.calls[0][0])
    expect(query.sql).toMatch(/game_id = \$2/)
    expect(query.params).toEqual([sessionId, "g70"])
    expect(mocks.playback).not.toHaveBeenCalled()
  })
  it("signs only a verified segment from the selected recording", async () => {
    mocks.query.mockResolvedValueOnce([session]).mockResolvedValueOnce([{ object_key: "game/clip.mp4" }])
    mocks.playback.mockResolvedValueOnce("https://storage.example/signed")
    expect((await POST(request({ action: "playback", sessionId, segmentId }), context)).status).toBe(200)
    const query = new PgDialect().sqlToQuery(mocks.query.mock.calls[1][0])
    expect(query.sql).toContain("uploaded_at IS NOT NULL")
    expect(query.params).toEqual([segmentId, sessionId])
    expect(mocks.playback).toHaveBeenCalledWith("game/clip.mp4")
  })
  it("rejects camera administration through the public viewing endpoint", async () => {
    expect((await POST(request({ action: "pair", sessionId, side: "left" }), context)).status).toBe(400)
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
