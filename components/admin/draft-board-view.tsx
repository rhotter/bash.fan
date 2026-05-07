"use client"

import { useState, useCallback, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, RotateCcw, Play, Loader2, Crown, Search, X, Check } from "lucide-react"

// ─── Types ──────────────────────────────────────────────────────────────────

interface Team {
  teamSlug: string
  teamName: string
  position: number
  color: string | null
}

interface PoolPlayer {
  playerId: number
  playerName: string
  isKeeper: boolean
  keeperTeamSlug: string | null
  keeperRound: number | null
  registrationMeta: Record<string, unknown> | null
}

interface Pick {
  id: string
  round: number
  pickNumber: number
  teamSlug: string
  originalTeamSlug: string
  playerId: number | null
  playerName: string | null
  isKeeper: boolean
  isSimulation: boolean
  pickedAt: string | null
}

interface Trade {
  id: string
  teamASlug: string
  teamBSlug: string
  tradeType: string
  description: string | null
}

interface Captain {
  playerId: number
  teamSlug: string
  playerName: string
}

interface DraftInstance {
  id: string
  seasonId: string
  name: string
  status: string
  isSimulating: boolean
  draftType: string
  rounds: number
  timerSeconds: number
  maxKeepers: number
  draftDate: string | null
  location: string | null
  currentRound: number | null
  currentPick: number | null
}

interface DraftBoardViewProps {
  seasonId: string
  seasonName: string
  draft: DraftInstance
  teams: Team[]
  pool: PoolPlayer[]
  picks: Pick[]
  trades: Trade[]
  captains: Captain[]
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DraftBoardView({
  seasonId,
  seasonName,
  draft: initialDraft,
  teams,
  pool: initialPool,
  picks: initialPicks,
  trades: _trades,
  captains,
}: DraftBoardViewProps) {
  const router = useRouter()
  const [draft, setDraft] = useState(initialDraft)
  const [pool, setPool] = useState(initialPool)
  const [picks] = useState(initialPicks)
  const [isResetting, setIsResetting] = useState(false)
  const [showStartConfirm, setShowStartConfirm] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [showClearKeepersConfirm, setShowClearKeepersConfirm] = useState(false)
  const [isClearingKeepers, setIsClearingKeepers] = useState(false)

  // Keeper entry state
  const [selectedTeam, setSelectedTeam] = useState<string>(teams[0]?.teamSlug || "")
  const [keeperSearch, setKeeperSearch] = useState("")

  const isSimulation = draft.status === "draft"
  const isPreDraft = draft.status === "published"
  const isLive = draft.status === "live"

  // Captain auto-population: assign captains as R1/R2/... keepers on first load
  const [autoPopulated, setAutoPopulated] = useState(false)
  useEffect(() => {
    if (autoPopulated) return
    if (isLive || draft.status === "completed") return
    if (captains.length === 0) return

    // Find current keepers from the initial pool
    const currentKeepers = initialPool
      .filter((p) => p.isKeeper)
      .map((k) => ({
        playerId: k.playerId,
        teamSlug: k.keeperTeamSlug!,
        round: k.keeperRound!,
      }))

    // Find captains that are in the pool but NOT currently keepers
    const missingCaptains = captains.filter(
      (cap) =>
        initialPool.some((p) => p.playerId === cap.playerId) &&
        !initialPool.some((p) => p.playerId === cap.playerId && p.isKeeper)
    )

    if (missingCaptains.length === 0) return // No missing captains to auto-populate

    const keeperPayload = [...currentKeepers]
    const addedCaptains: Array<Captain & { round: number }> = []

    for (const cap of missingCaptains) {
      const teamExistingKeepers = keeperPayload.filter((k) => k.teamSlug === cap.teamSlug)
      if (teamExistingKeepers.length >= draft.maxKeepers) continue

      // Find next available round for this team
      const takenRounds = new Set(teamExistingKeepers.map((k) => k.round))
      let nextRound = 1
      while (takenRounds.has(nextRound)) nextRound++

      keeperPayload.push({
        playerId: cap.playerId,
        teamSlug: cap.teamSlug,
        round: nextRound,
      })
      addedCaptains.push({ ...cap, round: nextRound })
    }

    if (addedCaptains.length === 0) return // Max keepers reached for all missing captains

    // Apply optimistic update
    setPool((prev) =>
      prev.map((p) => {
        const match = addedCaptains.find((k) => k.playerId === p.playerId)
        if (match) {
          return { ...p, isKeeper: true, keeperTeamSlug: match.teamSlug, keeperRound: match.round }
        }
        return p
      })
    )

    fetch(`/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/keepers`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepers: keeperPayload }),
    }).then((res) => {
      if (res.ok) {
        const names = addedCaptains.map((c) => `${c.playerName} (R${c.round})`).join(", ")
        toast.success(`Auto-assigned ${addedCaptains.length} missing captain(s) as keepers: ${names}`)
      }
    })

    setAutoPopulated(true)
  }, [autoPopulated, isLive, draft.status, draft.id, draft.maxKeepers, initialPool, captains, seasonId])

  // ─── Keeper helpers ─────────────────────────────────────────────────────

  const currentKeepers = useMemo(
    () => pool.filter((p) => p.isKeeper),
    [pool]
  )

  const keepersForTeam = useCallback(
    (teamSlug: string) => currentKeepers.filter((k) => k.keeperTeamSlug === teamSlug),
    [currentKeepers]
  )

  const captainsForTeam = useCallback(
    (teamSlug: string) => captains.filter((c) => c.teamSlug === teamSlug),
    [captains]
  )

  // Players available for keeper selection (in pool, not already a keeper)
  // Captains for the selected team are shown first
  const availableForKeeper = useMemo(() => {
    const q = keeperSearch.toLowerCase()
    const teamCaptainIds = new Set(captainsForTeam(selectedTeam).map((c) => c.playerId))
    return pool
      .filter((p) => !p.isKeeper)
      .filter((p) => !q || p.playerName.toLowerCase().includes(q))
      .sort((a, b) => {
        // Captains for selected team first
        const aCap = teamCaptainIds.has(a.playerId) ? 0 : 1
        const bCap = teamCaptainIds.has(b.playerId) ? 0 : 1
        if (aCap !== bCap) return aCap - bCap
        return a.playerName.localeCompare(b.playerName)
      })
      .slice(0, 20)
  }, [pool, keeperSearch, captainsForTeam, selectedTeam])

  // ─── Keeper actions ─────────────────────────────────────────────────────

  const addKeeper = useCallback(
    async (playerId: number, teamSlug: string) => {
      const team = keepersForTeam(teamSlug)

      if (team.length >= draft.maxKeepers) {
        toast.error(`Max ${draft.maxKeepers} keepers per team`)
        return
      }

      // Find next unused round for this team
      const usedRounds = new Set(team.map((k) => k.keeperRound))
      let nextRound = 1
      while (usedRounds.has(nextRound)) nextRound++

      // Optimistic update
      setPool((prev) =>
        prev.map((p) =>
          p.playerId === playerId
            ? { ...p, isKeeper: true, keeperTeamSlug: teamSlug, keeperRound: nextRound }
            : p
        )
      )
      setKeeperSearch("")

      // Build the full keeper list for persistence
      const allKeepers: Array<{ playerId: number; teamSlug: string; round: number }> = []
      // Existing keepers
      for (const k of currentKeepers) {
        if (k.playerId !== playerId) {
          allKeepers.push({
            playerId: k.playerId,
            teamSlug: k.keeperTeamSlug!,
            round: k.keeperRound!,
          })
        }
      }
      // Add the new keeper
      allKeepers.push({ playerId, teamSlug, round: nextRound })

      try {
        const res = await fetch(
          `/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/keepers`,
          { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keepers: allKeepers }) }
        )
        if (!res.ok) {
          const err = await res.json()
          toast.error(err.error || "Failed to save keeper")
          // Revert
          setPool((prev) =>
            prev.map((p) =>
              p.playerId === playerId
                ? { ...p, isKeeper: false, keeperTeamSlug: null, keeperRound: null }
                : p
            )
          )
        }
      } catch {
        toast.error("Failed to save keeper")
      }
    },
    [currentKeepers, keepersForTeam, draft.id, draft.maxKeepers, seasonId]
  )

  const removeKeeper = useCallback(
    async (playerId: number) => {
      const player = pool.find((p) => p.playerId === playerId)
      if (!player) return

      // Optimistic
      setPool((prev) =>
        prev.map((p) =>
          p.playerId === playerId
            ? { ...p, isKeeper: false, keeperTeamSlug: null, keeperRound: null }
            : p
        )
      )

      const remaining = currentKeepers
        .filter((k) => k.playerId !== playerId)
        .map((k) => ({
          playerId: k.playerId,
          teamSlug: k.keeperTeamSlug!,
          round: k.keeperRound!,
        }))

      try {
        const res = await fetch(
          `/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/keepers`,
          { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keepers: remaining }) }
        )
        if (!res.ok) {
          toast.error("Failed to remove keeper")
          setPool((prev) =>
            prev.map((p) =>
              p.playerId === playerId ? { ...p, ...player } : p
            )
          )
        }
      } catch {
        toast.error("Failed to remove keeper")
      }
    },
    [currentKeepers, pool, draft.id, seasonId]
  )

  const updateKeeperRound = useCallback(
    async (playerId: number, newRound: number) => {
      const player = pool.find((p) => p.playerId === playerId)
      if (!player) return

      // Optimistic
      setPool((prev) =>
        prev.map((p) =>
          p.playerId === playerId
            ? { ...p, keeperRound: newRound }
            : p
        )
      )

      const updated = currentKeepers.map((k) => ({
        playerId: k.playerId,
        teamSlug: k.keeperTeamSlug!,
        round: k.playerId === playerId ? newRound : k.keeperRound!,
      }))

      try {
        const res = await fetch(
          `/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/keepers`,
          { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keepers: updated }) }
        )
        if (!res.ok) {
          toast.error("Failed to update keeper round")
          setPool((prev) =>
            prev.map((p) =>
              p.playerId === playerId ? { ...p, keeperRound: player.keeperRound } : p
            )
          )
        }
      } catch {
        toast.error("Failed to update keeper round")
      }
    },
    [currentKeepers, pool, draft.id, seasonId]
  )

  const clearAllKeepers = useCallback(async () => {
    setIsClearingKeepers(true)
    try {
      const res = await fetch(
        `/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/keepers`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keepers: [] }) }
      )
      if (res.ok) {
        setPool((prev) => prev.map((p) => ({ ...p, isKeeper: false, keeperTeamSlug: null, keeperRound: null })))
        toast.success("All keepers cleared")
      } else {
        toast.error("Failed to clear keepers")
      }
    } catch {
      toast.error("Failed to clear keepers")
    } finally {
      setIsClearingKeepers(false)
      setShowClearKeepersConfirm(false)
    }
  }, [draft.id, seasonId])

  // ─── Simulation actions ─────────────────────────────────────────────────

  const handleResetSimulation = useCallback(async () => {
    setIsResetting(true)
    try {
      const res = await fetch(
        `/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/reset-simulation`,
        { method: "POST" }
      )
      if (res.ok) {
        toast.success("Simulation reset")
        router.refresh()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to reset")
      }
    } catch {
      toast.error("Failed to reset simulation")
    } finally {
      setIsResetting(false)
    }
  }, [draft.id, seasonId, router])

  // ─── Start draft ────────────────────────────────────────────────────────

  const handleStartDraft = useCallback(async () => {
    setIsStarting(true)
    try {
      const res = await fetch(
        `/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/start`,
        { method: "POST" }
      )
      if (res.ok) {
        const data = await res.json()
        toast.success(`Draft started! ${data.totalPicks} picks generated, ${data.keeperPicks} keepers pre-filled.`)
        setDraft((prev) => ({ ...prev, status: "live" }))
        router.refresh()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to start draft")
      }
    } catch {
      toast.error("Failed to start draft")
    } finally {
      setIsStarting(false)
      setShowStartConfirm(false)
    }
  }, [draft.id, seasonId, router])

  // ─── Board grid data ───────────────────────────────────────────────────

  // Build a grid: round → team → pick
  const boardGrid = useMemo(() => {
    const grid: Record<number, Record<string, Pick | null>> = {}
    for (let r = 1; r <= draft.rounds; r++) {
      grid[r] = {}
      for (const t of teams) {
        grid[r][t.teamSlug] = null
      }
    }

    // Fill with actual picks
    for (const pick of picks) {
      if (grid[pick.round]) {
        grid[pick.round][pick.teamSlug] = pick
      }
    }

    // Also overlay keeper assignments from pool (pre-generated picks)
    if (picks.length === 0) {
      for (const p of currentKeepers) {
        if (p.keeperRound && p.keeperTeamSlug && grid[p.keeperRound]) {
          grid[p.keeperRound][p.keeperTeamSlug] = {
            id: `keeper-preview-${p.playerId}`,
            round: p.keeperRound,
            pickNumber: 0,
            teamSlug: p.keeperTeamSlug,
            originalTeamSlug: p.keeperTeamSlug,
            playerId: p.playerId,
            playerName: p.playerName,
            isKeeper: true,
            isSimulation: false,
            pickedAt: null,
          }
        }
      }
    }

    return grid
  }, [draft.rounds, teams, picks, currentKeepers])

  // Captain warnings: teams missing their captain(s) as keepers
  // Only warn for captains who are actually in this draft's player pool
  const captainWarnings = useMemo(() => {
    const poolPlayerIds = new Set(pool.map((p) => p.playerId))
    const warnings: string[] = []
    for (const team of teams) {
      const teamCaptains = captainsForTeam(team.teamSlug)
      const teamKeepers = keepersForTeam(team.teamSlug)
      for (const cap of teamCaptains) {
        if (!poolPlayerIds.has(cap.playerId)) continue // skip captains not in pool
        if (!teamKeepers.some((k) => k.playerId === cap.playerId)) {
          warnings.push(`${cap.playerName} (captain of ${team.teamName}) is not a keeper`)
        }
      }
    }
    return warnings
  }, [teams, pool, captainsForTeam, keepersForTeam])

  // ─── Keeper summary ────────────────────────────────────────────────────

  const keeperSummary = useMemo(() => {
    return teams.map((t) => {
      const tk = keepersForTeam(t.teamSlug)
      const rounds = tk
        .map((k) => k.keeperRound!)
        .sort((a, b) => a - b)
      const roundsStr = rounds.length > 0
        ? rounds.length <= 3
          ? rounds.map((r) => `R${r}`).join(", ")
          : `R${rounds[0]}–R${rounds[rounds.length - 1]}`
        : "none"
      return { teamSlug: t.teamSlug, teamName: t.teamName, count: tk.length, roundsStr }
    })
  }, [teams, keepersForTeam])

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Simulation banner */}
      {isSimulation && (
        <div className="rounded-lg border-2 border-amber-500 bg-amber-500/10 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-amber-500 text-white border-amber-600 font-bold text-xs uppercase tracking-wider">
              Simulation Mode
            </Badge>
            <span className="text-sm text-amber-700 dark:text-amber-400">
              All picks and trades are test data — will be purged on publish.
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetSimulation}
              disabled={isResetting}
            >
              {isResetting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />}
              Reset
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/admin/seasons/${seasonId}`)}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Exit
            </Button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{draft.name}</h1>
          <p className="text-sm text-muted-foreground">
            {seasonName} · {draft.rounds} rounds · {teams.length} teams · {draft.draftType}
          </p>
        </div>
        <div className="flex gap-2">
          {!isSimulation && !isLive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/admin/seasons/${seasonId}`)}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
        </div>
      </div>

      {/* Keeper entry panel (shown in draft or published state) */}
      {(isSimulation || isPreDraft) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">
                  {isPreDraft ? "Pre-Draft: Enter Keepers" : "Keeper Configuration"}
                </CardTitle>
                <Badge variant="secondary" className="text-xs font-normal">
                  Max {draft.maxKeepers} Keepers
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowClearKeepersConfirm(true)}>
                  Clear All Keepers
                </Button>
                {isPreDraft && (
                  <Button size="sm" onClick={() => setShowStartConfirm(true)} disabled={isStarting}>
                    <Play className="h-4 w-4 mr-1" />
                    Start Draft
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Captain warnings */}
            {captainWarnings.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm space-y-1">
                <p className="font-medium text-amber-700 dark:text-amber-400">⚠ Captain keeper warnings:</p>
                {captainWarnings.map((w, i) => (
                  <p key={i} className="text-amber-600 dark:text-amber-500 text-xs">{w}</p>
                ))}
              </div>
            )}

            {/* Keeper summary bar */}
            <div className="flex flex-wrap gap-2">
              {keeperSummary.map((t) => (
                <Badge
                  key={t.teamSlug}
                  variant={t.count > 0 ? "default" : "outline"}
                  className="cursor-pointer text-xs"
                  onClick={() => setSelectedTeam(t.teamSlug)}
                >
                  {t.teamName}: {t.count} ({t.roundsStr})
                </Badge>
              ))}
            </div>

            {/* Team selector + player search */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t.teamSlug} value={t.teamSlug}>
                        {t.teamName} ({keepersForTeam(t.teamSlug).length} / {draft.maxKeepers} keepers)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Current keepers for selected team */}
                <div className="space-y-1">
                  {keepersForTeam(selectedTeam).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No keepers assigned yet.</p>
                  ) : (
                    keepersForTeam(selectedTeam)
                      .sort((a, b) => (a.keeperRound || 0) - (b.keeperRound || 0))
                      .map((k) => {
                        const isCaptain = captains.some(
                          (c) => c.playerId === k.playerId && c.teamSlug === selectedTeam
                        )
                        return (
                          <div
                            key={k.playerId}
                            className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <Select
                                value={k.keeperRound?.toString()}
                                onValueChange={(val) => updateKeeperRound(k.playerId, parseInt(val, 10))}
                              >
                                <SelectTrigger className="h-6 w-[52px] px-1.5 text-[10px] font-mono border-muted-foreground/20">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {Array.from({ length: draft.rounds }, (_, i) => i + 1).map((r) => (
                                    <SelectItem key={r} value={r.toString()} className="text-[10px]">
                                      R{r}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <span>{k.playerName}</span>
                              {isCaptain && (
                                <Crown className="h-3 w-3 text-amber-500" />
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => removeKeeper(k.playerId)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        )
                      })
                  )}
                </div>
              </div>

              {/* Player search for adding keepers */}
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search players to add as keeper..."
                    value={keeperSearch}
                    onChange={(e) => setKeeperSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {availableForKeeper.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">
                      {keeperSearch ? "No matching players" : "All players assigned"}
                    </p>
                  ) : (
                    availableForKeeper.map((p) => {
                      const isCaptain = captains.some(
                        (c) => c.playerId === p.playerId && c.teamSlug === selectedTeam
                      )
                      return (
                        <button
                          key={p.playerId}
                          className="w-full flex items-center justify-between rounded px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors text-left"
                          onClick={() => addKeeper(p.playerId, selectedTeam)}
                        >
                          <div className="flex items-center gap-2">
                            <span>{p.playerName}</span>
                            {isCaptain && (
                              <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-600">
                                Captain
                              </Badge>
                            )}
                          </div>
                          <Check className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Draft Board Content */}
      {isLive ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3">
            <Tabs defaultValue="board" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="board">Big Board</TabsTrigger>
                <TabsTrigger value="log">Draft Log</TabsTrigger>
              </TabsList>
              <TabsContent value="board" className="mt-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Draft Board</CardTitle>
                  </CardHeader>
                  <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-background border p-2 text-xs font-medium text-muted-foreground w-12">
                    Rd
                  </th>
                  {teams.map((t) => (
                    <th
                      key={t.teamSlug}
                      className="border p-2 text-xs font-semibold min-w-[120px]"
                      style={{
                        backgroundColor: t.color ? `${t.color}15` : undefined,
                        borderBottomColor: t.color || undefined,
                        borderBottomWidth: t.color ? "3px" : undefined,
                      }}
                    >
                      {t.teamName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: draft.rounds }, (_, i) => i + 1).map((round) => (
                  <tr key={round}>
                    <td className="sticky left-0 z-10 bg-background border p-2 text-center text-xs font-mono text-muted-foreground">
                      {round}
                    </td>
                    {teams.map((t) => {
                      const pick = boardGrid[round]?.[t.teamSlug]
                      const isTraded = pick && pick.originalTeamSlug !== pick.teamSlug
                      return (
                        <td
                          key={t.teamSlug}
                          className={`border p-1.5 text-center text-xs ${
                            pick?.playerId
                              ? pick.isKeeper
                                ? "bg-amber-500/5"
                                : "bg-green-500/5"
                              : ""
                          }`}
                          style={{
                            backgroundColor: pick?.playerId && t.color
                              ? `${t.color}08`
                              : undefined,
                          }}
                        >
                          {pick?.playerId ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="font-medium truncate max-w-[100px]">
                                {pick.playerName}
                              </span>
                              <div className="flex gap-0.5">
                                {pick.isKeeper && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 border-amber-500/50 text-amber-600">
                                    K
                                  </Badge>
                                )}
                                {isTraded && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 border-blue-500/50 text-blue-600">
                                    via {pick.originalTeamSlug}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground/30">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="log" className="mt-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Draft Log</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground py-8 text-center border rounded-md border-dashed">
                      Draft log activity will appear here...
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
          
          {/* Live Draft Control Panel */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">On the Clock</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-muted/50 p-4 text-center space-y-1">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Round 1 · Pick 1</div>
                  <div className="text-lg font-bold">Team Name</div>
                  <div className="text-2xl font-mono pt-2 font-semibold tabular-nums text-red-500">
                    2:00
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search players to draft..." className="pl-9" />
                  </div>
                  <div className="text-xs text-muted-foreground text-center py-4 border rounded-md border-dashed">
                    Available players will appear here
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Draft Controls</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm">Trade</Button>
                  <Button variant="outline" size="sm">Edit Order</Button>
                </div>
                <Button variant="outline" size="sm" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50">
                  Undo Last Pick
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Draft Board</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-background border p-2 text-xs font-medium text-muted-foreground w-12">
                      Rd
                    </th>
                    {teams.map((t) => (
                      <th
                        key={t.teamSlug}
                        className="border p-2 text-xs font-semibold min-w-[120px]"
                        style={{
                          backgroundColor: t.color ? `${t.color}15` : undefined,
                          borderBottomColor: t.color || undefined,
                          borderBottomWidth: t.color ? "3px" : undefined,
                        }}
                      >
                        {t.teamName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: draft.rounds }, (_, i) => i + 1).map((round) => (
                    <tr key={round}>
                      <td className="sticky left-0 z-10 bg-background border p-2 text-center text-xs font-mono text-muted-foreground">
                        {round}
                      </td>
                      {teams.map((t) => {
                        const pick = boardGrid[round]?.[t.teamSlug]
                        const isTraded = pick && pick.originalTeamSlug !== pick.teamSlug
                        return (
                          <td
                            key={t.teamSlug}
                            className={`border p-1.5 text-center text-xs ${
                              pick?.playerId
                                ? pick.isKeeper
                                  ? "bg-amber-500/5"
                                  : "bg-green-500/5"
                                : ""
                            }`}
                            style={{
                              backgroundColor: pick?.playerId && t.color
                                ? `${t.color}08`
                                : undefined,
                            }}
                          >
                            {pick?.playerId ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="font-medium truncate max-w-[100px]">
                                  {pick.playerName}
                                </span>
                                <div className="flex gap-0.5">
                                  {pick.isKeeper && (
                                    <Badge variant="outline" className="text-[8px] px-1 py-0 border-amber-500/50 text-amber-600">
                                      K
                                    </Badge>
                                  )}
                                  {isTraded && (
                                    <Badge variant="outline" className="text-[8px] px-1 py-0 border-blue-500/50 text-blue-600">
                                      via {pick.originalTeamSlug}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Clear Keepers Confirmation */}
      <AlertDialog open={showClearKeepersConfirm} onOpenChange={setShowClearKeepersConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Keepers?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to clear all keepers for this draft? This will remove all keeper assignments from the pool and cannot be undone unless you restore from a backup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearingKeepers}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={clearAllKeepers}
              disabled={isClearingKeepers}
            >
              {isClearingKeepers ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Clearing...
                </>
              ) : (
                "Clear Keepers"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Start Draft Confirmation */}
      <AlertDialog open={showStartConfirm} onOpenChange={setShowStartConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start the Draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This will lock all keeper picks, generate {draft.rounds * teams.length} pick slots, and transition the draft to live.
              {currentKeepers.length > 0
                ? ` ${currentKeepers.length} keeper picks will be pre-filled.`
                : " No keepers have been assigned — all picks will be open."}
              {captainWarnings.length > 0 && (
                <span className="block mt-2 text-amber-600 font-medium">
                  ⚠ {captainWarnings.length} captain warning(s) — captains should be keepers per BASH rules.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isStarting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStartDraft} disabled={isStarting}>
              {isStarting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start Draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
