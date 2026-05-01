import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { desc, eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { randomUUID } from "crypto"

export async function GET(request: NextRequest) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const seasonId = searchParams.get("seasonId")

  let query = db.select().from(schema.registrationPeriods).$dynamic()
  if (seasonId) {
    query = query.where(eq(schema.registrationPeriods.seasonId, seasonId))
  }
  const periods = await query.orderBy(desc(schema.registrationPeriods.createdAt))
  return NextResponse.json({ periods })
}

export async function POST(request: NextRequest) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { seasonId, baseFeeCents, dateOpen, dateClose, maxPlayers, ageMinimum, ageAsOfDate } = body

    if (!seasonId) {
      return NextResponse.json({ error: "seasonId required" }, { status: 400 })
    }

    // Confirm the season exists.
    const [season] = await db
      .select({ id: schema.seasons.id })
      .from(schema.seasons)
      .where(eq(schema.seasons.id, seasonId))
      .limit(1)
    if (!season) {
      return NextResponse.json({ error: "Unknown season" }, { status: 404 })
    }

    const id = `regp-${randomUUID().slice(0, 8)}`

    const [created] = await db
      .insert(schema.registrationPeriods)
      .values({
        id,
        seasonId,
        status: "draft",
        baseFee: typeof baseFeeCents === "number" ? baseFeeCents : 0,
        dateOpen: dateOpen ? new Date(dateOpen) : null,
        dateClose: dateClose ? new Date(dateClose) : null,
        maxPlayers: typeof maxPlayers === "number" ? maxPlayers : null,
        ageMinimum: typeof ageMinimum === "number" ? ageMinimum : null,
        ageAsOfDate: ageAsOfDate || null,
        requiresEmergencyInfo: true,
        requiresJerseySize: false,
      })
      .returning()

    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    console.error("Failed to create registration period:", err)
    return NextResponse.json({ error: "Failed to create period" }, { status: 500 })
  }
}
