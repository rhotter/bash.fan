import { notFound } from "next/navigation"
import Link from "next/link"
import { db, schema } from "@/lib/db"
import { eq, and, sql } from "drizzle-orm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Download } from "lucide-react"
import { RegistrantsTable, type RegistrantRow } from "@/components/admin/registration/registrants-table"

export const metadata = { title: "Registrants | Admin" }
export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ periodId: string }>
}

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return "—"
  return `$${(cents / 100).toFixed(2)}`
}

export default async function AdminPeriodPage({ params }: PageProps) {
  const { periodId } = await params

  const [period] = await db
    .select({
      id: schema.registrationPeriods.id,
      seasonId: schema.registrationPeriods.seasonId,
      seasonName: schema.seasons.name,
      status: schema.registrationPeriods.status,
      baseFee: schema.registrationPeriods.baseFee,
      maxPlayers: schema.registrationPeriods.maxPlayers,
    })
    .from(schema.registrationPeriods)
    .innerJoin(schema.seasons, eq(schema.registrationPeriods.seasonId, schema.seasons.id))
    .where(eq(schema.registrationPeriods.id, periodId))
    .limit(1)

  if (!period) notFound()

  const registrantRows = await db
    .select({
      id: schema.registrations.id,
      status: schema.registrations.status,
      teamSlug: schema.registrations.teamSlug,
      userName: schema.users.name,
      userEmail: schema.users.email,
      amountPaid: schema.registrations.amountPaid,
      paidAt: schema.registrations.paidAt,
      manualPayment: schema.registrations.manualPayment,
      createdAt: schema.registrations.createdAt,
      yearsPlayed: schema.registrations.yearsPlayed,
      skillLevel: schema.registrations.skillLevel,
      positions: schema.registrations.positions,
      lastTeam: schema.registrations.lastTeam,
      discountCode: schema.discountCodes.code,
    })
    .from(schema.registrations)
    .innerJoin(schema.users, eq(schema.registrations.userId, schema.users.id))
    .leftJoin(schema.discountCodes, eq(schema.registrations.discountCodeId, schema.discountCodes.id))
    .where(eq(schema.registrations.periodId, periodId))
    .orderBy(sql`${schema.registrations.createdAt} DESC`)

  const total = registrantRows.length
  const paidCount = registrantRows.filter((r) => r.status === "paid").length
  const unpaidCount = registrantRows.filter((r) => r.status === "registered_unpaid" || r.status === "pending_payment").length
  const waitlistedCount = registrantRows.filter((r) => r.status === "waitlisted").length
  const totalRevenueCents = registrantRows.reduce((sum, r) => sum + (r.amountPaid ?? 0), 0)
  const discountsRedeemedCount = registrantRows.filter((r) => r.discountCode).length

  const registrants: RegistrantRow[] = registrantRows.map((r) => ({
    id: r.id,
    status: r.status,
    teamSlug: r.teamSlug,
    userName: r.userName,
    userEmail: r.userEmail,
    amountPaid: r.amountPaid,
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    manualPayment: r.manualPayment,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    yearsPlayed: r.yearsPlayed,
    skillLevel: r.skillLevel,
    positions: r.positions,
    lastTeam: r.lastTeam,
    discountCode: r.discountCode,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">{period.seasonName}</h1>
            <Badge variant="outline" className="text-[10px]">{period.status}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Registration period · base fee {formatCents(period.baseFee)}
            {period.maxPlayers ? ` · cap ${period.maxPlayers}` : " · no cap"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a href={`/api/bash/admin/registration/periods/${period.id}/export`}>
              <Download className="h-4 w-4 mr-1.5" />
              Export CSV
            </a>
          </Button>
          <Button asChild variant="ghost">
            <Link href={`/admin/seasons/${period.seasonId}`}>Configure period</Link>
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <KpiCard label="Registered" value={`${total}${period.maxPlayers ? ` / ${period.maxPlayers}` : ""}`} />
        <KpiCard label="Paid" value={paidCount.toString()} sub={formatCents(totalRevenueCents)} />
        <KpiCard label="Unpaid" value={unpaidCount.toString()} sub="includes pending + rookies" />
        <KpiCard label="Waitlist" value={waitlistedCount.toString()} />
        <KpiCard label="Codes redeemed" value={discountsRedeemedCount.toString()} />
      </div>

      <RegistrantsTable registrants={registrants} />
    </div>
  )
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  )
}
