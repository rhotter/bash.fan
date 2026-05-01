import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Import a previous registration period's full configuration into this period.
 * Clones: scalar fields, custom questions, notice/extra/discount assignments.
 * Does NOT clone: registrations, payment data, period status (target stays "draft").
 *
 * Body: { sourcePeriodId: string, bumpYear?: boolean }
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: targetId } = await context.params

  try {
    const body = await request.json()
    const sourceId = body.sourcePeriodId
    const bumpYear = !!body.bumpYear

    if (!sourceId || typeof sourceId !== "string") {
      return NextResponse.json({ error: "sourcePeriodId required" }, { status: 400 })
    }
    if (sourceId === targetId) {
      return NextResponse.json({ error: "Cannot import from self" }, { status: 400 })
    }

    const [source] = await db
      .select()
      .from(schema.registrationPeriods)
      .where(eq(schema.registrationPeriods.id, sourceId))
      .limit(1)
    if (!source) {
      return NextResponse.json({ error: "Source period not found" }, { status: 404 })
    }

    const shift = (d: Date | null) => {
      if (!d) return null
      if (!bumpYear) return d
      const next = new Date(d)
      next.setFullYear(next.getFullYear() + 1)
      return next
    }

    await db
      .update(schema.registrationPeriods)
      .set({
        baseFee: source.baseFee,
        maxPlayers: source.maxPlayers,
        ageMinimum: source.ageMinimum,
        ageAsOfDate: source.ageAsOfDate, // ISO date string — bumpYear could shift it but keeping verbatim to avoid format drift
        dateOpen: shift(source.dateOpen),
        dateClose: shift(source.dateClose),
        earlybirdDeadline: shift(source.earlybirdDeadline),
        earlybirdDiscount: source.earlybirdDiscount,
        lateFeeDate: shift(source.lateFeeDate),
        lateFeeAmount: source.lateFeeAmount,
        requiresEmergencyInfo: source.requiresEmergencyInfo,
        requiresJerseySize: source.requiresJerseySize,
        confirmationEmailBody: source.confirmationEmailBody,
        // Don't copy adminNotes — those are season-specific.
      })
      .where(eq(schema.registrationPeriods.id, targetId))

    // Clone custom questions
    await db.delete(schema.registrationQuestions).where(eq(schema.registrationQuestions.periodId, targetId))
    const sourceQuestions = await db
      .select()
      .from(schema.registrationQuestions)
      .where(eq(schema.registrationQuestions.periodId, sourceId))
    if (sourceQuestions.length > 0) {
      await db.insert(schema.registrationQuestions).values(
        sourceQuestions.map((q) => ({
          periodId: targetId,
          questionText: q.questionText,
          questionType: q.questionType,
          options: q.options,
          sortOrder: q.sortOrder,
          isRequired: q.isRequired,
        }))
      )
    }

    // Clone notice assignments
    await db.delete(schema.registrationPeriodNotices).where(eq(schema.registrationPeriodNotices.periodId, targetId))
    const sourceNotices = await db
      .select()
      .from(schema.registrationPeriodNotices)
      .where(eq(schema.registrationPeriodNotices.periodId, sourceId))
    if (sourceNotices.length > 0) {
      await db.insert(schema.registrationPeriodNotices).values(
        sourceNotices.map((n) => ({ periodId: targetId, noticeId: n.noticeId, sortOrder: n.sortOrder }))
      )
    }

    // Clone extras
    await db.delete(schema.registrationPeriodExtras).where(eq(schema.registrationPeriodExtras.periodId, targetId))
    const sourceExtras = await db
      .select()
      .from(schema.registrationPeriodExtras)
      .where(eq(schema.registrationPeriodExtras.periodId, sourceId))
    if (sourceExtras.length > 0) {
      await db.insert(schema.registrationPeriodExtras).values(
        sourceExtras.map((e) => ({ periodId: targetId, extraId: e.extraId, sortOrder: e.sortOrder }))
      )
    }

    // Clone discounts
    await db.delete(schema.registrationPeriodDiscounts).where(eq(schema.registrationPeriodDiscounts.periodId, targetId))
    const sourceDiscounts = await db
      .select()
      .from(schema.registrationPeriodDiscounts)
      .where(eq(schema.registrationPeriodDiscounts.periodId, sourceId))
    if (sourceDiscounts.length > 0) {
      await db.insert(schema.registrationPeriodDiscounts).values(
        sourceDiscounts.map((d) => ({ periodId: targetId, discountId: d.discountId }))
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to import period config:", err)
    return NextResponse.json({ error: "Import failed" }, { status: 500 })
  }
}
