"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, Plus, Calendar, Trash2, Edit, ClipboardList, Shuffle, Trophy, LayoutList, LayoutGrid } from "lucide-react"
import Link from "next/link"
import { TeamLogo } from "@/components/team-logo"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { EditGameModal, GameFormData } from "./edit-game-modal"
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
  gameType: "regular" | "playoff" | "championship" | "exhibition" | "practice"
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
  
  const [modalOpen, setModalOpen] = useState(false)
  const [editingGame, setEditingGame] = useState<GameFormData | null>(null)
  
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const [deleteScheduleModalOpen, setDeleteScheduleModalOpen] = useState(false)
  const [deleteScheduleMode, setDeleteScheduleMode] = useState<"upcoming" | "all">("upcoming")
  const [viewMode, setViewMode] = useState<"card" | "table">("card")
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  const [rrWizardOpen, setRrWizardOpen] = useState(false)
  const [playoffWizardOpen, setPlayoffWizardOpen] = useState(false)

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
    setEditingGame(null)
    setModalOpen(true)
  }

  const openEditGame = (game: ScheduleGame) => {
    setEditingGame({
      id: game.id,
      date: game.date,
      time: game.time,
      homeTeam: game.homeSlug,
      awayTeam: game.awaySlug,
      location: game.location,
      gameType: game.gameType,
      status: game.status,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      isOvertime: game.isOvertime,
      hasShootout: game.hasShootout,
      isForfeit: game.isForfeit,
      notes: game.notes,
      homeNotes: game.homeNotes,
      awayNotes: game.awayNotes,
    })
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
        <div className="flex gap-2 flex-1">
          <Select value={teamFilter} onValueChange={(val) => {
            setTeamFilter(val)
            if (val !== "all") setViewMode("table")
          }}>
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
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(val) => { if (val) setViewMode(val as "card" | "table") }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="card" aria-label="Card view">
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Table view">
              <LayoutList className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            {isLoading ? "Loading schedule..." : `${games.length} games total`}
          </CardDescription>
        </CardHeader>
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
              <div className="border rounded-md overflow-hidden bg-background">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date & Time</TableHead>
                      <TableHead className="text-right">Away</TableHead>
                      <TableHead className="text-center w-8"></TableHead>
                      <TableHead>Home</TableHead>
                      <TableHead>Status</TableHead>
                      {isEditable && <TableHead className="text-right w-28">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredGames.map(g => (
                      <TableRow key={g.id}>
                        <TableCell className="whitespace-nowrap font-medium text-xs">
                          {new Date(g.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} 
                          <span className="text-muted-foreground ml-2">{formatGameTime(g.time)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="font-bold text-base">
                              {g.awayScore !== null ? g.awayScore : ""}
                            </span>
                            <span className={g.awaySlug === "tbd" ? "text-muted-foreground italic" : ""}>
                              {getTeamDisplay(g.awayTeam, g.awayPlaceholder)}
                            </span>
                            {g.awaySlug !== "tbd" && <TeamLogo slug={g.awaySlug} name={g.awayTeam} size={18} />}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-muted-foreground font-medium">VS</span>
                            {(g.isOvertime || g.hasShootout || g.isForfeit) && (
                              <div className="flex gap-1">
                                {g.isOvertime && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 min-w-0">OT</Badge>}
                                {g.hasShootout && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 min-w-0">SO</Badge>}
                                {g.isForfeit && <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4 min-w-0">Forfeit</Badge>}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {g.homeSlug !== "tbd" && <TeamLogo slug={g.homeSlug} name={g.homeTeam} size={18} />}
                            <span className={g.homeSlug === "tbd" ? "text-muted-foreground italic" : ""}>
                              {getTeamDisplay(g.homeTeam, g.homePlaceholder)}
                            </span>
                            <span className="font-bold text-base">
                              {g.homeScore !== null ? g.homeScore : ""}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={g.status === "live" ? "destructive" : g.status === "final" ? "secondary" : "default"} className="capitalize text-[10px]">
                              {g.status}
                            </Badge>
                            {g.gameType !== "regular" && (
                              <Badge variant="outline" className="capitalize text-[10px]">
                                {g.gameType}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        {isEditable && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" asChild title="Open Scorekeeper">
                                <Link href={`/scorekeeper/${g.id}`} target="_blank">
                                  <ClipboardList className="h-3.5 w-3.5" />
                                </Link>
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditGame(g)} title="Edit Game">
                                <Edit className="h-3.5 w-3.5" />
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
                            <Button variant="ghost" size="icon" asChild title="Open Scorekeeper">
                              <Link href={`/scorekeeper/${g.id}`} target="_blank">
                                <ClipboardList className="h-4 w-4" />
                              </Link>
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => openEditGame(g)} title="Edit Game">
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(g.id)} title="Delete Game">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            )
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
        game={editingGame}
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
