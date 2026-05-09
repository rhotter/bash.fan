"use client"

import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { RotateCcw, Play, Pause, Loader2, Crown, Search, X, Check, Download, Upload, MoreVertical, LogOut, ExternalLink, Timer, Info } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { PlayerCardModal } from "@/components/player-card-modal"
import { resolvePreDraftTrades, type PreDraftTradeInput } from "@/lib/draft-trade-resolver"
import { generatePickSlots } from "@/lib/draft-helpers"

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

  pickedAt: string | null
}

interface TradeItem {
  fromTeamSlug: string
  toTeamSlug: string
  round: number | null
}

interface Trade {
  id: string
  teamASlug: string
  teamBSlug: string
  tradeType: string
  description: string | null
  tradedAt: string | null
  items: TradeItem[]
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

  draftType: string
  rounds: number
  timerSeconds: number
  maxKeepers: number
  draftDate: string | null
  location: string | null
  currentRound: number | null
  currentPick: number | null
  timerCountdown: number | null
  timerRunning: boolean
  timerStartedAt: string | null
}

interface DraftBoardViewProps {
  seasonId: string
  seasonSlug: string
  seasonName: string
  draft: DraftInstance
  teams: Team[]
  pool: PoolPlayer[]
  picks: Pick[]
  trades: Trade[]
  captains: Captain[]
}

// ─── Component ──────────────────────────────────────────────────────────────

function formatPlayerName(name: string | null) {
  if (!name) return "—"
  if (name.length > 14 && name.includes(" ")) {
    const parts = name.split(" ")
    return `${parts[0][0]}. ${parts.slice(1).join(" ")}`
  }
  return name
}

export function DraftBoardView({
  seasonId,
  seasonSlug,
  seasonName,
  draft: initialDraft,
  teams,
  pool: initialPool,
  picks: initialPicks,
  trades,
  captains,
}: DraftBoardViewProps) {
  const router = useRouter()
  const [draft, setDraft] = useState(initialDraft)
  const [pool, setPool] = useState(initialPool)
  const [picks, setPicks] = useState(initialPicks)

  // Sync state from server props after router.refresh()
  // Next.js preserves client state on soft refresh, so we must
  // explicitly update when the server provides new data.
  useEffect(() => { setDraft(initialDraft) }, [initialDraft])
  useEffect(() => { setPool(initialPool) }, [initialPool])
  useEffect(() => { setPicks(initialPicks) }, [initialPicks])

  const [showStartConfirm, setShowStartConfirm] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [showClearKeepersConfirm, setShowClearKeepersConfirm] = useState(false)
  const [isClearingKeepers, setIsClearingKeepers] = useState(false)
  const [isUndoing, setIsUndoing] = useState(false)
  const [showDurationDialog, setShowDurationDialog] = useState(false)
  const [newDuration, setNewDuration] = useState(String(initialDraft.timerSeconds))
  const [isSavingDuration, setIsSavingDuration] = useState(false)

  // System log entries for admin actions (duration changes, etc.)
  const [systemLog, setSystemLog] = useState<{ time: string; text: string }[]>([])

  // Timer state — initialize with static value to avoid hydration mismatch.
  // The useEffect below will immediately compute the correct elapsed time on mount.
  const [timerRemaining, setTimerRemaining] = useState<number>(
    initialDraft.timerCountdown ?? initialDraft.timerSeconds
  )
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sync timer when draft state updates (from picks, undo, etc.)
  useEffect(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)

    if (draft.timerRunning && draft.timerStartedAt) {
      const tick = () => {
        const elapsed = Math.floor((Date.now() - new Date(draft.timerStartedAt!).getTime()) / 1000)
        const remaining = Math.max(0, (draft.timerCountdown ?? draft.timerSeconds) - elapsed)
        setTimerRemaining(remaining)
      }
      tick() // immediate first tick
      timerIntervalRef.current = setInterval(tick, 1000)
    } else {
      setTimerRemaining(draft.timerCountdown ?? draft.timerSeconds)
    }

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    }
  }, [draft.timerRunning, draft.timerStartedAt, draft.timerCountdown, draft.timerSeconds])

  const handleTimerAction = async (action: "pause" | "resume" | "reset") => {
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/timer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Timer action failed")
      }
      const result = await res.json()
      setDraft(result.draft)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "An error occurred"
      toast.error(msg)
    }
  }

  const handleSetDuration = async () => {
    const duration = Number(newDuration)
    if (!duration || duration < 10 || duration > 600) {
      toast.error("Duration must be between 10 and 600 seconds")
      return
    }
    setIsSavingDuration(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/timer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setDuration", duration }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to update duration")
      }
      const result = await res.json()
      setDraft(result.draft)
      setShowDurationDialog(false)
      setSystemLog(prev => [...prev, {
        time: new Date().toISOString(),
        text: `Pick timer changed to ${duration}s (was ${draft.timerSeconds}s)`,
      }])
      toast.success(`Pick timer updated to ${duration}s`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "An error occurred"
      toast.error(msg)
    } finally {
      setIsSavingDuration(false)
    }
  }

  // Keeper entry state
  const [selectedTeam, setSelectedTeam] = useState<string>(teams[0]?.teamSlug || "")
  const [keeperSearch, setKeeperSearch] = useState("")

  const isDraft = draft.status === "draft"
  const isPreDraft = draft.status === "published"
  const isLive = draft.status === "live"

  // Live Draft State
  const [livePlayerSearch, setLivePlayerSearch] = useState("")
  const [isSubmittingPick, setIsSubmittingPick] = useState(false)
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null)

  // Player card modal state (separate from live draft selection)
  const [cardPlayerId, setCardPlayerId] = useState<number | null>(null)
  const [playerCardOpen, setPlayerCardOpen] = useState(false)

  const openPlayerCard = useCallback((playerId: number) => {
    setCardPlayerId(playerId)
    setPlayerCardOpen(true)
  }, [])
  
  // Dialog state
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false)
  const [tradeTeam1, setTradeTeam1] = useState<string>("")
  const [tradePick1, setTradePick1] = useState<string>("")
  const [tradeTeam2, setTradeTeam2] = useState<string>("")
  const [tradePick2, setTradePick2] = useState<string>("")
  const [isTrading, setIsTrading] = useState(false)

  const [editOrderDialogOpen, setEditOrderDialogOpen] = useState(false)
  const [editOrderPickId, setEditOrderPickId] = useState<string>("")
  const [editOrderTeamSlug, setEditOrderTeamSlug] = useState<string>("")
  const [isEditingOrder, setIsEditingOrder] = useState(false)
  const [showPushConfirm, setShowPushConfirm] = useState(false)
  const [isPushingRosters, setIsPushingRosters] = useState(false)
  const [draftCompleteModalOpen, setDraftCompleteModalOpen] = useState(false)
  const [showRevertConfirm, setShowRevertConfirm] = useState(false)
  const [isReverting, setIsReverting] = useState(false)

  // Compute available players for live draft
  const availableForDraft = useMemo(() => {
    return pool.filter(p => !picks.some(pick => pick.playerId === p.playerId))
               .filter(p => p.playerName.toLowerCase().includes(livePlayerSearch.toLowerCase()))
               .sort((a, b) => a.playerName.localeCompare(b.playerName))
  }, [pool, picks, livePlayerSearch])

  // Find current pick
  const currentPickIndex = picks.findIndex(p => p.playerId === null)
  const currentPick = currentPickIndex >= 0 ? picks[currentPickIndex] : null
  const currentTeam = currentPick ? teams.find(t => t.teamSlug === currentPick.teamSlug) : null

  // Captain auto-population: assign captains as R1/R2/... keepers on first load
  const [autoPopulated, setAutoPopulated] = useState(false)
  useEffect(() => {
    if (autoPopulated) return
    if (isLive || draft.status === "completed" || isDraft) return
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
  }, [autoPopulated, isDraft, isLive, draft.status, draft.id, draft.maxKeepers, initialPool, captains, seasonId])

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

  // ─── Live Draft Actions ──────────────────────────────────────────────────

  const handlePick = async () => {
    if (!currentPick || !selectedPlayerId) return
    setIsSubmittingPick(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/pick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickId: currentPick.id, playerId: selectedPlayerId })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to submit pick")
      }
      
      const result = await res.json()
      setPicks(result.picks)
      setDraft(result.draft)
      setSelectedPlayerId(null)
      toast.success("Pick confirmed")

      // Show completion modal if draft auto-completed
      if (result.draft?.status === "completed") {
        setDraftCompleteModalOpen(true)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "An error occurred"
      toast.error(msg)
    } finally {
      setIsSubmittingPick(false)
    }
  }

  const handleUndo = async () => {
    setIsUndoing(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/undo`, {
        method: "POST"
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to undo pick")
      }
      
      const result = await res.json()
      setPicks(result.picks)
      setDraft(result.draft)
      setSelectedPlayerId(null)
      toast.success("Pick undone")
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "An error occurred"
      toast.error(msg)
    } finally {
      setIsUndoing(false)
    }
  }

  const upcomingPicks = useMemo(() => {
    return picks.filter(p => p.playerId === null && !p.isKeeper)
  }, [picks])

  const handleTrade = async () => {
    if (!tradePick1 || !tradePick2) return
    setIsTrading(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "pick_swap", pickIds: [tradePick1, tradePick2] })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to execute trade")
      }
      const result = await res.json()
      setPicks(result.picks)
      setTradeDialogOpen(false)
      setTradeTeam1("")
      setTradePick1("")
      setTradeTeam2("")
      setTradePick2("")
      toast.success("Trade executed successfully")
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "An error occurred"
      toast.error(msg)
    } finally {
      setIsTrading(false)
    }
  }

  const handleEditOrder = async () => {
    if (!editOrderPickId || !editOrderTeamSlug) return
    setIsEditingOrder(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/pick/${editOrderPickId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug: editOrderTeamSlug })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to edit order")
      }
      const result = await res.json()
      setPicks(result.picks)
      setEditOrderDialogOpen(false)
      setEditOrderPickId("")
      setEditOrderTeamSlug("")
      toast.success("Pick order updated")
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "An error occurred"
      toast.error(msg)
    } finally {
      setIsEditingOrder(false)
    }
  }

  const handleExportCsv = () => {
    window.open(`/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/export`, "_blank")
  }

  const handlePushRosters = async () => {
    setIsPushingRosters(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/push-rosters`, {
        method: "POST",
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to push rosters")
      }
      const result = await res.json()
      toast.success(
        `Rosters pushed: ${result.summary.inserted} added, ${result.summary.updated} updated, ${result.summary.skipped} skipped`
      )
      setShowPushConfirm(false)
      setDraft((prev) => ({ ...prev, status: "completed" }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "An error occurred"
      toast.error(msg)
    } finally {
      setIsPushingRosters(false)
    }
  }

  const handleRevertToLive = async () => {
    setIsReverting(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/revert-to-live`, {
        method: "POST",
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to revert draft")
      }
      setDraft((prev) => ({ ...prev, status: "live", timerRunning: false }))
      setShowRevertConfirm(false)
      toast.success("Draft reverted to live — you can continue drafting")
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "An error occurred"
      toast.error(msg)
    } finally {
      setIsReverting(false)
    }
  }

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



  // ─── Start draft ────────────────────────────────────────────────────────

  // Trade warnings: flag trades involving picks that exceed the player pool
  const tradeWarnings = useMemo(() => {
    if (pool.length === 0 || teams.length === 0) return []
    const totalPlayers = pool.length
    const numTeams = teams.length
    // The last round that will actually have all picks filled
    const lastFullRound = Math.floor(totalPlayers / numTeams)
    const remainderPicks = totalPlayers % numTeams

    const warnings: string[] = []
    const preDraftTrades = trades.filter((t) => t.tradeType === "pre_draft_pick_swap")

    for (const trade of preDraftTrades) {
      for (const item of trade.items) {
        if (!item.round) continue
        if (item.round > lastFullRound) {
          // This pick is in a partial round — check if the team would actually get a pick
          if (item.round > lastFullRound + 1 || remainderPicks === 0) {
            // Round doesn't exist at all
            warnings.push(
              `Trade between ${trade.teamASlug} and ${trade.teamBSlug}: Round ${item.round} pick from ${item.fromTeamSlug} will never be used (only ${totalPlayers} players for ${numTeams} teams = ${lastFullRound} full rounds${remainderPicks > 0 ? ` + ${remainderPicks} picks in round ${lastFullRound + 1}` : ""}).`
            )
          }
        }
      }
    }
    // Deduplicate (both items in a trade might flag)
    return [...new Set(warnings)]
  }, [pool, teams, trades])

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

    // Fill with actual picks — key by originalTeamSlug so picks stay
    // in their original column even after trades
    for (const pick of picks) {
      if (grid[pick.round]) {
        grid[pick.round][pick.originalTeamSlug] = pick
      }
    }

    // Also overlay keeper assignments from pool (pre-generated picks)
    if (picks.length === 0) {
      // In published mode, build trade-aware preview slots so admins can
      // visualize which picks have been swapped before starting the draft.
      const preDraftTrades = trades.filter((t) => t.tradeType === "pre_draft_pick_swap")
      const teamSlugs = teams.map((t) => t.teamSlug)

      if (preDraftTrades.length > 0) {
        // Build trade inputs from stored trade items
        const tradeInputs: PreDraftTradeInput[] = preDraftTrades
          .filter((t) => t.items.length === 2)
          .map((t) => ({
            teamASlug: t.teamASlug,
            teamARound: t.items[0].round!,
            teamAOriginalOwner: t.items[0].fromTeamSlug,
            teamBSlug: t.teamBSlug,
            teamBRound: t.items[1].round!,
            teamBOriginalOwner: t.items[1].fromTeamSlug,
          }))

        const ownershipMap = resolvePreDraftTrades(teamSlugs, draft.rounds, tradeInputs)
        const previewSlots = generatePickSlots(teamSlugs, draft.rounds, draft.draftType as "snake" | "linear", ownershipMap)

        for (const slot of previewSlots) {
          if (slot.teamSlug !== slot.originalTeamSlug && grid[slot.round]) {
            // Mark the original owner's cell as traded away
            grid[slot.round][slot.originalTeamSlug] = {
              id: `trade-preview-${slot.originalTeamSlug}-${slot.round}`,
              round: slot.round,
              pickNumber: slot.pickNumber,
              teamSlug: slot.teamSlug,
              originalTeamSlug: slot.originalTeamSlug,
              playerId: null,
              playerName: null,
              isKeeper: false,
              pickedAt: null,
            }
          }
        }
      }

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
            pickedAt: null,
          }
        }
      }
    }

    return grid
  }, [draft.rounds, draft.draftType, teams, picks, currentKeepers, trades])

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


      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{draft.name}</h1>
          <p className="text-sm text-muted-foreground">
            {seasonName} · {draft.rounds} rounds · {teams.length} teams · {draft.draftType}
          </p>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {(isLive || draft.status === "completed") && (
                <>
                  <DropdownMenuItem onClick={handleExportCsv}>
                    <Download className="h-4 w-4 mr-2" />
                    Export CSV
                  </DropdownMenuItem>
                  {draft.status !== "completed" && (
                    <DropdownMenuItem onClick={() => setShowPushConfirm(true)}>
                      <Upload className="h-4 w-4 mr-2" />
                      Push Rosters
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => { setNewDuration(String(draft.timerSeconds)); setShowDurationDialog(true) }}>
                    <Timer className="h-4 w-4 mr-2" />
                    Edit Pick Duration
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => window.open(`/draft/${seasonSlug}`, "_blank")}>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Public Page
              </DropdownMenuItem>
              {draft.status === "completed" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setShowRevertConfirm(true)}
                    className="text-orange-600 focus:text-orange-600"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Revert to Live
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push(`/admin/seasons/${seasonId}`)}>
                <LogOut className="h-4 w-4 mr-2" />
                Exit Draft
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Trade Dialog */}
      <Dialog open={tradeDialogOpen} onOpenChange={setTradeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Swap Picks</DialogTitle>
            <DialogDescription>Select two upcoming picks to swap their assigned teams.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Side A */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Team</label>
                <Select value={tradeTeam1} onValueChange={(val) => { setTradeTeam1(val); setTradePick1(""); }}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map(t => (
                      <SelectItem key={`t1-${t.teamSlug}`} value={t.teamSlug}>
                        {t.teamName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Pick to trade away</label>
                <Select value={tradePick1} onValueChange={setTradePick1} disabled={!tradeTeam1}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder={tradeTeam1 ? "Select pick" : "Select a team first"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[250px]">
                    {upcomingPicks.filter(p => p.teamSlug === tradeTeam1).map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        Round {p.round}, Pick {p.pickNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 px-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">for</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Side B */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Team</label>
                <Select value={tradeTeam2} onValueChange={(val) => { setTradeTeam2(val); setTradePick2(""); }}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map(t => (
                      <SelectItem key={`t2-${t.teamSlug}`} value={t.teamSlug}>
                        {t.teamName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Pick to trade away</label>
                <Select value={tradePick2} onValueChange={setTradePick2} disabled={!tradeTeam2}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder={tradeTeam2 ? "Select pick" : "Select a team first"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[250px]">
                    {upcomingPicks.filter(p => p.teamSlug === tradeTeam2).map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        Round {p.round}, Pick {p.pickNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTradeDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleTrade} disabled={isTrading || !tradePick1 || !tradePick2 || tradePick1 === tradePick2}>
              {isTrading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Execute Trade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Order Dialog */}
      <Dialog open={editOrderDialogOpen} onOpenChange={setEditOrderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Pick Order</DialogTitle>
            <DialogDescription>Assign a different team to an upcoming pick slot.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Pick Slot</label>
              <Select value={editOrderPickId} onValueChange={setEditOrderPickId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an open pick" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {upcomingPicks.map(p => {
                    const t = teams.find(team => team.teamSlug === p.teamSlug)
                    return (
                      <SelectItem key={p.id} value={p.id}>
                        R{p.round}P{p.pickNumber} — Currently: {t?.teamName}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">New Team</label>
              <Select value={editOrderTeamSlug} onValueChange={setEditOrderTeamSlug}>
                <SelectTrigger>
                  <SelectValue placeholder="Select team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map(t => (
                    <SelectItem key={t.teamSlug} value={t.teamSlug}>
                      {t.teamName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOrderDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditOrder} disabled={isEditingOrder || !editOrderPickId || !editOrderTeamSlug}>
              {isEditingOrder ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Push Rosters Confirmation */}
      <AlertDialog open={showPushConfirm} onOpenChange={setShowPushConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Push Rosters to Season</AlertDialogTitle>
            <AlertDialogDescription>
              This will create player-season entries for all drafted players, setting their team, goalie, rookie, and captain flags. The draft will be marked as completed. This action is safe to run multiple times.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePushRosters} disabled={isPushingRosters}>
              {isPushingRosters ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Push Rosters
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revert to Live Confirmation */}
      <AlertDialog open={showRevertConfirm} onOpenChange={setShowRevertConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert Draft to Live</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert the draft from &quot;completed&quot; back to &quot;live&quot; status, allowing you to continue making picks. All existing picks will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevertToLive} disabled={isReverting} className="bg-orange-600 hover:bg-orange-700">
              {isReverting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
              Revert to Live
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Pick Duration Dialog */}
      <Dialog open={showDurationDialog} onOpenChange={setShowDurationDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Pick Duration</DialogTitle>
            <DialogDescription>
              Change the time allowed per pick. The current pick timer will reset to the new duration.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="pick-duration">Duration (seconds)</Label>
            <Input
              id="pick-duration"
              type="number"
              min={10}
              max={600}
              value={newDuration}
              onChange={(e) => setNewDuration(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSetDuration()}
            />
            <p className="text-xs text-muted-foreground">Min: 10s · Max: 600s (10 min)</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDurationDialog(false)}>Cancel</Button>
            <Button onClick={handleSetDuration} disabled={isSavingDuration}>
              {isSavingDuration && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Draft Complete Modal */}
      <Dialog open={draftCompleteModalOpen} onOpenChange={setDraftCompleteModalOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">🏒 Draft Complete!</DialogTitle>
            <DialogDescription className="text-center">
              All available players have been drafted. Here are your next steps:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-start gap-3 p-3 rounded-md bg-muted/50">
              <span className="text-lg font-bold text-muted-foreground">1</span>
              <div>
                <p className="font-medium text-sm">Review Draft Results</p>
                <p className="text-xs text-muted-foreground">View the final draft board and verify all picks. You can also export the results as a CSV if you'd like to use them elsewhere.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-md bg-muted/50">
              <span className="text-lg font-bold text-muted-foreground">2</span>
              <div>
                <p className="font-medium text-sm">Push Rosters</p>
                <p className="text-xs text-muted-foreground">From the Draft tab, when ready, push the rosters to save them to the season.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-md bg-muted/50">
              <span className="text-lg font-bold text-muted-foreground">3</span>
              <div>
                <p className="font-medium text-sm">Publish Season</p>
                <p className="text-xs text-muted-foreground">Complete your review of the season settings, schedule, and rosters. Once everything looks good, publish the season. This will update the public facing pages to reflect a new &quot;current season&quot;.</p>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => { handleExportCsv(); setDraftCompleteModalOpen(false) }}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => { setDraftCompleteModalOpen(false); window.open(`/draft/${seasonSlug}`, "_blank") }}>
              <ExternalLink className="h-4 w-4 mr-2" />
              View Draft Results
            </Button>
            <Button onClick={() => { setDraftCompleteModalOpen(false); router.push(`/admin/seasons/${seasonId}`) }}>
              Season Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Keeper entry panel (shown in draft or published state) */}
      {(isDraft || isPreDraft) && (
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
                      const isTradedAway = pick && pick.teamSlug !== t.teamSlug
                      const newOwnerTeam = isTradedAway ? teams.find(tm => tm.teamSlug === pick.teamSlug) : null
                      const playerInPool = pick?.playerId ? pool.find(p => p.playerId === pick.playerId) : null
                      const isRookie = playerInPool?.registrationMeta?.isRookie === true
                      const isGoalie = typeof playerInPool?.registrationMeta?.positions === "string" && playerInPool.registrationMeta.positions.includes("G")

                      return (
                        <td
                          key={t.teamSlug}
                          className={`border p-1.5 text-left text-xs ${
                            pick?.playerId
                              ? pick.isKeeper
                                ? "bg-amber-500/5"
                                : "bg-green-500/5"
                              : isTradedAway
                                ? "bg-blue-500/5"
                                : "text-center"
                          }`}
                          style={{
                            backgroundColor: pick?.playerId && t.color
                              ? `${t.color}08`
                              : undefined,
                          }}
                        >
                          {pick?.playerId ? (
                            <div className="flex flex-col items-start gap-0.5 pl-1">
                              <button
                                className="font-medium truncate max-w-[120px] text-left hover:underline hover:text-primary transition-colors"
                                title={pick.playerName || ""}
                                onClick={(e) => { e.stopPropagation(); if (pick.playerId) openPlayerCard(pick.playerId) }}
                              >
                                {formatPlayerName(pick.playerName)}
                              </button>
                              <div className="flex gap-0.5">
                                {pick.isKeeper && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 border-amber-500/50 text-amber-600">
                                    K
                                  </Badge>
                                )}
                                {isTradedAway && newOwnerTeam && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 border-blue-500/50 text-blue-600">
                                    → {newOwnerTeam.teamName}
                                  </Badge>
                                )}
                                {isRookie && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 border-green-500/50 text-green-600 bg-green-50/50">
                                    R
                                  </Badge>
                                )}
                                {isGoalie && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 border-purple-500/50 text-purple-600 bg-purple-50/50">
                                    G
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ) : isTradedAway && newOwnerTeam ? (
                            <div className="flex flex-col items-start gap-0.5 pl-1">
                              <Badge variant="outline" className="text-[8px] px-1 py-0 border-blue-500/50 text-blue-600">
                                → {newOwnerTeam.teamName}
                              </Badge>
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
                    {(() => {
                      // Build a unified log from picks and trades
                      type LogEntry = { time: string | null; text: string; type: "pick" | "trade" | "keeper" | "system" }
                      const logEntries: LogEntry[] = []

                      // Add picks
                      for (const p of picks) {
                        if (p.playerId && p.pickedAt) {
                          const teamInfo = teams.find(tm => tm.teamSlug === p.teamSlug)
                          logEntries.push({
                            time: p.pickedAt,
                            text: p.isKeeper
                              ? `${teamInfo?.teamName || p.teamSlug} keeper: ${p.playerName} (Round ${p.round})`
                              : `R${p.round}P${p.pickNumber - (p.round - 1) * teams.length}: ${teamInfo?.teamName || p.teamSlug} select ${p.playerName} (#${p.pickNumber} overall)`,
                            type: p.isKeeper ? "keeper" : "pick",
                          })
                        }
                      }

                      // Add trades
                      for (const t of trades) {
                        const teamA = teams.find(tm => tm.teamSlug === t.teamASlug)?.teamName || t.teamASlug
                        const teamB = teams.find(tm => tm.teamSlug === t.teamBSlug)?.teamName || t.teamBSlug
                        // Use description if available, otherwise build a generic one
                        const tradeText = t.description
                          ? `Trade: ${t.description}`
                          : `Trade: ${teamA} ↔ ${teamB}`
                        logEntries.push({
                          time: t.tradedAt || null,
                          text: tradeText,
                          type: "trade",
                        })
                      }

                      // Add system events
                      for (const s of systemLog) {
                        logEntries.push({
                          time: s.time,
                          text: s.text,
                          type: "system",
                        })
                      }

                      // Sort newest first
                      logEntries.sort((a, b) => {
                        if (!a.time && !b.time) return 0
                        if (!a.time) return 1
                        if (!b.time) return -1
                        return new Date(b.time).getTime() - new Date(a.time).getTime()
                      })

                      if (logEntries.length === 0) {
                        return (
                          <div className="text-sm text-muted-foreground py-8 text-center border rounded-md border-dashed">
                            No draft activity yet.
                          </div>
                        )
                      }

                      return (
                        <div className="space-y-1 max-h-[500px] overflow-y-auto pr-1">
                          {logEntries.map((entry, i) => (
                            <div key={i} className="flex gap-3 py-1.5 border-b border-border/50 last:border-b-0">
                              <span className="text-[11px] text-muted-foreground w-[70px] shrink-0 tabular-nums">
                                {entry.time ? new Date(entry.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}
                              </span>
                              <span className={`text-xs ${
                                entry.type === "trade"
                                  ? "text-blue-600 dark:text-blue-400"
                                  : entry.type === "keeper"
                                    ? "text-amber-600 dark:text-amber-400"
                                    : entry.type === "system"
                                      ? "text-green-600 dark:text-green-400 italic"
                                      : "text-foreground"
                              }`}>
                                {entry.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
          
          {/* Live Draft Control Panel */}
          <div className="lg:col-span-1 space-y-4">
            <Card className="border-none shadow-none bg-transparent">
              <CardContent className="p-0 space-y-4">
                {currentPick ? (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <div className="text-lg font-medium">Round {currentPick.round} Pick {currentPick.pickNumber - (currentPick.round - 1) * teams.length}</div>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: currentTeam?.color || "#ccc" }} 
                        />
                        <span className="text-sm text-muted-foreground">{currentTeam?.teamName}</span>
                        <span className="text-xs text-muted-foreground/60">· #{currentPick.pickNumber} overall</span>
                      </div>
                    </div>

                    {/* Timer */}
                    <div className={`rounded-md p-4 border flex items-center justify-between transition-colors ${
                      timerRemaining === 0
                        ? "bg-red-100 dark:bg-red-950/40 border-red-300 dark:border-red-800 animate-pulse"
                        : timerRemaining <= 10
                          ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900"
                          : "bg-muted/30 border-border"
                    }`}>
                      <div className={`text-4xl font-mono tracking-tight font-semibold tabular-nums ${
                        timerRemaining === 0
                          ? "text-red-600 dark:text-red-400"
                          : timerRemaining <= 10
                            ? "text-red-500 dark:text-red-400"
                            : "text-black dark:text-white"
                      }`}>
                        {Math.floor(timerRemaining / 60)}:{(timerRemaining % 60).toString().padStart(2, '0')}
                      </div>
                      <div className="flex gap-1 text-muted-foreground">
                        {draft.timerRunning ? (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleTimerAction("pause")}>
                            <Pause className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleTimerAction("resume")}>
                            <Play className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleTimerAction("reset")}>
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[220px] text-center">
                            <p>The timer is a visual guideline to keep the draft moving. It does not auto-advance picks.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-muted p-4 text-center">
                    <div className="text-sm font-medium">Draft Complete</div>
                  </div>
                )}
                
                <div className="space-y-2 pt-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Search eligible players..." 
                      className="pl-9 bg-background" 
                      value={livePlayerSearch}
                      onChange={(e) => setLivePlayerSearch(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2 max-h-[350px] overflow-y-auto pr-1">
                    {availableForDraft.length === 0 ? (
                      <div className="text-xs text-muted-foreground text-center py-4 border rounded-md border-dashed">
                        No players found
                      </div>
                    ) : (
                      availableForDraft.slice(0, 50).map(p => {
                        const positionStr = typeof p.registrationMeta?.positions === "string" ? p.registrationMeta.positions : ""
                        const age = typeof p.registrationMeta?.age === "number" ? p.registrationMeta.age : null
                        const isSelected = p.playerId === selectedPlayerId
                        
                        return (
                          <div 
                            key={p.playerId} 
                            onClick={() => setSelectedPlayerId(p.playerId)}
                            className={`flex flex-col p-3 border rounded-md cursor-pointer transition-colors ${
                              isSelected 
                                ? "bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800" 
                                : "bg-card hover:bg-accent border-border"
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <span className="font-medium text-sm">{p.playerName}</span>
                              <Badge variant="secondary" className="text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 hover:bg-orange-100">
                                {positionStr || "Player"}
                              </Badge>
                            </div>
                            {age !== null && (
                              <span className="text-xs text-muted-foreground mt-0.5">Age: {age}</span>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                <Button 
                  className="w-full bg-orange-400 hover:bg-orange-500 text-white font-medium shadow-none h-10" 
                  disabled={!currentPick || isSubmittingPick || !selectedPlayerId}
                  onClick={handlePick}
                >
                  Confirm Pick
                </Button>

                <div className="grid grid-cols-3 gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="text-xs shadow-none border-border"
                    onClick={() => setTradeDialogOpen(true)}
                  >
                    Trade
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="text-xs shadow-none border-border"
                    onClick={() => setEditOrderDialogOpen(true)}
                  >
                    Edit Order
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="text-xs shadow-none border-border text-red-500 hover:text-red-600"
                    disabled={isUndoing}
                    onClick={handleUndo}
                  >
                    Undo Last
                  </Button>
                </div>

              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
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
                            const isTradedAway = pick && pick.teamSlug !== t.teamSlug
                            const newOwnerTeam = isTradedAway ? teams.find(tm => tm.teamSlug === pick.teamSlug) : null
                            const playerInPool = pick?.playerId ? pool.find(p => p.playerId === pick.playerId) : null
                            const isRookie = playerInPool?.registrationMeta?.isRookie === true
                            const isGoalie = typeof playerInPool?.registrationMeta?.positions === "string" && playerInPool.registrationMeta.positions.includes("G")

                            return (
                              <td
                                key={t.teamSlug}
                                className={`border p-2 text-xs transition-colors ${
                                  isTradedAway
                                    ? "bg-blue-50/50 dark:bg-blue-950/20"
                                    : pick?.playerId
                                      ? "bg-background"
                                      : "bg-muted/20"
                                }`}
                              >
                                {pick?.playerId && pick.playerName ? (
                                  <div className="flex flex-col gap-0.5">
                                    <button
                                      onClick={() => openPlayerCard(pick.playerId!)}
                                      className="font-medium text-left hover:text-orange-600 transition-colors cursor-pointer"
                                    >
                                      {pick.playerName}
                                    </button>
                                    <div className="flex gap-1">
                                      {pick.isKeeper && (
                                        <Badge variant="outline" className="text-[8px] px-1 py-0 border-orange-500/50 text-orange-600 bg-orange-50/50">
                                          K
                                        </Badge>
                                      )}
                                      {isTradedAway && newOwnerTeam && (
                                        <Badge variant="outline" className="text-[8px] px-1 py-0 border-blue-500/50 text-blue-600 bg-blue-50/50">
                                          → {newOwnerTeam.teamName}
                                        </Badge>
                                      )}
                                      {isRookie && (
                                        <Badge variant="outline" className="text-[8px] px-1 py-0 border-green-500/50 text-green-600 bg-green-50/50">
                                          R
                                        </Badge>
                                      )}
                                      {isGoalie && (
                                        <Badge variant="outline" className="text-[8px] px-1 py-0 border-purple-500/50 text-purple-600 bg-purple-50/50">
                                          G
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                ) : isTradedAway && newOwnerTeam ? (
                                  <div className="flex flex-col items-start gap-0.5 pl-1">
                                    <Badge variant="outline" className="text-[8px] px-1 py-0 border-blue-500/50 text-blue-600">
                                      → {newOwnerTeam.teamName}
                                    </Badge>
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
                {(() => {
                  type LogEntry = { time: string | null; text: string; type: "pick" | "trade" | "keeper" | "system" }
                  const logEntries: LogEntry[] = []

                  for (const p of picks) {
                    if (p.playerId && p.pickedAt) {
                      const teamInfo = teams.find(tm => tm.teamSlug === p.teamSlug)
                      logEntries.push({
                        time: p.pickedAt,
                        text: p.isKeeper
                          ? `${teamInfo?.teamName || p.teamSlug} keeper: ${p.playerName} (Round ${p.round})`
                          : `R${p.round}P${p.pickNumber - (p.round - 1) * teams.length}: ${teamInfo?.teamName || p.teamSlug} select ${p.playerName} (#${p.pickNumber} overall)`,
                        type: p.isKeeper ? "keeper" : "pick",
                      })
                    }
                  }

                  for (const t of trades) {
                    const teamA = teams.find(tm => tm.teamSlug === t.teamASlug)?.teamName || t.teamASlug
                    const teamB = teams.find(tm => tm.teamSlug === t.teamBSlug)?.teamName || t.teamBSlug
                    const tradeText = t.description
                      ? `Trade: ${t.description}`
                      : `Trade: ${teamA} ↔ ${teamB}`
                    logEntries.push({
                      time: t.tradedAt || null,
                      text: tradeText,
                      type: "trade",
                    })
                  }

                  for (const s of systemLog) {
                    logEntries.push({ time: s.time, text: s.text, type: "system" })
                  }

                  logEntries.sort((a, b) => {
                    if (!a.time && !b.time) return 0
                    if (!a.time) return 1
                    if (!b.time) return -1
                    return new Date(b.time).getTime() - new Date(a.time).getTime()
                  })

                  if (logEntries.length === 0) {
                    return (
                      <div className="text-sm text-muted-foreground py-8 text-center border rounded-md border-dashed">
                        No draft activity recorded.
                      </div>
                    )
                  }

                  return (
                    <div className="space-y-1 max-h-[500px] overflow-y-auto pr-1">
                      {logEntries.map((entry, i) => (
                        <div key={i} className="flex gap-3 py-1.5 border-b border-border/50 last:border-b-0">
                          <span className="text-[11px] text-muted-foreground w-[70px] shrink-0 tabular-nums">
                            {entry.time ? new Date(entry.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}
                          </span>
                          <span className={`text-xs ${
                            entry.type === "trade"
                              ? "text-blue-600 dark:text-blue-400"
                              : entry.type === "keeper"
                                ? "text-amber-600 dark:text-amber-400"
                                : entry.type === "system"
                                  ? "text-green-600 dark:text-green-400 italic"
                                  : "text-foreground"
                          }`}>
                            {entry.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
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
              {tradeWarnings.length > 0 && (
                <span className="block mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-amber-700 text-xs">
                  <span className="font-semibold block mb-1">⚠ Trade Warning — {tradeWarnings.length} trade(s) involve picks beyond the player pool:</span>
                  {tradeWarnings.map((w, i) => (
                    <span key={i} className="block mt-1">• {w}</span>
                  ))}
                  <span className="block mt-2 font-medium">Consider updating these trades before starting.</span>
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

      {/* Player Card Modal */}
      {(() => {
        const cardPlayer = cardPlayerId ? pool.find((p) => p.playerId === cardPlayerId) || null : null
        const cardPick = cardPlayerId ? picks.find((p) => p.playerId === cardPlayerId) : null
        const cardTeam = cardPick ? teams.find((t) => t.teamSlug === cardPick.teamSlug) : null
        return (
          <PlayerCardModal
            player={cardPlayer}
            open={playerCardOpen}
            onOpenChange={setPlayerCardOpen}
            seasonSlug={seasonSlug}
            teamName={cardTeam?.teamName}
            teamColor={cardTeam?.color}
            pickInfo={cardPick ? {
              round: cardPick.round,
              pickNumber: cardPick.pickNumber - (cardPick.round - 1) * teams.length,
              isKeeper: cardPick.isKeeper,
            } : null}
          />
        )
      })()}
    </div>
  )
}
