import { createHash } from "node:crypto"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { rawSql } from "@/lib/db"
import { pushConfigured } from "@/lib/push/apns"

const identity = z.object({ id: z.string().uuid(), activityID: z.string().min(1).max(64) })
const registration = identity.extend({
 gameID: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),
 token: z.string().regex(/^[a-f0-9]{64,512}$/), environment: z.enum(["sandbox", "production"]),
})
async function handle(request: Request, remove: boolean) {
 const secret = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
 if (!secret) return Response.json({ error: "Installation authentication required" }, { status: 401 })
 const text = await request.text()
 if (text.length > 4096) return new Response(null, { status: 413 })
 const hash = createHash("sha256").update(secret).digest("hex")
 try {
  const json: unknown = JSON.parse(text)
  if (remove) {
   const body = identity.parse(json)
   await rawSql(sql`DELETE FROM push_activities WHERE installation_id=${body.id}::uuid AND activity_id=${body.activityID} AND secret_hash=${hash}`)
  } else {
   const body = registration.parse(json)
   if (!pushConfigured()) return Response.json({ error: "Live scores are not available yet." }, { status: 503 })
   const rows = await rawSql(sql`
    INSERT INTO push_activities(installation_id,activity_id,secret_hash,game_id,token,environment)
    SELECT ${body.id}::uuid,${body.activityID},${hash},g.id,${body.token},${body.environment}
    FROM games g WHERE g.id=${body.gameID} AND g.status='live'
     AND ((SELECT count(*) FROM push_activities WHERE installation_id=${body.id}::uuid AND expires_at>now())<8
      OR EXISTS(SELECT 1 FROM push_activities WHERE installation_id=${body.id}::uuid AND activity_id=${body.activityID}))
    ON CONFLICT(installation_id,activity_id) DO UPDATE SET token=excluded.token,environment=excluded.environment,
     last_signature=CASE WHEN push_activities.token<>excluded.token THEN NULL ELSE push_activities.last_signature END,
     next_attempt_at=now()
    WHERE push_activities.secret_hash=excluded.secret_hash AND push_activities.game_id=excluded.game_id
    RETURNING activity_id
   `)
   if (!rows.length) return Response.json({ error: "Couldn’t follow this game. It may have ended, or too many live scores are open." }, { status: 409 })
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
 } catch (error) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Invalid live score registration" }, { status: 400 })
  console.error("Live score registration failed", error instanceof Error ? error.message : "database error")
  return Response.json({ error: "Couldn’t connect live scores. Please try again." }, { status: 503 })
 }
}
export const PUT = (request: Request) => handle(request, false)
export const DELETE = (request: Request) => handle(request, true)
