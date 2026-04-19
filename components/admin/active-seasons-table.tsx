"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface SeasonRow {
  id: string
  name: string
  seasonType: string
  status: string
  isCurrent: boolean
  teamCount: number
  gameCount: number
  completedGameCount: number
  playerCount: number
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

export function ActiveSeasonsTable({ seasons }: { seasons: SeasonRow[] }) {
  if (seasons.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center">
        <p className="text-sm text-muted-foreground">No active or draft seasons</p>
        <Link href="/admin/seasons/new" className="text-sm text-primary hover:text-primary/80 mt-1 inline-block">
          Create a new season →
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs font-semibold">Season</TableHead>
            <TableHead className="text-xs font-semibold">Status</TableHead>
            <TableHead className="text-xs font-semibold text-center">Tms</TableHead>
            <TableHead className="text-xs font-semibold text-center">Gms</TableHead>
            <TableHead className="text-xs font-semibold text-center">Plyrs</TableHead>
            <TableHead className="text-xs font-semibold">Progress</TableHead>
            <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {seasons.map((season) => {
            const progress = season.gameCount > 0
              ? Math.round((season.completedGameCount / season.gameCount) * 100)
              : 0

            return (
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
                <TableCell>
                  <StatusBadge status={season.status} />
                </TableCell>
                <TableCell className="text-center text-sm text-muted-foreground">
                  {season.teamCount}
                </TableCell>
                <TableCell className="text-center text-sm text-muted-foreground">
                  {season.gameCount}
                </TableCell>
                <TableCell className="text-center text-sm text-muted-foreground">
                  {season.playerCount}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-[80px]">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {season.completedGameCount}/{season.gameCount}
                    </span>
                  </div>
                </TableCell>
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
            )
          })}
        </TableBody>
      </Table>

      <div className="border-t px-4 py-2">
        <Link
          href="/admin/seasons?status=completed"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View Archived →
        </Link>
      </div>
    </div>
  )
}
