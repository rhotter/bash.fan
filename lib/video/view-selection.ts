import { findReplay, type CameraSide, type GameVideoData, type VideoMarker } from "@/lib/video/types"

export const cameraSides = ["left", "right"] as const
export type PlaybackRequest =
  | { action: "livePlayback"; sessionId: string; side: CameraSide }
  | { action: "playback"; sessionId: string; segmentId: string }
export type Selection = { request: PlaybackRequest; seconds: number; replayId?: number }
export type Selections = Record<CameraSide, Selection | null>

export function replaySelections(data: GameVideoData, marker: Pick<VideoMarker, "occurred_at">, replayId?: number): Selections {
  const result: Selections = { left: null, right: null }
  if (!data.session) return result
  const matches = cameraSides.map(side => findReplay(data.segments, side, Date.parse(marker.occurred_at),
    data.cameras.find(c => c.side === side)?.offset_ms ?? 0, 0))
  // Both views begin at the same event-relative time, even at segment boundaries.
  const lead = replayId === undefined ? 0 : Math.min(10, ...matches.flatMap(m => m ? [m.seconds] : []))
  matches.forEach((match, i) => {
    if (match) result[cameraSides[i]] = {
      request: { action: "playback", sessionId: data.session!.id, segmentId: match.segment.id },
      seconds: match.seconds - lead, replayId,
    }
  })
  return result
}

export function automaticSelections(data?: GameVideoData): Selections {
  const result: Selections = { left: null, right: null }
  if (!data?.session) return result
  const sessionId = data.session.id
  if (data.cameras.some(c => c.live)) {
    for (const side of cameraSides) if (data.cameras.some(c => c.side === side && c.live)) {
      result[side] = { request: { action: "livePlayback", sessionId, side }, seconds: 0 }
    }
    return result
  }
  const segments = data.segments.filter(s => s.uploaded_at).map(s => {
    const start = Date.parse(s.started_at) - (data.cameras.find(c => c.side === s.side)?.offset_ms ?? 0)
    return { side: s.side, start, end: start + s.duration * 1000 }
  }).sort((a, b) => a.start - b.start)
  const first = segments[0]
  if (!first) return result
  // Prefer the first interval with both cameras, rather than hiding a camera that started later.
  let commonStart = Infinity
  const left = segments.filter(s => s.side === "left")
  const right = segments.filter(s => s.side === "right")
  let l = 0, r = 0
  while (l < left.length && r < right.length) {
    const start = Math.max(left[l].start, right[r].start)
    if (start < Math.min(left[l].end, right[r].end)) { commonStart = start; break }
    if (left[l].end <= right[r].end) l++
    else r++
  }
  return replaySelections(data, { occurred_at: new Date(Number.isFinite(commonStart) ? commonStart : first.start).toISOString() })
}
