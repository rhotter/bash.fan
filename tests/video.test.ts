import { beforeEach, describe, expect, it, vi } from "vitest"
import { findReplay, type VideoSegment } from "@/lib/video/types"
const mocks = vi.hoisted(() => ({ query: vi.fn(), admin: vi.fn(), verify: vi.fn(), upload: vi.fn(), stream: vi.fn() }))
vi.mock("@/lib/db", () => ({ rawSql: mocks.query }))
vi.mock("@/lib/admin-session", () => ({ requireAdminSession: mocks.admin }))
vi.mock("@/lib/video/cloudflare", () => ({ verifyUpload: mocks.verify, uploadUrl: mocks.upload, streamRequest: mocks.stream, videoConfiguration: () => ({ r2: true, stream: true }), playbackUrl: vi.fn() }))
import { digestToken, tokenMatches } from "@/lib/video/server"
import { GET as sessions } from "@/app/api/bash/video/route"
import { GET as sessionDetail, POST as sessionPost } from "@/app/api/bash/video/[id]/route"
import { POST as cameraPost } from "@/app/api/bash/video/camera/[id]/[side]/route"
const token = "a".repeat(43)
const id = "test-session"
const segmentId = "6f61ea24-d9eb-443f-8801-6fedf62187fa"
const camera = { token_hash: digestToken(token), token_expires_at: new Date(Date.now() + 86400000).toISOString() }
const context = { params: Promise.resolve({ id, side: "left" }) }
function request(body: unknown, credential = token) {
  return new Request("http://localhost/api/bash/video/camera/test-session/left", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` }, body: JSON.stringify(body) })
}
beforeEach(() => { vi.resetAllMocks(); process.env.VIDEO_ENABLED = "1" })
describe("video access and upload integrity", () => {
  it("rejects an unexpected live player origin before issuing a viewer token", async () => {
    mocks.query.mockResolvedValueOnce([{ id }]).mockResolvedValueOnce([{ stream_input_id: "live-input" }])
    mocks.stream.mockResolvedValueOnce({ playback: { hls: "https://untrusted.example/video.m3u8" } })
    const response = await sessionPost(new Request("http://localhost/api/bash/video/test-session", { method: "POST", body: JSON.stringify({ action: "livePlayback", side: "left" }) }), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(503)
    expect(mocks.stream).toHaveBeenCalledTimes(1)
  })
  it("rejects unauthenticated administration before reading the database", async () => {
    mocks.admin.mockRejectedValue(new Response("Unauthorized", { status: 401 }))
    expect((await sessions()).status).toBe(401)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it("fails closed when video is disabled", async () => {
    process.env.VIDEO_ENABLED = "0"
    expect((await cameraPost(request({ action: "complete", segmentId }), context)).status).toBe(503)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it("rejects an incorrect or expired camera token", async () => {
    mocks.query.mockResolvedValueOnce([camera])
    expect((await cameraPost(request({ action: "complete", segmentId }, "b".repeat(43)), context)).status).toBe(401)
    mocks.query.mockResolvedValueOnce([{ ...camera, token_expires_at: null }])
    expect((await cameraPost(request({ action: "complete", segmentId }), context)).status).toBe(401)
  })
  it("does not mark incomplete storage objects as uploaded", async () => {
    mocks.query.mockResolvedValueOnce([camera]).mockResolvedValueOnce([{ object_key: "test.mp4", bytes: 100 }])
    mocks.verify.mockResolvedValue(false)
    expect((await cameraPost(request({ action: "complete", segmentId }), context)).status).toBe(409)
    expect(mocks.query).toHaveBeenCalledTimes(2)
  })
  it("does not issue a new upload URL for a verified retry", async () => {
    const body = { action: "upload", segmentId, startedAt: "2026-10-24T20:00:00.000Z", bytes: 100, duration: 60 }
    mocks.query.mockResolvedValueOnce([camera]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ session_id: id, side: "left", bytes: 100, duration: 60, started_at: body.startedAt, uploaded_at: body.startedAt }])
    const response = await cameraPost(request(body), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ alreadyUploaded: true })
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it("rejects attempts to reuse another camera's segment ID", async () => {
    mocks.query.mockResolvedValueOnce([camera]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ session_id: id, side: "right", bytes: 100 }])
    const response = await cameraPost(request({ action: "upload", segmentId, startedAt: "2026-10-24T20:00:00.000Z", duration: 60, bytes: 100 }), context)
    expect(response.status).toBe(409)
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it("rejects out-of-bound recording sizes", async () => {
    mocks.query.mockResolvedValueOnce([camera])
    expect((await cameraPost(request({ action: "upload", segmentId, startedAt: "2026-10-24T20:00:00.000Z", duration: 60, bytes: 600000000 }), context)).status).toBe(400)
  })
  it("only accepts matching fixed-size credential hashes", () => {
    expect(tokenMatches(token, digestToken(token))).toBe(true)
    expect(tokenMatches("wrong", digestToken(token))).toBe(false)
    expect(tokenMatches(token, "bad")).toBe(false)
  })
})
describe("replay alignment", () => {
  it("preserves original goal observations and excludes deleted goals across timing stores", async () => {
    const original = "2026-10-24T20:00:20.000Z"
    mocks.query.mockResolvedValueOnce([{ id, game_id: "g1" }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ state: { goals: [{ id: "goal-1" }], timing: { entries: [
        { id: "legacy", kind: "goal", action: "add", capturedAt: Date.parse(original) + 5000, period: 1, details: { eventId: "goal-1" } },
      ] } } }])
      .mockResolvedValueOnce([{ name: "game_timing_events" }])
      .mockResolvedValueOnce([
        { entry_id: "original", kind: "goal", action: "add", captured_at: original, recorded_at: original, source: "scorekeeper", period: 1, clock_seconds: 400, details: { eventId: "goal-1" } },
        { entry_id: "deleted", kind: "goal", action: "add", captured_at: original, recorded_at: original, source: "scorekeeper", period: 1, clock_seconds: 400, details: { eventId: "deleted-goal" } },
      ])
    const response = await sessionDetail(new Request("http://localhost/api/bash/video/test-session"), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(200)
    expect((await response.json()).markers).toEqual([{ id: "original", label: "Goal · Period 1", occurred_at: original, source: "scorekeeper" }])
  })
  const segment: VideoSegment = { id: "one", side: "left", started_at: "2026-10-24T20:00:00Z", duration: 60, bytes: 100, uploaded_at: "2026-10-24T21:00:00Z" }
  it("applies a camera offset and replay lead-in", () => {
    const result = findReplay([segment], "left", Date.parse(segment.started_at) + 20000, 5000)
    expect(result?.seconds).toBe(15)
  })
  it("does not fabricate coverage across gaps, other cameras or incomplete uploads", () => {
    const at = Date.parse(segment.started_at) + 70000
    expect(findReplay([segment], "left", at)).toBeNull()
    expect(findReplay([segment], "right", at - 60000)).toBeNull()
    expect(findReplay([{ ...segment, uploaded_at: null }], "left", at - 60000)).toBeNull()
  })
})
