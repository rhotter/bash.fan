import { sql } from "drizzle-orm"
import { rawSql } from "@/lib/db"
import { adminVideo, videoHandler } from "@/lib/video/server"
export const runtime = "nodejs"
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return videoHandler(async () => {
    const { id } = await context.params
    await adminVideo(id)
    const cameras = await rawSql(sql`SELECT side, received_at, snapshot FROM video_camera_diagnostics WHERE session_id = ${id} ORDER BY side`)
    return Response.json({ cameras })
  })
}
