import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { desc } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

export async function GET() {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const _hof = await db.select().from(schema.hallOfFame).orderBy(desc(schema.hallOfFame.classYear))
  return NextResponse.json({ hallOfFame: _hof })
}

export async function POST(request: Request) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const data = await request.json()
    const { playerName, playerId, classYear, wing, yearsActive, achievements } = data

    if (!playerName || !classYear) {
      return NextResponse.json({ error: "playerName and classYear are required" }, { status: 400 })
    }

    const [hofEntry] = await db
      .insert(schema.hallOfFame)
      .values({ 
        playerName: playerName.trim(), 
        playerId: playerId || null, 
        classYear: parseInt(classYear, 10), 
        wing: wing?.trim() || "players",
        yearsActive: yearsActive?.trim() || null,
        achievements: achievements?.trim() || null
      })
      .returning()

    return NextResponse.json({ entry: hofEntry })
  } catch (error) {
    console.error("Failed to create HOF entry:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
