import { describe, expect, it, vi, beforeEach } from "vitest"
import { cameraDiagnostics } from "@/lib/video/diagnostics"
const mocks = vi.hoisted(() => ({ query: vi.fn(), admin: vi.fn() }))
vi.mock("@/lib/db", () => ({ rawSql: mocks.query }))
vi.mock("@/lib/admin-session", () => ({ requireAdminSession: mocks.admin }))
vi.mock("@/lib/video/review-access", () => ({ reviewSessionId: async () => null }))
import { GET } from "@/app/api/bash/video/[id]/diagnostics/route"
import { POST } from "@/app/api/bash/video/camera/[id]/[side]/route"
import { digestToken } from "@/lib/video/server"
const snapshot = {
  version: 1, sampledAt: 1793470000000, appBuild: "1104", osVersion: "26.1", quality: "uhd30", thermalState: 0, lowPower: false, freeBytes: 1024,
  network: { status: "satisfied", interface: "cellular", expensive: true, constrained: false },
  stream: { connected: true, encodedFPS: 0, queuedBytes: 1000, queuedBytesPerSecond: 0, sampleAge: 0.2, secondsWithoutVideoProgress: 20, secondsWithoutByteProgress: 20 },
  uploads: { pending: 3, taskCount: 1, tasks: [{ task: 1, state: 0, sent: 100, expected: 1000, bytesPerSecond: 0, secondsWithoutProgress: 20 }] },
  events: [{ at: 1793470000000, name: "upload_network_error", detail: "NSURLErrorDomain", code: -1009 }],
}
beforeEach(() => { vi.resetAllMocks(); process.env.VIDEO_ENABLED = "1" })
describe("private camera diagnostics", () => {
  it("accepts a stalled-stream snapshot and rejects unbounded or unexpected data", () => {
    expect(cameraDiagnostics.parse(snapshot)).toEqual(snapshot)
    expect(cameraDiagnostics.safeParse({ ...snapshot, events: Array(25).fill(snapshot.events[0]) }).success).toBe(false)
    expect(cameraDiagnostics.safeParse({ ...snapshot, stream: { ...snapshot.stream, url: "https://secret" } }).success).toBe(false)
    expect(cameraDiagnostics.safeParse({ ...snapshot, events: [{ ...snapshot.events[0], detail: "https://secret?token=abc" }] }).success).toBe(false)
  })
  it("requires admin authentication before reading diagnostic snapshots", async () => {
    mocks.admin.mockRejectedValue(new Response("Unauthorized", { status: 401 }))
    const response = await GET(new Request("https://example.com"), { params: Promise.resolve({ id: "session" }) })
    expect(response.status).toBe(401)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it("returns private, uncached diagnostics to an administrator", async () => {
    mocks.query.mockResolvedValue([{ side: "right", snapshot }])
    const response = await GET(new Request("https://example.com"), { params: Promise.resolve({ id: "session" }) })
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect((await response.json()).cameras[0].snapshot).toEqual(snapshot)
  })
  it.each([undefined, snapshot])("accepts old and diagnostic-enabled camera heartbeats", async diagnostics => {
    const token = "a".repeat(43)
    mocks.query.mockResolvedValueOnce([{ token_hash: digestToken(token), token_expires_at: new Date(Date.now() + 60000).toISOString() }]).mockResolvedValue([])
    const response = await POST(new Request("https://example.com", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "heartbeat", deviceName: "iPhone", recording: true, streaming: true, battery: 0.5, error: null, diagnostics }) }), { params: Promise.resolve({ id: "session", side: "right" }) })
    expect(response.status).toBe(200)
    expect(mocks.query).toHaveBeenCalledTimes(2)
  })
})
