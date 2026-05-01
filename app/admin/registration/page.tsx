import Link from "next/link"
import { db, schema } from "@/lib/db"
import { count, desc, eq, sql } from "drizzle-orm"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tag, Plus, ScrollText, ChevronRight } from "lucide-react"

export const metadata = {
  title: "Registration | Admin",
}

export const dynamic = "force-dynamic"

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return "—"
  return `$${(cents / 100).toFixed(2)}`
}

function periodGroup(period: { status: string; dateOpen: Date | null; dateClose: Date | null }, now: Date) {
  if (period.status === "open") return "open"
  if (period.status === "closed") return "closed"
  if (period.status === "draft") {
    if (period.dateOpen && period.dateOpen > now) return "upcoming"
    return "draft"
  }
  return "other"
}

export default async function AdminRegistrationPage() {
  const now = new Date()

  const [[noticesCount], [extrasCount], [discountsCount]] = await Promise.all([
    db.select({ n: count() }).from(schema.legalNotices),
    db.select({ n: count() }).from(schema.extras),
    db.select({ n: count() }).from(schema.discountCodes),
  ])

  // All periods with KPI counts, joined to the season name for display.
  const periodRows = await db
    .select({
      id: schema.registrationPeriods.id,
      seasonId: schema.registrationPeriods.seasonId,
      seasonName: schema.seasons.name,
      status: schema.registrationPeriods.status,
      baseFee: schema.registrationPeriods.baseFee,
      maxPlayers: schema.registrationPeriods.maxPlayers,
      dateOpen: schema.registrationPeriods.dateOpen,
      dateClose: schema.registrationPeriods.dateClose,
      total: sql<number>`(SELECT COUNT(*)::int FROM registrations WHERE registrations.period_id = registration_periods.id)`,
      paid: sql<number>`(SELECT COUNT(*)::int FROM registrations WHERE registrations.period_id = registration_periods.id AND registrations.status = 'paid')`,
      revenue: sql<number>`(SELECT COALESCE(SUM(amount_paid), 0)::int FROM registrations WHERE registrations.period_id = registration_periods.id AND registrations.status = 'paid')`,
    })
    .from(schema.registrationPeriods)
    .innerJoin(schema.seasons, eq(schema.registrationPeriods.seasonId, schema.seasons.id))
    .orderBy(desc(schema.registrationPeriods.createdAt))

  const grouped: Record<"open" | "upcoming" | "closed" | "draft", typeof periodRows> = {
    open: [],
    upcoming: [],
    closed: [],
    draft: [],
  }
  for (const p of periodRows) {
    const g = periodGroup(p, now) as keyof typeof grouped
    if (grouped[g]) grouped[g].push(p)
  }

  const libraries = [
    {
      title: "Notices",
      description: "Reusable waivers and notices assigned to registration periods.",
      href: "/admin/registration/notices",
      icon: ScrollText,
      count: noticesCount.n,
    },
    {
      title: "Extras",
      description: "Optional add-ons (donations, tournament fees, jerseys).",
      href: "/admin/registration/extras",
      icon: Plus,
      count: extrasCount.n,
    },
    {
      title: "Discount Codes",
      description: "Flat-dollar codes with usage caps and expiry dates.",
      href: "/admin/registration/discounts",
      icon: Tag,
      count: discountsCount.n,
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Registration</h1>
        <p className="text-muted-foreground mt-1">
          Configure registration per-season and manage the global libraries.
        </p>
      </div>

      {(["open", "upcoming", "closed", "draft"] as const).map((g) =>
        grouped[g].length === 0 ? null : (
          <PeriodGroup key={g} title={groupTitle(g)} periods={grouped[g]} />
        )
      )}

      {periodRows.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No registration periods yet</CardTitle>
            <CardDescription>
              Open a season at <Link href="/admin/seasons" className="underline">/admin/seasons</Link> and use its
              Registration tab to create the first period.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Libraries</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {libraries.map(({ title, description, href, icon: Icon, count: n }) => (
            <Card key={href}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">{title}</CardTitle>
                  </div>
                  <Badge variant="secondary" className="rounded-full">{n}</Badge>
                </div>
                <CardDescription className="pt-1">{description}</CardDescription>
              </CardHeader>
              <CardContent />
              <CardFooter>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href={href}>Manage</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )

  function groupTitle(g: "open" | "upcoming" | "closed" | "draft"): string {
    return {
      open: "Open",
      upcoming: "Upcoming",
      closed: "Closed",
      draft: "Draft",
    }[g]
  }
}

function PeriodGroup({
  title,
  periods,
}: {
  title: string
  periods: {
    id: string
    seasonId: string
    seasonName: string
    status: string
    baseFee: number
    maxPlayers: number | null
    total: number
    paid: number
    revenue: number
  }[]
}) {
  function formatCents(cents: number | null): string {
    if (cents === null || cents === undefined) return "—"
    return `$${(cents / 100).toFixed(2)}`
  }

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">{title}</h2>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {periods.map((p) => (
          <Link
            key={p.id}
            href={`/admin/registration/${p.id}`}
            className="group rounded-lg border bg-card p-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold">{p.seasonName}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {formatCents(p.baseFee)}
                  {p.maxPlayers ? ` · cap ${p.maxPlayers}` : ""}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div className="text-2xl font-bold">
                {p.paid}
                <span className="text-sm text-muted-foreground font-normal">
                  {" "}
                  / {p.total}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatCents(p.revenue)} collected
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
