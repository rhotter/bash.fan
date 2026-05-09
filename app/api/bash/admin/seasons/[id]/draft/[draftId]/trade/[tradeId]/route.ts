import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string; draftId: string; tradeId: string }>
}

// DELETE — Remove a pre-draft trade
export async function DELETE(_request: Request, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { draftId, tradeId } = await context.params

  // Verify draft exists and is in editable status
  const draft = await db.query.draftInstances.findFirst({
    where: eq(schema.draftInstances.id, draftId),
  })

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  }

  if (draft.status !== "draft") {
    return NextResponse.json(
      { error: "Trades can only be deleted while the draft is in draft status" },
      { status: 400 }
    )
  }

  // Verify the trade belongs to this draft
  const trade = await db.query.draftTrades.findFirst({
    where: and(
      eq(schema.draftTrades.id, tradeId),
      eq(schema.draftTrades.draftId, draftId)
    ),
  })

  if (!trade) {
    return NextResponse.json({ error: "Trade not found" }, { status: 404 })
  }

  try {
    // Trade items cascade-delete via FK
    await db.delete(schema.draftTrades).where(eq(schema.draftTrades.id, tradeId))
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Failed to delete trade:", err)
    return NextResponse.json({ error: "Failed to delete trade" }, { status: 500 })
  }
}
