import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string }>
}

const ALLOWED_STATUSES = [
  "draft",
  "pending_payment",
  "registered_unpaid",
  "paid",
  "cancelled",
  "waitlisted",
] as const

/**
 * Admin status updates on a registration. Used for:
 *   - Mark Paid (Manual)  → status='paid', manual_payment=true, paid_at=now
 *   - Cancel              → status='cancelled'
 *   - Move from waitlist  → status='registered_unpaid' or 'paid' depending on intent
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params

  try {
    const body = await request.json()
    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (body.status !== undefined) {
      if (!ALLOWED_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 })
      }
      updates.status = body.status

      if (body.status === "paid" && body.manualPayment) {
        updates.manualPayment = true
        updates.paidAt = new Date()
        if (typeof body.amountPaidCents === "number") {
          updates.amountPaid = body.amountPaidCents
        }
      }
    }

    if (body.amountPaidCents !== undefined && body.amountPaidCents !== null) {
      if (typeof body.amountPaidCents !== "number" || body.amountPaidCents < 0) {
        return NextResponse.json({ error: "amountPaidCents must be non-negative" }, { status: 400 })
      }
      updates.amountPaid = body.amountPaidCents
    }

    if (body.adminNotes !== undefined) {
      // We don't have an adminNotes column on registrations — putting in miscNotes is the
      // closest existing field. Skip silently if not a known field.
    }

    const [updated] = await db
      .update(schema.registrations)
      .set(updates)
      .where(eq(schema.registrations.id, id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(updated)
  } catch (err) {
    console.error("Failed to update registration:", err)
    return NextResponse.json({ error: "Failed to update registration" }, { status: 500 })
  }
}

export const runtime = "nodejs"
