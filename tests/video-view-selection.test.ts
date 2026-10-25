import { describe, expect, it } from "vitest"
import { automaticSelections, replaySelections } from "@/lib/video/view-selection"
import type { GameVideoData, VideoSegment } from "@/lib/video/types"
const epoch = Date.parse("2026-10-24T20:00:00Z")
const time = (seconds: number) => new Date(epoch + seconds * 1000).toISOString()
const segment = (side: "left" | "right", start: number, duration = 60): VideoSegment => ({ id: side, side, started_at: time(start), duration, bytes: 100, uploaded_at: time(90) })
function data(): GameVideoData {
  return { sessions: [], session: { id: "session", game_id: "g70", title: "Game", created_at: time(0), ended_at: null },
    cameras: [{ side: "left", live: false, offset_ms: 0 }, { side: "right", live: false, offset_ms: 2000 }],
    segments: [segment("left", 0), segment("right", 7)], markers: [] }
}
describe("two-camera playback selection", () => {
  it("starts both views at their first shared time, accounting for camera clock offsets", () => {
    const view = automaticSelections(data())
    expect(view.left?.seconds).toBe(5)
    expect(view.right?.seconds).toBe(0)
  })
  it("never displays an old recording beside a live camera", () => {
    const fixture = data(); fixture.cameras[1].live = true
    expect(automaticSelections(fixture)).toEqual({ left: null, right: { request: { action: "livePlayback", sessionId: "session", side: "right" }, seconds: 0 } })
  })
  it("opens both live cameras", () => {
    const fixture = data(); fixture.cameras.forEach(c => { c.live = true })
    const views = automaticSelections(fixture)
    expect(views.left?.request.action).toBe("livePlayback")
    expect(views.right?.request.action).toBe("livePlayback")
  })
  it("uses the same replay lead-in at segment boundaries", () => {
    const view = replaySelections(data(), { occurred_at: time(8) }, 1)
    expect(view.left?.seconds).toBe(5)
    expect(view.right?.seconds).toBe(0)
    expect(view.left?.replayId).toBe(1)
    expect(view.right?.replayId).toBe(1)
  })
  it("leaves missing coverage empty rather than playing unrelated footage", () => {
    const view = replaySelections(data(), { occurred_at: time(2) }, 2)
    expect(view.left?.seconds).toBe(0)
    expect(view.right).toBeNull()
  })
  it("ignores incomplete uploads", () => {
    const fixture = data(); fixture.segments.forEach(s => { s.uploaded_at = null })
    expect(automaticSelections(fixture)).toEqual({ left: null, right: null })
  })
})
