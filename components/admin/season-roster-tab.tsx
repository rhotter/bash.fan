import { fetchApi as fetch, readApiJson, errorMessage } from "@/lib/api-errors"
import { useState, useCallback, useEffect } from "react"
import { Spinner } from "@/components/ui/spinner"
import { useRouter } from "next/navigation"
import { Plus, Search, ArrowUpDown, AlertTriangle, ArrowLeftRight, ArrowDown, Trash2, Undo2 } from "lucide-react"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SportabilityImportModal } from "@/components/admin/sportability-import-modal"
import { getNextFallSeasonId } from "@/lib/trade-helpers"

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
  to: string
  round: number
  originalTeam: string
  targetSeason: string
}

interface TradeParticipantSection {
  teamSlug: string
  selectedPlayers: Record<number, string>
  draftPicks: TradePickRow[]
}

const createInitialTradeSections = (): TradeParticipantSection[] => [
  { teamSlug: "", selectedPlayers: {}, draftPicks: [] },
  { teamSlug: "", selectedPlayers: {}, draftPicks: [] },
]

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
  const [isReviewingTrade, setIsReviewingTrade] = useState(false)
  const [isExecutingTrade, setIsExecutingTrade] = useState(false)
  const [tradeSections, setTradeSections] = useState<TradeParticipantSection[]>(createInitialTradeSections)
  const [tradeNotes, setTradeNotes] = useState("")

  const getOtherSelectedTeams = (excludeIdx: number, sections = tradeSections) =>
    sections
      .filter((s, idx) => idx !== excludeIdx && s.teamSlug.trim() !== "")
      .map((s) => s.teamSlug)

  const resolveDestinationTeam = (excludeIdx: number, preferredTo: string, sections = tradeSections) => {
    const others = getOtherSelectedTeams(excludeIdx, sections)
    if (others.length === 0) return ""
    if (others.length === 1) return others[0]
    return others.includes(preferredTo) ? preferredTo : others[0]
  }

  // Check season trade history from DB to find any Round `round` picks acquired by `teamSlug` from other teams
  const getAcquiredPickOriginsForRound = (teamSlug: string, round: number): string[] => {
    if (!teamSlug) return []
    const chronologicalTrades = [...trades].reverse()
    const holderByOrigin = new Map<string, string>()

    for (const trade of chronologicalTrades) {
      if (!trade.items) continue
      for (const item of trade.items) {
        if (item.itemType === "draft_pick" && Number(item.draftPickRound) === Number(round)) {
          const originSlug = item.draftPickOriginalTeamSlug || item.fromTeamSlug
          if (originSlug && item.toTeamSlug) {
            holderByOrigin.set(originSlug, item.toTeamSlug)
          }
        }
      }
    }

    const acquiredOrigins: string[] = []
    for (const [originSlug, holderSlug] of holderByOrigin.entries()) {
      if (holderSlug === teamSlug && originSlug !== teamSlug && !acquiredOrigins.includes(originSlug)) {
        acquiredOrigins.push(originSlug)
      }
    }
    return acquiredOrigins
  }

  // Assign chronological trade numbers (oldest = #1)
  const chronologicalTradeIds = [...trades].reverse().map((tr) => tr.id)
  const tradeNumberById = new Map<number, number>(
    chronologicalTradeIds.map((id, i) => [id, i + 1])
  )

  // Helper to find which prior trade # a team acquired a specific (round, origSlug) pick from
  const findSourceTradeNumber = (
    currentTradeId: number | null,
    holderSlug: string,
    round: number | null | undefined,
    origSlug: string | null | undefined
  ): number | null => {
    if (!round || !origSlug) return null
    const chronologicalTrades = [...trades].reverse()
    let foundTradeNum: number | null = null
    for (const tr of chronologicalTrades) {
      if (currentTradeId !== null && tr.id === currentTradeId) break
      for (const it of tr.items || []) {
        if (
          it.itemType === "draft_pick" &&
          Number(it.draftPickRound) === Number(round) &&
          (it.draftPickOriginalTeamSlug || it.fromTeamSlug) === origSlug &&
          it.toTeamSlug === holderSlug
        ) {
          foundTradeNum = tradeNumberById.get(tr.id) ?? null
        }
      }
    }
    return foundTradeNum
  }

  const activeSelectedTeams = tradeSections
    .map((s) => s.teamSlug.trim())
    .filter((slug) => slug.length > 0)
  const hasValidTeamSelection =
    activeSelectedTeams.length >= 2 &&
    new Set(activeSelectedTeams).size === activeSelectedTeams.length

  const buildPendingTradeMoves = () => {
    const playerMoves: { playerId: number; fromTeamSlug: string; toTeamSlug: string }[] = []
    const draftPickMoves: {
      fromTeamSlug: string
      toTeamSlug: string
      round: number
      originalTeamSlug: string
      targetSeason: string
    }[] = []

    tradeSections.forEach((section, idx) => {
      if (!section.teamSlug) return
      Object.entries(section.selectedPlayers).forEach(([playerIdStr, preferredTo]) => {
        const toTeamSlug = resolveDestinationTeam(idx, preferredTo)
        if (toTeamSlug) {
          playerMoves.push({
            playerId: Number(playerIdStr),
            fromTeamSlug: section.teamSlug,
            toTeamSlug,
          })
        }
      })
      section.draftPicks.forEach((pick) => {
        const toTeamSlug = resolveDestinationTeam(idx, pick.to)
        if (toTeamSlug) {
          draftPickMoves.push({
            fromTeamSlug: section.teamSlug,
            toTeamSlug,
            round: pick.round,
            originalTeamSlug: pick.originalTeam || section.teamSlug,
            targetSeason: pick.targetSeason,
          })
        }
      })
    })

    return { playerMoves, draftPickMoves }
  }

  const handleReviewTrade = () => {
    if (!hasValidTeamSelection) {
      toast.error("Please select at least two distinct teams")
      return
    }
    const { playerMoves, draftPickMoves } = buildPendingTradeMoves()
    if (playerMoves.length + draftPickMoves.length === 0) {
      toast.error("Trade must include at least one player or draft pick")
      return
    }
    setIsReviewingTrade(true)
  }

  const handleRecordTrade = async () => {
    if (!hasValidTeamSelection) {
      toast.error("Please select at least two distinct teams")
      return
    }

    const { playerMoves, draftPickMoves } = buildPendingTradeMoves()

    const totalAssets = playerMoves.length + draftPickMoves.length
    if (totalAssets === 0) {
      toast.error("Trade must include at least one player or draft pick")
      return
    }

    setIsExecutingTrade(true)
    try {
      const teamASlug = activeSelectedTeams[0]
      const teamBSlug = activeSelectedTeams[1]
      const teamAPlayerIds = playerMoves
        .filter((m) => m.fromTeamSlug === teamASlug && m.toTeamSlug === teamBSlug)
        .map((m) => m.playerId)
      const teamBPlayerIds = playerMoves
        .filter((m) => m.fromTeamSlug === teamBSlug && m.toTeamSlug === teamASlug)
        .map((m) => m.playerId)

      const payload: Record<string, unknown> = {
        teamSlugs: activeSelectedTeams,
        teamASlug,
        teamBSlug,
        playerMoves,
        draftPicks: draftPickMoves,
        notes: tradeNotes.trim() ? tradeNotes.trim() : undefined,
      }
      if (activeSelectedTeams.length === 2) {
        payload.teamAPlayerIds = teamAPlayerIds
        payload.teamBPlayerIds = teamBPlayerIds
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
      setIsReviewingTrade(false)
      setTradeSections(createInitialTradeSections())
      setTradeNotes("")

      // Update local roster immediately if onRosterChange provided
      if (onRosterChange) {
        const moveMap = new Map(playerMoves.map((m) => [m.playerId, m.toTeamSlug]))
        const updatedRoster = roster.map((p) =>
          moveMap.has(p.playerId) ? { ...p, teamSlug: moveMap.get(p.playerId)! } : p
        )
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

  // Undo Latest Trade State
  const [tradeToUndo, setTradeToUndo] = useState<SeasonTradeRecord | null>(null)
  const [isUndoingTrade, setIsUndoingTrade] = useState(false)

  const handleUndoTrade = async () => {
    if (!tradeToUndo) return
    setIsUndoingTrade(true)
    try {
      const res = await fetch(
        `/api/bash/admin/seasons/${seasonId}/trades?tradeId=${tradeToUndo.id}`,
        { method: "DELETE" }
      )
      const data = await readApiJson(res)
      if (!res.ok) {
        throw new Error(data.error || "Failed to undo trade")
      }

      toast.success("Trade undone successfully")
      setTradeToUndo(null)

      if (onRosterChange && Array.isArray(data.revertedPlayers)) {
        const revertMap = new Map<number, string>(
          data.revertedPlayers.map((rp: { playerId: number; toTeamSlug: string }) => [
            Number(rp.playerId),
            rp.toTeamSlug,
          ])
        )
        const updatedRoster = roster.map((p) =>
          revertMap.has(p.playerId) ? { ...p, teamSlug: revertMap.get(p.playerId)! } : p
        )
        onRosterChange(updatedRoster)
      }

      await refreshRoster()
      await fetchTrades()
      router.refresh()
    } catch (err: unknown) {
      if (err instanceof Error) toast.error(err.message)
      else toast.error("An unknown error occurred")
    } finally {
      setIsUndoingTrade(false)
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
    <div data-testid="season-roster-tab" className="space-y-6 min-w-0">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 flex-wrap">
                Roster Management
                <Badge variant="secondary" className="rounded-full">
                  {roster.length} Players
                </Badge>
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById("season-trades-section")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 hover:bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title="Jump to Season Trades section below"
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  <span>
                    {trades.length} {trades.length === 1 ? "Trade" : "Trades"}
                  </span>
                  <ArrowDown className="h-3 w-3" />
                </button>
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
            <Dialog
              open={isTradeOpen}
              onOpenChange={(open) => {
                setIsTradeOpen(open)
                if (!open) setIsReviewingTrade(false)
              }}
            >
              <DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ArrowLeftRight className="h-5 w-5" />
                    {isReviewingTrade ? "Review Mid-Season Trade" : "Record Mid-Season Trade"}
                  </DialogTitle>
                  <DialogDescription>
                    {isReviewingTrade
                      ? "Confirm the players and draft picks being traded before executing."
                      : "Select participating teams and configure the players or future draft picks each team is trading away."}
                  </DialogDescription>
                </DialogHeader>

                {!isReviewingTrade ? (
                  <>
                    <div className="space-y-4 py-4">
                      <div className="space-y-3">
                        {tradeSections.map((section, sectionIdx) => {
                          const letter = String.fromCharCode(65 + sectionIdx)
                          const lowerLetter = String.fromCharCode(97 + sectionIdx)
                          const selectId =
                            sectionIdx === 0 ? "teamA" : sectionIdx === 1 ? "teamB" : `team${letter}`
                          const sectionPlayers = section.teamSlug
                            ? roster.filter((p) => p.teamSlug === section.teamSlug)
                            : []
                          const otherSelectedSlugs = getOtherSelectedTeams(sectionIdx)
                          const selectedCount = Object.keys(section.selectedPlayers).length

                          return (
                            <div
                              key={sectionIdx}
                              data-testid={`trade-team-section-${sectionIdx}`}
                              className="rounded-lg border bg-muted/15 p-3.5 space-y-3"
                            >
                              {/* Team Header & Selector */}
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex-1 space-y-1.5">
                                  <Label htmlFor={selectId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Team {letter}
                                  </Label>
                                  <div className="relative flex items-center">
                                    {section.teamSlug && (
                                      <div className="pointer-events-none absolute left-2.5 flex items-center">
                                        <TeamLogo
                                          slug={section.teamSlug}
                                          name={getTeamName(section.teamSlug)}
                                          size={20}
                                        />
                                      </div>
                                    )}
                                    <select
                                      id={selectId}
                                      value={section.teamSlug}
                                      onChange={(e) => {
                                        const nextSlug = e.target.value
                                        setTradeSections((prev) =>
                                          prev.map((item, i) =>
                                            i === sectionIdx
                                              ? { teamSlug: nextSlug, selectedPlayers: {}, draftPicks: [] }
                                              : item
                                          )
                                        )
                                      }}
                                      className={`flex h-9 w-full rounded-md border border-input bg-background py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                                        section.teamSlug ? "pl-9 pr-3" : "px-3"
                                      }`}
                                    >
                                      <option value="">Select Team {letter}</option>
                                      {teams
                                        .filter((t) => t.teamSlug !== "tbd")
                                        .map((t) => {
                                          const usedByOther = tradeSections.some(
                                            (other, idx) => idx !== sectionIdx && other.teamSlug === t.teamSlug
                                          )
                                          return (
                                            <option key={t.teamSlug} value={t.teamSlug} disabled={usedByOther}>
                                              {t.teamName}
                                            </option>
                                          )
                                        })}
                                    </select>
                                  </div>
                                </div>

                                {tradeSections.length > 2 && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Remove Team ${letter}`}
                                    className="h-8 w-8 mt-5 text-muted-foreground hover:text-destructive"
                                    onClick={() => {
                                      setTradeSections((prev) => prev.filter((_, i) => i !== sectionIdx))
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>

                              {/* Team Trade Assets (Players + Draft Picks) */}
                              {!section.teamSlug ? (
                                <p className="text-xs text-muted-foreground italic">
                                  Select a team above to add players or draft picks to trade.
                                </p>
                              ) : (
                                <div className="space-y-3 pt-1">
                                  {/* Players Asset Subsection */}
                                  <div
                                    data-testid={`team-${lowerLetter}-players`}
                                    className="space-y-2 rounded-md border bg-background p-3"
                                  >
                                    <div className="flex items-center justify-between">
                                      <h3 className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                                        <TeamLogo
                                          slug={section.teamSlug}
                                          name={getTeamName(section.teamSlug)}
                                          size={16}
                                        />
                                        <span>{getTeamName(section.teamSlug)} Players to Trade</span>
                                      </h3>
                                      {selectedCount > 0 && (
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                          {selectedCount} selected
                                        </Badge>
                                      )}
                                    </div>

                                    {sectionPlayers.length === 0 ? (
                                      <p className="text-xs text-muted-foreground">No players found on this team.</p>
                                    ) : (
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1">
                                        {sectionPlayers.map((p) => {
                                          const isChecked = Object.prototype.hasOwnProperty.call(
                                            section.selectedPlayers,
                                            p.playerId
                                          )
                                          const resolvedTo = resolveDestinationTeam(
                                            sectionIdx,
                                            section.selectedPlayers[p.playerId] || ""
                                          )

                                          return (
                                            <div
                                              key={p.playerId}
                                              className={`flex items-center justify-between gap-2 text-sm p-1.5 rounded border transition-colors ${
                                                isChecked
                                                  ? "bg-muted/60 border-border"
                                                  : "border-transparent hover:bg-muted/30"
                                              }`}
                                            >
                                              <label className="flex items-center gap-2 cursor-pointer min-w-0 flex-1">
                                                <input
                                                  type="checkbox"
                                                  checked={isChecked}
                                                  onChange={(e) => {
                                                    setTradeSections((prev) =>
                                                      prev.map((item, i) => {
                                                        if (i !== sectionIdx) return item
                                                        const nextPlayers = { ...item.selectedPlayers }
                                                        if (e.target.checked) {
                                                          nextPlayers[p.playerId] = resolveDestinationTeam(
                                                            sectionIdx,
                                                            "",
                                                            prev
                                                          )
                                                        } else {
                                                          delete nextPlayers[p.playerId]
                                                        }
                                                        return { ...item, selectedPlayers: nextPlayers }
                                                      })
                                                    )
                                                  }}
                                                  className="rounded shrink-0"
                                                />
                                                <span className="font-medium truncate text-xs">{p.playerName}</span>
                                                {p.isGoalie && (
                                                  <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                                                    G
                                                  </Badge>
                                                )}
                                              </label>

                                              {isChecked && otherSelectedSlugs.length > 1 && (
                                                <div className="inline-flex items-center gap-1 shrink-0">
                                                  <span className="text-[11px] text-muted-foreground">→</span>
                                                  {resolvedTo && (
                                                    <TeamLogo
                                                      slug={resolvedTo}
                                                      name={getTeamName(resolvedTo)}
                                                      size={14}
                                                    />
                                                  )}
                                                  <select
                                                    aria-label={`Destination team for ${p.playerName}`}
                                                    value={resolvedTo}
                                                    onChange={(e) => {
                                                      const newDest = e.target.value
                                                      setTradeSections((prev) =>
                                                        prev.map((item, i) =>
                                                          i === sectionIdx
                                                            ? {
                                                                ...item,
                                                                selectedPlayers: {
                                                                  ...item.selectedPlayers,
                                                                  [p.playerId]: newDest,
                                                                },
                                                              }
                                                            : item
                                                        )
                                                      )
                                                    }}
                                                    className="h-6 text-[11px] rounded border px-1 bg-background shrink-0"
                                                  >
                                                    {otherSelectedSlugs.map((slug) => (
                                                      <option key={slug} value={slug}>
                                                        {getTeamName(slug)}
                                                      </option>
                                                    ))}
                                                  </select>
                                                </div>
                                              )}

                                              {isChecked && otherSelectedSlugs.length === 1 && resolvedTo && (
                                                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                                                  <span>→</span>
                                                  <TeamLogo
                                                    slug={resolvedTo}
                                                    name={getTeamName(resolvedTo)}
                                                    size={14}
                                                  />
                                                  <span>{getTeamName(resolvedTo)}</span>
                                                </span>
                                              )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>

                                  {/* Draft Picks Asset Subsection */}
                                  <div className="space-y-2 rounded-md border bg-background p-3">
                                    <div className="flex items-center justify-between">
                                      <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                                        <TeamLogo
                                          slug={section.teamSlug}
                                          name={getTeamName(section.teamSlug)}
                                          size={16}
                                        />
                                        <span>{getTeamName(section.teamSlug)} Draft Picks to Trade</span>
                                      </span>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs px-2"
                                        onClick={() => {
                                          setTradeSections((prev) =>
                                            prev.map((item, i) =>
                                              i === sectionIdx
                                                ? {
                                                    ...item,
                                                    draftPicks: [
                                                      ...item.draftPicks,
                                                      {
                                                        to: resolveDestinationTeam(sectionIdx, "", prev),
                                                        round: 2,
                                                        originalTeam: item.teamSlug,
                                                        targetSeason: getNextFallSeasonId(seasonId),
                                                      },
                                                    ],
                                                  }
                                                : item
                                            )
                                          )
                                        }}
                                      >
                                        <Plus className="h-3 w-3 mr-1" />
                                        Add Draft Pick
                                      </Button>
                                    </div>

                                    {section.draftPicks.length === 0 ? (
                                      <p className="text-xs text-muted-foreground">
                                        No draft picks added from {getTeamName(section.teamSlug)}.
                                      </p>
                                    ) : (
                                      <div className="space-y-2">
                                        {section.draftPicks.map((pick, pickIdx) => {
                                          const resolvedPickTo = resolveDestinationTeam(sectionIdx, pick.to)
                                          const acquiredOrigins = getAcquiredPickOriginsForRound(
                                            section.teamSlug,
                                            pick.round
                                          )
                                          const availableOriginSlugs = [
                                            section.teamSlug,
                                            ...acquiredOrigins,
                                          ]
                                          const resolvedOrigin = availableOriginSlugs.includes(pick.originalTeam)
                                            ? pick.originalTeam
                                            : section.teamSlug

                                          return (
                                            <div
                                              key={pickIdx}
                                              data-testid="draft-pick-row"
                                              className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 p-2.5 rounded-md border text-xs min-w-0"
                                            >
                                              <div className="flex flex-wrap items-center gap-2 min-w-0">
                                                <span className="font-medium text-muted-foreground">Round:</span>
                                                <select
                                                  aria-label={`Draft pick round for ${getTeamName(section.teamSlug)}`}
                                                  value={pick.round}
                                                  onChange={(e) => {
                                                    const nextRound = Math.max(
                                                      1,
                                                      Math.min(20, parseInt(e.target.value, 10) || 1)
                                                    )
                                                    const nextAcquired = getAcquiredPickOriginsForRound(
                                                      section.teamSlug,
                                                      nextRound
                                                    )
                                                    setTradeSections((prev) =>
                                                      prev.map((item, i) => {
                                                        if (i !== sectionIdx) return item
                                                        const nextPicks = [...item.draftPicks]
                                                        const currentOrig = nextPicks[pickIdx].originalTeam
                                                        const keepOrig =
                                                          currentOrig === item.teamSlug ||
                                                          nextAcquired.includes(currentOrig)
                                                        nextPicks[pickIdx] = {
                                                          ...nextPicks[pickIdx],
                                                          round: nextRound,
                                                          originalTeam: keepOrig ? currentOrig : item.teamSlug,
                                                        }
                                                        return { ...item, draftPicks: nextPicks }
                                                      })
                                                    )
                                                  }}
                                                  className="h-7 text-xs rounded border px-2 bg-background font-medium"
                                                >
                                                  {Array.from({ length: 15 }, (_, i) => i + 1).map((r) => (
                                                    <option key={r} value={r}>
                                                      Round {r}
                                                    </option>
                                                  ))}
                                                </select>

                                                {/* Only show 2nd option if team has acquired Round X pick(s) from another team in DB */}
                                                {acquiredOrigins.length > 0 && (
                                                  <select
                                                    data-testid="draft-pick-origin-select"
                                                    aria-label={`Select which Round ${pick.round} pick ${getTeamName(section.teamSlug)} is trading`}
                                                    value={resolvedOrigin}
                                                    onChange={(e) => {
                                                      const newOrig = e.target.value
                                                      setTradeSections((prev) =>
                                                        prev.map((item, i) => {
                                                          if (i !== sectionIdx) return item
                                                          const nextPicks = [...item.draftPicks]
                                                          nextPicks[pickIdx] = {
                                                            ...nextPicks[pickIdx],
                                                            originalTeam: newOrig,
                                                          }
                                                          return { ...item, draftPicks: nextPicks }
                                                        })
                                                      )
                                                    }}
                                                    className="h-7 text-xs rounded border px-2 bg-background min-w-0 max-w-full"
                                                  >
                                                    <option value={section.teamSlug}>
                                                      Own Round {pick.round} Pick ({getTeamName(section.teamSlug)})
                                                    </option>
                                                    {acquiredOrigins.map((origSlug) => (
                                                      <option key={origSlug} value={origSlug}>
                                                        Acquired Round {pick.round} Pick (from {getTeamName(origSlug)})
                                                      </option>
                                                    ))}
                                                  </select>
                                                )}

                                                {otherSelectedSlugs.length > 1 ? (
                                                  <div className="flex items-center gap-1.5">
                                                    <span className="text-muted-foreground">→</span>
                                                    {resolvedPickTo && (
                                                      <TeamLogo
                                                        slug={resolvedPickTo}
                                                        name={getTeamName(resolvedPickTo)}
                                                        size={15}
                                                      />
                                                    )}
                                                    <select
                                                      aria-label={`Destination team for Round ${pick.round} pick`}
                                                      value={resolvedPickTo}
                                                      onChange={(e) => {
                                                        const newTo = e.target.value
                                                        setTradeSections((prev) =>
                                                          prev.map((item, i) => {
                                                            if (i !== sectionIdx) return item
                                                            const nextPicks = [...item.draftPicks]
                                                            nextPicks[pickIdx] = { ...nextPicks[pickIdx], to: newTo }
                                                            return { ...item, draftPicks: nextPicks }
                                                          })
                                                        )
                                                      }}
                                                      className="h-7 text-xs rounded border px-2 bg-background"
                                                    >
                                                      {otherSelectedSlugs.map((slug) => (
                                                        <option key={slug} value={slug}>
                                                          {getTeamName(slug)}
                                                        </option>
                                                      ))}
                                                    </select>
                                                  </div>
                                                ) : (
                                                  resolvedPickTo && (
                                                    <span className="inline-flex items-center gap-1 text-muted-foreground font-medium">
                                                      <span>→</span>
                                                      <TeamLogo
                                                        slug={resolvedPickTo}
                                                        name={getTeamName(resolvedPickTo)}
                                                        size={15}
                                                      />
                                                      <span>{getTeamName(resolvedPickTo)}</span>
                                                    </span>
                                                  )
                                                )}
                                              </div>

                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Remove draft pick"
                                                className="h-7 w-7 text-destructive hover:bg-destructive/10 shrink-0"
                                                onClick={() => {
                                                  setTradeSections((prev) =>
                                                    prev.map((item, i) =>
                                                      i === sectionIdx
                                                        ? {
                                                            ...item,
                                                            draftPicks: item.draftPicks.filter(
                                                              (_, idx) => idx !== pickIdx
                                                            ),
                                                          }
                                                        : item
                                                    )
                                                  )
                                                }}
                                              >
                                                <Trash2 className="h-3.5 w-3.5" />
                                              </Button>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full border-dashed"
                          onClick={() => {
                            setTradeSections((prev) => [
                              ...prev,
                              { teamSlug: "", selectedPlayers: {}, draftPicks: [] },
                            ])
                          }}
                          disabled={tradeSections.length >= Math.max(2, teams.filter((t) => t.teamSlug !== "tbd").length)}
                        >
                          <Plus className="h-4 w-4 mr-1.5" />
                          Add Team to Trade
                        </Button>
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
                        onClick={handleReviewTrade}
                        disabled={isExecutingTrade || !hasValidTeamSelection}
                      >
                        Review Trade
                      </Button>
                    </DialogFooter>
                  </>
                ) : (
                  <>
                    <div className="space-y-4 py-4" data-testid="trade-review-step">
                      <div className="rounded-md border overflow-hidden">
                        <Table aria-label="Trade Review Summary">
                          <TableBody>
                            {(() => {
                              const { playerMoves, draftPickMoves } = buildPendingTradeMoves()
                              return activeSelectedTeams.flatMap((teamSlug, teamIdx) => {
                                const teamPlayerMoves = playerMoves.filter((m) => m.fromTeamSlug === teamSlug)
                                const teamPickMoves = draftPickMoves.filter((m) => m.fromTeamSlug === teamSlug)
                                const isLastTeam = teamIdx === activeSelectedTeams.length - 1

                                return [
                                  <TableRow
                                    key={`header-${teamSlug}`}
                                    className="bg-muted/40 hover:bg-muted/40 border-b border-border/60"
                                  >
                                    <TableCell colSpan={2} className="py-2.5 px-3">
                                      <div className="flex items-center gap-2">
                                        <TeamLogo slug={teamSlug} name={getTeamName(teamSlug)} size={22} />
                                        <span className="font-semibold text-sm text-foreground">
                                          {getTeamName(teamSlug)}
                                        </span>
                                      </div>
                                    </TableCell>
                                  </TableRow>,
                                  <TableRow
                                    key={`players-${teamSlug}`}
                                    className="border-b border-border/40"
                                  >
                                    <TableCell className="w-[130px] text-xs font-medium text-muted-foreground align-top py-2.5 px-3 border-r border-border/40">
                                      Players Sent
                                    </TableCell>
                                    <TableCell className="text-sm align-top py-2.5 px-3 whitespace-normal">
                                      {teamPlayerMoves.length === 0 ? (
                                        <span className="text-muted-foreground">—</span>
                                      ) : (
                                        <div className="flex flex-col gap-1.5">
                                          {teamPlayerMoves.map((move) => {
                                            const playerObj = roster.find((r) => r.playerId === move.playerId)
                                            const pName = playerObj?.playerName || `Player ${move.playerId}`
                                            return (
                                              <div
                                                key={move.playerId}
                                                className="flex flex-wrap items-center gap-2"
                                              >
                                                <span className="font-medium text-foreground">{pName}</span>
                                                {playerObj?.isGoalie && (
                                                  <Badge
                                                    variant="outline"
                                                    className="text-[10px] px-1 py-0 shrink-0"
                                                  >
                                                    G
                                                  </Badge>
                                                )}
                                                {move.toTeamSlug && (
                                                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                                    <span>→</span>
                                                    <TeamLogo
                                                      slug={move.toTeamSlug}
                                                      name={getTeamName(move.toTeamSlug)}
                                                      size={16}
                                                    />
                                                    <span className="font-medium">
                                                      {getTeamName(move.toTeamSlug)}
                                                    </span>
                                                  </span>
                                                )}
                                              </div>
                                            )
                                          })}
                                        </div>
                                      )}
                                    </TableCell>
                                  </TableRow>,
                                  <TableRow
                                    key={`picks-${teamSlug}`}
                                    className={isLastTeam ? "border-b-0" : "border-b-2 border-border"}
                                  >
                                    <TableCell className="w-[130px] text-xs font-medium text-muted-foreground align-top py-2.5 px-3 border-r border-border/40">
                                      Picks Sent
                                    </TableCell>
                                    <TableCell className="text-sm align-top py-2.5 px-3 whitespace-normal">
                                      {teamPickMoves.length === 0 ? (
                                        <span className="text-muted-foreground">—</span>
                                      ) : (
                                        <div className="flex flex-col gap-1.5">
                                          {teamPickMoves.map((pick, pIdx) => {
                                            const origSlug = pick.originalTeamSlug
                                            const isAcquired = origSlug && origSlug !== pick.fromTeamSlug
                                            const sourceTradeNum = isAcquired
                                              ? findSourceTradeNumber(
                                                  null,
                                                  pick.fromTeamSlug,
                                                  pick.round,
                                                  origSlug
                                                )
                                              : null
                                            const originNote = isAcquired
                                              ? sourceTradeNum
                                                ? ` (from ${getTeamName(origSlug)}, Trade #${sourceTradeNum})`
                                                : ` (from ${getTeamName(origSlug)})`
                                              : ""
                                            const pickLabel = `Round ${pick.round} Pick${originNote}`

                                            return (
                                              <div
                                                key={pIdx}
                                                className="flex flex-wrap items-center gap-2"
                                              >
                                                <span className="font-medium text-foreground">
                                                  {pickLabel}
                                                </span>
                                                {pick.toTeamSlug && (
                                                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                                    <span>→</span>
                                                    <TeamLogo
                                                      slug={pick.toTeamSlug}
                                                      name={getTeamName(pick.toTeamSlug)}
                                                      size={16}
                                                    />
                                                    <span className="font-medium">
                                                      {getTeamName(pick.toTeamSlug)}
                                                    </span>
                                                  </span>
                                                )}
                                              </div>
                                            )
                                          })}
                                        </div>
                                      )}
                                    </TableCell>
                                  </TableRow>,
                                ]
                              })
                            })()}
                          </TableBody>
                        </Table>
                      </div>

                      <div className="rounded-md border bg-muted/15 p-3 space-y-1">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Trade Notes
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {tradeNotes.trim() || <span className="text-muted-foreground">—</span>}
                        </p>
                      </div>
                    </div>

                    <DialogFooter className="flex sm:justify-between w-full">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsReviewingTrade(false)}
                        disabled={isExecutingTrade}
                      >
                        Back
                      </Button>
                      <Button
                        onClick={handleRecordTrade}
                        disabled={isExecutingTrade || !hasValidTeamSelection}
                      >
                        {isExecutingTrade ? <Spinner className="h-4 w-4 mr-2" /> : null}
                        Execute Trade
                      </Button>
                    </DialogFooter>
                  </>
                )}
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

          {/* Dense Table (capped at ~25 visible rows with sticky header) */}
          <div className="rounded-md border [&_[data-slot=table-container]]:max-h-[1060px] [&_[data-slot=table-container]]:overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
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
      <Card id="season-trades-section" className="scroll-mt-6">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
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
            {canManageRoster && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  fetchTrades()
                  setIsTradeOpen(true)
                }}
                aria-label="Record Trade"
              >
                <ArrowLeftRight className="h-4 w-4 mr-2" />
                Record Trade
              </Button>
            )}
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
                    <TableHead className="w-[95px]">Date</TableHead>
                    <TableHead className="w-[155px]">Team</TableHead>
                    <TableHead>Players Sent</TableHead>
                    <TableHead>Picks Sent</TableHead>
                    <TableHead className="w-[150px] max-w-[160px]">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    return trades.flatMap((t, tradeIdx) => {
                      const participatingSlugs =
                        t.teamSlugs && t.teamSlugs.length > 0
                          ? t.teamSlugs
                          : [t.teamASlug, t.teamBSlug].filter((s): s is string => Boolean(s))

                      const allTeamSlugs = [...participatingSlugs]
                      for (const item of t.items || []) {
                        if (item.fromTeamSlug && !allTeamSlugs.includes(item.fromTeamSlug)) {
                          allTeamSlugs.push(item.fromTeamSlug)
                        }
                      }

                      const rowTeams = allTeamSlugs.length > 0 ? allTeamSlugs : [""]
                      const isMultiTeam = rowTeams.length > 2
                      const tradeNum = tradeNumberById.get(t.id)
                      const isLatestTrade = tradeIdx === 0

                      return rowTeams.map((teamSlug, subIdx) => {
                        const isFirstRow = subIdx === 0
                        const isLastRow = subIdx === rowTeams.length - 1
                        const fallbackOtherSlug =
                          rowTeams.find((s) => s && s !== teamSlug) || ""

                        const teamPlayerItems = (t.items || []).filter(
                          (item) => item.fromTeamSlug === teamSlug && item.itemType === "player"
                        )
                        const teamPickItems = (t.items || []).filter(
                          (item) => item.fromTeamSlug === teamSlug && item.itemType === "draft_pick"
                        )

                        return (
                          <TableRow
                            key={`${t.id}-${teamSlug || subIdx}`}
                            className={
                              isLastRow
                                ? "border-b-2 border-border"
                                : "border-b border-border/50"
                            }
                          >
                            {isFirstRow && (
                              <TableCell
                                rowSpan={rowTeams.length}
                                className="text-xs font-medium align-top border-r border-border/40 py-2.5 whitespace-nowrap"
                              >
                                <div>{new Date(t.tradedAt).toLocaleDateString()}</div>
                                {tradeNum != null && (
                                  <div className="text-[11px] text-muted-foreground font-normal mt-0.5">
                                    Trade #{tradeNum}
                                  </div>
                                )}
                                {isLatestTrade && canManageRoster && (
                                  <button
                                    type="button"
                                    onClick={() => setTradeToUndo(t)}
                                    data-testid="undo-latest-trade-btn"
                                    aria-label={`Undo Trade #${tradeNum ?? 1}`}
                                    className="mt-1.5 inline-flex items-center gap-1 rounded border border-border/70 bg-muted/30 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors cursor-pointer"
                                  >
                                    <Undo2 className="h-3 w-3" />
                                    <span>Undo</span>
                                  </button>
                                )}
                              </TableCell>
                            )}

                            <TableCell className="align-middle whitespace-nowrap py-2">
                              {isFirstRow && (
                                <span className="sr-only">{participatingSlugs.join(" ↔ ")}</span>
                              )}
                              {teamSlug ? (
                                <div className="flex items-center gap-2 whitespace-nowrap">
                                  <TeamLogo slug={teamSlug} name={getTeamName(teamSlug)} size={22} />
                                  <span className="font-semibold text-xs text-foreground">
                                    {getTeamName(teamSlug)}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>

                            <TableCell className="text-sm align-middle whitespace-normal py-2">
                              {teamPlayerItems.length === 0 ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  {teamPlayerItems.map((item, idx) => {
                                    const pName = item.playerName || `Player ${item.playerId}`
                                    const toSlug = item.toTeamSlug || fallbackOtherSlug
                                    const fullStatement = toSlug
                                      ? `${getTeamName(teamSlug)} sends ${pName} to ${getTeamName(toSlug)}`
                                      : `${getTeamName(teamSlug)} sends ${pName}`

                                    return (
                                      <Tooltip key={idx}>
                                        <TooltipTrigger asChild>
                                          <span className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 py-0.5 hover:bg-muted/60 cursor-default transition-colors whitespace-nowrap">
                                            <span>
                                              {pName}
                                              {!(isMultiTeam && toSlug) && idx < teamPlayerItems.length - 1 && (
                                                <span className="text-muted-foreground">,</span>
                                              )}
                                            </span>
                                            {isMultiTeam && toSlug && (
                                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                                <span>→</span>
                                                <TeamLogo
                                                  slug={toSlug}
                                                  name={getTeamName(toSlug)}
                                                  size={16}
                                                />
                                              </span>
                                            )}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent>{fullStatement}</TooltipContent>
                                      </Tooltip>
                                    )
                                  })}
                                </div>
                              )}
                            </TableCell>

                            <TableCell className="text-sm align-middle whitespace-normal py-2">
                              {teamPickItems.length === 0 ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  {teamPickItems.map((item, idx) => {
                                    const origSlug = item.draftPickOriginalTeamSlug
                                    const isAcquired = origSlug && origSlug !== item.fromTeamSlug
                                    const sourceTradeNum = isAcquired
                                      ? findSourceTradeNumber(
                                          t.id,
                                          item.fromTeamSlug,
                                          item.draftPickRound,
                                          origSlug
                                        )
                                      : null
                                    const originNote = isAcquired
                                      ? sourceTradeNum
                                        ? ` (from ${getTeamName(origSlug)}, Trade #${sourceTradeNum})`
                                        : ` (from ${getTeamName(origSlug)})`
                                      : ""
                                    const pickLabel = `Round ${item.draftPickRound} Pick${originNote}`
                                    const toSlug = item.toTeamSlug || fallbackOtherSlug
                                    const fullStatement = toSlug
                                      ? `${getTeamName(teamSlug)} sends ${pickLabel} to ${getTeamName(toSlug)}`
                                      : `${getTeamName(teamSlug)} sends ${pickLabel}`

                                    return (
                                      <Tooltip key={idx}>
                                        <TooltipTrigger asChild>
                                          <span className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 py-0.5 hover:bg-muted/60 cursor-default transition-colors whitespace-nowrap">
                                            <span>
                                              {pickLabel}
                                              {!(isMultiTeam && toSlug) && idx < teamPickItems.length - 1 && (
                                                <span className="text-muted-foreground">,</span>
                                              )}
                                            </span>
                                            {isMultiTeam && toSlug && (
                                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                                <span>→</span>
                                                <TeamLogo
                                                  slug={toSlug}
                                                  name={getTeamName(toSlug)}
                                                  size={16}
                                                />
                                              </span>
                                            )}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent>{fullStatement}</TooltipContent>
                                      </Tooltip>
                                    )
                                  })}
                                </div>
                              )}
                            </TableCell>

                            {isFirstRow && (
                              <TableCell
                                rowSpan={rowTeams.length}
                                className="text-xs text-muted-foreground align-top whitespace-normal border-l border-border/40 py-2.5 w-[150px] max-w-[160px]"
                              >
                                {t.notes ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="line-clamp-2 cursor-default leading-snug">
                                        {t.notes}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                      {t.notes}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        )
                      })
                    })
                  })()}
                </TableBody>
              </Table>
            </div>
          )}

          <AlertDialog
            open={tradeToUndo !== null}
            onOpenChange={(open) => {
              if (!open && !isUndoingTrade) setTradeToUndo(null)
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Undo Trade #{tradeToUndo ? tradeNumberById.get(tradeToUndo.id) ?? 1 : ""}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the most recent trade and revert all traded players back to their previous teams. Undoing is only permitted before any traded players have played a game for their new team.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isUndoingTrade}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault()
                    handleUndoTrade()
                  }}
                  disabled={isUndoingTrade}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isUndoingTrade ? <Spinner className="h-4 w-4 mr-2" /> : null}
                  Undo Trade
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
