import Link from "next/link"
import { Plus } from "lucide-react"
import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { Button } from "@/components/ui/button"
import { SeasonsListTable, type SeasonRow } from "@/components/admin/seasons-list-table"

interface SeasonListPageProps {
  searchParams: Promise<{ status?: string; type?: string }>
}

async function getSeasons(statusFilter?: string, typeFilter?: string) {
  const statusClause = statusFilter && statusFilter !== "all"
    ? sql`AND s.status = ${statusFilter}`
    : sql``
  const typeClause = typeFilter && typeFilter !== "all"
    ? sql`AND s.season_type = ${typeFilter}`
    : sql``

  const rows = await rawSql(sql`
    SELECT
      s.id,
      s.name,
      s.season_type AS "seasonType",
      s.status,
      s.is_current AS "isCurrent",
      (SELECT COUNT(*)::int FROM season_teams WHERE season_id = s.id AND team_slug != 'tbd' AND team_slug NOT LIKE 'seed-%') AS "teamCount",
      (SELECT COUNT(*)::int FROM games WHERE season_id = s.id) AS "gameCount",
      (SELECT COUNT(DISTINCT player_id)::int FROM player_seasons WHERE season_id = s.id) AS "playerCount"
    FROM seasons s
    WHERE 1=1 ${statusClause} ${typeClause}
    ORDER BY s.id DESC
  `)

  return rows as SeasonRow[]
}

export default async function SeasonsListPage({ searchParams }: SeasonListPageProps) {
  const params = await searchParams
  const seasons = await getSeasons(params.status, params.type)
  const currentStatus = params.status || "all"
  const currentType = params.type || "all"

  const statusOptions = ["all", "active", "draft", "completed"]
  const typeOptions = ["all", "fall", "summer"]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Seasons</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {seasons.length} season{seasons.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button asChild size="sm" className="font-semibold">
          <Link href="/admin/seasons/new">
            <Plus className="h-4 w-4 mr-1.5" />
            New Season
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Status:</span>
          <div className="flex gap-1">
            {statusOptions.map((opt) => (
              <Link
                key={opt}
                href={`/admin/seasons?status=${opt}${currentType !== "all" ? `&type=${currentType}` : ""}`}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${
                  currentStatus === opt
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {opt}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Type:</span>
          <div className="flex gap-1">
            {typeOptions.map((opt) => (
              <Link
                key={opt}
                href={`/admin/seasons?type=${opt}${currentStatus !== "all" ? `&status=${currentStatus}` : ""}`}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${
                  currentType === opt
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {opt}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <SeasonsListTable seasons={seasons} />
    </div>
  )
}
