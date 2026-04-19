import Link from "next/link"
import { Plus } from "lucide-react"
import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { Button } from "@/components/ui/button"
import { ActiveSeasonsTable } from "@/components/admin/active-seasons-table"

async function getDashboardData() {
  const rows = await rawSql(sql`
    SELECT
      s.id,
      s.name,
      s.season_type AS "seasonType",
      s.status,
      s.is_current AS "isCurrent",
      (SELECT COUNT(*)::int FROM season_teams WHERE season_id = s.id) AS "teamCount",
      (SELECT COUNT(*)::int FROM games WHERE season_id = s.id) AS "gameCount",
      (SELECT COUNT(*)::int FROM games WHERE season_id = s.id AND status = 'final') AS "completedGameCount",
      (SELECT COUNT(DISTINCT player_id)::int FROM player_seasons WHERE season_id = s.id) AS "playerCount"
    FROM seasons s
    WHERE s.status IN ('active', 'draft')
    ORDER BY s.is_current DESC, s.id DESC
  `)

  // Parse and map to plain objects safely, coercing counts to numbers
  // This avoids Next.js Server Components serialization errors (BigInt, objects, etc)
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    seasonType: row.seasonType,
    status: row.status,
    isCurrent: row.isCurrent,
    teamCount: Number(row.teamCount || 0),
    gameCount: Number(row.gameCount || 0),
    completedGameCount: Number(row.completedGameCount || 0),
    playerCount: Number(row.playerCount || 0),
  }))
}

export default async function AdminDashboardPage() {
  const seasons = await getDashboardData()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Active and draft seasons overview
          </p>
        </div>
        <Button asChild size="sm" className="font-semibold">
          <Link href="/admin/seasons/new">
            <Plus className="h-4 w-4 mr-1.5" />
            New Season
          </Link>
        </Button>
      </div>

      <ActiveSeasonsTable seasons={seasons} />
    </div>
  )
}
