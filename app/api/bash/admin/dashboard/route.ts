import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { sql, inArray } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"

export async function GET() {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const seasons = await db
    .select({
      id: schema.seasons.id,
      name: schema.seasons.name,
      seasonType: schema.seasons.seasonType,
      status: schema.seasons.status,
      isCurrent: schema.seasons.isCurrent,
      // TODO: Remove seed-* filtering once legacy seed teams are cleaned from production
      teamCount: sql<number>`(SELECT COUNT(*)::int FROM season_teams WHERE season_teams.season_id = seasons.id AND team_slug != 'tbd' AND team_slug NOT LIKE 'seed-%')`,
      gameCount: sql<number>`(SELECT COUNT(*)::int FROM games WHERE games.season_id = seasons.id)`,
      completedGameCount: sql<number>`(SELECT COUNT(*)::int FROM games WHERE games.season_id = seasons.id AND games.status = 'final')`,
      playerCount: sql<number>`(SELECT COUNT(DISTINCT player_id)::int FROM player_seasons WHERE player_seasons.season_id = seasons.id)`,
    })
    .from(schema.seasons)
    .where(inArray(schema.seasons.status, ["active", "draft"]))
    .orderBy(sql`${schema.seasons.isCurrent} DESC, ${schema.seasons.id} DESC`)

  return NextResponse.json({ seasons })
}
