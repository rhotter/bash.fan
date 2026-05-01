import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * CSV export of all registrations for a period — column set chosen to mirror
 * Sportability's "Players-Extended" export so commissioners can drop it into
 * existing draft-planning workflows. Youth-specific columns (Parent1_*, School,
 * Grade, Height, Weight) are omitted.
 */
export async function GET(_request: Request, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: periodId } = await context.params

  const [period] = await db
    .select({
      id: schema.registrationPeriods.id,
      seasonId: schema.registrationPeriods.seasonId,
      seasonName: schema.seasons.name,
    })
    .from(schema.registrationPeriods)
    .innerJoin(schema.seasons, eq(schema.registrationPeriods.seasonId, schema.seasons.id))
    .where(eq(schema.registrationPeriods.id, periodId))
    .limit(1)

  if (!period) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Pull all registrations + user + extras + answers + discount code
  const rows = await db
    .select({
      regId: schema.registrations.id,
      status: schema.registrations.status,
      teamSlug: schema.registrations.teamSlug,
      teamName: schema.teams.name,

      userEmail: schema.users.email,
      userName: schema.users.name,

      phone: schema.registrations.phone,
      address: schema.registrations.address,
      birthdate: schema.registrations.birthdate,
      gender: schema.registrations.gender,
      tshirtSize: schema.registrations.tshirtSize,

      emergencyName: schema.registrations.emergencyName,
      emergencyPhone: schema.registrations.emergencyPhone,
      healthPlan: schema.registrations.healthPlan,
      healthPlanId: schema.registrations.healthPlanId,
      doctorName: schema.registrations.doctorName,
      doctorPhone: schema.registrations.doctorPhone,
      medicalNotes: schema.registrations.medicalNotes,

      yearsPlayed: schema.registrations.yearsPlayed,
      skillLevel: schema.registrations.skillLevel,
      positions: schema.registrations.positions,
      lastLeague: schema.registrations.lastLeague,
      lastTeam: schema.registrations.lastTeam,
      miscNotes: schema.registrations.miscNotes,

      amountPaid: schema.registrations.amountPaid,
      paidAt: schema.registrations.paidAt,
      manualPayment: schema.registrations.manualPayment,
      discountCode: schema.discountCodes.code,

      createdAt: schema.registrations.createdAt,
    })
    .from(schema.registrations)
    .innerJoin(schema.users, eq(schema.registrations.userId, schema.users.id))
    .leftJoin(schema.teams, eq(schema.registrations.teamSlug, schema.teams.slug))
    .leftJoin(schema.discountCodes, eq(schema.registrations.discountCodeId, schema.discountCodes.id))
    .where(eq(schema.registrations.periodId, periodId))

  // Per-registration extras (joined separately to avoid blowing up the row count)
  const allExtras = await db
    .select({
      registrationId: schema.registrationExtras.registrationId,
      name: schema.extras.name,
      detail: schema.registrationExtras.detail,
    })
    .from(schema.registrationExtras)
    .innerJoin(schema.extras, eq(schema.registrationExtras.extraId, schema.extras.id))
  const extrasByReg = new Map<string, string[]>()
  for (const e of allExtras) {
    const arr = extrasByReg.get(e.registrationId) ?? []
    arr.push(e.detail ? `${e.name} (${e.detail})` : e.name)
    extrasByReg.set(e.registrationId, arr)
  }

  // Custom answers, by registration
  const allAnswers = await db
    .select({
      registrationId: schema.registrationAnswers.registrationId,
      questionText: schema.registrationQuestions.questionText,
      sortOrder: schema.registrationQuestions.sortOrder,
      answer: schema.registrationAnswers.answer,
    })
    .from(schema.registrationAnswers)
    .innerJoin(
      schema.registrationQuestions,
      eq(schema.registrationAnswers.questionId, schema.registrationQuestions.id)
    )
  const answersByReg = new Map<string, { sortOrder: number; answer: string | null }[]>()
  for (const a of allAnswers) {
    const arr = answersByReg.get(a.registrationId) ?? []
    arr.push({ sortOrder: a.sortOrder, answer: a.answer })
    answersByReg.set(a.registrationId, arr)
  }

  function splitName(full: string | null) {
    if (!full) return { first: "", last: "" }
    const parts = full.trim().split(/\s+/)
    if (parts.length === 1) return { first: parts[0], last: "" }
    return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] }
  }

  function ageAt(date: string | null): string {
    if (!date) return ""
    const d = new Date(date)
    if (Number.isNaN(d.getTime())) return ""
    const now = new Date()
    let age = now.getFullYear() - d.getFullYear()
    const m = now.getMonth() - d.getMonth()
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
    return String(age)
  }

  const headers = [
    "League", "Team", "FirstName", "LastName", "Email", "Phone",
    "Gender", "Birthdate", "Age", "Address",
    "Status", "Rookie", "DiscountCode",
    "CustomQ1", "CustomQ2", "CustomQ3",
    "Notes",
    "TShirt",
    "ExpYrs", "ExpSkill", "ExpPos", "ExpLeague", "ExpTeam",
    "HealthPlan", "HealthPlanID", "DocName", "DocPhone", "MedNotes",
    "PdDate", "PdStatus", "PdAmt",
    "Extras",
    "DateAdded", "HowAdded",
  ]

  const lines: string[] = []
  lines.push(headers.map(csvCell).join(","))
  for (const r of rows) {
    const { first, last } = splitName(r.userName)
    const answers = (answersByReg.get(r.regId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((a) => a.answer ?? "")
    const customQ1 = answers[0] ?? ""
    const customQ2 = answers[1] ?? ""
    const customQ3 = answers[2] ?? ""
    const extrasStr = (extrasByReg.get(r.regId) ?? []).join("; ")
    const pdAmt = r.amountPaid !== null ? `$${(r.amountPaid / 100).toFixed(2)}` : ""
    const pdStatus =
      r.status === "paid"
        ? r.manualPayment
          ? "Paid (manual)"
          : "Paid"
        : r.status === "registered_unpaid"
          ? "Unpaid"
          : r.status === "pending_payment"
            ? "Pending"
            : r.status

    const row = [
      period.seasonName,
      r.teamName ?? r.teamSlug ?? "",
      first,
      last,
      r.userEmail,
      r.phone ?? "",
      r.gender ?? "",
      r.birthdate ?? "",
      ageAt(r.birthdate),
      r.address ?? "",
      r.status,
      "", // Rookie — derived; computing per-row would slow down the export.
      r.discountCode ?? "",
      customQ1,
      customQ2,
      customQ3,
      r.miscNotes ?? "",
      r.tshirtSize ?? "",
      r.yearsPlayed?.toString() ?? "",
      r.skillLevel ?? "",
      r.positions ?? "",
      r.lastLeague ?? "",
      r.lastTeam ?? "",
      r.healthPlan ?? "",
      r.healthPlanId ?? "",
      r.doctorName ?? "",
      r.doctorPhone ?? "",
      r.medicalNotes ?? "",
      r.paidAt ? new Date(r.paidAt).toISOString().slice(0, 10) : "",
      pdStatus,
      pdAmt,
      extrasStr,
      r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "",
      "Online",
    ]
    lines.push(row.map(csvCell).join(","))
  }

  const csv = lines.join("\n") + "\n"
  const filename = `bash-${period.seasonId}-registrations.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}

function csvCell(v: string): string {
  const s = (v ?? "").toString()
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export const runtime = "nodejs"
