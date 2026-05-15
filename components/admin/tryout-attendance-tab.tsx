"use client"

import { useState, useEffect, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, Search, Filter, Users } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import { playerSlug } from "@/lib/player-slug"

interface GameAttendance {
  gameId: string
  date: string
  title: string | null
}

interface AttendancePlayer {
  playerId: number
  name: string
  tryoutGamesAttended: number
  isNewPlayer: boolean
  games: GameAttendance[]
}

interface TryoutAttendanceTabProps {
  seasonId: string
}

/** Format a date string to a short display label, e.g. "May 11" */
function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** Returns the display label for a game: title if present, otherwise short date */
function gameLabel(game: GameAttendance): string {
  return game.title || formatShortDate(game.date)
}

export function TryoutAttendanceTab({ seasonId }: TryoutAttendanceTabProps) {
  const [players, setPlayers] = useState<AttendancePlayer[]>([])
  const [totalTryoutGames, setTotalTryoutGames] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [showNewOnly, setShowNewOnly] = useState(false)

  const fetchAttendance = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/tryout-attendance`)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to fetch attendance")
      }
      const data = await res.json()
      setPlayers(data.players || [])
      setTotalTryoutGames(data.totalTryoutGames || 0)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load tryout attendance")
    } finally {
      setIsLoading(false)
    }
  }, [seasonId])

  useEffect(() => {
    fetchAttendance()
  }, [fetchAttendance])

  const filtered = players.filter((p) => {
    if (showNewOnly && !p.isNewPlayer) return false
    if (searchQuery.trim()) {
      return p.name.toLowerCase().includes(searchQuery.toLowerCase())
    }
    return true
  })

  const newPlayerCount = players.filter((p) => p.isNewPlayer).length
  const returningPlayerCount = players.length - newPlayerCount

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading tryout attendance…</span>
      </div>
    )
  }

  if (totalTryoutGames === 0) {
    return (
      <div className="text-center py-16 space-y-3">
        <Users className="h-10 w-10 text-muted-foreground/30 mx-auto" />
        <p className="text-sm text-muted-foreground">
          No tryout games found for this season.
        </p>
        <p className="text-xs text-muted-foreground/60">
          Create a game with type &ldquo;Tryout&rdquo; from the Schedule tab to start tracking attendance.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold tabular-nums">{totalTryoutGames}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Tryout Games</div>
        </div>
        <div className="bg-card border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold tabular-nums">{players.length}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Total Players</div>
        </div>
        <div className="bg-card border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold tabular-nums text-teal-600">{newPlayerCount}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">New Players</div>
        </div>
        <div className="bg-card border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold tabular-nums">{returningPlayerCount}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Returning</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search players…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Button
          variant={showNewOnly ? "default" : "outline"}
          size="sm"
          className="h-9 gap-1.5 shrink-0"
          onClick={() => setShowNewOnly(!showNewOnly)}
        >
          <Filter className="h-3.5 w-3.5" />
          New players only
          {showNewOnly && (
            <Badge variant="secondary" className="ml-1 h-4 text-[9px] px-1">
              {newPlayerCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Results count */}
      <div className="text-xs text-muted-foreground">
        Showing {filtered.length} of {players.length} players
        {showNewOnly && " (new players only)"}
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Player</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[200px]">Games Attended</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[80px]">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center py-8 text-sm text-muted-foreground">
                  {searchQuery
                    ? `No players matching "${searchQuery}"`
                    : "No players match the current filter."}
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.playerId} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/player/${playerSlug(p.name)}`}
                      className="text-sm font-medium hover:text-primary transition-colors hover:underline underline-offset-2"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold tabular-nums text-xs shrink-0">{p.tryoutGamesAttended}/{totalTryoutGames}</span>
                      <div className="flex flex-wrap gap-1">
                        {p.games.map((g) => (
                          <Link
                            key={g.gameId}
                            href={`/game/${g.gameId}`}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted hover:bg-primary/10 hover:text-primary transition-colors"
                            title={g.title ? `${g.title} — ${formatShortDate(g.date)}` : formatShortDate(g.date)}
                          >
                            {gameLabel(g)}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {p.isNewPlayer ? (
                      <Badge className="bg-teal-500/10 text-teal-600 border-teal-500/20 hover:bg-teal-500/20 text-[10px] uppercase tracking-wider font-semibold">
                        New
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Returning</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
