import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

export async function GET(request: Request) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const seasonId = searchParams.get("seasonId")

  let query = db.select().from(schema.playerAwards)
  if (seasonId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.where(eq(schema.playerAwards.seasonId, seasonId)) as any
  }

  const awards = await query
  return NextResponse.json({ awards })
}

export async function POST(request: Request) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const data = await request.json()
    const { playerName, playerId, seasonId, awardType } = data

    if (!playerName || !seasonId || !awardType) {
      return NextResponse.json({ error: "playerName, seasonId, and awardType are required" }, { status: 400 })
    }

    const [award] = await db
      .insert(schema.playerAwards)
      .values({ 
        playerName: playerName.trim(), 
        playerId: playerId || null, 
        seasonId: seasonId.trim(), 
        awardType: awardType.trim() 
      })
      .returning()

    return NextResponse.json({ award })
  } catch (error) {
    console.error("Failed to create award:", error)
    return NextResponse.json({ error: "Internal Server Error. Award may already exist for this season." }, { status: 500 })
  }
}
