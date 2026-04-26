import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { ilike, asc } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

export async function GET(request: Request) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q") ?? ""

  // We could paginate, but since admin often needs to scan/search, we'll return all or limit to a large number
  // For search, we can use ilike.
  const query = db.select().from(schema.players)

  if (q) {
    query.where(ilike(schema.players.name, `%${q}%`))
  }

  const players = await query.orderBy(asc(schema.players.name))

  return NextResponse.json({ players })
}

export async function POST(request: Request) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const data = await request.json()
    const { name } = data

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 })
    }

    const [player] = await db
      .insert(schema.players)
      .values({ name: name.trim() })
      .returning()

    return NextResponse.json({ player })
  } catch (error) {
    console.error("Failed to create player:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
