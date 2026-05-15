import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { ilike, asc } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

async function validateAuth(request: Request): Promise<boolean> {
  const pin = request.headers.get("x-pin")
  if (pin && pin === process.env.SCOREKEEPER_PIN) return true
  return await getSession()
}

// GET /api/bash/scorekeeper/[id]/search-players?q=... — search players by name
// Accepts PIN-based auth (scorekeeper) or admin session
export async function GET(request: Request) {
  if (!(await validateAuth(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q") ?? ""

  if (!q || q.length < 2) {
    return NextResponse.json({ players: [] })
  }

  const players = await db
    .select({ id: schema.players.id, name: schema.players.name })
    .from(schema.players)
    .where(ilike(schema.players.name, `%${q}%`))
    .orderBy(asc(schema.players.name))
    .limit(20)

  return NextResponse.json({ players })
}
