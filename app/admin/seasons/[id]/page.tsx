import { notFound } from "next/navigation"
import { db, schema } from "@/lib/db"
import { eq, ne, and, sql, desc } from "drizzle-orm"
import { Badge } from "@/components/ui/badge"
import { SeasonTabs } from "@/components/admin/season-tabs"

interface SeasonDetailPageProps {
  params: Promise<{ id: string }>
}

async function getSeason(id: string) {
  const [season] = await db
    .select()
    .from(schema.seasons)
    .where(eq(schema.seasons.id, id))
    .limit(1)

  if (!season) return null

  const allTeams = await db
    .select({ teamSlug: schema.seasonTeams.teamSlug, teamName: schema.teams.name })
    .from(schema.seasonTeams)
    .innerJoin(schema.teams, eq(schema.seasonTeams.teamSlug, schema.teams.slug))
    .where(and(eq(schema.seasonTeams.seasonId, id), ne(schema.seasonTeams.teamSlug, "tbd")))
  const teams = allTeams.filter(t => !t.teamSlug.startsWith("seed-"))

  // isRookie is derived: a player is a rookie iff they have no prior fall-season
  // participation. Only meaningful for fall seasons; summer rosters never have rookies.
  const isRookieExpr = season.seasonType === "fall"
    ? sql<boolean>`NOT EXISTS (
        SELECT 1 FROM player_seasons ps2
        JOIN seasons s2 ON s2.id = ps2.season_id
        WHERE ps2.player_id = players.id
          AND s2.season_type = 'fall'
          AND ps2.season_id < ${id}
      )`
    : sql<boolean>`false`

  const rawRoster = await db
    .select({
      playerId: schema.players.id,
      playerName: schema.players.name,
      teamSlug: schema.playerSeasons.teamSlug,
      isGoalie: schema.playerSeasons.isGoalie,
      isRookie: isRookieExpr,
    })
    .from(schema.playerSeasons)
    .innerJoin(schema.players, eq(schema.playerSeasons.playerId, schema.players.id))
    .where(eq(schema.playerSeasons.seasonId, id))
  
  // Sort by player name
  const roster = rawRoster.sort((a, b) => a.playerName.localeCompare(b.playerName))

  // Registration period (at most one per season today; PRD allows multiple in future)
  const [period] = await db
    .select()
    .from(schema.registrationPeriods)
    .where(eq(schema.registrationPeriods.seasonId, id))
    .orderBy(desc(schema.registrationPeriods.createdAt))
    .limit(1)

  let registrationData: {
    period: PeriodForTab | null
    notices: { id: number; title: string; ackType: string; version: number }[]
    extras: { id: number; name: string; price: number; active: boolean }[]
    discounts: { id: number; code: string; amountOff: number; active: boolean }[]
    otherPeriods: { id: string; seasonName: string }[]
  }

  // Always load library options so the tab can show "create a notice" links etc.
  const [allNotices, allExtras, allDiscounts, otherPeriodsRows] = await Promise.all([
    db.select({
      id: schema.legalNotices.id,
      title: schema.legalNotices.title,
      ackType: schema.legalNotices.ackType,
      version: schema.legalNotices.version,
    }).from(schema.legalNotices),
    db.select({
      id: schema.extras.id,
      name: schema.extras.name,
      price: schema.extras.price,
      active: schema.extras.active,
    }).from(schema.extras),
    db.select({
      id: schema.discountCodes.id,
      code: schema.discountCodes.code,
      amountOff: schema.discountCodes.amountOff,
      active: schema.discountCodes.active,
    }).from(schema.discountCodes),
    db.select({
      id: schema.registrationPeriods.id,
      seasonName: schema.seasons.name,
    })
      .from(schema.registrationPeriods)
      .innerJoin(schema.seasons, eq(schema.registrationPeriods.seasonId, schema.seasons.id))
      .where(ne(schema.registrationPeriods.seasonId, id)),
  ])

  if (period) {
    const [questions, periodNotices, periodExtras, periodDiscounts] = await Promise.all([
      db.select().from(schema.registrationQuestions).where(eq(schema.registrationQuestions.periodId, period.id)),
      db.select({ noticeId: schema.registrationPeriodNotices.noticeId })
        .from(schema.registrationPeriodNotices)
        .where(eq(schema.registrationPeriodNotices.periodId, period.id)),
      db.select({ extraId: schema.registrationPeriodExtras.extraId })
        .from(schema.registrationPeriodExtras)
        .where(eq(schema.registrationPeriodExtras.periodId, period.id)),
      db.select({ discountId: schema.registrationPeriodDiscounts.discountId })
        .from(schema.registrationPeriodDiscounts)
        .where(eq(schema.registrationPeriodDiscounts.periodId, period.id)),
    ])

    registrationData = {
      period: {
        id: period.id,
        status: period.status,
        baseFee: period.baseFee,
        dateOpen: period.dateOpen ? period.dateOpen.toISOString() : null,
        dateClose: period.dateClose ? period.dateClose.toISOString() : null,
        maxPlayers: period.maxPlayers,
        ageMinimum: period.ageMinimum,
        ageAsOfDate: period.ageAsOfDate,
        requiresEmergencyInfo: period.requiresEmergencyInfo,
        requiresJerseySize: period.requiresJerseySize,
        confirmationEmailBody: period.confirmationEmailBody,
        adminNotes: period.adminNotes,
        questions: questions.map((q) => ({
          id: q.id,
          questionText: q.questionText,
          questionType: q.questionType,
          isRequired: q.isRequired,
        })),
        noticeIds: periodNotices.map((n) => n.noticeId),
        extraIds: periodExtras.map((e) => e.extraId),
        discountIds: periodDiscounts.map((d) => d.discountId),
      },
      notices: allNotices,
      extras: allExtras,
      discounts: allDiscounts,
      otherPeriods: otherPeriodsRows,
    }
  } else {
    registrationData = {
      period: null,
      notices: allNotices,
      extras: allExtras,
      discounts: allDiscounts,
      otherPeriods: otherPeriodsRows,
    }
  }

  return {
    ...season,
    teams,
    roster,
    registration: registrationData,
  }
}

// Locally-scoped type for the registration tab payload
type PeriodForTab = {
  id: string
  status: string
  baseFee: number
  dateOpen: string | null
  dateClose: string | null
  maxPlayers: number | null
  ageMinimum: number | null
  ageAsOfDate: string | null
  requiresEmergencyInfo: boolean
  requiresJerseySize: boolean
  confirmationEmailBody: string | null
  adminNotes: string | null
  questions: { id: number; questionText: string; questionType: string; isRequired: boolean }[]
  noticeIds: number[]
  extraIds: number[]
  discountIds: number[]
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-500/10 text-green-700 border-green-500/30",
    draft: "bg-amber-500/10 text-amber-700 border-amber-500/30",
    completed: "bg-muted text-muted-foreground border-border",
  }
  return (
    <Badge variant="outline" className={`text-[10px] font-medium ${styles[status] || styles.completed}`}>
      {status}
    </Badge>
  )
}

export default async function SeasonDetailPage({ params }: SeasonDetailPageProps) {
  const { id } = await params
  const season = await getSeason(id)

  if (!season) notFound()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{season.name}</h1>
            <StatusBadge status={season.status} />
            {season.isCurrent && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-primary">
                Current
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {season.seasonType === "fall" ? "Fall" : "Summer"} season
            {season.leagueId && ` · League ID: ${season.leagueId}`}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <SeasonTabs season={season} />
    </div>
  )
}
