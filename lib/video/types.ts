export type CameraSide = "left" | "right"
export interface VideoSession {
  capture_day?: string | null; id: string; game_id: string | null; title: string; created_at: string; ended_at: string | null }
export interface VideoCamera {
  side: CameraSide; last_seen_at: string | null; device_name: string | null;
  recording: boolean; streaming: boolean; battery: number | null;
  stream_input_id: string | null; offset_ms: number; error: string | null;
}
export interface VideoSegment {
  id: string; side: CameraSide; started_at: string; duration: number; bytes: number;
  uploaded_at: string | null; playbackUrl?: string;
}
export type VideoEventKind = "goal" | "penalty"
export interface VideoMarker {
  id: string; label: string; occurred_at: string; source: string;
  eventId?: string; eventKind?: VideoEventKind; goalId?: string;
}
export interface VideoDetail {
  session: VideoSession; cameras: VideoCamera[]; segments: VideoSegment[]; markers: VideoMarker[];
  configured: { r2: boolean; stream: boolean };
}

/** Positive offset means the camera's timestamps are ahead of the event clock. */
export function findReplay(segments: VideoSegment[], side: CameraSide, eventMs: number, offsetMs = 0, leadSeconds = 10) {
  const target = eventMs + offsetMs
  const segment = segments.find(s => s.side === side && s.uploaded_at &&
    target >= Date.parse(s.started_at) && target < Date.parse(s.started_at) + s.duration * 1000)
  if (!segment) return null // Never silently seek across missing footage.
  return { segment, seconds: Math.max(0, (target - Date.parse(segment.started_at)) / 1000 - leadSeconds) }
}

export interface GameVideoData {
  sessions: VideoSession[];
  session: VideoSession | null;
  cameras: { side: CameraSide; live: boolean; offset_ms: number }[];
  segments: VideoSegment[];
  markers: VideoMarker[];
}
