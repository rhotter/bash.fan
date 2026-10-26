import { createHash } from "node:crypto"
import { sql } from "drizzle-orm"
import { rawSql } from "@/lib/db"
import { pushConfigured } from "@/lib/push/apns"
import { z } from "zod"

const preferences = z.object({
 id: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64,200}$/),
 environment: z.enum(["sandbox", "production"]),
 teams: z.array(z.string().regex(/^[a-z0-9-]{1,100}$/)).max(32),
 games: z.array(z.string().regex(/^[a-zA-Z0-9-]{1,100}$/)).max(100), enabled: z.boolean(),
})
export async function PUT(request: Request) {
 const secret = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
 if (!secret) return Response.json({ error: "Installation authentication required" }, { status: 401 })
 if (Number(request.headers.get("content-length")) > 16384) return new Response(null, { status: 413 })
 const text = await request.text()
 if (text.length > 16384) return new Response(null, { status: 413 })
 let body
 try { body = preferences.parse(JSON.parse(text)) } catch { return Response.json({ error: "Invalid preferences" }, { status: 400 }) }
 if (body.enabled && !pushConfigured()) return Response.json({ error: "Game alerts are not available yet. Please try again later." }, { status: 503 })
 const hash = createHash("sha256").update(secret).digest("hex")
 try {
  const updated = await rawSql(sql`
   INSERT INTO push_devices(id,secret_hash,token,environment,teams,games,enabled)
   VALUES(${body.id}::uuid,${hash},${body.token},${body.environment},
    ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify([...new Set(body.teams)])}::jsonb)),
    ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify([...new Set(body.games)])}::jsonb)),${body.enabled})
   ON CONFLICT(id) DO UPDATE SET token=excluded.token,environment=excluded.environment,
    teams=excluded.teams,games=excluded.games,enabled=excluded.enabled,updated_at=now()
   WHERE push_devices.secret_hash=excluded.secret_hash RETURNING id
  `)
  if (!updated.length) return Response.json({ error: "Invalid installation credentials" }, { status: 401 })
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
 } catch (error) {
  console.error("Could not save push preferences", error instanceof Error ? error.message : "database failure")
  return Response.json({ error: "Could not save game alerts. Please try again." }, { status: 503 })
 }
}
