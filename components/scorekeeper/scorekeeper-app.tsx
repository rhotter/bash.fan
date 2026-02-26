"use client"

import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose,
} from "@/components/ui/drawer"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { Play, Pause, Plus, Minus, ChevronRight, X } from "lucide-react"
import Link from "next/link"
import type {
  LiveGameState, GoalEvent, PenaltyEvent, TimeoutEvent, RosterPlayer, ShootoutAttempt,
  ActivePenalty, PowerPlayState,
} from "@/lib/scorekeeper-types"
import {
  createInitialState, periodLabel, formatClock, computeCurrentClock,
  computeScore, shotPeriodIndex, getActivePenalties, getPowerPlayState,
  findPenaltyToEnd, clockToElapsed, parseClockString,
} from "@/lib/scorekeeper-types"
import {
  saveToLocalStorage, loadFromLocalStorage, clearLocalStorage,
  createSyncManager, type SyncStatus,
} from "@/lib/scorekeeper-sync"

const INFRACTIONS = [
  "Holding", "Hooking", "Tripping", "Slashing", "Interference",
  "High-Sticking", "Roughing", "Cross-Checking", "Boarding",
  "Delay of Game", "Too Many Players", "Unsportsmanlike", "Fighting",
]

function fullPeriodLabel(period: number): string {
  if (period === 0) return "Pre-Game"
  if (period <= 3) return `Period ${period}`
  if (period === 4) return "Overtime"
  if (period === 5) return "Shootout"
  return `Period ${period}`
}

interface Props {
  gameId: string
  date: string
  time: string
  status: string
  homeSlug: string
  awaySlug: string
  homeTeam: string
  awayTeam: string
  homeRoster: RosterPlayer[]
  awayRoster: RosterPlayer[]
  existingState: LiveGameState | null
}

export function ScorekeeperApp({
  gameId, date, time, status,
  homeSlug, awaySlug, homeTeam, awayTeam,
  homeRoster, awayRoster, existingState,
}: Props) {
  // ─── PIN Gate ────────────────────────────────────────────────────────────
  const [pin, setPin] = useState("")
  const [pinError, setPinError] = useState("")
  const [authenticated, setAuthenticated] = useState(false)
  const [starting, setStarting] = useState(false)

  // ─── Game State ──────────────────────────────────────────────────────────
  const [state, setState] = useState<LiveGameState>(() => {
    if (existingState) return existingState
    return createInitialState()
  })

  // ─── Sync ────────────────────────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("synced")
  const syncRef = useRef<ReturnType<typeof createSyncManager> | null>(null)

  // ─── Goalie Overrides ───────────────────────────────────────────────────
  const [goalieOverrides, setGoalieOverrides] = useState<Record<number, boolean>>({})

  const effectiveRoster = (roster: RosterPlayer[]) =>
    roster.map((p) => ({ ...p, isGoalie: goalieOverrides[p.id] ?? p.isGoalie }))

  // ─── UI State ────────────────────────────────────────────────────────────
  const [goalDrawerOpen, setGoalDrawerOpen] = useState(false)
  const [penaltyDrawerOpen, setPenaltyDrawerOpen] = useState(false)
  const [goalTeam, setGoalTeam] = useState<string>(homeSlug)
  const [penaltyTeam, setPenaltyTeam] = useState<string>(homeSlug)
  const [clockEditOpen, setClockEditOpen] = useState(false)
  const [clockEditMin, setClockEditMin] = useState("20")
  const [clockEditSec, setClockEditSec] = useState("00")
  const [periodEditOpen, setPeriodEditOpen] = useState(false)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [finalized, setFinalized] = useState(status === "final")
  const [pendingFinalize, setPendingFinalize] = useState(false)
  const [showAttendance, setShowAttendance] = useState(false)
  const [showShootout, setShowShootout] = useState(false)
  const [shootoutTeam, setShootoutTeam] = useState<string>(awaySlug)
  const [showThreeStars, setShowThreeStars] = useState(false)

  // Goal form state
  const [goalScorer, setGoalScorer] = useState<string>("")
  const [goalAssist1, setGoalAssist1] = useState<string>("")
  const [goalAssist2, setGoalAssist2] = useState<string>("")
  const [goalPPG, setGoalPPG] = useState(false)
  const [goalSHG, setGoalSHG] = useState(false)
  const [goalENG, setGoalENG] = useState(false)
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null)

  // Penalty form state
  const [penPlayer, setPenPlayer] = useState<string>("")
  const [penInfraction, setPenInfraction] = useState<string>("")
  const [penMinutes, setPenMinutes] = useState<string>("2")
  const [editingPenaltyId, setEditingPenaltyId] = useState<string | null>(null)

  // Undo confirmation
  const [confirmUndo, setConfirmUndo] = useState<{ id: string; type: "goal" | "penalty" } | null>(null)

  // Timeout countdown
  const [activeTimeout, setActiveTimeout] = useState<{ team: string; startedAt: number } | null>(null)
  const [timeoutRemaining, setTimeoutRemaining] = useState(0)

  useEffect(() => {
    if (!activeTimeout) { setTimeoutRemaining(0); return }
    const tick = () => {
      const elapsed = (Date.now() - activeTimeout.startedAt) / 1000
      const rem = Math.max(0, 60 - elapsed)
      setTimeoutRemaining(rem)
      if (rem <= 0) setActiveTimeout(null)
    }
    tick()
    const id = setInterval(tick, 200)
    return () => clearInterval(id)
  }, [activeTimeout])

  // ─── Clock tick ──────────────────────────────────────────────────────────
  const [displayClock, setDisplayClock] = useState(state.clockSeconds)

  useEffect(() => {
    if (!state.clockRunning) {
      setDisplayClock(state.clockSeconds)
      return
    }
    const tick = () => setDisplayClock(computeCurrentClock(state))
    tick()
    const id = setInterval(tick, 200)
    return () => clearInterval(id)
  }, [state.clockRunning, state.clockStartedAt, state.clockSeconds])

  // ─── Scores ──────────────────────────────────────────────────────────────
  const scores = useMemo(() => computeScore(state.goals, homeSlug, awaySlug), [state.goals, homeSlug, awaySlug])

  // ─── Power Play State ──────────────────────────────────────────────────
  const activePenalties = useMemo(
    () => getActivePenalties(state.penalties, state.period, displayClock),
    [state.penalties, state.period, displayClock]
  )
  const ppState = useMemo(
    () => getPowerPlayState(state.penalties, state.period, displayClock, homeSlug, awaySlug),
    [state.penalties, state.period, displayClock, homeSlug, awaySlug]
  )

  // ─── Load from localStorage on mount ─────────────────────────────────────
  useEffect(() => {
    const saved = loadFromLocalStorage(gameId)
    if (saved && saved.updatedAt > state.updatedAt) {
      setState(saved)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  // ─── Save to localStorage on change ──────────────────────────────────────
  useEffect(() => {
    if (authenticated && !finalized) {
      saveToLocalStorage(gameId, state)
      syncRef.current?.scheduleSync(state)
    }
  }, [state, authenticated, finalized, gameId])

  // ─── Page unload beacon ──────────────────────────────────────────────────
  useEffect(() => {
    if (!authenticated) return
    const handler = () => syncRef.current?.sendBeacon(state)
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [state, authenticated])

  // ─── Sync manager lifecycle ──────────────────────────────────────────────
  useEffect(() => {
    if (!authenticated) return
    const mgr = createSyncManager(gameId, pin)
    mgr.setStatusListener(setSyncStatus)
    syncRef.current = mgr
    return () => mgr.destroy()
  }, [authenticated, gameId, pin])

  // ─── Check for pending finalize on mount ───────────────────────────────
  useEffect(() => {
    try {
      if (localStorage.getItem(`bash-finalize-${gameId}`)) {
        setPendingFinalize(true)
      }
    } catch {}
  }, [gameId])

  // ─── Auto-finalize when back online ────────────────────────────────────
  useEffect(() => {
    if (!pendingFinalize || !authenticated || finalized) return

    let cancelled = false

    async function tryFinalize() {
      // Give sync manager time to send latest state
      await new Promise(r => setTimeout(r, 2000))
      if (cancelled) return
      try {
        await syncRef.current?.flush()
        const res = await fetch(`/api/bash/scorekeeper/${gameId}/finalize`, {
          method: "POST",
          headers: { "x-pin": pin },
        })
        if (res.ok && !cancelled) {
          setFinalized(true)
          clearLocalStorage(gameId)
          setPendingFinalize(false)
          localStorage.removeItem(`bash-finalize-${gameId}`)
        }
      } catch {
        // Still offline
      }
    }

    tryFinalize()

    const handler = () => tryFinalize()
    window.addEventListener("online", handler)
    return () => {
      cancelled = true
      window.removeEventListener("online", handler)
    }
  }, [pendingFinalize, authenticated, finalized, gameId, pin])

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const updateState = useCallback((updater: (prev: LiveGameState) => LiveGameState) => {
    setState((prev) => {
      const next = updater(prev)
      next.updatedAt = Date.now()
      return next
    })
  }, [])

  const currentClockString = (): string => {
    const secs = computeCurrentClock(state)
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${s.toString().padStart(2, "0")}`
  }

  const rosterForTeam = (team: string) => effectiveRoster(team === homeSlug ? homeRoster : awayRoster)
  const attendanceForTeam = (team: string) => team === homeSlug ? state.homeAttendance : state.awayAttendance
  const attendingPlayers = (team: string) => {
    const ids = attendanceForTeam(team)
    return rosterForTeam(team).filter((p) => ids.includes(p.id))
  }
  const attendingSkaters = (team: string) => attendingPlayers(team).filter((p) => !p.isGoalie)

  // ─── PIN Auth ────────────────────────────────────────────────────────────
  async function handlePinSubmit() {
    setPinError("")
    setStarting(true)
    try {
      if (status !== "live" && status !== "final") {
        const res = await fetch(`/api/bash/scorekeeper/${gameId}/start`, {
          method: "POST",
          headers: { "x-pin": pin },
        })
        if (!res.ok) {
          const data = await res.json()
          setPinError(data.error || "Invalid PIN")
          setStarting(false)
          return
        }
      } else {
        const res = await fetch(`/api/bash/scorekeeper/${gameId}/state`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-pin": pin },
          body: JSON.stringify(state),
        })
        if (!res.ok) {
          setPinError("Invalid PIN")
          setStarting(false)
          return
        }
      }
      setAuthenticated(true)
    } catch {
      setPinError("Network error — try again")
    }
    setStarting(false)
  }

  // ─── Clock Controls ─────────────────────────────────────────────────────
  function toggleClock() {
    updateState((prev) => {
      if (prev.clockRunning) {
        const remaining = computeCurrentClock(prev)
        return { ...prev, clockRunning: false, clockSeconds: Math.max(0, remaining), clockStartedAt: null }
      } else {
        return { ...prev, clockRunning: true, clockStartedAt: Date.now() }
      }
    })
  }

  function openClockEdit() {
    const secs = computeCurrentClock(state)
    setClockEditMin(Math.floor(secs / 60).toString())
    setClockEditSec(Math.floor(secs % 60).toString().padStart(2, "0"))
    setClockEditOpen(true)
  }

  function saveClockEdit() {
    const m = parseInt(clockEditMin) || 0
    const s = parseInt(clockEditSec) || 0
    updateState((prev) => ({
      ...prev,
      clockSeconds: m * 60 + s,
      clockRunning: false,
      clockStartedAt: null,
    }))
    setClockEditOpen(false)
  }

  function endPeriod() {
    updateState((prev) => ({
      ...prev,
      clockRunning: false,
      clockSeconds: 0,
      clockStartedAt: null,
    }))
  }

  function startNextPeriod() {
    updateState((prev) => {
      const nextPeriod = prev.period + 1
      const clockSecs = nextPeriod === 4 ? 300 : 1200
      const homeShots = [...prev.homeShots]
      const awayShots = [...prev.awayShots]
      while (homeShots.length < (nextPeriod <= 3 ? nextPeriod : 4)) homeShots.push(0)
      while (awayShots.length < (nextPeriod <= 3 ? nextPeriod : 4)) awayShots.push(0)
      const homeAttendance = prev.homeAttendance.length > 0 ? prev.homeAttendance : homeRoster.map((p) => p.id)
      const awayAttendance = prev.awayAttendance.length > 0 ? prev.awayAttendance : awayRoster.map((p) => p.id)
      return {
        ...prev,
        period: nextPeriod,
        clockSeconds: clockSecs,
        clockRunning: false,
        clockStartedAt: null,
        homeShots,
        awayShots,
        homeAttendance,
        awayAttendance,
      }
    })
  }

  function setPeriodTo(p: number) {
    updateState((prev) => {
      const clockSecs = p === 0 ? 1200 : p === 4 ? 300 : 1200
      const homeShots = [...prev.homeShots]
      const awayShots = [...prev.awayShots]
      while (homeShots.length < (p <= 3 ? p : 4)) homeShots.push(0)
      while (awayShots.length < (p <= 3 ? p : 4)) awayShots.push(0)
      return {
        ...prev,
        period: p,
        clockSeconds: clockSecs,
        clockRunning: false,
        clockStartedAt: null,
        homeShots,
        awayShots,
        shootout: p === 5 ? (prev.shootout ?? { homeAttempts: [], awayAttempts: [] }) : prev.shootout,
      }
    })
    setPeriodEditOpen(false)
  }

  function adjustShots(team: "home" | "away", delta: number) {
    updateState((prev) => {
      const key = team === "home" ? "homeShots" : "awayShots"
      const shots = [...prev[key]]
      const idx = shotPeriodIndex(prev.period)
      if (idx < 0) return prev
      while (shots.length <= idx) shots.push(0)
      shots[idx] = Math.max(0, shots[idx] + delta)
      return { ...prev, [key]: shots }
    })
  }

  function useTimeout(team: "home" | "away") {
    const slug = team === "home" ? homeSlug : awaySlug
    updateState((prev) => {
      const remaining = computeCurrentClock(prev)
      const event: TimeoutEvent = {
        id: crypto.randomUUID(),
        team: slug,
        period: prev.period,
        clock: formatClock(remaining),
      }
      return {
        ...prev,
        timeouts: [...(prev.timeouts ?? []), event],
        clockRunning: false,
        clockSeconds: Math.max(0, remaining),
        clockStartedAt: null,
      }
    })
    setActiveTimeout({ team: slug, startedAt: Date.now() })
  }

  function toggleAttendance(team: string, playerId: number) {
    updateState((prev) => {
      const key = team === homeSlug ? "homeAttendance" : "awayAttendance"
      const list = [...prev[key]]
      const idx = list.indexOf(playerId)
      if (idx >= 0) list.splice(idx, 1)
      else list.push(playerId)
      return { ...prev, [key]: list }
    })
  }

  function selectAllAttendance(team: string) {
    const roster = rosterForTeam(team)
    updateState((prev) => {
      const key = team === homeSlug ? "homeAttendance" : "awayAttendance"
      return { ...prev, [key]: roster.map((p) => p.id) }
    })
  }

  function unselectAllAttendance(team: string) {
    updateState((prev) => {
      const key = team === homeSlug ? "homeAttendance" : "awayAttendance"
      return { ...prev, [key]: [] }
    })
  }

  function toggleGoalie(playerId: number) {
    setGoalieOverrides((prev) => {
      const isHome = homeRoster.some((p) => p.id === playerId)
      const teamRoster = isHome ? homeRoster : awayRoster
      const current = prev[playerId] ?? teamRoster.find((p) => p.id === playerId)?.isGoalie ?? false
      const next = { ...prev }
      // Clear goalie from all other players on the same team
      for (const p of teamRoster) {
        next[p.id] = false
      }
      // Toggle the selected player
      next[playerId] = !current
      return next
    })
  }

  function pauseClockNow() {
    const clock = currentClockString()
    updateState((prev) => {
      if (!prev.clockRunning) return prev
      const remaining = computeCurrentClock(prev)
      return { ...prev, clockRunning: false, clockSeconds: Math.max(0, remaining), clockStartedAt: null }
    })
    return clock
  }

  // ─── Goal Entry ─────────────────────────────────────────────────────────
  const [capturedClock, setCapturedClock] = useState("")

  function openGoalDrawer(team: string) {
    const clock = pauseClockNow()
    setCapturedClock(clock)
    setEditingGoalId(null)
    setGoalTeam(team)
    setGoalScorer("")
    setGoalAssist1("")
    setGoalAssist2("")
    // Pre-populate PPG/SHG based on current power play state
    const isPP = ppState.ppTeam === team
    const isPK = ppState.pkTeam === team
    setGoalPPG(isPP)
    setGoalSHG(isPK)
    setGoalENG(false)
    setGoalDrawerOpen(true)
  }

  function editGoal(goal: GoalEvent) {
    setEditingGoalId(goal.id)
    setCapturedClock(goal.clock)
    setGoalTeam(goal.team)
    setGoalScorer(goal.scorerId.toString())
    setGoalAssist1(goal.assist1Id ? goal.assist1Id.toString() : "")
    setGoalAssist2(goal.assist2Id ? goal.assist2Id.toString() : "")
    setGoalPPG(goal.flags.includes("PPG"))
    setGoalSHG(goal.flags.includes("SHG"))
    setGoalENG(goal.flags.includes("ENG"))
    setGoalDrawerOpen(true)
  }

  function submitGoal() {
    if (!goalScorer) return
    const clock = capturedClock
    const flags: string[] = []
    if (goalPPG) flags.push("PPG")
    if (goalSHG) flags.push("SHG")
    if (goalENG) flags.push("ENG")

    if (editingGoalId) {
      updateState((prev) => ({
        ...prev,
        goals: prev.goals.map((g) =>
          g.id === editingGoalId
            ? { ...g, team: goalTeam, clock, scorerId: parseInt(goalScorer), assist1Id: goalAssist1 && goalAssist1 !== "none" ? parseInt(goalAssist1) : null, assist2Id: goalAssist2 && goalAssist2 !== "none" ? parseInt(goalAssist2) : null, flags }
            : g
        ),
      }))
    } else {
      const goalId = crypto.randomUUID()
      const goal: GoalEvent = {
        id: goalId,
        team: goalTeam,
        period: state.period,
        clock,
        scorerId: parseInt(goalScorer),
        assist1Id: goalAssist1 && goalAssist1 !== "none" ? parseInt(goalAssist1) : null,
        assist2Id: goalAssist2 && goalAssist2 !== "none" ? parseInt(goalAssist2) : null,
        flags,
      }
      updateState((prev) => {
        const next = { ...prev, goals: [...prev.goals, goal] }

        // End penalty on PP goal
        if (goalPPG) {
          const clockSecs = parseClockString(clock)
          const result = findPenaltyToEnd(prev.penalties, goalTeam, state.period, clockSecs)
          if (result) {
            const currentElapsed = clockToElapsed(state.period, clockSecs)
            next.penalties = prev.penalties.map((p) => {
              if (p.id !== result.penaltyId) return p
              if (result.action === "end") {
                return { ...p, endedByGoalId: goalId }
              } else {
                // "halve" — double minor: set expiration to 2 min from now
                return { ...p, adjustedEndElapsed: currentElapsed + 120 }
              }
            })
          }
        }

        return next
      })
    }
    setGoalDrawerOpen(false)
  }

  function openPenaltyDrawer(team: string) {
    const clock = pauseClockNow()
    setCapturedClock(clock)
    setEditingPenaltyId(null)
    setPenaltyTeam(team)
    setPenPlayer("")
    setPenInfraction("")
    setPenMinutes("2")
    setPenaltyDrawerOpen(true)
  }

  function editPenalty(penalty: PenaltyEvent) {
    setEditingPenaltyId(penalty.id)
    setCapturedClock(penalty.clock)
    setPenaltyTeam(penalty.team)
    setPenPlayer(penalty.playerId.toString())
    setPenInfraction(penalty.infraction)
    setPenMinutes(penalty.minutes.toString())
    setPenaltyDrawerOpen(true)
  }

  function submitPenalty() {
    if (!penPlayer || !penInfraction) return
    const clock = capturedClock

    if (editingPenaltyId) {
      updateState((prev) => ({
        ...prev,
        penalties: prev.penalties.map((p) =>
          p.id === editingPenaltyId
            ? { ...p, team: penaltyTeam, clock, playerId: parseInt(penPlayer), infraction: penInfraction, minutes: parseInt(penMinutes) }
            : p
        ),
      }))
    } else {
      const penalty: PenaltyEvent = {
        id: crypto.randomUUID(),
        team: penaltyTeam,
        period: state.period,
        clock,
        playerId: parseInt(penPlayer),
        infraction: penInfraction,
        minutes: parseInt(penMinutes),
      }
      updateState((prev) => ({
        ...prev,
        penalties: [...prev.penalties, penalty],
      }))
    }
    setPenaltyDrawerOpen(false)
  }

  function undoGoal(goalId: string) {
    updateState((prev) => ({
      ...prev,
      goals: prev.goals.filter((g) => g.id !== goalId),
    }))
  }

  function undoPenalty(penaltyId: string) {
    updateState((prev) => ({
      ...prev,
      penalties: prev.penalties.filter((p) => p.id !== penaltyId),
    }))
  }

  function startShootout() {
    updateState((prev) => ({
      ...prev,
      period: 5,
      clockRunning: false,
      clockSeconds: 0,
      clockStartedAt: null,
      shootout: { homeAttempts: [], awayAttempts: [] },
    }))
    setShowShootout(true)
  }

  function addShootoutAttempt(team: string, playerId: number, scored: boolean) {
    updateState((prev) => {
      if (!prev.shootout) return prev
      const key = team === homeSlug ? "homeAttempts" : "awayAttempts"
      const attempts = [...prev.shootout[key], { playerId, scored }]
      return { ...prev, shootout: { ...prev.shootout, [key]: attempts } }
    })
  }

  function undoLastShootoutAttempt(team: string) {
    updateState((prev) => {
      if (!prev.shootout) return prev
      const key = team === homeSlug ? "homeAttempts" : "awayAttempts"
      const attempts = [...prev.shootout[key]]
      attempts.pop()
      return { ...prev, shootout: { ...prev.shootout, [key]: attempts } }
    })
  }

  function setThreeStar(position: number, playerId: number) {
    updateState((prev) => {
      const stars = prev.threeStars ? [...prev.threeStars] : [0, 0, 0]
      stars[position] = playerId
      return { ...prev, threeStars: stars }
    })
  }

  function setOfficial(key: "ref1" | "ref2" | "scorekeeper", value: string) {
    updateState((prev) => ({
      ...prev,
      officials: { ...prev.officials, [key]: value },
    }))
  }

  async function handleFinalize() {
    setFinalizing(true)
    try {
      syncRef.current?.scheduleSync(state)
      await syncRef.current?.flush()

      const res = await fetch(`/api/bash/scorekeeper/${gameId}/finalize`, {
        method: "POST",
        headers: { "x-pin": pin },
      })
      if (res.ok) {
        setFinalized(true)
        clearLocalStorage(gameId)
        setFinalizeOpen(false)
        setPendingFinalize(false)
        localStorage.removeItem(`bash-finalize-${gameId}`)
      }
    } catch {
      // Network error — mark for auto-retry when back online
      setPendingFinalize(true)
      localStorage.setItem(`bash-finalize-${gameId}`, "1")
      setFinalizeOpen(false)
    }
    setFinalizing(false)
  }

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════

  const syncDotColor =
    syncStatus === "synced" ? "bg-foreground/30" :
    syncStatus === "syncing" ? "bg-foreground/30 animate-pulse" :
    syncStatus === "pending" ? "bg-foreground/20" :
    "bg-red-500"

  // PIN Screen
  if (!authenticated) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center bg-background px-4">
        <div className="w-full max-w-xs space-y-8">
          <div className="text-center space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">Scorekeeper</p>
            <h1 className="text-lg font-bold">
              {awayTeam} <span className="text-muted-foreground/30 font-normal">@</span> {homeTeam}
            </h1>
            <p className="text-[11px] text-muted-foreground/60">{date} &middot; {time}</p>
          </div>
          <div className="space-y-3">
            <input
              type="password"
              inputMode="numeric"
              placeholder="Enter PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePinSubmit()}
              className="w-full rounded-md border border-border/60 bg-card px-4 py-3 text-center text-lg font-mono tracking-[0.5em] outline-none focus:border-foreground/40"
              autoFocus
            />
            {pinError && <p className="text-xs text-muted-foreground text-center">{pinError}</p>}
            <Button className="w-full bg-foreground text-background hover:bg-foreground/90" onClick={handlePinSubmit} disabled={!pin || starting}>
              {starting ? "..." : "Enter"}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Finalized screen
  if (finalized) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center bg-background px-4">
        <div className="text-center space-y-4">
          <div className={cn(
            "text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full inline-block",
            "bg-secondary text-secondary-foreground"
          )}>
            Final
          </div>
          <div className="flex items-baseline justify-center gap-3">
            <div className="text-center">
              <div className="text-sm font-bold mb-1">{awayTeam}</div>
              <div className="text-5xl font-black font-mono tabular-nums tracking-tighter">{scores.away}</div>
            </div>
            <span className="text-2xl text-muted-foreground/40 font-light select-none">&ndash;</span>
            <div className="text-center">
              <div className="text-sm font-bold mb-1">{homeTeam}</div>
              <div className="text-5xl font-black font-mono tabular-nums tracking-tighter">{scores.home}</div>
            </div>
          </div>
          <Link href={`/game/${gameId}`} className="text-xs text-foreground hover:underline">
            View game page
          </Link>
        </div>
      </div>
    )
  }

  const allPlayers = [...homeRoster, ...awayRoster]
  const allAttending = [...state.homeAttendance, ...state.awayAttendance]
  const nameById = (id: number) => allPlayers.find((p) => p.id === id)?.name ?? `#${id}`

  const isPreGame = state.period === 0
  const isShootout = state.period === 5
  const totalHomeShots = state.homeShots.reduce((a, b) => a + b, 0)
  const totalAwayShots = state.awayShots.reduce((a, b) => a + b, 0)

  return (
    <div className="min-h-svh bg-background pb-24" style={{ "--accent": "var(--muted)", "--accent-foreground": "var(--foreground)" } as React.CSSProperties}>
      {/* ─── Top Bar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur">
        <div className="flex items-center justify-end px-4 py-2 max-w-2xl mx-auto">
          <div className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", syncDotColor)} />
            <span className={cn("text-[9px] capitalize", syncStatus === "offline" ? "text-red-500" : "text-muted-foreground")}>{syncStatus}</span>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* ─── Offline Finalize Banner ──────────────────────────────── */}
        {pendingFinalize && (
          <div className="pt-1 pb-2">
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/[0.04] px-4 py-3 text-center">
              <p className="text-xs">Game data is saved on this device.</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                It will automatically finalize when you&apos;re back online.
              </p>
            </div>
          </div>
        )}

        {/* ─── Scoreboard ──────────────────────────────────────────── */}
        <div className="pt-1 pb-3">
          <div className="relative rounded-2xl overflow-hidden bg-foreground text-background">
            <div className="relative px-6 py-5 sm:py-6">
              {/* Scores — hero */}
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                  <span className="text-sm font-bold leading-tight text-center text-background/70">{awayTeam}</span>
                  {ppState.ppTeam === awaySlug && (
                    <span className="text-[9px] font-bold uppercase tracking-widest text-background/50">PP</span>
                  )}
                </div>
                <div className="flex items-baseline gap-3 px-4">
                  <span className="text-5xl sm:text-6xl font-black font-mono tabular-nums tracking-tighter text-background">{scores.away}</span>
                  <span className="text-2xl text-background/25 font-light select-none">&ndash;</span>
                  <span className="text-5xl sm:text-6xl font-black font-mono tabular-nums tracking-tighter text-background">{scores.home}</span>
                </div>
                <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                  <span className="text-sm font-bold leading-tight text-center text-background/70">{homeTeam}</span>
                  {ppState.ppTeam === homeSlug && (
                    <span className="text-[9px] font-bold uppercase tracking-widest text-background/50">PP</span>
                  )}
                </div>
              </div>

              {/* Clock + Period + Play/Pause */}
              {!isPreGame && !isShootout && (
                <div className="flex items-center justify-center gap-3">
                  <button onClick={() => setPeriodEditOpen(true)}>
                    <span className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-background/15 text-background">
                      {periodLabel(state.period)}
                    </span>
                  </button>
                  <button
                    onClick={openClockEdit}
                    className="text-3xl font-black font-mono tabular-nums tracking-tighter text-background/60"
                  >
                    {formatClock(displayClock)}
                  </button>
                  <button
                    onClick={toggleClock}
                    className={cn(
                      "size-12 rounded-full flex items-center justify-center transition-all active:scale-95",
                      state.clockRunning
                        ? "bg-background/10 text-background hover:bg-background/20"
                        : "bg-background text-foreground hover:bg-background/90 shadow-lg"
                    )}
                  >
                    {state.clockRunning ? <Pause className="size-5" /> : <Play className="size-5 ml-0.5" />}
                  </button>
                </div>
              )}
              {(isPreGame || isShootout) && (
                <div className="flex justify-center">
                  <button onClick={() => setPeriodEditOpen(true)}>
                    <span className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-background/15 text-background">
                      {periodLabel(state.period)}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>


        {/* ─── Active Timeout ──────────────────────────────────────── */}
        {activeTimeout && !isPreGame && !isShootout && (
          <div className="pb-2">
            <div className="flex items-center gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/[0.04] px-3 py-2">
              <span className="font-mono tabular-nums text-base font-black tracking-tight text-foreground w-12 shrink-0">
                {Math.floor(timeoutRemaining / 60)}:{Math.floor(timeoutRemaining % 60).toString().padStart(2, "0")}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium">Timeout</div>
                <div className="text-[10px] text-muted-foreground/60">{activeTimeout.team === homeSlug ? homeTeam : awayTeam}</div>
              </div>
              <Button size="icon-sm" variant="ghost" onClick={() => setActiveTimeout(null)} className="text-muted-foreground shrink-0">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ─── Active Penalties ────────────────────────────────────── */}
        {activePenalties.length > 0 && !isPreGame && !isShootout && (
          <div className="space-y-1.5 pb-2">
            {activePenalties.map((ap) => {
              const p = ap.penalty
              const isHome = p.team === homeSlug
              const teamName = isHome ? homeTeam : awayTeam
              const remaining = Math.max(0, Math.ceil(ap.remainingSeconds))
              const rm = Math.floor(remaining / 60)
              const rs = remaining % 60
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/[0.04] px-3 py-2"
                >
                  <span className="font-mono tabular-nums text-base font-black tracking-tight text-foreground w-12 shrink-0">
                    {rm}:{rs.toString().padStart(2, "0")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium truncate">{nameById(p.playerId)}</div>
                    <div className="text-[10px] text-muted-foreground/60 truncate">{p.infraction} &middot; {p.minutes}min &middot; {teamName}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ─── Pre-Game: Attendance ────────────────────────────────── */}
        {isPreGame && (
          <div className="space-y-4 pt-2">
            <div className="space-y-4">
              <SectionHeader>Attendance</SectionHeader>
              <AttendanceList
                label={awayTeam}
                count={state.awayAttendance.length}
                team={awaySlug}
                roster={effectiveRoster(awayRoster)}
                attendance={state.awayAttendance}
                onToggle={toggleAttendance}
                onSelectAll={selectAllAttendance}
                onUnselectAll={unselectAllAttendance}
                onToggleGoalie={toggleGoalie}
              />
              <AttendanceList
                label={homeTeam}
                count={state.homeAttendance.length}
                team={homeSlug}
                roster={effectiveRoster(homeRoster)}
                attendance={state.homeAttendance}
                onToggle={toggleAttendance}
                onSelectAll={selectAllAttendance}
                onUnselectAll={unselectAllAttendance}
                onToggleGoalie={toggleGoalie}
              />
            </div>

            {/* Officials */}
            <div className="space-y-2">
              <SectionHeader>Officials</SectionHeader>
              <div className="grid grid-cols-1 gap-2">
                <input
                  className="rounded-md border border-border/60 bg-card px-3 py-2 text-xs outline-none focus:border-foreground/40"
                  placeholder="Referee 1"
                  value={state.officials.ref1}
                  onChange={(e) => setOfficial("ref1", e.target.value)}
                />
                <input
                  className="rounded-md border border-border/60 bg-card px-3 py-2 text-xs outline-none focus:border-foreground/40"
                  placeholder="Referee 2"
                  value={state.officials.ref2}
                  onChange={(e) => setOfficial("ref2", e.target.value)}
                />
                <input
                  className="rounded-md border border-border/60 bg-card px-3 py-2 text-xs outline-none focus:border-foreground/40"
                  placeholder="Scorekeeper"
                  value={state.officials.scorekeeper}
                  onChange={(e) => setOfficial("scorekeeper", e.target.value)}
                />
              </div>
            </div>

            <Button className="w-full bg-foreground text-background hover:bg-foreground/90" onClick={() => startNextPeriod()}>
              Start Period 1
            </Button>
          </div>
        )}

        {/* ─── In-Game Controls ────────────────────────────────────── */}
        {!isPreGame && !isShootout && (
          <div className="space-y-4 pt-2">
            {/* Team columns — away on left, home on right */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <SectionHeader>{awayTeam}</SectionHeader>
                <Button variant="outline" className="w-full h-11 text-xs" onClick={() => openGoalDrawer(awaySlug)}>
                  Goal
                </Button>
                <Button variant="outline" className="w-full h-9 text-xs text-muted-foreground" onClick={() => openPenaltyDrawer(awaySlug)}>
                  Penalty
                </Button>
                <TimeoutButton
                  used={(state.timeouts ?? []).filter((t) => t.team === awaySlug).length}
                  max={state.period >= 4 ? 3 : 2}
                  onUse={() => useTimeout("away")}
                />
                <ShotCounter
                  label="SOG"
                  count={state.awayShots[shotPeriodIndex(state.period)] ?? 0}
                  onPlus={() => adjustShots("away", 1)}
                  onMinus={() => adjustShots("away", -1)}
                />
              </div>
              <div className="space-y-2">
                <SectionHeader>{homeTeam}</SectionHeader>
                <Button variant="outline" className="w-full h-11 text-xs" onClick={() => openGoalDrawer(homeSlug)}>
                  Goal
                </Button>
                <Button variant="outline" className="w-full h-9 text-xs text-muted-foreground" onClick={() => openPenaltyDrawer(homeSlug)}>
                  Penalty
                </Button>
                <TimeoutButton
                  used={(state.timeouts ?? []).filter((t) => t.team === homeSlug).length}
                  max={state.period >= 4 ? 3 : 2}
                  onUse={() => useTimeout("home")}
                />
                <ShotCounter
                  label="SOG"
                  count={state.homeShots[shotPeriodIndex(state.period)] ?? 0}
                  onPlus={() => adjustShots("home", 1)}
                  onMinus={() => adjustShots("home", -1)}
                />
              </div>
            </div>

            {/* Period Controls — moved to sticky bottom bar */}
          </div>
        )}

        {/* ─── Shootout UI ─────────────────────────────────────────── */}
        {isShootout && state.shootout && (
          <div className="space-y-3 pt-2">
            <ShootoutPanel
              homeSlug={homeSlug}
              awaySlug={awaySlug}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              shootout={state.shootout}
              homeRoster={attendingSkaters(homeSlug)}
              awayRoster={attendingSkaters(awaySlug)}
              onAttempt={addShootoutAttempt}
              onUndo={undoLastShootoutAttempt}
            />
            {(() => {
              const hg = state.shootout.homeAttempts.filter((a) => a.scored).length
              const ag = state.shootout.awayAttempts.filter((a) => a.scored).length
              const minRounds = Math.min(state.shootout.homeAttempts.length, state.shootout.awayAttempts.length)
              const isDecided = minRounds >= 5
                ? (state.shootout.homeAttempts.length === state.shootout.awayAttempts.length && hg !== ag)
                : false
              const canFinalize = isDecided || (minRounds >= 3 && state.shootout.homeAttempts.length === state.shootout.awayAttempts.length && hg !== ag)
              if (!canFinalize) return null
              return (
                <Button className="w-full bg-foreground text-background hover:bg-foreground/90" onClick={() => setShowThreeStars(true)}>
                  Three Stars & Finalize
                </Button>
              )
            })()}
          </div>
        )}

        {/* ─── Period Summary (goals + shots by period) ───────────── */}
        {!isPreGame && (
          <div className="mt-5">
            <SectionHeader>Stats by Period</SectionHeader>
            <PeriodSummary
              state={state}
              homeSlug={homeSlug}
              awaySlug={awaySlug}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
            />
          </div>
        )}

        {/* ─── Event Log ───────────────────────────────────────────── */}
        {!isPreGame && (
          <div className="mt-5">
            <SectionHeader>Events</SectionHeader>
            {state.goals.length === 0 && state.penalties.length === 0 && (state.timeouts ?? []).length === 0 && (
              <p className="text-[11px] text-muted-foreground/40 text-center py-6">No events yet</p>
            )}
            <div className="space-y-0">
              {[
                ...state.goals.map((g) => ({ type: "goal" as const, event: g, period: g.period, clock: g.clock })),
                ...state.penalties.map((p) => ({ type: "penalty" as const, event: p, period: p.period, clock: p.clock })),
                ...(state.timeouts ?? []).map((t) => ({ type: "timeout" as const, event: t, period: t.period, clock: t.clock })),
              ]
                .sort((a, b) => a.period - b.period || b.clock.localeCompare(a.clock))
                .map((item) => {
                  if (item.type === "goal") {
                    const g = item.event as GoalEvent
                    const teamName = g.team === homeSlug ? homeTeam : awayTeam
                    return (
                      <div key={g.id} className="flex items-center gap-2 py-2 border-t border-border/20 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => editGoal(g)}>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-foreground w-8 shrink-0">GOAL</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] font-medium">{nameById(g.scorerId)}</span>
                          {g.assist1Id && <span className="text-[11px] text-muted-foreground"> ({nameById(g.assist1Id)}{g.assist2Id ? `, ${nameById(g.assist2Id)}` : ""})</span>}
                          {g.flags.length > 0 && (
                            <span className="text-[9px] text-muted-foreground/60 ml-1">{g.flags.join(", ")}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground/50 shrink-0">{teamName}</span>
                        <span className="text-[10px] text-muted-foreground/40 tabular-nums font-mono shrink-0">{periodLabel(g.period)} {g.clock}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmUndo({ id: g.id, type: "goal" }) }}
                          className="shrink-0 p-1 rounded text-muted-foreground/30 hover:text-foreground transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  } else if (item.type === "penalty") {
                    const p = item.event as PenaltyEvent
                    const teamName = p.team === homeSlug ? homeTeam : awayTeam
                    return (
                      <div key={p.id} className="flex items-center gap-2 py-2 border-t border-border/20 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => editPenalty(p)}>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-red-400/60 w-8 shrink-0">PEN</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] font-medium text-muted-foreground">{nameById(p.playerId)}</span>
                          <span className="text-[10px] text-muted-foreground/50"> &middot; {p.infraction} &middot; {p.minutes}min</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground/50 shrink-0">{teamName}</span>
                        <span className="text-[10px] text-muted-foreground/40 tabular-nums font-mono shrink-0">{periodLabel(p.period)} {p.clock}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmUndo({ id: p.id, type: "penalty" }) }}
                          className="shrink-0 p-1 rounded text-muted-foreground/30 hover:text-foreground transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  } else {
                    const t = item.event as TimeoutEvent
                    const teamName = t.team === homeSlug ? homeTeam : awayTeam
                    return (
                      <div key={t.id} className="flex items-center gap-2 py-2 border-t border-border/20">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-yellow-500/60 w-8 shrink-0">T/O</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] font-medium text-muted-foreground">{teamName}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground/40 tabular-nums font-mono shrink-0">{periodLabel(t.period)} {t.clock}</span>
                        <button
                          onClick={() => updateState((prev) => ({ ...prev, timeouts: (prev.timeouts ?? []).filter((x) => x.id !== t.id) }))}
                          className="shrink-0 p-1 rounded text-muted-foreground/30 hover:text-foreground transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  }
                })}
            </div>
          </div>
        )}

        {/* ─── Attendance (in-game) ────────────────────────────────── */}
        {!isPreGame && (
          <div className="mt-5">
            <SectionHeader>Attendance</SectionHeader>
            <div className="space-y-3">
              <AttendanceList label={awayTeam} count={state.awayAttendance.length} team={awaySlug} roster={effectiveRoster(awayRoster)} attendance={state.awayAttendance} onToggle={toggleAttendance} onSelectAll={selectAllAttendance} onUnselectAll={unselectAllAttendance} onToggleGoalie={toggleGoalie} />
              <AttendanceList label={homeTeam} count={state.homeAttendance.length} team={homeSlug} roster={effectiveRoster(homeRoster)} attendance={state.homeAttendance} onToggle={toggleAttendance} onSelectAll={selectAllAttendance} onUnselectAll={unselectAllAttendance} onToggleGoalie={toggleGoalie} />
            </div>
          </div>
        )}

        {/* ─── Officials (in-game) ────────────────────────────────── */}
        {!isPreGame && (
          <div className="mt-5">
            <SectionHeader>Officials</SectionHeader>
            <div className="grid grid-cols-1 gap-2">
              <input
                className="rounded-md border border-border/60 bg-card px-3 py-2 text-xs outline-none focus:border-foreground/40"
                placeholder="Referee 1"
                value={state.officials.ref1}
                onChange={(e) => setOfficial("ref1", e.target.value)}
              />
              <input
                className="rounded-md border border-border/60 bg-card px-3 py-2 text-xs outline-none focus:border-foreground/40"
                placeholder="Referee 2"
                value={state.officials.ref2}
                onChange={(e) => setOfficial("ref2", e.target.value)}
              />
              <input
                className="rounded-md border border-border/60 bg-card px-3 py-2 text-xs outline-none focus:border-foreground/40"
                placeholder="Scorekeeper"
                value={state.officials.scorekeeper}
                onChange={(e) => setOfficial("scorekeeper", e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ─── Notes ─────────────────────────────────────────────────── */}
        {!isPreGame && (
          <div className="mt-5 pb-16">
            <SectionHeader>Notes</SectionHeader>
            <textarea
              className="w-full rounded-md border border-border/60 bg-card px-3 py-2 text-xs outline-none focus:border-foreground/40 resize-y min-h-[80px]"
              placeholder="Game notes..."
              value={state.notes ?? ""}
              onChange={(e) => updateState((prev) => ({ ...prev, notes: e.target.value }))}
            />
          </div>
        )}
      </div>

      {/* ─── Bottom Sticky Bar (period controls + finalize) ──────── */}
      {!isPreGame && (
        <div className="fixed bottom-0 left-0 right-0 p-3 bg-background/95 backdrop-blur border-t border-border/60">
          <div className="max-w-2xl mx-auto flex items-center gap-2">
            {!isShootout && displayClock <= 0 && !state.clockRunning && state.period < 4 && (
              <Button className="flex-1 bg-foreground text-background hover:bg-foreground/90" onClick={startNextPeriod}>
                Start {fullPeriodLabel(state.period + 1)}
              </Button>
            )}
            {!isShootout && displayClock <= 0 && !state.clockRunning && state.period === 4 && scores.home === scores.away && (
              <Button className="flex-1 bg-foreground text-background hover:bg-foreground/90" onClick={startShootout}>
                Start Shootout
              </Button>
            )}
            {!isShootout && (displayClock > 0 || state.clockRunning) && (
              <Button variant="secondary" className="flex-1 text-xs" onClick={endPeriod}>
                End {fullPeriodLabel(state.period)}
              </Button>
            )}
            {!isShootout && state.period >= 3 && !state.clockRunning && displayClock <= 0 && scores.home !== scores.away && (
              <Button className="flex-1 bg-foreground text-background hover:bg-foreground/90" onClick={() => setShowThreeStars(true)}>
                Three Stars
              </Button>
            )}
            {!isShootout && state.period >= 3 && !state.clockRunning && displayClock <= 0 && scores.home !== scores.away && (
              <Button variant="outline" className="flex-1 text-xs" onClick={() => setFinalizeOpen(true)}>
                Finalize
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ─── Goal Drawer ─────────────────────────────────────────── */}
      <Drawer open={goalDrawerOpen} onOpenChange={setGoalDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {editingGoalId ? "Edit" : ""} {goalTeam === homeSlug ? homeTeam : awayTeam} Goal
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 space-y-4">
            <FieldLabel label="Time">
              <input
                type="text"
                inputMode="numeric"
                value={capturedClock}
                onChange={(e) => setCapturedClock(e.target.value)}
                className="mt-1 w-full rounded-md border border-border/60 bg-card px-3 py-2 text-sm font-mono tabular-nums outline-none focus:border-foreground/40"
              />
            </FieldLabel>
            <FieldLabel label="Scorer *">
              <Select value={goalScorer} onValueChange={setGoalScorer}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select player" /></SelectTrigger>
                <SelectContent>
                  {attendingSkaters(goalTeam).map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabel>
            <FieldLabel label="Primary Assist">
              <Select value={goalAssist1} onValueChange={setGoalAssist1}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {attendingSkaters(goalTeam).filter((p) => p.id.toString() !== goalScorer).map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabel>
            <FieldLabel label="Secondary Assist">
              <Select value={goalAssist2} onValueChange={setGoalAssist2}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {attendingSkaters(goalTeam).filter((p) => p.id.toString() !== goalScorer && p.id.toString() !== goalAssist1).map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabel>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={goalPPG} onCheckedChange={(v) => setGoalPPG(!!v)} className="data-[state=checked]:bg-foreground data-[state=checked]:border-foreground data-[state=checked]:text-background" />Power Play
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={goalSHG} onCheckedChange={(v) => setGoalSHG(!!v)} className="data-[state=checked]:bg-foreground data-[state=checked]:border-foreground data-[state=checked]:text-background" />Short Handed
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={goalENG} onCheckedChange={(v) => setGoalENG(!!v)} className="data-[state=checked]:bg-foreground data-[state=checked]:border-foreground data-[state=checked]:text-background" />Empty Net
              </label>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1 bg-foreground text-background hover:bg-foreground/90" onClick={submitGoal} disabled={!goalScorer}>
                {editingGoalId ? "Save" : "Add Goal"}
              </Button>
              <DrawerClose asChild>
                <Button variant="outline">Cancel</Button>
              </DrawerClose>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* ─── Penalty Drawer ──────────────────────────────────────── */}
      <Drawer open={penaltyDrawerOpen} onOpenChange={setPenaltyDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {editingPenaltyId ? "Edit" : ""} {penaltyTeam === homeSlug ? homeTeam : awayTeam} Penalty
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 space-y-4">
            <FieldLabel label="Time">
              <input
                type="text"
                inputMode="numeric"
                value={capturedClock}
                onChange={(e) => setCapturedClock(e.target.value)}
                className="mt-1 w-full rounded-md border border-border/60 bg-card px-3 py-2 text-sm font-mono tabular-nums outline-none focus:border-foreground/40"
              />
            </FieldLabel>
            <FieldLabel label="Player *">
              <Select value={penPlayer} onValueChange={setPenPlayer}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select player" /></SelectTrigger>
                <SelectContent>
                  {attendingPlayers(penaltyTeam).map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabel>
            <FieldLabel label="Infraction *">
              <Select value={penInfraction} onValueChange={setPenInfraction}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {INFRACTIONS.map((inf) => (
                    <SelectItem key={inf} value={inf}>{inf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabel>
            <FieldLabel label="Minutes">
              <Select value={penMinutes} onValueChange={setPenMinutes}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 min</SelectItem>
                  <SelectItem value="4">4 min (double minor)</SelectItem>
                  <SelectItem value="5">5 min (major)</SelectItem>
                  <SelectItem value="10">10 min (misconduct)</SelectItem>
                </SelectContent>
              </Select>
            </FieldLabel>
            <div className="flex gap-2">
              <Button className="flex-1 bg-foreground text-background hover:bg-foreground/90" onClick={submitPenalty} disabled={!penPlayer || !penInfraction}>
                {editingPenaltyId ? "Save" : "Add Penalty"}
              </Button>
              <DrawerClose asChild>
                <Button variant="outline">Cancel</Button>
              </DrawerClose>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* ─── Clock Edit Dialog ───────────────────────────────────── */}
      <Dialog open={clockEditOpen} onOpenChange={setClockEditOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Edit Clock</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center gap-2">
            <input
              type="number"
              min="0"
              max="20"
              value={clockEditMin}
              onChange={(e) => setClockEditMin(e.target.value)}
              className="w-16 rounded-md border bg-card px-3 py-2 text-center text-lg font-mono outline-none"
            />
            <span className="text-lg font-bold">:</span>
            <input
              type="number"
              min="0"
              max="59"
              value={clockEditSec}
              onChange={(e) => setClockEditSec(e.target.value)}
              className="w-16 rounded-md border bg-card px-3 py-2 text-center text-lg font-mono outline-none"
            />
          </div>
          <DialogFooter>
            <Button className="w-full bg-foreground text-background hover:bg-foreground/90" onClick={saveClockEdit}>Set Time</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Period Edit Dialog ──────────────────────────────────── */}
      <Dialog open={periodEditOpen} onOpenChange={setPeriodEditOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Change Period</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2">
            {[
              { value: 0, label: "Pre-Game" },
              { value: 1, label: "Period 1" },
              { value: 2, label: "Period 2" },
              { value: 3, label: "Period 3" },
              { value: 4, label: "Overtime" },
              { value: 5, label: "Shootout" },
            ].map((opt) => (
              <Button
                key={opt.value}
                variant="outline"
                className={cn("w-full", state.period === opt.value && "bg-foreground text-background hover:bg-foreground/90")}
                onClick={() => setPeriodTo(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Three Stars Dialog ──────────────────────────────────── */}
      <Dialog open={showThreeStars} onOpenChange={setShowThreeStars}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Three Stars</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {[0, 1, 2].map((pos) => (
              <FieldLabel key={pos} label={pos === 0 ? "1st Star" : pos === 1 ? "2nd Star" : "3rd Star"}>
                <Select
                  value={state.threeStars?.[pos]?.toString() ?? ""}
                  onValueChange={(v) => setThreeStar(pos, parseInt(v))}
                >
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select player" /></SelectTrigger>
                  <SelectContent>
                    {allAttending.map((pid) => (
                      <SelectItem key={pid} value={pid.toString()}>{nameById(pid)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldLabel>
            ))}
          </div>
          <DialogFooter>
            <Button className="w-full bg-foreground text-background hover:bg-foreground/90" onClick={() => { setShowThreeStars(false); setFinalizeOpen(true) }}>
              Continue to Finalize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Undo Confirmation ──────────────────────────────────── */}
      <Dialog open={!!confirmUndo} onOpenChange={(open) => { if (!open) setConfirmUndo(null) }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Remove {confirmUndo?.type === "goal" ? "goal" : "penalty"}?</DialogTitle>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setConfirmUndo(null)} className="flex-1">
              Cancel
            </Button>
            <Button
              className="flex-1 bg-foreground text-background hover:bg-foreground/90"
              onClick={() => {
                if (confirmUndo?.type === "goal") undoGoal(confirmUndo.id)
                else if (confirmUndo?.type === "penalty") undoPenalty(confirmUndo.id)
                setConfirmUndo(null)
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Finalize Confirmation ───────────────────────────────── */}
      <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Finalize Game?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>Final score: {awayTeam} {scores.away} — {homeTeam} {scores.home}</p>
            <p>{state.goals.length} goals, {state.penalties.length} penalties</p>
            <p className="text-muted-foreground/70 text-[10px]">This will write stats to the database and cannot be undone.</p>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setFinalizeOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button className="flex-1 bg-foreground text-background hover:bg-foreground/90" onClick={handleFinalize} disabled={finalizing}>
              {finalizing ? "..." : "Finalize"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground whitespace-nowrap">
        {children}
      </h4>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  )
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

function AttendanceList({
  label, count, team, roster, attendance, onToggle, onSelectAll, onUnselectAll, onToggleGoalie,
}: {
  label: string; count: number; team: string; roster: RosterPlayer[]; attendance: number[]
  onToggle: (team: string, id: number) => void; onSelectAll: (team: string) => void
  onUnselectAll: (team: string) => void; onToggleGoalie?: (id: number) => void
}) {
  const allSelected = roster.length > 0 && roster.every((p) => attendance.includes(p.id))
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label} <span className="text-muted-foreground/40 font-normal">{count}</span></h4>
        <button
          onClick={() => allSelected ? onUnselectAll(team) : onSelectAll(team)}
          className="text-[9px] text-foreground hover:underline"
        >
          {allSelected ? "Unselect all" : "Select all"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {roster.map((p) => (
          <label key={p.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted/50 cursor-pointer">
            <Checkbox
              checked={attendance.includes(p.id)}
              onCheckedChange={() => onToggle(team, p.id)}
              className="data-[state=checked]:bg-foreground data-[state=checked]:border-foreground data-[state=checked]:text-background"
            />
            <span className="text-[11px] truncate flex-1">
              {p.name}
            </span>
            {onToggleGoalie && (
              <button
                onClick={(e) => { e.preventDefault(); onToggleGoalie(p.id) }}
                className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded transition-colors shrink-0",
                  p.isGoalie ? "bg-foreground text-background font-bold" : "text-muted-foreground/30 hover:text-muted-foreground"
                )}
              >
                G
              </button>
            )}
          </label>
        ))}
      </div>
    </div>
  )
}

function ShotCounter({
  label, count, onPlus, onMinus,
}: {
  label: string; count: number; onPlus: () => void; onMinus: () => void
}) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
      <span className="text-[11px] text-muted-foreground truncate mr-2">{label}</span>
      <div className="flex items-center gap-1.5">
        <Button size="icon-sm" variant="ghost" onClick={onMinus}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="text-lg font-bold font-mono tabular-nums w-6 text-center">{count}</span>
        <Button size="icon-sm" variant="outline" onClick={onPlus}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function PeriodSummary({ state, homeSlug, awaySlug, homeTeam, awayTeam }: {
  state: LiveGameState; homeSlug: string; awaySlug: string; homeTeam: string; awayTeam: string
}) {
  const periods = Math.max(state.period, 3)
  const periodHeaders = Array.from({ length: Math.min(periods, 5) }, (_, i) => {
    const p = i + 1
    if (p <= 3) return `P${p}`
    if (p === 4) return "OT"
    return "SO"
  })

  const awayGoals = periodHeaders.map((_, i) =>
    state.goals.filter((g) => g.team === awaySlug && g.period === i + 1).length
  )
  const homeGoals = periodHeaders.map((_, i) =>
    state.goals.filter((g) => g.team === homeSlug && g.period === i + 1).length
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
            <th className="text-left font-medium py-1.5 pr-2"></th>
            {periodHeaders.map((h) => (
              <th key={h} className="text-center font-medium py-1.5 px-2 w-10">{h}</th>
            ))}
            <th className="text-center font-medium py-1.5 px-2 w-10">T</th>
          </tr>
        </thead>
        <tbody>
          {/* Goals */}
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium">Goals</td>
            <td colSpan={periodHeaders.length + 1}></td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-muted-foreground">{awayTeam}</td>
            {awayGoals.map((g, i) => (
              <td key={i} className="text-center tabular-nums font-mono py-1.5 px-2 text-muted-foreground">{g}</td>
            ))}
            <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">{awayGoals.reduce((a, b) => a + b, 0)}</td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-muted-foreground">{homeTeam}</td>
            {homeGoals.map((g, i) => (
              <td key={i} className="text-center tabular-nums font-mono py-1.5 px-2 text-muted-foreground">{g}</td>
            ))}
            <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">{homeGoals.reduce((a, b) => a + b, 0)}</td>
          </tr>
          {/* Shots */}
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium pt-3">Shots</td>
            <td colSpan={periodHeaders.length + 1}></td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-muted-foreground">{awayTeam}</td>
            {state.awayShots.slice(0, periodHeaders.length).map((s, i) => (
              <td key={i} className="text-center tabular-nums font-mono py-1.5 px-2 text-muted-foreground">{s}</td>
            ))}
            <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">{state.awayShots.reduce((a, b) => a + b, 0)}</td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-muted-foreground">{homeTeam}</td>
            {state.homeShots.slice(0, periodHeaders.length).map((s, i) => (
              <td key={i} className="text-center tabular-nums font-mono py-1.5 px-2 text-muted-foreground">{s}</td>
            ))}
            <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">{state.homeShots.reduce((a, b) => a + b, 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function TimeoutButton({
  used, max, onUse,
}: {
  used: number; max: number; onUse: () => void
}) {
  const remaining = max - used
  return (
    <Button variant="outline" className="w-full h-9 text-xs text-muted-foreground" onClick={onUse} disabled={remaining <= 0}>
      Timeout ({remaining} left)
    </Button>
  )
}

function ShootoutPanel({
  homeSlug, awaySlug, homeTeam, awayTeam,
  shootout, homeRoster, awayRoster,
  onAttempt, onUndo,
}: {
  homeSlug: string; awaySlug: string; homeTeam: string; awayTeam: string
  shootout: { homeAttempts: ShootoutAttempt[]; awayAttempts: ShootoutAttempt[] }
  homeRoster: RosterPlayer[]; awayRoster: RosterPlayer[]
  onAttempt: (team: string, playerId: number, scored: boolean) => void
  onUndo: (team: string) => void
}) {
  const [selectedShooter, setSelectedShooter] = useState<string>("")
  const awayTurn = shootout.awayAttempts.length <= shootout.homeAttempts.length
  const currentTeam = awayTurn ? awaySlug : homeSlug
  const currentTeamName = awayTurn ? awayTeam : homeTeam
  const currentRoster = awayTurn ? awayRoster : homeRoster

  const homeGoals = shootout.homeAttempts.filter((a) => a.scored).length
  const awayGoals = shootout.awayAttempts.filter((a) => a.scored).length

  return (
    <div className="space-y-3">
      <div className="text-center">
        <span className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-secondary text-secondary-foreground">
          Shootout
        </span>
        <div className="flex items-baseline justify-center gap-3 mt-3">
          <div className="text-center">
            <div className="text-[11px] text-muted-foreground mb-0.5">{awayTeam}</div>
            <div className="text-2xl font-black font-mono tabular-nums">{awayGoals}</div>
          </div>
          <span className="text-muted-foreground/30">&ndash;</span>
          <div className="text-center">
            <div className="text-[11px] text-muted-foreground mb-0.5">{homeTeam}</div>
            <div className="text-2xl font-black font-mono tabular-nums">{homeGoals}</div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <div className="text-[10px] font-bold text-muted-foreground mb-2">{currentTeamName} shoots</div>
        <Select value={selectedShooter} onValueChange={setSelectedShooter}>
          <SelectTrigger><SelectValue placeholder="Select shooter" /></SelectTrigger>
          <SelectContent>
            {currentRoster.map((p) => (
              <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2 mt-2">
          <Button
            className="flex-1"
            onClick={() => { if (selectedShooter) { onAttempt(currentTeam, parseInt(selectedShooter), true); setSelectedShooter("") } }}
            disabled={!selectedShooter}
          >
            Goal
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => { if (selectedShooter) { onAttempt(currentTeam, parseInt(selectedShooter), false); setSelectedShooter("") } }}
            disabled={!selectedShooter}
          >
            Miss
          </Button>
        </div>
      </div>

      {/* Shootout log */}
      <div className="space-y-0">
        {[...shootout.awayAttempts.map((a, i) => ({ ...a, team: awaySlug, teamName: awayTeam, round: i + 1 })),
          ...shootout.homeAttempts.map((a, i) => ({ ...a, team: homeSlug, teamName: homeTeam, round: i + 1 })),
        ]
          .sort((a, b) => a.round - b.round)
          .map((a, i) => {
            const roster = a.team === homeSlug ? homeRoster : awayRoster
            const name = roster.find((p) => p.id === a.playerId)?.name ?? `#${a.playerId}`
            return (
              <div key={i} className="flex items-center gap-2 text-[11px] py-1 border-t border-border/20">
                <span className={cn("text-[9px] font-bold uppercase tracking-wider w-8", a.scored ? "text-foreground" : "text-muted-foreground/30")}>
                  {a.scored ? "GOAL" : "MISS"}
                </span>
                <span className="text-muted-foreground">{a.teamName}</span>
                <span>{name}</span>
              </div>
            )
          })}
      </div>

      {/* Undo buttons */}
      <div className="flex gap-2">
        {shootout.awayAttempts.length > 0 && (
          <button className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors" onClick={() => onUndo(awaySlug)}>
            Undo {awayTeam}
          </button>
        )}
        {shootout.homeAttempts.length > 0 && (
          <button className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors" onClick={() => onUndo(homeSlug)}>
            Undo {homeTeam}
          </button>
        )}
      </div>
    </div>
  )
}
