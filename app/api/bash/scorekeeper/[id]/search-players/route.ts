import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { ilike, asc } from "drizzle-orm"
import { authorizeScorekeeper } from "@/lib/operator-auth"

// GET /api/bash/scorekeeper/[id]/search-players?q=... — search players by name
// Accepts PIN-based auth (scorekeeper) or admin session
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const authError = await authorizeScorekeeper(request, id)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q") ?? ""

  if (!q || q.length < 2) {
    return NextResponse.json({ players: [] })
  }

  // Escape LIKE special characters to prevent pattern injection
  const escaped = q.replace(/[%_\\]/g, '\\$&')

  const players = await db
    .select({ id: schema.players.id, name: schema.players.name })
    .from(schema.players)
    .where(ilike(schema.players.name, `%${escaped}%`))
    .orderBy(asc(schema.players.name))
    .limit(20)

  return NextResponse.json({ players })
}
