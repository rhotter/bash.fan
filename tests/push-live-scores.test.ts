import { beforeEach, describe, expect, it, vi } from "vitest"
import { goalText, liveScoreContent } from "@/lib/push/game-content"
const { query, send } = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn() }))
vi.mock("@/lib/db", () => ({ rawSql: query }))
vi.mock("@/lib/push/apns", () => ({ pushConfigured: () => true, sendLiveScore: send }))
import { dispatchLiveScores } from "@/lib/push/live-scores"
import { PUT, DELETE } from "@/app/api/bash/notifications/activities/route"
const goal = { id: "goal", scorerId: 1, assist1Id: 2, assist2Id: 3, period: 2, clock: "18:35", team: "seals" }
const names = { "1": "Scorer", "2": "First Assist", "3": "Second Assist" }
const row = { status: "live", home_score: 2, away_score: 1, is_playoff: false, state: { period: 2, clockSeconds: 100, clockRunning: true, clockStartedAt: 100000, goals: [goal] } }
beforeEach(() => { query.mockReset(); send.mockReset() })
describe("live score content", () => {
 it("includes both assists in order without inventing unassisted when they are unavailable", () => {
  expect(goalText(goal, names)).toEqual({ scorer: "Scorer", play: "Scorer · P2 18:35", assists: "Assists: First Assist, Second Assist" })
  expect(goalText({ ...goal, assist1Id: null, assist2Id: null }, names).assists).toBe("")
 })
 it("anchors the countdown to server clock time, freezes stopped clocks, and ends final games", () => {
  expect(liveScoreContent(row, names, 110000)).toMatchObject({ clock: "1:30", clockEndsAt: 200, final: false })
  expect(liveScoreContent({ ...row, state: { ...row.state, clockRunning: false } }, names, 110000)).toMatchObject({ clock: "1:40", clockEndsAt: null })
  expect(liveScoreContent({ ...row, status: "final" }, names, 110000)).toMatchObject({ final: true, clockEndsAt: null, status: "Final" })
  expect(liveScoreContent({ ...row, status: "final", state: { ...row.state, finalizationPending: true } }, names).final).toBe(false)
 })
 it("does not count below zero and labels playoff overtime", () => {
  expect(liveScoreContent(row, names, 250000).clock).toBe("0:00")
  expect(liveScoreContent({ ...row, is_playoff: true, state: { ...row.state, period: 5 } }, names).period).toBe("2OT")
 })
})
const job = { installation_id: "00000000-0000-4000-8000-000000000001", activity_id: "activity", token: "a".repeat(64), environment: "sandbox", game_id: "g1" }
const request = (method = "PUT", secret = "b".repeat(64), changes = {}) => new Request("http://localhost/api/bash/notifications/activities", { method, headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ id: job.installation_id, activityID: job.activity_id, token: job.token, gameID: "g1", environment: "sandbox", ...changes }) })
describe("live score registration", () => {
 it("requires installation authentication", async () => { expect((await PUT(request("PUT", "bad"))).status).toBe(401); expect(query).not.toHaveBeenCalled() })
 it("rejects invalid tokens", async () => { expect((await PUT(request("PUT", undefined, { token: "bad" }))).status).toBe(400); expect(query).not.toHaveBeenCalled() })
 it("does not claim success when an inactive game or conflicting credential prevents registration", async () => { query.mockResolvedValue([]); expect((await PUT(request())).status).toBe(409) })
 it("registers an eligible activity and supports idempotent removal", async () => { query.mockResolvedValue([{ activity_id: "activity" }]); expect((await PUT(request())).status).toBe(200); expect((await DELETE(request("DELETE"))).status).toBe(200) })
})
describe("remote live scores", () => {
 it("sends final state with end flag and stable activity identity", async () => {
  query.mockResolvedValue([]).mockResolvedValueOnce([job]).mockResolvedValueOnce([{ ...row, status: "final", names, signature: "final" }]); send.mockResolvedValue({ status: 200 })
  expect(await dispatchLiveScores()).toEqual({ sent: 1 })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ activityID: "activity", final: true, content: expect.objectContaining({ homeScore: 2, assists: "Assists: First Assist, Second Assist" }) }))
 })
 it("retries failures without recording a delivered snapshot", async () => {
  query.mockResolvedValue([]).mockResolvedValueOnce([job]).mockResolvedValueOnce([{ ...row, names, signature: "live" }]); send.mockResolvedValue({ status: 503 })
  expect(await dispatchLiveScores()).toEqual({ sent: 0 }); expect(query).toHaveBeenCalledTimes(3)
 })
 it("removes invalid tokens", async () => {
  query.mockResolvedValue([]).mockResolvedValueOnce([job]).mockResolvedValueOnce([{ ...row, names, signature: "live" }]); send.mockResolvedValue({ status: 410 })
  expect(await dispatchLiveScores()).toEqual({ sent: 0 }); expect(query).toHaveBeenCalledTimes(4)
 })
})
