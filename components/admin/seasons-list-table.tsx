"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { MoreHorizontal, MapPin } from "lucide-react"

export interface SeasonRow {
  id: string
  name: string
  seasonType: string
  status: string
  isCurrent: boolean
  teamCount: number
  gameCount: number
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

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className="text-[10px] font-medium">
      {type}
    </Badge>
  )
}

export function SeasonsListTable({ seasons }: { seasons: SeasonRow[] }) {
  const router = useRouter()
  const [confirmSeason, setConfirmSeason] = useState<SeasonRow | null>(null)
  const [isSettingCurrent, setIsSettingCurrent] = useState(false)

  const currentSeason = seasons.find((s) => s.isCurrent)

  const navigateToSeason = (seasonId: string) => {
    router.push(`/admin/seasons/${seasonId}`)
  }

  const handleSetCurrent = async () => {
    if (!confirmSeason) return
    setIsSettingCurrent(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${confirmSeason.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCurrent: true }),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || "Failed to set current season")
        return
      }
      router.refresh()
    } catch {
      alert("Failed to set current season")
    } finally {
      setIsSettingCurrent(false)
      setConfirmSeason(null)
    }
  }

  return (
    <>
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
              <TableHead className="w-10" />
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
                <TableRow
                  key={season.id}
                  tabIndex={0}
                  role="link"
                  aria-label={`Open ${season.name}`}
                  className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none"
                  onClick={() => navigateToSeason(season.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      navigateToSeason(season.id)
                    }
                  }}
                >
                  <TableCell>
                    <span className="font-medium">{season.name}</span>
                    {season.isCurrent && (
                      <Badge variant="outline" className="ml-2 text-[9px] font-semibold uppercase tracking-wider border-primary/40 text-primary bg-primary/5">
                        Current
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell><TypeBadge type={season.seasonType} /></TableCell>
                  <TableCell><StatusBadge status={season.status} /></TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">{season.teamCount}</TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">{season.gameCount}</TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">{season.playerCount}</TableCell>
                  <TableCell>
                    {!season.isCurrent && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem
                            onClick={() => setConfirmSeason(season)}
                          >
                            <MapPin className="h-3.5 w-3.5 mr-2" />
                            Set as Current
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Confirmation dialog */}
      <AlertDialog open={!!confirmSeason} onOpenChange={(open) => !open && setConfirmSeason(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch current season?</AlertDialogTitle>
            <AlertDialogDescription>
              {currentSeason ? (
                <>
                  This will change the current season from{" "}
                  <span className="font-semibold text-foreground">{currentSeason.name}</span> to{" "}
                  <span className="font-semibold text-foreground">{confirmSeason?.name}</span>.
                  The home page, standings, and stats will default to the new season.
                </>
              ) : (
                <>
                  This will set{" "}
                  <span className="font-semibold text-foreground">{confirmSeason?.name}</span>{" "}
                  as the current season. The home page, standings, and stats will default to it.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSettingCurrent}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSetCurrent} disabled={isSettingCurrent}>
              {isSettingCurrent ? "Switching…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
