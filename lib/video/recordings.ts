import { neon } from "@neondatabase/serverless"
import { requireAdminSession } from "@/lib/admin-session"
import { fail } from "@/lib/video/server"

/** Dedicated read-only source; never changes the application's normal database target. */
export async function recordingSource() {
  if (process.env.VIDEO_ENABLED !== "1" || process.env.VERCEL_ENV === "production") fail("Not found", 404)
  await requireAdminSession()
  if (!process.env.VIDEO_VIEWER_DATABASE_URL) fail("The recording library is not configured", 503)
  return neon(process.env.VIDEO_VIEWER_DATABASE_URL)
}

export interface RecordingDay { day: string; uploaded: number; pending: number; seconds: number; live: boolean }
export interface RecordingClip { id: string; session_id: string; side: "left" | "right"; started_at: string; duration: number; bytes: number; uploaded_at: string | null }
export interface RecordingCamera { session_id: string; side: "left" | "right"; live: boolean; recording: boolean }
export interface RecordingDayDetail { cameras: RecordingCamera[]; segments: RecordingClip[] }
