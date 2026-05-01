import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { and, eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; qid: string }>
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: periodId, qid } = await context.params
  const numericQid = Number.parseInt(qid, 10)
  if (Number.isNaN(numericQid)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  try {
    await db
      .delete(schema.registrationQuestions)
      .where(
        and(
          eq(schema.registrationQuestions.id, numericQid),
          eq(schema.registrationQuestions.periodId, periodId)
        )
      )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to delete question:", err)
    return NextResponse.json({ error: "Failed to delete question" }, { status: 500 })
  }
}
