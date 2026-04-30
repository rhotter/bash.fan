import { notFound } from "next/navigation"
import { db, rawSql, schema } from "@/lib/db"
import { eq, ne, and, sql } from "drizzle-orm"
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

  const [counts] = await rawSql(sql`
    SELECT
      (SELECT COUNT(*)::int FROM games WHERE season_id = ${id}) AS "gameCount",
      (SELECT COUNT(*)::int FROM games WHERE season_id = ${id} AND status = 'final') AS "completedGameCount",
      (SELECT COUNT(DISTINCT player_id)::int FROM player_seasons WHERE season_id = ${id}) AS "playerCount"
  `)

  const recentGames = await rawSql(sql`
    SELECT g.id, g.date, g.time, g.away_team AS "awayTeam", g.home_team AS "homeTeam", g.location,
      COALESCE(
        (SELECT json_agg(json_build_object('name', o.name, 'role', o.role) ORDER BY o.role, o.name)
         FROM game_officials o WHERE o.game_id = g.id), '[]'::json
      ) AS officials
    FROM games g
    WHERE g.season_id = ${id} 
      AND g.date::date >= (now() AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '7 days'
      AND g.date::date <= (now() AT TIME ZONE 'America/Los_Angeles')::date
    ORDER BY g.date DESC, g.time DESC
  `)

  const upcomingGames = await rawSql(sql`
    SELECT g.id, g.date, g.time, g.away_team AS "awayTeam", g.home_team AS "homeTeam", g.location,
      COALESCE(
        (SELECT json_agg(json_build_object('name', o.name, 'role', o.role) ORDER BY o.role, o.name)
         FROM game_officials o WHERE o.game_id = g.id), '[]'::json
      ) AS officials
    FROM games g
    WHERE g.season_id = ${id} 
      AND g.date::date > (now() AT TIME ZONE 'America/Los_Angeles')::date
      AND g.date::date <= (now() AT TIME ZONE 'America/Los_Angeles')::date + INTERVAL '7 days'
    ORDER BY g.date ASC, g.time ASC
  `)

  return {
    ...season,
    teams,
    roster,
    gameCount: counts?.gameCount ?? 0,
    completedGameCount: counts?.completedGameCount ?? 0,
    playerCount: counts?.playerCount ?? 0,
    recentGames: recentGames as { id: number; date: string; time: string | null; awayTeam: string; homeTeam: string; location: string | null; officials: { name: string; role: string }[] }[],
    upcomingGames: upcomingGames as { id: number; date: string; time: string | null; awayTeam: string; homeTeam: string; location: string | null; officials: { name: string; role: string }[] }[],
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

      {/* Tabs */}
      <SeasonTabs season={season} />
    </div>
  )
}
