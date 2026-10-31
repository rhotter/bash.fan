import { beforeEach, describe, expect, it, vi } from "vitest"
const { query, send, configured } = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn(), configured: vi.fn(() => true) }))
vi.mock("@/lib/db", () => ({ rawSql: query }))
vi.mock("@/lib/push/apns", () => ({ sendPush: send, pushConfigured: configured }))
import { PUT } from "@/app/api/bash/notifications/devices/route"
import { dispatchGameAlerts } from "@/lib/push/dispatch"
const device = { id: "00000000-0000-4000-8000-000000000001", token: "a".repeat(64), environment: "production", teams: ["seals"], games: [], enabled: true }
const request = (body: typeof device & { kinds?: string[] } = device, secret = "b".repeat(64)) => new Request("http://localhost/api/bash/notifications/devices", { method: "PUT", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body) })
beforeEach(() => { vi.clearAllMocks(); configured.mockReturnValue(true); query.mockReset(); send.mockReset() })
describe("push preferences", () => {
 it("rejects unknown alert kinds", async () => { expect((await PUT(request({ ...device, kinds: ["penalty"] }))).status).toBe(400); expect(query).not.toHaveBeenCalled() })
 it("accepts a subset of alert kinds", async () => { query.mockResolvedValue([{ id: device.id }]); expect((await PUT(request({ ...device, kinds: ["final"] }))).status).toBe(200) })
 it("accepts all alert kinds disabled", async () => { query.mockResolvedValue([{ id: device.id }]); expect((await PUT(request({ ...device, kinds: [], enabled: false }))).status).toBe(200) })
 it("accepts older clients without alert kinds", async () => { query.mockResolvedValue([{ id: device.id }]); expect((await PUT(request())).status).toBe(200) })
 it("rejects unauthenticated installations before writing", async () => { expect((await PUT(request(device,"bad"))).status).toBe(401); expect(query).not.toHaveBeenCalled() })
 it("rejects malformed tokens", async () => { expect((await PUT(request({ ...device, token: "not-a-token" }))).status).toBe(400); expect(query).not.toHaveBeenCalled() })
 it("does not claim alerts are active without provider configuration", async () => { configured.mockReturnValue(false); expect((await PUT(request())).status).toBe(503); expect(query).not.toHaveBeenCalled() })
 it("rejects updates when the installation secret does not match", async () => { query.mockResolvedValue([]); expect((await PUT(request())).status).toBe(401) })
 it("allows disabling when provider is unavailable", async () => { configured.mockReturnValue(false); query.mockResolvedValue([{ id: device.id }]); expect((await PUT(request({ ...device, enabled: false }))).status).toBe(200) })
})
const job = { event_id: "e1", device_id: device.id, attempts: 1 }
const event = { ...device, kinds: ["goal", "start", "final"], id: "e1", game_id: "g1", kind: "goal", goal_id: "goal1", created_at: new Date().toISOString(), home_team: "seals", away_team: "yetis", home_name: "Seals", away_name: "Yetis", home_score: 1, away_score: 0, state: { goals: [{ id: "goal1", team: "seals", scorerId: 7 }] } }
function setup(row = event) { query.mockResolvedValue([]).mockResolvedValueOnce([job]).mockResolvedValueOnce([row]) }
describe("push delivery", () => {
 it.each(["goal", "start", "final"])("skips an opted-out %s event queued before the preference changed", async kind => {
  setup({ ...event, kind, kinds: [] }); await dispatchGameAlerts(); expect(send).not.toHaveBeenCalled()
 })
 it("does not send goals to a final-score-only subscriber", async () => {
  setup({ ...event, kinds: ["final"] }); await dispatchGameAlerts(); expect(send).not.toHaveBeenCalled()
 })
 it.each(["start", "final"])("sends an opted-in %s event", async kind => {
  setup({ ...event, kind, kinds: [kind], goal_id: "", ...{ status: kind === "final" ? "final" : "live" } })
  send.mockResolvedValue({ status: 200 })
  expect((await dispatchGameAlerts()).sent).toBe(1)
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ title: kind === "final" ? "Final score" : "Game started" }))
 })
 it.each([[2, false, "Period 2 started"], [3, false, "Period 3 started"], [4, false, "Overtime started"], [5, false, "Shootout started"], [5, true, "2OT started"], [6, true, "3OT started"]])("announces period %s (playoffs: %s)", async (period, isPlayoff, title) => {
  setup({ ...event, kind: "start", goal_id: "", ...{ event_key: `period:${period}`, status: "live", is_playoff: isPlayoff }, state: { ...event.state, ...{ period } } })
  send.mockResolvedValue({ status: 200 })
  expect((await dispatchGameAlerts()).sent).toBe(1)
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ title, gameID: "g1" }))
 })
 it.each([{ period: 1, status: "live" }, { period: 3, status: "live" }, { period: 2, status: "final" }])("skips stale or retracted period alerts: %j", async ({ period, status }) => {
  setup({ ...event, kind: "start", goal_id: "", ...{ event_key: "period:2", status }, state: { ...event.state, ...{ period } } })
  await dispatchGameAlerts(); expect(send).not.toHaveBeenCalled()
 })
 it("respects the existing puck-drop opt-out for period alerts", async () => {
  setup({ ...event, kind: "start", kinds: ["goal", "final"], ...{ event_key: "period:2", status: "live" }, state: { ...event.state, ...{ period: 2 } } })
  await dispatchGameAlerts(); expect(send).not.toHaveBeenCalled()
 })
 it("skips a goal removed before delivery", async () => { setup({ ...event, state: { goals: [] } }); await dispatchGameAlerts(); expect(send).not.toHaveBeenCalled() })
 it("skips expired notifications", async () => { setup({ ...event, created_at: "2020-01-01" }); await dispatchGameAlerts(); expect(send).not.toHaveBeenCalled() })
 it("rechecks unfollowed games before sending", async () => { setup({ ...event, teams: [] }); await dispatchGameAlerts(); expect(send).not.toHaveBeenCalled() })
 it("sends a deep link and stable collapse ID", async () => {
  setup(); query.mockResolvedValueOnce([{ name: "Test Player" }]); send.mockResolvedValue({ status: 200 })
  expect(await dispatchGameAlerts()).toEqual({ configured: true, sent: 1 })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ eventID: "e1", gameID: "g1", title: "Seals goal!" }))
 })
 it("includes both assists and bundled-logo metadata in goal alerts", async () => {
  setup({ ...event, state: { goals: [{ ...event.state.goals[0], ...{ period: 2, clock: "18:35", assist1Id: 8, assist2Id: 9 } }] } })
  query.mockResolvedValueOnce([{ id: 7, name: "Scorer" }, { id: 8, name: "First Assist" }, { id: 9, name: "Second Assist" }])
  send.mockResolvedValue({ status: 200 })
  await dispatchGameAlerts()
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
   goal: { teamSlug: "seals", scoreLine: "Yetis 0 · Seals 1", scorerLine: "Scorer · P2 18:35", assistLine: "Assists: First Assist, Second Assist" },
   body: "Yetis 0 · Seals 1\nScorer · P2 18:35\nAssists: First Assist, Second Assist",
  }))
 })
 it("deactivates invalid tokens", async () => { setup(); send.mockResolvedValue({ status: 410, reason: "Unregistered" }); await dispatchGameAlerts(); expect(query).toHaveBeenCalledTimes(6) })
 it("retries provider failures without reporting success", async () => { setup(); send.mockResolvedValue({ status: 503, reason: "ServiceUnavailable" }); expect((await dispatchGameAlerts()).sent).toBe(0) })
})
