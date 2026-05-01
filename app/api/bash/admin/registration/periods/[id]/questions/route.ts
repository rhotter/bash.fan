import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: periodId } = await context.params

  try {
    const body = await request.json()
    const text = (body.questionText ?? "").toString().trim()
    if (!text) return NextResponse.json({ error: "Question text required" }, { status: 400 })
    if (text.length > 64) return NextResponse.json({ error: "Question text capped at 64 chars" }, { status: 400 })

    const type = body.questionType === "select" ? "select" : "text"
    const options = type === "select" && Array.isArray(body.options) ? body.options : null

    // Place at end of list.
    const existing = await db
      .select({ sortOrder: schema.registrationQuestions.sortOrder })
      .from(schema.registrationQuestions)
      .where(eq(schema.registrationQuestions.periodId, periodId))
    const nextOrder = existing.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1

    if (existing.length >= 3) {
      return NextResponse.json({ error: "Max 3 custom questions per period" }, { status: 400 })
    }

    const [created] = await db
      .insert(schema.registrationQuestions)
      .values({
        periodId,
        questionText: text,
        questionType: type,
        options,
        sortOrder: nextOrder,
        isRequired: !!body.isRequired,
      })
      .returning()

    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    console.error("Failed to create question:", err)
    return NextResponse.json({ error: "Failed to create question" }, { status: 500 })
  }
}
