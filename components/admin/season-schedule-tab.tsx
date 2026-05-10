"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Loader2, Plus, Calendar, Trash2, Edit, Shuffle, Trophy, ArrowRightLeft, AlertCircle, LayoutGrid, List } from "lucide-react"
import Link from "next/link"
import { TeamLogo } from "@/components/team-logo"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { EditGameModal } from "./edit-game-modal"
import { RoundRobinWizard } from "./round-robin-wizard"
import { PlayoffWizard } from "./playoff-wizard"
import { formatGameTime } from "@/lib/format-time"

interface SeasonScheduleTabProps {
  seasonId: string
  seasonStatus: string
  initialTeams: { teamSlug: string; teamName: string }[]
  defaultLocation: string
}

export interface ScheduleGame {
  id: string
  date: string
  time: string
  homeSlug: string
  homeTeam: string
  homePlaceholder: string | null
  awaySlug: string
  awayTeam: string
  awayPlaceholder: string | null
  location: string
  gameType: "regular" | "playoff" | "championship" | "exhibition" | "practice" | "tryout"
  status: "upcoming" | "live" | "final"
  homeScore: number | null
  awayScore: number | null
  isOvertime: boolean
  hasShootout: boolean
  isForfeit: boolean
  isPlayoff: boolean
  notes: string | null
  homeNotes: string | null
  awayNotes: string | null
}

export function SeasonScheduleTab({ seasonId, seasonStatus, initialTeams, defaultLocation }: SeasonScheduleTabProps) {
  const [games, setGames] = useState<ScheduleGame[]>([])
  const [isLoading, setIsLoading] = useState(true)
  

  const [teamFilter, setTeamFilter] = useState("all")
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards")
  
  const [modalOpen, setModalOpen] = useState(false)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const [deleteScheduleModalOpen, setDeleteScheduleModalOpen] = useState(false)
  const [deleteScheduleMode, setDeleteScheduleMode] = useState<"upcoming" | "all">("upcoming")
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  const [rrWizardOpen, setRrWizardOpen] = useState(false)
  const [playoffWizardOpen, setPlayoffWizardOpen] = useState(false)

  // Placeholder replacement state
  const [placeholderMappings, setPlaceholderMappings] = useState<Record<string, string>>({})
  const [isReplacing, setIsReplacing] = useState(false)

  const isEditable = seasonStatus === "draft" || seasonStatus === "active"

  const fetchGames = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/schedule?_t=${Date.now()}`)
      if (res.ok) {
        const data = await res.json()
        setGames(data || [])
      }
    } catch (err) {
      console.error(err)
      toast.error("Failed to load schedule")
    } finally {
      setIsLoading(false)
    }
  }, [seasonId])

  useEffect(() => {
    fetchGames()
  }, [fetchGames])

  const handleDelete = async (force: boolean = false) => {
    if (!deleteId) return
    setIsDeleting(true)
    
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/schedule/${deleteId}${force ? "?force=true" : ""}`, {
        method: "DELETE",
      })
      
      if (!res.ok) {
        const data = await res.json()
        if (data.error && data.error.includes("force")) {
          // If the API refuses because it's final with boxscore, we could prompt again with force
          // But for now just show the error. A real implementation would show a "force delete" dialog.
          toast.error(data.error)
          return
        }
        throw new Error(data.error || "Failed to delete game")
      }
      
      toast.success("Game deleted")
      fetchGames()
      setDeleteId(null)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsDeleting(false)
    }
  }

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/schedule?mode=${deleteScheduleMode}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        throw new Error("Failed to delete schedule")
      }
      toast.success("Schedule deleted successfully")
      setDeleteScheduleModalOpen(false)
      fetchGames()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsBulkDeleting(false)
    }
  }

  const openAddGame = () => {
    setModalOpen(true)
  }

  const filteredGames = games.filter(g => {
    // Team filter
    const matchesTeam = teamFilter === "all" || g.homeSlug === teamFilter || g.awaySlug === teamFilter
    return matchesTeam
  })

  // Group by date
  const groupedGames = filteredGames.reduce((acc: Record<string, ScheduleGame[]>, game) => {
    if (!acc[game.date]) acc[game.date] = []
    acc[game.date].push(game)
    return acc
  }, {})

  const sortedDates = Object.keys(groupedGames).sort()

  // Compute bye teams per game date for odd team counts.
  // For each regular-season date, find which season teams are NOT playing.
  const byesByDate = useMemo(() => {
    const isOdd = initialTeams.length % 2 !== 0
    if (!isOdd || initialTeams.length < 3) return {} as Record<string, string[]>

    const result: Record<string, string[]> = {}
    const allSlugs = new Set(initialTeams.map(t => t.teamSlug))

    for (const [date, dateGames] of Object.entries(groupedGames)) {
      // Only annotate byes on regular-season game dates
      if (!dateGames.some(g => g.gameType === "regular")) continue

      const playingSlugs = new Set<string>()
      for (const g of dateGames) {
        if (g.gameType === "regular") {
          playingSlugs.add(g.homeSlug)
          playingSlugs.add(g.awaySlug)
        }
      }

      const byes: string[] = []
      for (const slug of allSlugs) {
        if (!playingSlugs.has(slug)) byes.push(slug)
      }
      if (byes.length > 0) result[date] = byes
    }
    return result
  }, [groupedGames, initialTeams])



  const getTeamDisplay = (teamName: string, placeholder: string | null) => {
    if (teamName === "(TBD)" && placeholder) {
      return placeholder
    }
    return teamName
  }


  const totalUpcoming = games.filter(g => g.status === "upcoming").length
  const totalToDelete = deleteScheduleMode === "all" ? games.length : totalUpcoming

  const lastRegularSeasonGame = games
    .filter(g => g.gameType === "regular" && g.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
  const lastRegularSeasonDate = lastRegularSeasonGame?.date || null

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="flex gap-2 flex-1 items-center">
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Teams</SelectItem>
              {initialTeams.map(t => (
                <SelectItem key={t.teamSlug} value={t.teamSlug}>{t.teamName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center border rounded-md">
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 rounded-r-none ${viewMode === "cards" ? "bg-muted" : ""}`}
              onClick={() => setViewMode("cards")}
              title="Card view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 rounded-l-none ${viewMode === "table" ? "bg-muted" : ""}`}
              onClick={() => setViewMode("table")}
              title="Table view"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isEditable && (
            <>
              <Button variant="outline" onClick={() => setRrWizardOpen(true)}>
                <Shuffle className="h-4 w-4 mr-2" />
                Generate Schedule
              </Button>
              <Button variant="outline" onClick={() => setPlayoffWizardOpen(true)}>
                <Trophy className="h-4 w-4 mr-2" />
                Playoff Bracket
              </Button>
              <Button onClick={openAddGame}>
                <Plus className="h-4 w-4 mr-2" />
                Add Game
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Placeholder Teams Banner */}
      {(() => {
        // Find all unique placeholder slugs in current games
        const placeholderSlugs = new Set<string>()
        for (const g of games) {
          if (g.homeSlug.startsWith("placeholder-")) placeholderSlugs.add(g.homeSlug)
          if (g.awaySlug.startsWith("placeholder-")) placeholderSlugs.add(g.awaySlug)
        }
        if (placeholderSlugs.size === 0 || !isEditable) return null

        const realTeams = initialTeams.filter(t => !t.teamSlug.startsWith("placeholder-"))
        const sortedPlaceholders = [...placeholderSlugs].sort()
        // Track which real slugs are already mapped to avoid duplicates
        const usedSlugs = new Set(Object.values(placeholderMappings))
        const allMapped = sortedPlaceholders.every(p => placeholderMappings[p])

        return (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="font-medium text-sm">Schedule uses placeholder teams</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {sortedPlaceholders.length} placeholder team{sortedPlaceholders.length !== 1 ? "s" : ""} found.
                      Map each to a real team to finalize the schedule.
                    </p>
                  </div>
                  <div className="grid gap-2">
                    {sortedPlaceholders.map(ph => (
                      <div key={ph} className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-mono shrink-0">
                          {ph}
                        </Badge>
                        <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <Select
                          value={placeholderMappings[ph] || ""}
                          onValueChange={(val) => setPlaceholderMappings(prev => ({ ...prev, [ph]: val }))}
                        >
                          <SelectTrigger className="h-8 text-xs w-[180px]">
                            <SelectValue placeholder="Select team..." />
                          </SelectTrigger>
                          <SelectContent>
                            {realTeams
                              .filter(t => !usedSlugs.has(t.teamSlug) || placeholderMappings[ph] === t.teamSlug)
                              .map(t => (
                                <SelectItem key={t.teamSlug} value={t.teamSlug}>
                                  {t.teamName}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    disabled={!allMapped || isReplacing}
                    onClick={async () => {
                      setIsReplacing(true)
                      try {
                        const mappings = Object.entries(placeholderMappings).map(([placeholder, realSlug]) => ({
                          placeholder,
                          realSlug,
                        }))
                        const res = await fetch(`/api/bash/admin/seasons/${seasonId}/schedule/replace-placeholders`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ mappings }),
                        })
                        if (res.ok) {
                          const data = await res.json()
                          toast.success(`${data.updated} game(s) updated with real teams`)
                          setPlaceholderMappings({})
                          fetchGames()
                        } else {
                          const err = await res.json()
                          toast.error(err.error || "Failed to replace placeholders")
                        }
                      } catch {
                        toast.error("Connection error")
                      } finally {
                        setIsReplacing(false)
                      }
                    }}
                  >
                    {isReplacing && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Replace All Placeholders
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })()}

      <Card>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : games.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground border border-dashed rounded-lg">
              <Calendar className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p>No games scheduled yet.</p>
              {isEditable && (
                <div className="mt-4 flex justify-center gap-2">
                  <Button variant="outline" onClick={openAddGame}>Add a Game</Button>
                </div>
              )}
            </div>
          ) : (
            viewMode === "table" ? (
              /* ── Condensed Table View ── */
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[110px]">Date</TableHead>
                      <TableHead className="w-[60px]">Time</TableHead>
                      <TableHead className="text-right">Away</TableHead>
                      <TableHead className="w-[40px] text-center">Score</TableHead>
                      <TableHead>Home</TableHead>
                      <TableHead className="w-[80px]">Status</TableHead>
                      {isEditable && <TableHead className="w-[80px]" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredGames
                      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
                      .map((g) => (
                      <TableRow key={g.id} className="h-10">
                        <TableCell className="text-xs text-muted-foreground py-1.5">
                          {new Date(g.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                        </TableCell>
                        <TableCell className="text-xs font-medium py-1.5">
                          {formatGameTime(g.time)}
                        </TableCell>
                        <TableCell className="text-right py-1.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className={`text-sm ${g.awaySlug === "tbd" ? "text-muted-foreground italic" : ""}`}>
                              {getTeamDisplay(g.awayTeam, g.awayPlaceholder)}
                            </span>
                            {g.awaySlug !== "tbd" && <TeamLogo slug={g.awaySlug} name={g.awayTeam} size={16} />}
                          </div>
                        </TableCell>
                        <TableCell className="text-center py-1.5">
                          {g.status === "final" ? (
                            <span className="text-xs font-bold tabular-nums">
                              {g.awayScore}–{g.homeScore}
                              {g.isOvertime && <span className="text-muted-foreground font-normal ml-0.5">OT</span>}
                              {g.hasShootout && <span className="text-muted-foreground font-normal ml-0.5">SO</span>}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">vs</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5">
                          <div className="flex items-center gap-1.5">
                            {g.homeSlug !== "tbd" && <TeamLogo slug={g.homeSlug} name={g.homeTeam} size={16} />}
                            <span className={`text-sm ${g.homeSlug === "tbd" ? "text-muted-foreground italic" : ""}`}>
                              {getTeamDisplay(g.homeTeam, g.homePlaceholder)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-1.5">
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={g.status === "live" ? "destructive" : g.status === "final" ? "secondary" : "default"} className="capitalize text-[10px] px-1.5 py-0">
                              {g.status}
                            </Badge>
                            {g.gameType !== "regular" && (
                              <Badge variant="outline" className="capitalize text-[10px] px-1.5 py-0">
                                {g.gameType}
                              </Badge>
                            )}
                            {g.isForfeit && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">FF</Badge>
                            )}
                          </div>
                        </TableCell>
                        {isEditable && (
                          <TableCell className="py-1.5">
                            <div className="flex items-center gap-0.5">
                              <Button variant="ghost" size="icon" className="h-7 w-7" asChild title="Edit Game">
                                <Link href={`/admin/games/${g.id}/edit`}>
                                  <Edit className="h-3.5 w-3.5" />
                                </Link>
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(g.id)} title="Delete Game">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
            /* ── Card View (existing) ── */
            <div className="space-y-8">
              {sortedDates.map(date => (
                <div key={date}>
                  <h3 className="font-semibold text-lg border-b pb-2 mb-4 sticky top-0 bg-card z-10">{
                    new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
                  }</h3>
                  <div className="grid gap-3">
                    {groupedGames[date].map((g: ScheduleGame) => (
                      <div key={g.id} className="flex flex-col sm:flex-row items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 items-center w-full">
                          
                          <div className="sm:col-span-2 text-sm font-medium">
                            {formatGameTime(g.time)}
                          </div>
                          
                          <div className="sm:col-span-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="font-bold text-lg">
                                {g.awayScore !== null ? g.awayScore : ""}
                              </span>
                              <span className={g.awaySlug === "tbd" ? "text-muted-foreground italic" : ""}>
                                {getTeamDisplay(g.awayTeam, g.awayPlaceholder)}
                              </span>
                              {g.awaySlug !== "tbd" && <TeamLogo slug={g.awaySlug} name={g.awayTeam} size={20} />}
                            </div>
                          </div>
                          
                          <div className="sm:col-span-1 flex flex-col items-center justify-center gap-1">
                            <span className="text-xs text-muted-foreground font-medium">VS</span>
                            {(g.isOvertime || g.hasShootout || g.isForfeit) && (
                              <div className="flex gap-1">
                                {g.isOvertime && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 min-w-0">OT</Badge>}
                                {g.hasShootout && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 min-w-0">SO</Badge>}
                                {g.isForfeit && <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4 min-w-0">Forfeit</Badge>}
                              </div>
                            )}
                          </div>
                          
                          <div className="sm:col-span-3 text-left">
                            <div className="flex items-center gap-1.5">
                              {g.homeSlug !== "tbd" && <TeamLogo slug={g.homeSlug} name={g.homeTeam} size={20} />}
                              <span className={g.homeSlug === "tbd" ? "text-muted-foreground italic" : ""}>
                                {getTeamDisplay(g.homeTeam, g.homePlaceholder)}
                              </span>
                              <span className="font-bold text-lg">
                                {g.homeScore !== null ? g.homeScore : ""}
                              </span>
                            </div>
                          </div>

                          <div className="sm:col-span-2 flex flex-wrap gap-1">
                            <Badge variant={g.status === "live" ? "destructive" : g.status === "final" ? "secondary" : "default"} className="capitalize text-[10px]">
                              {g.status}
                            </Badge>
                            {g.gameType !== "regular" && (
                              <Badge variant="outline" className="capitalize text-[10px]">
                                {g.gameType}
                              </Badge>
                            )}
                          </div>
                          
                          <div className="sm:col-span-1 text-xs text-muted-foreground truncate">
                            {g.location !== defaultLocation && g.location}
                          </div>

                        </div>
                        
                        {isEditable && (
                          <div className="flex items-center gap-1 mt-3 sm:mt-0 ml-4">
                            <Button variant="ghost" size="icon" asChild title="Edit Game">
                              <Link href={`/admin/games/${g.id}/edit`}>
                                <Edit className="h-4 w-4" />
                              </Link>
                            </Button>
                            <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(g.id)} title="Delete Game">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Bye annotations for odd team counts */}
                  {byesByDate[date] && byesByDate[date].length > 0 && (
                    <div className="mt-2 flex items-center gap-2 px-3 py-2 border border-dashed border-amber-300 dark:border-amber-700 rounded-lg bg-amber-50/50 dark:bg-amber-950/20">
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-700 shrink-0">
                        BYE
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {byesByDate[date].map(slug => {
                          const team = initialTeams.find(t => t.teamSlug === slug)
                          return team?.teamName ?? slug
                        }).join(", ")}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>)
          )}
        </CardContent>
      </Card>

      {isEditable && games.length > 0 && (
        <div className="flex justify-end mt-4">
          <Button variant="destructive" onClick={() => setDeleteScheduleModalOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Schedule
          </Button>
        </div>
      )}

      <EditGameModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        game={null}
        teams={initialTeams}
        seasonId={seasonId}
        defaultLocation={defaultLocation}
        onSaved={fetchGames}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the game and all associated player statistics, goalie statistics, 
              and live play-by-play data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); handleDelete(false); }}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete Game"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RoundRobinWizard
        open={rrWizardOpen}
        onOpenChange={setRrWizardOpen}
        teams={initialTeams}
        seasonId={seasonId}
        defaultLocation={defaultLocation}
        onSaved={fetchGames}
      />

      <PlayoffWizard
        open={playoffWizardOpen}
        onOpenChange={setPlayoffWizardOpen}
        teams={initialTeams}
        seasonId={seasonId}
        defaultLocation={defaultLocation}
        lastRegularSeasonDate={lastRegularSeasonDate}
        games={games}
        onSaved={fetchGames}
      />

      <Dialog open={deleteScheduleModalOpen} onOpenChange={setDeleteScheduleModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Schedule</DialogTitle>
            <DialogDescription>
              Choose which games you want to remove from the schedule.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <RadioGroup value={deleteScheduleMode} onValueChange={(v: "upcoming" | "all") => setDeleteScheduleMode(v)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="upcoming" id="r-upcoming" />
                <Label htmlFor="r-upcoming" className="cursor-pointer">Only upcoming games ({totalUpcoming})</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="all" id="r-all" />
                <Label htmlFor="r-all" className="cursor-pointer">All games ({games.length})</Label>
              </div>
            </RadioGroup>

            <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm font-medium">
              You are about to delete {totalToDelete} out of {games.length} total games. This action cannot be undone.
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteScheduleModalOpen(false)} disabled={isBulkDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={isBulkDeleting || totalToDelete === 0}>
              {isBulkDeleting ? "Deleting..." : "Confirm Deletion"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
