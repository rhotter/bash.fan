import Link from "next/link"
import { Plus } from "lucide-react"
import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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
      (SELECT COUNT(*)::int FROM season_teams WHERE season_id = s.id) AS "teamCount",
      (SELECT COUNT(*)::int FROM games WHERE season_id = s.id) AS "gameCount",
      (SELECT COUNT(DISTINCT player_id)::int FROM player_seasons WHERE season_id = s.id) AS "playerCount"
    FROM seasons s
    WHERE 1=1 ${statusClause} ${typeClause}
    ORDER BY s.id DESC
  `)

  return rows
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

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className="text-[10px] font-medium">
      {type}
    </Badge>
  )
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

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-semibold">Name</TableHead>
              <TableHead className="text-xs font-semibold">Type</TableHead>
              <TableHead className="text-xs font-semibold">Status</TableHead>
              <TableHead className="text-xs font-semibold text-center">Teams</TableHead>
              <TableHead className="text-xs font-semibold text-center">Games</TableHead>
              <TableHead className="text-xs font-semibold text-center">Players</TableHead>
              <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {seasons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                  No seasons found
                </TableCell>
              </TableRow>
            ) : (
              seasons.map((season) => (
                <TableRow key={season.id}>
                  <TableCell>
                    <Link
                      href={`/admin/seasons/${season.id}`}
                      className="font-medium hover:text-primary transition-colors"
                    >
                      {season.name}
                    </Link>
                    {season.isCurrent && (
                      <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                        Current
                      </span>
                    )}
                  </TableCell>
                  <TableCell><TypeBadge type={season.seasonType} /></TableCell>
                  <TableCell><StatusBadge status={season.status} /></TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">{season.teamCount}</TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">{season.gameCount}</TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">{season.playerCount}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/admin/seasons/${season.id}`}
                        className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
                      >
                        Edit
                      </Link>
                      {season.status !== "draft" && (
                        <Link
                          href={`/?season=${season.id}`}
                          target="_blank"
                          className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
                        >
                          View
                        </Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
