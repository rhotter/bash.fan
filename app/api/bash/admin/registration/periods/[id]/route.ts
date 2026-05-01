import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string }>
}

const ALLOWED_STATUSES = ["draft", "open", "closed"] as const

export async function GET(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params

  const [period] = await db
    .select()
    .from(schema.registrationPeriods)
    .where(eq(schema.registrationPeriods.id, id))
    .limit(1)
  if (!period) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const [questions, notices, extras, discounts] = await Promise.all([
    db.select().from(schema.registrationQuestions).where(eq(schema.registrationQuestions.periodId, id)),
    db.select({ noticeId: schema.registrationPeriodNotices.noticeId, sortOrder: schema.registrationPeriodNotices.sortOrder })
      .from(schema.registrationPeriodNotices)
      .where(eq(schema.registrationPeriodNotices.periodId, id)),
    db.select({ extraId: schema.registrationPeriodExtras.extraId, sortOrder: schema.registrationPeriodExtras.sortOrder })
      .from(schema.registrationPeriodExtras)
      .where(eq(schema.registrationPeriodExtras.periodId, id)),
    db.select({ discountId: schema.registrationPeriodDiscounts.discountId })
      .from(schema.registrationPeriodDiscounts)
      .where(eq(schema.registrationPeriodDiscounts.periodId, id)),
  ])

  return NextResponse.json({
    ...period,
    questions,
    noticeIds: notices.map((n) => n.noticeId),
    extraIds: extras.map((e) => e.extraId),
    discountIds: discounts.map((d) => d.discountId),
  })
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params

  try {
    const body = await request.json()
    const updates: Record<string, unknown> = {}

    if (body.status !== undefined) {
      if (!ALLOWED_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 })
      }
      updates.status = body.status
    }
    if (body.baseFeeCents !== undefined) {
      if (typeof body.baseFeeCents !== "number" || body.baseFeeCents < 0) {
        return NextResponse.json({ error: "baseFeeCents must be a non-negative number" }, { status: 400 })
      }
      updates.baseFee = body.baseFeeCents
    }
    if (body.dateOpen !== undefined) updates.dateOpen = body.dateOpen ? new Date(body.dateOpen) : null
    if (body.dateClose !== undefined) updates.dateClose = body.dateClose ? new Date(body.dateClose) : null
    if (body.maxPlayers !== undefined) updates.maxPlayers = typeof body.maxPlayers === "number" ? body.maxPlayers : null
    if (body.ageMinimum !== undefined) updates.ageMinimum = typeof body.ageMinimum === "number" ? body.ageMinimum : null
    if (body.ageAsOfDate !== undefined) updates.ageAsOfDate = body.ageAsOfDate || null
    if (body.requiresEmergencyInfo !== undefined) updates.requiresEmergencyInfo = !!body.requiresEmergencyInfo
    if (body.requiresJerseySize !== undefined) updates.requiresJerseySize = !!body.requiresJerseySize
    if (body.confirmationEmailBody !== undefined) updates.confirmationEmailBody = body.confirmationEmailBody || null
    if (body.adminNotes !== undefined) updates.adminNotes = body.adminNotes || null

    // Assignments — fully replace each set if provided.
    const noticeIds: number[] | undefined = Array.isArray(body.noticeIds) ? body.noticeIds : undefined
    const extraIds: number[] | undefined = Array.isArray(body.extraIds) ? body.extraIds : undefined
    const discountIds: number[] | undefined = Array.isArray(body.discountIds) ? body.discountIds : undefined

    if (Object.keys(updates).length > 0) {
      await db.update(schema.registrationPeriods).set(updates).where(eq(schema.registrationPeriods.id, id))
    }

    if (noticeIds) {
      await db.delete(schema.registrationPeriodNotices).where(eq(schema.registrationPeriodNotices.periodId, id))
      if (noticeIds.length > 0) {
        await db.insert(schema.registrationPeriodNotices).values(
          noticeIds.map((noticeId, i) => ({ periodId: id, noticeId, sortOrder: i }))
        )
      }
    }
    if (extraIds) {
      await db.delete(schema.registrationPeriodExtras).where(eq(schema.registrationPeriodExtras.periodId, id))
      if (extraIds.length > 0) {
        await db.insert(schema.registrationPeriodExtras).values(
          extraIds.map((extraId, i) => ({ periodId: id, extraId, sortOrder: i }))
        )
      }
    }
    if (discountIds) {
      await db.delete(schema.registrationPeriodDiscounts).where(eq(schema.registrationPeriodDiscounts.periodId, id))
      if (discountIds.length > 0) {
        await db.insert(schema.registrationPeriodDiscounts).values(
          discountIds.map((discountId) => ({ periodId: id, discountId }))
        )
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to update period:", err)
    return NextResponse.json({ error: "Failed to update period" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params

  try {
    // Cascade is handled by FKs (registration_period_notices/extras/discounts have onDelete: cascade)
    // but registrations don't cascade — bail if any exist.
    const regs = await db
      .select({ id: schema.registrations.id })
      .from(schema.registrations)
      .where(eq(schema.registrations.periodId, id))
      .limit(1)
    if (regs.length > 0) {
      return NextResponse.json({ error: "Period has registrations and cannot be deleted." }, { status: 400 })
    }

    await db.delete(schema.registrationPeriods).where(eq(schema.registrationPeriods.id, id))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to delete period:", err)
    return NextResponse.json({ error: "Failed to delete period" }, { status: 500 })
  }
}
