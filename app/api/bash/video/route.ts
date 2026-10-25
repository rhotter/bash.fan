import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { rawSql } from "@/lib/db"
import { adminVideo, fail, videoHandler } from "@/lib/video/server"
import { videoConfiguration } from "@/lib/video/cloudflare"
export const runtime = "nodejs"

export async function GET(request: Request) { return videoHandler(async () => {
  await adminVideo()
  const gameId = new URL(request.url).searchParams.get("gameId")
  const sessions = gameId
    ? await rawSql(sql`SELECT * FROM video_sessions WHERE game_id = ${gameId} ORDER BY created_at DESC LIMIT 100`)
    : await rawSql(sql`SELECT * FROM video_sessions ORDER BY created_at DESC LIMIT 100`)
  return Response.json({ sessions, configured: videoConfiguration() })
}) }
export async function POST(request: Request) { return videoHandler(async () => {
  await adminVideo()
  const body = z.object({ title: z.string().trim().min(1).max(120), gameId: z.string().max(100).nullable().optional() }).parse(await request.json())
  if (body.gameId && !(await rawSql(sql`SELECT id FROM games WHERE id = ${body.gameId}`)).length) fail("Game not found", 404)
  const id = randomUUID()
  const [session] = await rawSql(sql`INSERT INTO video_sessions (id, title, game_id) VALUES (${id}, ${body.title}, ${body.gameId ?? null}) RETURNING *`)
  // Camera rows are initialized idempotently in the detail endpoint, so a partial creation is recoverable.
  return Response.json({ session }, { status: 201 })
}) }
