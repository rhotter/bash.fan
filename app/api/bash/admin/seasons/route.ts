import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { sql, eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { revalidateTag } from "next/cache"

export async function GET(request: NextRequest) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get("status")

  let query = db
    .select({
      id: schema.seasons.id,
      name: schema.seasons.name,
      seasonType: schema.seasons.seasonType,
      status: schema.seasons.status,
      isCurrent: schema.seasons.isCurrent,
      teamCount: sql<number>`(SELECT COUNT(*) FROM season_teams WHERE season_id = ${schema.seasons.id})`,
      gameCount: sql<number>`(SELECT COUNT(*) FROM games WHERE season_id = ${schema.seasons.id})`,
      playerCount: sql<number>`(SELECT COUNT(DISTINCT player_id) FROM player_seasons WHERE season_id = ${schema.seasons.id})`,
    })
    .from(schema.seasons)
    .orderBy(sql`${schema.seasons.id} DESC`)
    .$dynamic()

  if (statusFilter && statusFilter !== "all") {
    query = query.where(eq(schema.seasons.status, statusFilter))
  }

  const seasons = await query

  return NextResponse.json({ seasons })
}

export async function POST(request: NextRequest) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { name, seasonType, leagueId } = body

    if (!name || !seasonType) {
      return NextResponse.json({ error: "Name and seasonType are required" }, { status: 400 })
    }

    // Generate ID from name (e.g. "2026-2027" or "2026-summer")
    const id = name.toLowerCase().replace(/\s+/g, "-")

    // Check if season already exists
    const existing = await db
      .select({ id: schema.seasons.id })
      .from(schema.seasons)
      .where(eq(schema.seasons.id, id))
      .limit(1)

    if (existing.length > 0) {
      return NextResponse.json({ error: "A season with this ID already exists" }, { status: 409 })
    }

    // Determine default location based on season type
    const defaultLocation =
      seasonType === "summer"
        ? "Dolores Park Multi-purpose Court"
        : "James Lick Arena"

    await db.insert(schema.seasons).values({
      id,
      name,
      seasonType,
      leagueId: leagueId || null,
      isCurrent: false,
      status: "draft",
      standingsMethod: "pts-pbla",
      gameLength: 60,
      defaultLocation,
    })

    // Bust the Next.js season cache so subsequent reads see the new season
    revalidateTag("seasons")

    return NextResponse.json({ id, name, status: "draft" }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to create season" }, { status: 500 })
  }
}
