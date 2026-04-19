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
      teamCount: sql<number>`(SELECT COUNT(*) FROM season_teams WHERE season_id = ${schema.seasons.id})`,
      gameCount: sql<number>`(SELECT COUNT(*) FROM games WHERE season_id = ${schema.seasons.id})`,
      completedGameCount: sql<number>`(SELECT COUNT(*) FROM games WHERE season_id = ${schema.seasons.id} AND status = 'final')`,
      playerCount: sql<number>`(SELECT COUNT(DISTINCT player_id) FROM player_seasons WHERE season_id = ${schema.seasons.id})`,
    })
    .from(schema.seasons)
    .where(inArray(schema.seasons.status, ["active", "draft"]))
    .orderBy(sql`${schema.seasons.isCurrent} DESC, ${schema.seasons.id} DESC`)

  return NextResponse.json({ seasons })
}
