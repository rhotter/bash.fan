import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Search, Loader2, ArrowUpDown } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { TeamLogo } from "@/components/team-logo"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"

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
}

export function SeasonRosterTab({ seasonId, seasonStatus, roster, teams }: SeasonRosterTabProps) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState("")
  const [teamFilter, setTeamFilter] = useState("all")
  const [experienceFilter, setExperienceFilter] = useState("all")
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: "asc" | "desc" } | null>(null)

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
      router.refresh()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setIsAdding(false)
    }
  }

  // Edit Player State
  const [isEditPlayerOpen, setIsEditPlayerOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editingPlayer, setEditingPlayer] = useState<RosterPlayer | null>(null)
  const [editPlayerName, setEditPlayerName] = useState("")
  const [editPlayerTeam, setEditPlayerTeam] = useState("")
  const [editPlayerPosition, setEditPlayerPosition] = useState("skater")
  const [editPlayerRookie, setEditPlayerRookie] = useState(false)

  const handleEditClick = (player: RosterPlayer) => {
    if (seasonStatus !== "draft") return
    setEditingPlayer(player)
    setEditPlayerName(player.playerName)
    setEditPlayerTeam(player.teamSlug)
    setEditPlayerPosition(player.isGoalie ? "goalie" : "skater")
    setEditPlayerRookie(player.isRookie)
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
          isRookie: editPlayerRookie,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to update player")
      }

      toast.success("Player updated successfully")
      setIsEditPlayerOpen(false)
      router.refresh()
    } catch (err: any) {
      toast.error(err.message)
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
    
    let aValue: any = a[sortConfig.key as keyof RosterPlayer]
    let bValue: any = b[sortConfig.key as keyof RosterPlayer]
    
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
          )}

          {/* Edit Player Modal (Hidden structure, triggered by row click) */}
          <Dialog open={isEditPlayerOpen} onOpenChange={setIsEditPlayerOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Player</DialogTitle>
                <DialogDescription>
                  Update the player's name, team assignment, or rookie status.
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
                <div className="flex items-center space-x-2 pt-2">
                  <Checkbox 
                    id="editPlayerRookie" 
                    checked={editPlayerRookie} 
                    onCheckedChange={(c) => setEditPlayerRookie(!!c)} 
                  />
                  <Label htmlFor="editPlayerRookie" className="font-normal cursor-pointer">
                    Mark as Rookie
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsEditPlayerOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveEdit} disabled={isEditing || !editPlayerName || !editPlayerTeam}>
                  {isEditing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Save Changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
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
