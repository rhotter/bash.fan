import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { asc, eq, ne, not, like, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

export async function GET() {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const allTeams = await db
    .select()
    .from(schema.teams)
    .where(
      and(
        ne(schema.teams.slug, "tbd"),
        not(like(schema.teams.slug, "seed-%"))
      )
    )
    .orderBy(asc(schema.teams.name))

  return NextResponse.json({ teams: allTeams })
}

export async function POST(request: Request) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const data = await request.json()
    const { slug, name } = data

    if (!slug || !name || typeof slug !== "string" || typeof name !== "string") {
      return NextResponse.json({ error: "Slug and Name are required" }, { status: 400 })
    }

    const existingTeam = await db.select().from(schema.teams).where(eq(schema.teams.slug, slug.trim().toLowerCase())).limit(1)
    if (existingTeam.length > 0) {
      return NextResponse.json({ error: "A team with this team name already exists. Please add them from the database." }, { status: 400 })
    }

    const [team] = await db
      .insert(schema.teams)
      .values({ slug: slug.trim().toLowerCase(), name: name.trim() })
      .returning()

    return NextResponse.json({ team })
  } catch (error) {
    console.error("Failed to create team:", error)
    return NextResponse.json({ error: "Internal Server Error. Team may already exist." }, { status: 500 })
  }
}
