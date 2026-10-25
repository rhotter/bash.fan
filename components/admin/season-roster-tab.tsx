import { fetchApi as fetch, readApiJson, errorMessage } from "@/lib/api-errors"
import { useState, useCallback, useEffect } from "react"
import { Spinner } from "@/components/ui/spinner"
import { useRouter } from "next/navigation"
import { Plus, Search, ArrowUpDown, AlertTriangle, ArrowLeftRight, Trash2 } from "lucide-react"
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

interface SeasonTradeItemEntry {
  id?: number
  itemType: string
  fromTeamSlug: string
  toTeamSlug: string
  playerId?: number | null
  playerName?: string | null
  draftPickRound?: number | null
  draftPickOriginalTeamSlug?: string | null
  draftPickTargetSeason?: string | null
}

interface SeasonTradeRecord {
  id: number
  seasonId: string
  teamSlugs?: string[]
  teamASlug?: string
  teamBSlug?: string
  notes?: string | null
  tradedAt: string
  createdAt?: string
  items?: SeasonTradeItemEntry[]
}

interface TradePickRow {
  from: string
  to: string
  round: number
  originalTeam: string
  targetSeason: string
}

export function SeasonRosterTab({ seasonId, seasonStatus, roster, teams, onRosterChange }: SeasonRosterTabProps) {
  const router = useRouter()
  const canManageRoster = seasonStatus === "draft" || seasonStatus === "active"

  const [searchQuery, setSearchQuery] = useState("")
  const [teamFilter, setTeamFilter] = useState("all")
  const [experienceFilter, setExperienceFilter] = useState("all")
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null)

  // Re-fetch roster from the API and push to parent state
  const refreshRoster = useCallback(async () => {
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/roster`)
      if (res.ok) {
        const data = await readApiJson(res)
        onRosterChange?.(data.roster)
      }
    } catch (error) {
      toast.warning(`Could not refresh the roster; showing the previous list. ${errorMessage(error)}`)
    }
  }, [seasonId, onRosterChange])

  // Trades history state
  const [trades, setTrades] = useState<SeasonTradeRecord[]>([])

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/trades`)
      if (res.ok) {
        const data = await readApiJson(res)
        setTrades(data.trades || [])
      }
    } catch {
      setTrades([])
    }
  }, [seasonId])

  useEffect(() => {
    fetchTrades()
  }, [fetchTrades])

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

      const data = await readApiJson(res)

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
    if (!canManageRoster) return
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

      const data = await readApiJson(res)

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

      const data = await readApiJson(res)

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

  // Record Trade Modal State
  const [isTradeOpen, setIsTradeOpen] = useState(false)
  const [isExecutingTrade, setIsExecutingTrade] = useState(false)
  const [tradeTeamA, setTradeTeamA] = useState("")
  const [tradeTeamB, setTradeTeamB] = useState("")
  const [selectedAPlayers, setSelectedAPlayers] = useState<number[]>([])
  const [selectedBPlayers, setSelectedBPlayers] = useState<number[]>([])
  const [draftPicks, setDraftPicks] = useState<TradePickRow[]>([])
  const [tradeNotes, setTradeNotes] = useState("")

  const teamAPlayers = roster.filter((p) => p.teamSlug === tradeTeamA)
  const teamBPlayers = roster.filter((p) => p.teamSlug === tradeTeamB)

  const handleRecordTrade = async () => {
    if (!tradeTeamA || !tradeTeamB || tradeTeamA === tradeTeamB) {
      toast.error("Please select two distinct teams")
      return
    }

    const totalAssets = selectedAPlayers.length + selectedBPlayers.length + draftPicks.length
    if (totalAssets === 0) {
      toast.error("Trade must include at least one player or draft pick")
      return
    }

    setIsExecutingTrade(true)
    try {
      const playerMoves = [
        ...selectedAPlayers.map((playerId) => ({
          playerId,
          fromTeamSlug: tradeTeamA,
          toTeamSlug: tradeTeamB,
        })),
        ...selectedBPlayers.map((playerId) => ({
          playerId,
          fromTeamSlug: tradeTeamB,
          toTeamSlug: tradeTeamA,
        })),
      ]

      const payload = {
        teamSlugs: [tradeTeamA, tradeTeamB],
        teamASlug: tradeTeamA,
        teamBSlug: tradeTeamB,
        playerMoves,
        teamAPlayerIds: selectedAPlayers,
        teamBPlayerIds: selectedBPlayers,
        draftPicks: draftPicks.map((p) => ({
          fromTeamSlug: p.from,
          toTeamSlug: p.to,
          round: p.round,
          originalTeamSlug: p.originalTeam,
          targetSeason: p.targetSeason,
        })),
        notes: tradeNotes.trim() ? tradeNotes.trim() : undefined,
      }

      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/trades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const data = await readApiJson(res)

      if (!res.ok) {
        throw new Error(data.error || "Failed to record trade")
      }

      toast.success("Trade recorded successfully")
      setIsTradeOpen(false)
      setTradeTeamA("")
      setTradeTeamB("")
      setSelectedAPlayers([])
      setSelectedBPlayers([])
      setDraftPicks([])
      setTradeNotes("")

      // Update local roster immediately if onRosterChange provided
      if (onRosterChange) {
        const updatedRoster = roster.map((p) => {
          if (selectedAPlayers.includes(p.playerId)) return { ...p, teamSlug: tradeTeamB }
          if (selectedBPlayers.includes(p.playerId)) return { ...p, teamSlug: tradeTeamA }
          return p
        })
        onRosterChange(updatedRoster)
      }

      await refreshRoster()
      await fetchTrades()
      router.refresh()
    } catch (err: unknown) {
      if (err instanceof Error) toast.error(err.message)
      else toast.error("An unknown error occurred")
    } finally {
      setIsExecutingTrade(false)
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

    if (sortConfig.key === "playerName") {
      const aStr = String(aValue).trim()
      const bStr = String(bValue).trim()
      const aParts = aStr.split(" ")
      const bParts = bStr.split(" ")
      const aLast = aParts.length > 1 ? aParts[aParts.length - 1] : aParts[0]
      const bLast = bParts.length > 1 ? bParts[bParts.length - 1] : bParts[0]

      if (aLast !== bLast) {
        return sortConfig.direction === "asc"
          ? aLast.localeCompare(bLast)
          : bLast.localeCompare(aLast)
      }
      return sortConfig.direction === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr)
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
    <div data-testid="season-roster-tab" className="space-y-6">
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
                {canManageRoster
                  ? "Assign players to teams and manage mid-season rosters."
                  : "View the locked roster for this season."}
              </CardDescription>
            </div>
            {canManageRoster && (
              <div className="flex items-center gap-2">
                {seasonStatus === "draft" && (
                  <SportabilityImportModal
                    seasonId={seasonId}
                    seasonStatus={seasonStatus}
                    onImportComplete={refreshRoster}
                  />
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsTradeOpen(true)}
                  aria-label="Record Trade"
                >
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                  Record Trade
                </Button>
                <Dialog open={isAddPlayerOpen} onOpenChange={setIsAddPlayerOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" aria-label="Add Player">
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
                            <SelectItem value="tbd" className="font-semibold text-muted-foreground">
                              Unassigned (TBD)
                            </SelectItem>
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
                        {isAdding ? <Spinner className="h-4 w-4 mr-2" /> : null}
                        Add Player
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}

            {/* Record Trade Modal */}
            <Dialog open={isTradeOpen} onOpenChange={setIsTradeOpen}>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ArrowLeftRight className="h-5 w-5" />
                    Record Mid-Season Trade
                  </DialogTitle>
                  <DialogDescription>
                    Exchange players and future draft picks between two teams for this season.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="teamA">Team A</Label>
                      <select
                        id="teamA"
                        value={tradeTeamA}
                        onChange={(e) => {
                          setTradeTeamA(e.target.value)
                          setSelectedAPlayers([])
                        }}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="">Select Team A</option>
                        {teams
                          .filter((t) => t.teamSlug !== "tbd")
                          .map((t) => (
                            <option key={t.teamSlug} value={t.teamSlug}>
                              {t.teamName}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="teamB">Team B</Label>
                      <select
                        id="teamB"
                        value={tradeTeamB}
                        onChange={(e) => {
                          setTradeTeamB(e.target.value)
                          setSelectedBPlayers([])
                        }}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="">Select Team B</option>
                        {teams
                          .filter((t) => t.teamSlug !== "tbd")
                          .map((t) => (
                            <option key={t.teamSlug} value={t.teamSlug}>
                              {t.teamName}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {tradeTeamA && (
                    <div data-testid="team-a-players" className="space-y-2 border rounded-md p-3">
                      <h3 className="font-semibold text-sm">{getTeamName(tradeTeamA)} Players to Trade</h3>
                      {teamAPlayers.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No players found on this team.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {teamAPlayers.map((p) => (
                            <label
                              key={p.playerId}
                              className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 p-1.5 rounded border border-transparent hover:border-muted"
                            >
                              <input
                                type="checkbox"
                                checked={selectedAPlayers.includes(p.playerId)}
                                onChange={(e) => {
                                  if (e.target.checked) setSelectedAPlayers([...selectedAPlayers, p.playerId])
                                  else setSelectedAPlayers(selectedAPlayers.filter((id) => id !== p.playerId))
                                }}
                                className="rounded"
                              />
                              <span className="font-medium">{p.playerName}</span>
                              {p.isGoalie && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0">
                                  Goalie
                                </Badge>
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {tradeTeamB && (
                    <div data-testid="team-b-players" className="space-y-2 border rounded-md p-3">
                      <h3 className="font-semibold text-sm">{getTeamName(tradeTeamB)} Players to Trade</h3>
                      {teamBPlayers.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No players found on this team.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {teamBPlayers.map((p) => (
                            <label
                              key={p.playerId}
                              className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 p-1.5 rounded border border-transparent hover:border-muted"
                            >
                              <input
                                type="checkbox"
                                checked={selectedBPlayers.includes(p.playerId)}
                                onChange={(e) => {
                                  if (e.target.checked) setSelectedBPlayers([...selectedBPlayers, p.playerId])
                                  else setSelectedBPlayers(selectedBPlayers.filter((id) => id !== p.playerId))
                                }}
                                className="rounded"
                              />
                              <span className="font-medium">{p.playerName}</span>
                              {p.isGoalie && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0">
                                  Goalie
                                </Badge>
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-3 border rounded-md p-3">
                    <div className="flex items-center justify-between">
                      <Label className="font-semibold text-sm">Future Draft Picks</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDraftPicks([
                            ...draftPicks,
                            {
                              from: tradeTeamA || "team-a",
                              to: tradeTeamB || "team-b",
                              round: 2,
                              originalTeam: tradeTeamA || "team-a",
                              targetSeason: "2027-summer",
                            },
                          ])
                        }}
                        disabled={!tradeTeamA || !tradeTeamB}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add Draft Pick
                      </Button>
                    </div>
                    {draftPicks.map((pick, idx) => (
                      <div
                        key={idx}
                        data-testid="draft-pick-row"
                        className="flex flex-wrap items-center gap-2 bg-muted/30 p-2 rounded-md border text-xs"
                      >
                        <span className="font-medium">
                          {pick.from} → {pick.to} Round {pick.round}
                        </span>
                        <div className="flex items-center gap-1.5 ml-auto">
                          <select
                            value={pick.from}
                            onChange={(e) => {
                              const newPicks = [...draftPicks]
                              newPicks[idx].from = e.target.value
                              newPicks[idx].to = e.target.value === tradeTeamA ? tradeTeamB : tradeTeamA
                              setDraftPicks(newPicks)
                            }}
                            className="h-7 text-xs rounded border px-1.5 bg-background"
                          >
                            <option value={tradeTeamA}>{getTeamName(tradeTeamA)}</option>
                            <option value={tradeTeamB}>{getTeamName(tradeTeamB)}</option>
                          </select>
                          <span>→</span>
                          <select
                            value={pick.to}
                            onChange={(e) => {
                              const newPicks = [...draftPicks]
                              newPicks[idx].to = e.target.value
                              newPicks[idx].from = e.target.value === tradeTeamA ? tradeTeamB : tradeTeamA
                              setDraftPicks(newPicks)
                            }}
                            className="h-7 text-xs rounded border px-1.5 bg-background"
                          >
                            <option value={tradeTeamB}>{getTeamName(tradeTeamB)}</option>
                            <option value={tradeTeamA}>{getTeamName(tradeTeamA)}</option>
                          </select>
                          <span className="font-medium">Round:</span>
                          <Input
                            type="number"
                            min={1}
                            max={20}
                            value={pick.round}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 1
                              const newPicks = [...draftPicks]
                              newPicks[idx].round = Math.max(1, Math.min(20, val))
                              setDraftPicks(newPicks)
                            }}
                            className="h-7 w-14 text-xs"
                          />
                          <span className="font-medium">Orig:</span>
                          <select
                            value={pick.originalTeam}
                            onChange={(e) => {
                              const newPicks = [...draftPicks]
                              newPicks[idx].originalTeam = e.target.value
                              setDraftPicks(newPicks)
                            }}
                            className="h-7 text-xs rounded border px-1.5 bg-background"
                          >
                            {teams
                              .filter((t) => t.teamSlug !== "tbd")
                              .map((t) => (
                                <option key={t.teamSlug} value={t.teamSlug}>
                                  {t.teamName}
                                </option>
                              ))}
                          </select>
                          <span className="font-medium">Season:</span>
                          <Input
                            value={pick.targetSeason}
                            onChange={(e) => {
                              const newPicks = [...draftPicks]
                              newPicks[idx].targetSeason = e.target.value
                              setDraftPicks(newPicks)
                            }}
                            placeholder="e.g. 2027-summer"
                            className="h-7 w-28 text-xs"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              setDraftPicks(draftPicks.filter((_, i) => i !== idx))
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="trade-notes">Notes</Label>
                    <textarea
                      id="trade-notes"
                      value={tradeNotes}
                      onChange={(e) => setTradeNotes(e.target.value)}
                      placeholder="Trade context..."
                      className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                </div>

                <DialogFooter className="flex sm:justify-between w-full">
                  <Button variant="outline" onClick={() => setIsTradeOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleRecordTrade}
                    disabled={isExecutingTrade || !tradeTeamA || !tradeTeamB || tradeTeamA === tradeTeamB}
                  >
                    {isExecutingTrade ? <Spinner className="h-4 w-4 mr-2" /> : null}
                    Execute Trade
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

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
                        <SelectItem value="tbd" className="font-semibold text-muted-foreground">
                          Unassigned (TBD)
                        </SelectItem>
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
                      {isEditing ? <Spinner className="h-4 w-4 mr-2" /> : null}
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
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault()
                      handleDeletePlayer()
                    }}
                    disabled={isEditing}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {isEditing ? <Spinner className="h-4 w-4 mr-2" /> : null}
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
                  <span>
                    Only <span className="font-semibold">{goalieCount}</span> goalie{goalieCount !== 1 ? "s" : ""} listed — fewer than the <span className="font-semibold">{teamCount}</span> teams configured. Please confirm more players whose primary position is goalie.
                  </span>
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
                    <Button
                      variant="ghost"
                      onClick={() => handleSort("playerName")}
                      className="-ml-4 h-8 data-[state=open]:bg-accent"
                    >
                      Player Name
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      onClick={() => handleSort("teamName")}
                      className="-ml-4 h-8 data-[state=open]:bg-accent"
                    >
                      Team
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead className="w-[100px] text-right">
                    <Button
                      variant="ghost"
                      onClick={() => handleSort("isGoalie")}
                      className="h-8 -mr-4 justify-end data-[state=open]:bg-accent w-full"
                    >
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
                      className={canManageRoster ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
                      onClick={() => canManageRoster && handleEditClick(player)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {player.playerName}
                          {!player.isRookie ? (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              Veteran
                            </Badge>
                          ) : (
                            <Badge
                              variant="default"
                              className="text-[10px] px-1.5 py-0 bg-green-600 hover:bg-green-700"
                            >
                              Rookie
                            </Badge>
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

      {/* Season Trades History Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-lg flex items-center gap-2">
                <ArrowLeftRight className="h-5 w-5" />
                Season Trades
                {trades.length > 0 && (
                  <Badge variant="secondary" className="rounded-full">
                    {trades.length}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Official trades recorded for this season.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {trades.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No trades recorded for this season.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table aria-label="Trades Table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Date</TableHead>
                    <TableHead className="w-[200px]">Teams</TableHead>
                    <TableHead>Assets</TableHead>
                    <TableHead className="w-[200px]">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-sm font-medium">
                        {new Date(t.tradedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold text-sm">
                          {(t.teamSlugs && t.teamSlugs.length > 0
                            ? t.teamSlugs
                            : [t.teamASlug, t.teamBSlug].filter(Boolean)
                          ).join(" ↔ ")}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {t.items
                          ?.map((item) =>
                            item.itemType === "player"
                              ? `${item.playerName || `Player ${item.playerId}`} (${item.fromTeamSlug} → ${item.toTeamSlug})`
                              : `Round ${item.draftPickRound} Pick (${item.fromTeamSlug} → ${item.toTeamSlug})`
                          )
                          .join(", ") || "None"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.notes || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
