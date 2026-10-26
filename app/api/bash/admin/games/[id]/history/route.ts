import { createInitialState } from "@/lib/scorekeeper-types"
import { getSession } from "@/lib/admin-session"
import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

const headers = { "Cache-Control": "private, no-store" }
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return Response.json({ error: "Admin access required" }, { status: 401, headers })
  const { id } = await params
  const cursor = new URL(request.url).searchParams.get("before")
  if (cursor && !/^\d{1,18}$/.test(cursor)) return Response.json({ error: "Invalid cursor" }, { status: 400, headers })
  const [result] = await rawSql(sql`SELECT
    (SELECT max(id)::text FROM game_score_history WHERE game_id = ${id}) AS "latestId",
    COALESCE((SELECT jsonb_agg(entry ORDER BY (entry.id)::bigint DESC) FROM (
      SELECT id::text, phase, recorded_at, restored_from::text, snapshot->'game' AS game,
        snapshot->'game' <> 'null'::jsonb AND NOT COALESCE(snapshot->'live' ? 'finalizationPending', false) AS restorable
      FROM game_score_history WHERE game_id = ${id} AND (${cursor}::bigint IS NULL OR id < ${cursor}::bigint)
      ORDER BY game_score_history.id DESC LIMIT 50
    ) entry), '[]'::jsonb) AS entries`)
  return Response.json(result, { headers })
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return Response.json({ error: "Admin access required" }, { status: 401, headers })
  const { id } = await params
  let body
  try { body = await request.json() } catch { return Response.json({ error: "Invalid request" }, { status: 400, headers }) }
  if (typeof body?.historyId !== "string" || typeof body?.expectedLatestId !== "string" || !/^\d{1,18}$/.test(body.historyId) || !/^\d{1,18}$/.test(body.expectedLatestId)) {
    return Response.json({ error: "Select a saved version and reload history before restoring" }, { status: 400, headers })
  }
  try {
    await rawSql(sql`SELECT restore_game_score(${id}, ${body.historyId}::bigint, ${body.expectedLatestId}::bigint, ${JSON.stringify(createInitialState())}::jsonb)`)
    revalidatePath("/", "layout")
    return Response.json({ ok: true }, { headers })
  } catch {
    return Response.json({ error: "Could not restore. Reload history; the game may have changed or may still be finalizing." }, { status: 409, headers })
  }
}
