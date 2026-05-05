import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

export async function GET() {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const franchises = await db
    .select()
    .from(schema.franchises)
    .orderBy(schema.franchises.name)

  return NextResponse.json({ franchises })
}

export async function POST(request: NextRequest) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { slug, name, color } = await request.json()

    if (!slug || !name) {
      return NextResponse.json({ error: "Slug and name are required" }, { status: 400 })
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json({ error: "Slug must be lowercase alphanumeric with hyphens" }, { status: 400 })
    }

    // Check for duplicate
    const [existing] = await db
      .select()
      .from(schema.franchises)
      .where(eq(schema.franchises.slug, slug))
      .limit(1)

    if (existing) {
      return NextResponse.json({ error: "A franchise with this slug already exists" }, { status: 409 })
    }

    const [franchise] = await db
      .insert(schema.franchises)
      .values({ slug, name, color: color || null })
      .returning()

    return NextResponse.json({ franchise }, { status: 201 })
  } catch (err) {
    console.error("Failed to create franchise:", err)
    return NextResponse.json({ error: "Failed to create franchise" }, { status: 500 })
  }
}
