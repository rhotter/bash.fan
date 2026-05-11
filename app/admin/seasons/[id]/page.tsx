import { notFound } from "next/navigation"
import { db, schema } from "@/lib/db"
import { eq, ne, and, sql } from "drizzle-orm"
import { Badge } from "@/components/ui/badge"
import { SeasonTabs } from "@/components/admin/season-tabs"
import { SeasonActivationChecklist } from "@/components/admin/season-activation-checklist"

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
    .select({
      teamSlug: schema.seasonTeams.teamSlug,
      teamName: schema.teams.name,
      franchiseSlug: schema.seasonTeams.franchiseSlug,
      color: schema.seasonTeams.color,
    })
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

  const [{ count: gameCount }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(schema.games)
    .where(eq(schema.games.seasonId, id))

  const drafts = await db
    .select({ id: schema.draftInstances.id, status: schema.draftInstances.status })
    .from(schema.draftInstances)
    .where(eq(schema.draftInstances.seasonId, id))

  return {
    ...season,
    teams,
    roster,
    gameCount,
    drafts,
  }
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

      <SeasonActivationChecklist season={season} />

      {/* Tabs */}
      <SeasonTabs season={season} />
    </div>
  )
}
