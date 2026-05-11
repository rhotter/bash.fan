import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Plus, Search, Loader2, ArrowUpDown, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { TeamLogo } from "@/components/team-logo"
import { Badge } from "@/components/ui/badge"
import { SportabilityImportModal } from "@/components/admin/sportability-import-modal"


interface RosterPlayer {
  playerId: number
  playerName: string
  teamSlug: string
  isGoalie: boolean
  isRookie: boolean
}

interface SeasonRosterTabProps {
  seasonId: string
  seasonStatus: string
  roster: RosterPlayer[]
  teams: { teamSlug: string; teamName: string }[]
  onRosterChange?: (roster: RosterPlayer[]) => void
}

export function SeasonRosterTab({ seasonId, seasonStatus, roster, teams, onRosterChange }: SeasonRosterTabProps) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState("")
  const [teamFilter, setTeamFilter] = useState("all")
  const [experienceFilter, setExperienceFilter] = useState("all")
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: "asc" | "desc" } | null>(null)

  // Re-fetch roster from the API and push to parent state
  const refreshRoster = useCallback(async () => {
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/roster`)
      if (res.ok) {
        const data = await res.json()
        onRosterChange?.(data.roster)
      }
    } catch {
      // Silently fail — the user can still hard-refresh
    }
  }, [seasonId, onRosterChange])

  // Add Player State
  const [isAddPlayerOpen, setIsAddPlayerOpen] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [newPlayerName, setNewPlayerName] = useState("")
  const [newPlayerTeam, setNewPlayerTeam] = useState("")
  const [newPlayerPosition, setNewPlayerPosition] = useState("skater")

  const handleAddPlayer = async () => {
    if (!newPlayerName || !newPlayerTeam) {
      toast.error("Please fill in all fields.")
      return
    }
    
    setIsAdding(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/roster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: newPlayerName.trim(),
          teamSlug: newPlayerTeam,
          isGoalie: newPlayerPosition === "goalie",
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to add player")
      }

      toast.success("Player added successfully")
      setIsAddPlayerOpen(false)
      setNewPlayerName("")
      setNewPlayerTeam("")
      setNewPlayerPosition("skater")
      await refreshRoster()
      router.refresh()
    } catch (err: unknown) {
      if (err instanceof Error) toast.error(err.message)
      else toast.error("An unknown error occurred")
    } finally {
      setIsAdding(false)
    }
  }

  // Edit Player State
  const [isEditPlayerOpen, setIsEditPlayerOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editingPlayer, setEditingPlayer] = useState<RosterPlayer | null>(null)
  const [editPlayerName, setEditPlayerName] = useState("")
  const [editPlayerTeam, setEditPlayerTeam] = useState("")
  const [editPlayerPosition, setEditPlayerPosition] = useState("skater")

  const handleEditClick = (player: RosterPlayer) => {
    if (seasonStatus !== "draft") return
    setEditingPlayer(player)
    setEditPlayerName(player.playerName)
    setEditPlayerTeam(player.teamSlug)
    setEditPlayerPosition(player.isGoalie ? "goalie" : "skater")
    setIsEditPlayerOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editingPlayer || !editPlayerName || !editPlayerTeam) {
      toast.error("Please fill in all fields.")
      return
    }
    
    setIsEditing(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/roster`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: editingPlayer.playerId,
          oldTeamSlug: editingPlayer.teamSlug,
          playerName: editPlayerName.trim(),
          teamSlug: editPlayerTeam,
          isGoalie: editPlayerPosition === "goalie",
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to update player")
      }

      toast.success("Player updated successfully")
      setIsEditPlayerOpen(false)
      await refreshRoster()
      router.refresh()
    } catch (err: unknown) {
      if (err instanceof Error) toast.error(err.message)
      else toast.error("An unknown error occurred")
    } finally {
      setIsEditing(false)
    }
  }

  const handleDeletePlayer = async () => {
    if (!editingPlayer?.playerId) return

    setIsEditing(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/roster?playerId=${editingPlayer.playerId}`, {
        method: "DELETE",
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to remove player")
      }

      toast.success("Player removed from season")
      setIsDeleteDialogOpen(false)
      setIsEditPlayerOpen(false)
      await refreshRoster()
      router.refresh()
    } catch (err: unknown) {
      if (err instanceof Error) toast.error(err.message)
      else toast.error("An unknown error occurred")
    } finally {
      setIsEditing(false)
    }
  }

  // Filter the roster
  const filteredRoster = roster.filter((player) => {
    // 1. Team filter
    if (teamFilter !== "all" && player.teamSlug !== teamFilter) {
      return false
    }
    // 2. Experience filter
    if (experienceFilter === "veterans" && player.isRookie) {
      return false
    }
    if (experienceFilter === "rookies" && !player.isRookie) {
      return false
    }
    // 3. Search query
    if (searchQuery && !player.playerName.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }
    return true
  })

  // Get team name helper
  const getTeamName = (slug: string) => {
    return teams.find((t) => t.teamSlug === slug)?.teamName || slug
  }

  // Sort the roster
  const sortedRoster = [...filteredRoster].sort((a, b) => {
    if (!sortConfig) return 0
    let aValue: string | number | boolean = a[sortConfig.key as keyof RosterPlayer]
    let bValue: string | number | boolean = b[sortConfig.key as keyof RosterPlayer]
    
    if (sortConfig.key === "teamName") {
      aValue = getTeamName(a.teamSlug)
      bValue = getTeamName(b.teamSlug)
    }

    if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1
    if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1
    return 0
  })

  const handleSort = (key: string) => {
    let direction: "asc" | "desc" = "asc"
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc"
    }
    setSortConfig({ key, direction })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              Roster Management
              <Badge variant="secondary" className="rounded-full">
                {roster.length} Players
              </Badge>
            </CardTitle>
            <CardDescription>
              {seasonStatus === "draft" 
                ? "Assign players to teams for the upcoming season." 
                : "View the locked roster for this season."}
            </CardDescription>
          </div>
          {seasonStatus === "draft" && (
            <div className="flex items-center gap-2">
              <SportabilityImportModal seasonId={seasonId} seasonStatus={seasonStatus} onImportComplete={refreshRoster} />
              <Dialog open={isAddPlayerOpen} onOpenChange={setIsAddPlayerOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Player
                  </Button>
                </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Player to Roster</DialogTitle>
                  <DialogDescription>
                    Assign a player to a team for this season. If the player doesn't exist yet, a new profile will be created.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="playerName">Player Name</Label>
                    <Input
                      id="playerName"
                      placeholder="e.g. John Doe"
                      value={newPlayerName}
                      onChange={(e) => setNewPlayerName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Assign to Team</Label>
                    <Select value={newPlayerTeam} onValueChange={setNewPlayerTeam}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a team" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tbd" className="font-semibold text-muted-foreground">Unassigned (TBD)</SelectItem>
                        {teams.map((t) => (
                          <SelectItem key={t.teamSlug} value={t.teamSlug}>
                            {t.teamName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Position</Label>
                    <Select value={newPlayerPosition} onValueChange={setNewPlayerPosition}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skater">Skater</SelectItem>
                        <SelectItem value="goalie">Goalie</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddPlayerOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddPlayer} disabled={isAdding || !newPlayerName || !newPlayerTeam}>
                    {isAdding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Add Player
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          )}

          {/* Edit Player Modal (Hidden structure, triggered by row click) */}
          <Dialog open={isEditPlayerOpen} onOpenChange={setIsEditPlayerOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Player</DialogTitle>
                <DialogDescription>
                  Update the player's name, team assignment, or position. Rookie status is computed from prior fall-season participation.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="editPlayerName">Player Name</Label>
                  <Input
                    id="editPlayerName"
                    value={editPlayerName}
                    onChange={(e) => setEditPlayerName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Assign to Team</Label>
                  <Select value={editPlayerTeam} onValueChange={setEditPlayerTeam}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a team" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tbd" className="font-semibold text-muted-foreground">Unassigned (TBD)</SelectItem>
                      {teams.map((t) => (
                        <SelectItem key={t.teamSlug} value={t.teamSlug}>
                          {t.teamName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Position</Label>
                  <Select value={editPlayerPosition} onValueChange={setEditPlayerPosition}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skater">Skater</SelectItem>
                      <SelectItem value="goalie">Goalie</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter className="flex sm:justify-between w-full">
                <Button 
                  variant="destructive" 
                  onClick={(e) => {
                    e.preventDefault()
                    setIsDeleteDialogOpen(true)
                  }}
                  disabled={isEditing}
                >
                  Remove Player
                </Button>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsEditPlayerOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSaveEdit} disabled={isEditing || !editPlayerName || !editPlayerTeam}>
                    {isEditing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Save Changes
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete Confirmation Alert Dialog */}
          <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove {editPlayerName} from the {seasonId} season roster. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isEditing}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={(e) => {
                  e.preventDefault()
                  handleDeletePlayer()
                }} disabled={isEditing} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {isEditing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Remove Player
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Goalie coverage alert */}
        {(() => {
          const goalieCount = roster.filter((p) => p.isGoalie).length
          const teamCount = teams.filter((t) => t.teamSlug !== "tbd").length
          if (teamCount > 0 && goalieCount < teamCount) {
            return (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>Only <span className="font-semibold">{goalieCount}</span> goalie{goalieCount !== 1 ? "s" : ""} listed — fewer than the <span className="font-semibold">{teamCount}</span> teams configured. Please confirm more players whose primary position is goalie.</span>
              </div>
            )
          }
          return null
        })()}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search players..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Select value={experienceFilter} onValueChange={setExperienceFilter}>
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue placeholder="Experience" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Players</SelectItem>
                <SelectItem value="veterans">Veterans</SelectItem>
                <SelectItem value="rookies">Rookies</SelectItem>
              </SelectContent>
            </Select>
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Filter by team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Teams</SelectItem>
                <SelectItem value="tbd">Unassigned</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.teamSlug} value={t.teamSlug}>
                    {t.teamName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Dense Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px]">
                  <Button variant="ghost" onClick={() => handleSort("playerName")} className="-ml-4 h-8 data-[state=open]:bg-accent">
                    Player Name
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button variant="ghost" onClick={() => handleSort("teamName")} className="-ml-4 h-8 data-[state=open]:bg-accent">
                    Team
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead className="w-[100px] text-right">
                  <Button variant="ghost" onClick={() => handleSort("isGoalie")} className="h-8 -mr-4 justify-end data-[state=open]:bg-accent w-full">
                    Position
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRoster.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                    No players found.
                  </TableCell>
                </TableRow>
              ) : (
                sortedRoster.map((player) => (
                  <TableRow 
                    key={`${player.playerId}-${player.teamSlug}`}
                    className={seasonStatus === "draft" ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
                    onClick={() => handleEditClick(player)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {player.playerName}
                        {!player.isRookie ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Veteran</Badge>
                        ) : (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-green-600 hover:bg-green-700">Rookie</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {player.teamSlug === "tbd" ? (
                        <Badge variant="outline" className="text-muted-foreground border-dashed font-normal">
                          Pending Assignment
                        </Badge>
                      ) : (
                        <div className="flex items-center gap-2">
                          <TeamLogo slug={player.teamSlug} name={getTeamName(player.teamSlug)} size={24} />
                          <span className="text-sm">{getTeamName(player.teamSlug)}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {player.isGoalie ? (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          Goalie
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">Skater</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        
        {filteredRoster.length > 0 && (
          <div className="text-xs text-muted-foreground text-center pt-2">
            Showing {filteredRoster.length} of {roster.length} total players
          </div>
        )}
      </CardContent>
    </Card>
  )
}
