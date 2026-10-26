import { beforeEach, describe, expect, it, vi } from "vitest"
const { query, send, configured } = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn(), configured: vi.fn(() => true) }))
vi.mock("@/lib/db", () => ({ rawSql: query }))
vi.mock("@/lib/push/apns", () => ({ sendPush: send, pushConfigured: configured }))
import { PUT } from "@/app/api/bash/notifications/devices/route"
import { dispatchGameAlerts } from "@/lib/push/dispatch"
const device = { id: "00000000-0000-4000-8000-000000000001", token: "a".repeat(64), environment: "production", teams: ["seals"], games: [], enabled: true }
const request = (body = device, secret = "b".repeat(64)) => new Request("http://localhost/api/bash/notifications/devices", { method: "PUT", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body) })
beforeEach(() => { vi.clearAllMocks(); configured.mockReturnValue(true); query.mockReset(); send.mockReset() })
describe("push preferences", () => {
 it("rejects unauthenticated installations before writing", async () => { expect((await PUT(request(device,"bad"))).status).toBe(401); expect(query).not.toHaveBeenCalled() })
 it("rejects malformed tokens", async () => { expect((await PUT(request({ ...device, token: "not-a-token" }))).status).toBe(400); expect(query).not.toHaveBeenCalled() })
 it("does not claim alerts are active without provider configuration", async () => { configured.mockReturnValue(false); expect((await PUT(request())).status).toBe(503); expect(query).not.toHaveBeenCalled() })
 it("rejects updates when the installation secret does not match", async () => { query.mockResolvedValue([]); expect((await PUT(request())).status).toBe(401) })
 it("allows disabling when provider is unavailable", async () => { configured.mockReturnValue(false); query.mockResolvedValue([{ id: device.id }]); expect((await PUT(request({ ...device, enabled: false }))).status).toBe(200) })
})
const job = { event_id: "e1", device_id: device.id, attempts: 1 }
const event = { ...device, id: "e1", game_id: "g1", kind: "goal", goal_id: "goal1", created_at: new Date().toISOString(), home_team: "seals", away_team: "yetis", home_name: "Seals", away_name: "Yetis", home_score: 1, away_score: 0, state: { goals: [{ id: "goal1", team: "seals", scorerId: 7 }] } }
function setup(row = event) { query.mockResolvedValue([]).mockResolvedValueOnce([job]).mockResolvedValueOnce([row]) }
describe("push delivery", () => {
 it("skips a goal removed before delivery", async () => { setup({ ...event, state: { goals: [] } }); await dispatchGameAlerts(); expect(send).not.toHaveBeenCalled() })
 it("skips expired notifications", async () => { setup({ ...event, created_at: "2020-01-01" }); await dispatchGameAlerts(); expect(send).not.toHaveBeenCalled() })
 it("rechecks unfollowed games before sending", async () => { setup({ ...event, teams: [] }); await dispatchGameAlerts(); expect(send).not.toHaveBeenCalled() })
 it("sends a deep link and stable collapse ID", async () => {
  setup(); query.mockResolvedValueOnce([{ name: "Test Player" }]); send.mockResolvedValue({ status: 200 })
  expect(await dispatchGameAlerts()).toEqual({ configured: true, sent: 1 })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ eventID: "e1", gameID: "g1", title: "Seals goal!" }))
 })
 it("deactivates invalid tokens", async () => { setup(); send.mockResolvedValue({ status: 410, reason: "Unregistered" }); await dispatchGameAlerts(); expect(query).toHaveBeenCalledTimes(6) })
 it("retries provider failures without reporting success", async () => { setup(); send.mockResolvedValue({ status: 503, reason: "ServiceUnavailable" }); expect((await dispatchGameAlerts()).sent).toBe(0) })
})
