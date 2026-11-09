"use client"

import { fetchApi as fetch, readApiJson, errorMessage } from "@/lib/api-errors"

import { Spinner } from "@/components/ui/spinner"
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { Plus, X, Search, Database, Info } from "lucide-react"
import { toHHMM } from "@/lib/format-time"
import { applyForfeitPreset, inferForfeitingSide, type ForfeitingSide } from "@/lib/forfeit-helpers"
import { AdminGameEditor } from "@/components/admin-editor/admin-game-editor"
import { useAdmin } from "@/lib/admin-context"
import type { LiveGameState, RosterPlayer } from "@/lib/scorekeeper-types"
import type { ShotAllocationGoalie } from "@/components/scorekeeper/shared/goalie-shot-allocation"

export interface GameFormData {
  id?: string
  date: string
  time: string
  homeTeam: string
  awayTeam: string
  location: string
  gameType: string
  status: string
  homeScore: number | null
  awayScore: number | null
  isOvertime: boolean
  hasShootout: boolean
  isForfeit: boolean
  hasBoxscore?: boolean
  hasLiveScorekeeperData?: boolean
  liveState?: LiveGameState | null
  homeRoster?: RosterPlayer[]
  awayRoster?: RosterPlayer[]
  playerNames?: Record<number, string>
  savedGoalies?: ShotAllocationGoalie[]
  title?: string | null
  notes: string | null
  homeNotes: string | null
  awayNotes: string | null
}

interface EditGameModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  game?: GameFormData | null
  teams: { teamSlug: string; teamName: string }[]
  seasonId: string
  defaultLocation: string
  onSaved: () => void
  onTeamCreated?: () => void
}

interface GlobalTeam {
  slug: string
  name: string
}

interface EditorData {
  hasLiveScorekeeperData: boolean
  liveState: LiveGameState | null
  homeRoster: RosterPlayer[]
  awayRoster: RosterPlayer[]
  playerNames: Record<number, string>
  savedGoalies: ShotAllocationGoalie[]
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

const AD_HOC_GAME_TYPES = ["exhibition", "tryout"]

export function deriveBoxscoreStats(
  state: LiveGameState | null | undefined,
  homeSlug: string,
  awaySlug: string,
  fallback: { homeScore: number | null; awayScore: number | null; isOvertime: boolean; hasShootout: boolean },
  isPlayoff = false,
  originalHomeSlug?: string,
  originalAwaySlug?: string
) {
  if (!state) {
    return {
      homeScore: fallback.homeScore,
      awayScore: fallback.awayScore,
      isOvertime: fallback.isOvertime,
      hasShootout: fallback.hasShootout,
    }
  }

  let homeScore = 0
  let awayScore = 0
  for (const goal of state.goals ?? []) {
    if (isPlayoff || goal.period <= 4) {
      if (goal.team === "home") homeScore++
      else if (goal.team === "away") awayScore++
      else if (goal.team === homeSlug && goal.team !== awaySlug) homeScore++
      else if (goal.team === awaySlug && goal.team !== homeSlug) awayScore++
      else if (originalHomeSlug && goal.team === originalHomeSlug && goal.team !== awaySlug) homeScore++
      else if (originalAwaySlug && goal.team === originalAwaySlug && goal.team !== homeSlug) awayScore++
    }
  }

  let hasShootout = Boolean(state.hasShootout)
  if (state.shootout) {
    const isSwapped = Boolean(
      originalHomeSlug &&
      originalAwaySlug &&
      homeSlug === originalAwaySlug &&
      awaySlug === originalHomeSlug
    )
    const rawHomeSOGoals = state.shootout.homeAttempts?.filter((a) => a.scored).length ?? 0
    const rawAwaySOGoals = state.shootout.awayAttempts?.filter((a) => a.scored).length ?? 0
    const homeSOGoals = isSwapped ? rawAwaySOGoals : rawHomeSOGoals
    const awaySOGoals = isSwapped ? rawHomeSOGoals : rawAwaySOGoals

    if ((state.shootout.homeAttempts?.length ?? 0) > 0 || (state.shootout.awayAttempts?.length ?? 0) > 0) {
      hasShootout = true
    }
    if (homeSOGoals > awaySOGoals) homeScore++
    else if (awaySOGoals > homeSOGoals) awayScore++
  }

  const isOvertime = Boolean(state.isOvertime || state.period >= 4 || state.goals?.some((g) => g.period >= 4) || hasShootout)

  if (
    (state.goals?.length ?? 0) === 0 &&
    !hasShootout &&
    (fallback.homeScore !== null || fallback.awayScore !== null || Number(state.period ?? 0) === 0)
  ) {
    return {
      homeScore: fallback.homeScore,
      awayScore: fallback.awayScore,
      isOvertime: fallback.isOvertime,
      hasShootout: fallback.hasShootout,
    }
  }

  return {
    homeScore,
    awayScore,
    isOvertime,
    hasShootout,
  }
}

export function EditGameModal({
  open,
  onOpenChange,
  game,
  teams: initialTeams,
  seasonId,
  defaultLocation,
  onSaved,
  onTeamCreated,
}: EditGameModalProps) {
  const isEditing = !!game?.id
  const { pin: adminPin } = useAdmin()

  // Local copy of teams that can grow when new teams are created/assigned inline
  const [localTeams, setLocalTeams] = useState(initialTeams)

  const [modalTab, setModalTab] = useState<"boxscore" | "settings">("settings")
  const [editorData, setEditorData] = useState<EditorData | null>(null)
  const [isLoadingEditor, setIsLoadingEditor] = useState(false)
  const [hasLiveScorekeeperData, setHasLiveScorekeeperData] = useState(false)

  const [formData, setFormData] = useState<GameFormData>({
    date: "",
    time: "",
    homeTeam: "",
    awayTeam: "",
    location: defaultLocation,
    gameType: "regular",
    status: "upcoming",
    homeScore: null,
    awayScore: null,
    isOvertime: false,
    hasShootout: false,
    isForfeit: false,
    notes: null,
    homeNotes: null,
    awayNotes: null,
  })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [forfeitingSide, setForfeitingSide] = useState<ForfeitingSide>("away")
  const preForfeitSnapshotRef = useRef<{
    status: string
    homeScore: number | null
    awayScore: number | null
    isOvertime: boolean
    hasShootout: boolean
  } | null>(null)

  // Inline team picker mode: null = dropdown, "create" = new team form, "search" = global team search
  const [pickerState, setPickerState] = useState<{
    side: "home" | "away"
    mode: "create" | "search"
  } | null>(null)

  // Create-team form state
  const [newTeamName, setNewTeamName] = useState("")
  const [newTeamColor, setNewTeamColor] = useState("#6366f1")
  const [isCreatingTeam, setIsCreatingTeam] = useState(false)

  // Search-from-database state
  const [globalTeams, setGlobalTeams] = useState<GlobalTeam[]>([])
  const [isLoadingGlobal, setIsLoadingGlobal] = useState(false)
  const [globalSearch, setGlobalSearch] = useState("")
  const [isAssigningTeam, setIsAssigningTeam] = useState(false)
  const hasFetchedGlobal = useRef(false)
  const activeGameIdRef = useRef<string | null>(null)

  // Sync local teams when prop changes
  useEffect(() => {
    setLocalTeams(initialTeams)
  }, [initialTeams])

  const loadEditorData = useCallback(async (gameId: string) => {
    setIsLoadingEditor(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/schedule/${gameId}`)
      if (activeGameIdRef.current !== gameId) return
      if (res.ok) {
        const data = await readApiJson(res)
        if (activeGameIdRef.current !== gameId) return
        setEditorData(data)
        setHasLiveScorekeeperData(Boolean(data.hasLiveScorekeeperData))
        return
      }
      // Fallback: check /api/bash/game/${gameId}/live
      const liveRes = await fetch(`/api/bash/game/${gameId}/live`)
      if (activeGameIdRef.current !== gameId) return
      if (liveRes.ok) {
        const liveData = await readApiJson(liveRes)
        if (activeGameIdRef.current !== gameId) return
        if (liveData?.state) {
          setHasLiveScorekeeperData(true)
          setEditorData({
            hasLiveScorekeeperData: true,
            liveState: liveData.state,
            homeRoster: [],
            awayRoster: [],
            playerNames: liveData.playerNames ?? {},
            savedGoalies: [],
          })
          return
        }
      }
      if (activeGameIdRef.current === gameId) {
        setHasLiveScorekeeperData(false)
        setEditorData(null)
      }
    } catch {
      if (activeGameIdRef.current === gameId) {
        setHasLiveScorekeeperData(false)
        setEditorData(null)
      }
    } finally {
      if (activeGameIdRef.current === gameId) {
        setIsLoadingEditor(false)
      }
    }
  }, [seasonId])

  useEffect(() => {
    if (open) {
      activeGameIdRef.current = game?.id ?? null
      setPickerState(null)
      setNewTeamName("")
      setNewTeamColor("#6366f1")
      setGlobalSearch("")
      hasFetchedGlobal.current = false
      if (game) {
        setFormData(game)
        setForfeitingSide(inferForfeitingSide(game))
        preForfeitSnapshotRef.current = game.isForfeit
          ? null
          : {
              status: game.status,
              homeScore: game.homeScore,
              awayScore: game.awayScore,
              isOvertime: game.isOvertime,
              hasShootout: game.hasShootout,
            }

        const initialTab = game.status === "final" && !game.isForfeit ? "boxscore" : "settings"
        setModalTab(initialTab)

        if (game.liveState) {
          setHasLiveScorekeeperData(true)
          setEditorData({
            hasLiveScorekeeperData: true,
            liveState: game.liveState,
            homeRoster: game.homeRoster ?? [],
            awayRoster: game.awayRoster ?? [],
            playerNames: game.playerNames ?? {},
            savedGoalies: game.savedGoalies ?? [],
          })
          setIsLoadingEditor(false)
        } else if (game.hasLiveScorekeeperData !== undefined) {
          setHasLiveScorekeeperData(game.hasLiveScorekeeperData)
          setEditorData(null)
          if (game.hasLiveScorekeeperData && game.id) {
            loadEditorData(game.id)
          } else {
            setIsLoadingEditor(false)
          }
        } else if (game.id && game.status === "final") {
          loadEditorData(game.id)
        } else {
          setHasLiveScorekeeperData(false)
          setEditorData(null)
          setIsLoadingEditor(false)
        }
      } else {
        setModalTab("settings")
        setHasLiveScorekeeperData(false)
        setEditorData(null)
        setIsLoadingEditor(false)
        setForfeitingSide("away")
        preForfeitSnapshotRef.current = {
          status: "upcoming",
          homeScore: null,
          awayScore: null,
          isOvertime: false,
          hasShootout: false,
        }
        setFormData({
          date: new Date().toISOString().split("T")[0],
          time: "12:00",
          homeTeam: "",
          awayTeam: "",
          location: defaultLocation,
          gameType: "regular",
          status: "upcoming",
          homeScore: null,
          awayScore: null,
          isOvertime: false,
          hasShootout: false,
          isForfeit: false,
          title: null,
          notes: null,
          homeNotes: null,
          awayNotes: null,
        })
      }
    } else {
      activeGameIdRef.current = null
      setEditorData(null)
      setIsLoadingEditor(false)
    }
  }, [open, game, defaultLocation, loadEditorData])

  const handleTabChange = (newTab: "boxscore" | "settings") => {
    setModalTab(newTab)
    if (newTab === "boxscore" && game?.id && !editorData && !isLoadingEditor && game.hasLiveScorekeeperData !== false) {
      loadEditorData(game.id)
    }
  }

  // Fetch global teams once when search mode is first opened
  const fetchGlobalTeams = async () => {
    if (hasFetchedGlobal.current) return
    hasFetchedGlobal.current = true
    setIsLoadingGlobal(true)
    try {
      const res = await fetch("/api/bash/admin/teams")
      if (res.ok) {
        const data = await readApiJson(res)
        setGlobalTeams(data.teams || [])
      }
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load teams"))
    } finally {
      setIsLoadingGlobal(false)
    }
  }

  const derivedStats = useMemo(() => {
    const isUnforfeitedWithoutSnapshot = Boolean(game?.isForfeit && !formData.isForfeit && !preForfeitSnapshotRef.current)
    const fallbackScoreWhenUnforfeited =
      Number(editorData?.liveState?.period ?? 0) === 0 ? null : 0
    return deriveBoxscoreStats(
      editorData?.liveState,
      formData.homeTeam,
      formData.awayTeam,
      {
        homeScore: isUnforfeitedWithoutSnapshot ? fallbackScoreWhenUnforfeited : formData.homeScore,
        awayScore: isUnforfeitedWithoutSnapshot ? fallbackScoreWhenUnforfeited : formData.awayScore,
        isOvertime: isUnforfeitedWithoutSnapshot ? false : formData.isOvertime,
        hasShootout: isUnforfeitedWithoutSnapshot ? false : formData.hasShootout,
      },
      formData.gameType === "playoff" || formData.gameType === "championship",
      game?.homeTeam,
      game?.awayTeam
    )
  }, [
    editorData?.liveState,
    formData.homeTeam,
    formData.awayTeam,
    formData.homeScore,
    formData.awayScore,
    formData.isOvertime,
    formData.hasShootout,
    formData.isForfeit,
    formData.gameType,
    game?.isForfeit,
    game?.homeTeam,
    game?.awayTeam,
  ])

  const handleSubmit = async () => {
    if (!formData.date || !formData.time || !formData.homeTeam || !formData.awayTeam) {
      toast.error("Please fill in all required fields")
      return
    }

    setIsSubmitting(true)
    try {
      const url = isEditing
        ? `/api/bash/admin/seasons/${seasonId}/schedule/${game.id}`
        : `/api/bash/admin/seasons/${seasonId}/schedule`
      const method = isEditing ? "PATCH" : "POST"

      // hasBoxscore is server-owned; strip internal and server-owned fields
      const {
        hasBoxscore: _hasBoxscore,
        hasLiveScorekeeperData: _hasLive,
        liveState: _liveState,
        homeRoster: _hr,
        awayRoster: _ar,
        playerNames: _pn,
        savedGoalies: _sg,
        ...payload
      } = formData as Record<string, unknown>

      if (hasLiveScorekeeperData && !formData.isForfeit) {
        payload.homeScore = derivedStats.homeScore
        payload.awayScore = derivedStats.awayScore
        payload.isOvertime = derivedStats.isOvertime
        payload.hasShootout = derivedStats.hasShootout
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await readApiJson(res)
        throw new Error(data.error || "Failed to save game")
      }

      toast.success(isEditing ? "Game updated" : "Game added")
      onSaved()
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(errorMessage(err, "An error occurred"))
    } finally {
      setIsSubmitting(false)
    }
  }

  /** Create a brand-new team and assign it to the season */
  const handleCreateTeam = async (side: "home" | "away") => {
    if (!newTeamName.trim()) {
      toast.error("Team name is required")
      return
    }

    const slug = slugify(newTeamName)
    if (!slug) {
      toast.error("Invalid team name")
      return
    }

    setIsCreatingTeam(true)
    try {
      // 1. Create the team globally
      const createRes = await fetch("/api/bash/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, name: newTeamName.trim() }),
      })

      if (!createRes.ok) {
        const err = await readApiJson(createRes)
        toast.error(err.error || "Failed to create team")
        return
      }

      const { team } = await readApiJson(createRes)

      // 2. Assign to this season with the chosen color
      const assignRes = await fetch(`/api/bash/admin/seasons/${seasonId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug: team.slug, color: newTeamColor }),
      })

      if (!assignRes.ok) {
        const err = await readApiJson(assignRes)
        toast.error(err.error || "Failed to assign team to season")
        return
      }

      // 3. Add to local teams list and select it
      const newEntry = { teamSlug: team.slug, teamName: team.name }
      setLocalTeams((prev) =>
        [...prev, newEntry].sort((a, b) => a.teamName.localeCompare(b.teamName))
      )
      setFormData((f) => ({ ...f, [side === "home" ? "homeTeam" : "awayTeam"]: team.slug }))

      // 4. Reset
      setPickerState(null)
      setNewTeamName("")
      setNewTeamColor("#6366f1")

      // 5. Notify parent so Teams tab refreshes
      onTeamCreated?.()

      toast.success(`Created "${team.name}" and assigned to season`)
    } catch (error) {
      toast.error(errorMessage(error, "Connection error"))
    } finally {
      setIsCreatingTeam(false)
    }
  }

  /** Assign an existing global team to this season and select it */
  const handleAssignGlobalTeam = async (side: "home" | "away", team: GlobalTeam) => {
    setIsAssigningTeam(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug: team.slug }),
      })

      if (!res.ok) {
        const err = await readApiJson(res)
        toast.error(err.error || "Failed to assign team")
        return
      }

      // Add to local teams and select
      const newEntry = { teamSlug: team.slug, teamName: team.name }
      setLocalTeams((prev) =>
        [...prev, newEntry].sort((a, b) => a.teamName.localeCompare(b.teamName))
      )
      setFormData((f) => ({ ...f, [side === "home" ? "homeTeam" : "awayTeam"]: team.slug }))

      setPickerState(null)
      setGlobalSearch("")

      onTeamCreated?.()

      toast.success(`Added "${team.name}" to season`)
    } catch (error) {
      toast.error(errorMessage(error, "Connection error"))
    } finally {
      setIsAssigningTeam(false)
    }
  }

  const resetPickerState = () => {
    setPickerState(null)
    setNewTeamName("")
    setNewTeamColor("#6366f1")
    setGlobalSearch("")
  }

  const assignedSlugs = new Set(localTeams.map((t) => t.teamSlug))
  
  const extraTeams: { teamSlug: string; teamName: string }[] = []
  if (formData.homeTeam && formData.homeTeam !== "tbd" && !assignedSlugs.has(formData.homeTeam)) {
    const globalMatch = globalTeams.find(t => t.slug === formData.homeTeam)
    extraTeams.push({ teamSlug: formData.homeTeam, teamName: globalMatch ? globalMatch.name : formData.homeTeam })
    assignedSlugs.add(formData.homeTeam)
  }
  if (formData.awayTeam && formData.awayTeam !== "tbd" && !assignedSlugs.has(formData.awayTeam)) {
    const globalMatch = globalTeams.find(t => t.slug === formData.awayTeam)
    extraTeams.push({ teamSlug: formData.awayTeam, teamName: globalMatch ? globalMatch.name : formData.awayTeam })
    assignedSlugs.add(formData.awayTeam)
  }

  // Include the TBD placeholder team
  const allTeams = [{ teamSlug: "tbd", teamName: "(TBD)" }, ...localTeams, ...extraTeams]

  const isAdHocType = AD_HOC_GAME_TYPES.includes(formData.gameType)

  // Global teams not yet assigned to this season
  const unassignedGlobalTeams = globalTeams.filter(
    (t) => !assignedSlugs.has(t.slug) && t.slug !== "tbd"
  )
  const searchLower = globalSearch.toLowerCase()
  const filteredGlobalTeams = globalSearch
    ? unassignedGlobalTeams.filter(
        (t) => t.name.toLowerCase().includes(searchLower) || t.slug.includes(searchLower)
      )
    : unassignedGlobalTeams

  /**
   * Renders a team selector — either the standard dropdown or (for exhibition/tryout)
   * a dropdown with inline "Add from database" / "Create team" expansion.
   */
  function renderTeamPicker(side: "home" | "away", label: string) {
    const fieldKey = side === "home" ? "homeTeam" : "awayTeam"
    const isActive = pickerState?.side === side

    return (
      <div className="space-y-2">
        <Label>{label} *</Label>

        {/* ── Inline Create New Team ── */}
        {isActive && pickerState.mode === "create" ? (
          <div className="space-y-2 p-3 border rounded-md bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                New Team
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                onClick={resetPickerState}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <Input
              placeholder="Team name (e.g. USA, Team Chris)"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              className="h-8 text-sm"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground shrink-0">Color</Label>
              <input
                type="color"
                value={newTeamColor}
                onChange={(e) => setNewTeamColor(e.target.value)}
                className="h-7 w-10 rounded border cursor-pointer"
              />
              <span className="text-xs text-muted-foreground font-mono">{newTeamColor}</span>
            </div>
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              disabled={isCreatingTeam || !newTeamName.trim()}
              onClick={() => handleCreateTeam(side)}
            >
              {isCreatingTeam ? (
                <Spinner className="h-3 w-3 mr-1" />
              ) : (
                <Plus className="h-3 w-3 mr-1" />
              )}
              Create &amp; Select
            </Button>
          </div>

        /* ── Inline Search from Database ── */
        ) : isActive && pickerState.mode === "search" ? (
          <div className="space-y-2 p-3 border rounded-md bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Add from Database
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                onClick={resetPickerState}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search teams..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                className="h-8 text-sm pl-7"
                autoFocus
              />
            </div>
            <div className="max-h-[160px] overflow-y-auto space-y-1">
              {isLoadingGlobal ? (
                <div className="flex justify-center py-4">
                  <Spinner className="h-4 w-4 text-muted-foreground" />
                </div>
              ) : filteredGlobalTeams.length === 0 ? (
                <div className="text-center py-3 text-xs text-muted-foreground">
                  {globalSearch ? "No matches found." : "All teams are already assigned."}
                </div>
              ) : (
                filteredGlobalTeams.slice(0, 50).map((t) => (
                  <button
                    key={t.slug}
                    className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-primary/10 transition-colors flex items-center justify-between disabled:opacity-50"
                    disabled={isAssigningTeam}
                    onClick={() => handleAssignGlobalTeam(side, t)}
                  >
                    <span className="truncate">{t.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>

        /* ── Default: Team dropdown ── */
        ) : (
          <Select
            value={formData[fieldKey]}
            onValueChange={(val) => {
              if (val === "__SEARCH__") {
                setPickerState({ side, mode: "search" })
                fetchGlobalTeams()
              } else if (val === "__CREATE__") {
                setPickerState({ side, mode: "create" })
                setNewTeamName("")
                setNewTeamColor("#6366f1")
              } else {
                setFormData({ ...formData, [fieldKey]: val })
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select team..." />
            </SelectTrigger>
            <SelectContent>
              {allTeams.map((t) => (
                <SelectItem key={t.teamSlug} value={t.teamSlug}>
                  {t.teamName}
                </SelectItem>
              ))}
              {isAdHocType && (
                <>
                  <SelectItem value="__SEARCH__" className="text-primary font-medium focus:text-primary focus:bg-primary/10 border-t mt-1 pt-2">
                    <div className="flex items-center">
                      <Database className="h-3.5 w-3.5 mr-2" />
                      Add from database...
                    </div>
                  </SelectItem>
                  <SelectItem value="__CREATE__" className="text-primary font-medium focus:text-primary focus:bg-primary/10">
                    <div className="flex items-center">
                      <Plus className="h-3.5 w-3.5 mr-2" />
                      Create new team...
                    </div>
                  </SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        )}

        {/* Score display or input */}
        {hasLiveScorekeeperData && !formData.isForfeit ? (
          <div className="space-y-1">
            <Input
              type="number"
              placeholder="Score"
              value={(side === "home" ? derivedStats.homeScore : derivedStats.awayScore) ?? ""}
              disabled
              readOnly
              aria-label={`${label} Score (derived from boxscore)`}
              title="Score is derived from boxscore data"
              className="bg-muted text-muted-foreground cursor-not-allowed"
            />
            <p className="text-[10px] text-muted-foreground">Derived from boxscore</p>
          </div>
        ) : (
          <Input
            type="number"
            placeholder="Score"
            value={formData[side === "home" ? "homeScore" : "awayScore"] ?? ""}
            onChange={(e) =>
              setFormData({
                ...formData,
                [side === "home" ? "homeScore" : "awayScore"]:
                  e.target.value === "" ? null : parseInt(e.target.value, 10),
              })
            }
          />
        )}
      </div>
    )
  }

  const settingsFormContent = (
    <div className="grid gap-6 py-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Date *</Label>
          <Input
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Time *</Label>
            <div className="flex items-center gap-1.5">
              <Switch
                id="time-tbd"
                checked={formData.time === "TBD"}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, time: checked ? "TBD" : "12:00" })
                }
                className="scale-75"
              />
              <Label htmlFor="time-tbd" className="text-xs text-muted-foreground cursor-pointer">
                TBD
              </Label>
            </div>
          </div>
          <Input
            type="time"
            value={toHHMM(formData.time)}
            onChange={(e) => setFormData({ ...formData, time: e.target.value || "TBD" })}
            disabled={formData.time === "TBD"}
            className={formData.time === "TBD" ? "opacity-40" : ""}
          />
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={formData.status}
            onValueChange={(val) => setFormData({ ...formData, status: val })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="live">Live (In Progress)</SelectItem>
              <SelectItem value="final">Final</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Game Type</Label>
          <Select
            value={formData.gameType}
            onValueChange={(val) => setFormData({ ...formData, gameType: val })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="regular">Regular Season</SelectItem>
              <SelectItem value="playoff">Playoff</SelectItem>
              <SelectItem value="championship">Championship</SelectItem>
              <SelectItem value="exhibition">Exhibition</SelectItem>
              <SelectItem value="tryout">Tryout</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Location</Label>
          <Input
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
          />
        </div>
        <div className="space-y-2 col-span-2">
          <Label>Game Title (Optional)</Label>
          <Input
            placeholder="e.g. The Alumni Game, 2026 Skills Competition"
            value={formData.title || ""}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4 items-start bg-muted/30 p-4 rounded-lg">
        <div className="col-span-2">
          {renderTeamPicker("away", "Away Team")}
        </div>
        <div className="col-span-1 flex items-center justify-center pt-8 text-sm text-muted-foreground font-medium">
          VS
        </div>
        <div className="col-span-2">
          {renderTeamPicker("home", "Home Team")}
        </div>
      </div>

      <div className="bg-muted/10 p-4 rounded-lg border space-y-4">
        <div className="flex flex-wrap gap-8 items-center justify-between sm:justify-start">
          {hasLiveScorekeeperData && !formData.isForfeit ? (
            <div className="flex items-center gap-2">
              <Switch
                id="overtime"
                checked={derivedStats.isOvertime}
                disabled
              />
              <Label htmlFor="overtime" className="text-muted-foreground cursor-not-allowed">
                Overtime <span className="text-[10px] text-muted-foreground">(derived from boxscore)</span>
              </Label>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Switch
                id="overtime"
                checked={formData.isOvertime}
                onCheckedChange={(checked) => setFormData({ ...formData, isOvertime: checked })}
              />
              <Label htmlFor="overtime">Overtime</Label>
            </div>
          )}
          {hasLiveScorekeeperData && !formData.isForfeit ? (
            <div className="flex items-center gap-2">
              <Switch
                id="shootout"
                checked={derivedStats.hasShootout}
                disabled
              />
              <Label htmlFor="shootout" className="text-muted-foreground cursor-not-allowed">
                Shootout <span className="text-[10px] text-muted-foreground">(derived from boxscore)</span>
              </Label>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Switch
                id="shootout"
                checked={formData.hasShootout}
                onCheckedChange={(checked) => setFormData({ ...formData, hasShootout: checked })}
              />
              <Label htmlFor="shootout">Shootout</Label>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch
              id="forfeit"
              checked={formData.isForfeit}
              onCheckedChange={(checked) => {
                if (checked) {
                  preForfeitSnapshotRef.current = {
                    status: formData.status,
                    homeScore: formData.homeScore,
                    awayScore: formData.awayScore,
                    isOvertime: formData.isOvertime,
                    hasShootout: formData.hasShootout,
                  }
                  const inferred = inferForfeitingSide(formData)
                  setForfeitingSide(inferred)
                  setFormData({ ...formData, ...applyForfeitPreset(inferred) })
                } else if (preForfeitSnapshotRef.current) {
                  const snap = preForfeitSnapshotRef.current
                  setFormData({
                    ...formData,
                    isForfeit: false,
                    status: snap.status,
                    homeScore: snap.homeScore,
                    awayScore: snap.awayScore,
                    isOvertime: snap.isOvertime,
                    hasShootout: snap.hasShootout,
                  })
                } else if (hasLiveScorekeeperData && editorData?.liveState) {
                  const fallbackScore = Number(editorData.liveState.period ?? 0) === 0 ? null : 0
                  const restored = deriveBoxscoreStats(
                    editorData.liveState,
                    formData.homeTeam,
                    formData.awayTeam,
                    { homeScore: fallbackScore, awayScore: fallbackScore, isOvertime: false, hasShootout: false },
                    formData.gameType === "playoff" || formData.gameType === "championship",
                    game?.homeTeam,
                    game?.awayTeam
                  )
                  setFormData({
                    ...formData,
                    isForfeit: false,
                    status: restored.homeScore === null && restored.awayScore === null ? "upcoming" : formData.status,
                    homeScore: restored.homeScore,
                    awayScore: restored.awayScore,
                    isOvertime: restored.isOvertime,
                    hasShootout: restored.hasShootout,
                  })
                } else if (!game?.hasBoxscore) {
                  setFormData({
                    ...formData,
                    isForfeit: false,
                    status: "upcoming",
                    homeScore: null,
                    awayScore: null,
                    isOvertime: false,
                    hasShootout: false,
                  })
                } else {
                  setFormData({
                    ...formData,
                    isForfeit: false,
                  })
                }
              }}
            />
            <Label htmlFor="forfeit" className="text-destructive">Forfeit</Label>
          </div>
        </div>

        {formData.isForfeit && (
          <div className="pt-3 border-t border-border/60 space-y-2">
            <Label className="text-xs text-muted-foreground">Forfeiting Team (auto-sets official 5–0 score &amp; Final status)</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(
                [
                  {
                    side: "away" as const,
                    label: `${localTeams.find((t) => t.teamSlug === formData.awayTeam)?.teamName || "Away Team"} (Away)`,
                    sublabel: "Home wins 5–0",
                  },
                  {
                    side: "home" as const,
                    label: `${localTeams.find((t) => t.teamSlug === formData.homeTeam)?.teamName || "Home Team"} (Home)`,
                    sublabel: "Away wins 5–0",
                  },
                  {
                    side: "both" as const,
                    label: "Both Teams (Double Forfeit)",
                    sublabel: "Both lose 0–5 in standings",
                  },
                ]
              ).map((opt) => {
                const active = forfeitingSide === opt.side
                return (
                  <Button
                    key={opt.side}
                    type="button"
                    variant={active ? "secondary" : "outline"}
                    size="sm"
                    className={active ? "border-foreground/40 font-semibold h-auto py-2 flex flex-col items-start" : "h-auto py-2 flex flex-col items-start text-muted-foreground"}
                    onClick={() => {
                      setForfeitingSide(opt.side)
                      setFormData((prev) => ({ ...prev, ...applyForfeitPreset(opt.side) }))
                    }}
                  >
                    <span className="text-xs truncate w-full text-left">{opt.label}</span>
                    <span className="text-[10px] text-muted-foreground font-normal">{opt.sublabel}</span>
                  </Button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <Tabs defaultValue="league">
        <TabsList className="w-full">
          <TabsTrigger value="league" className="flex-1">League Notes</TabsTrigger>
          <TabsTrigger value="away" className="flex-1">Away Notes</TabsTrigger>
          <TabsTrigger value="home" className="flex-1">Home Notes</TabsTrigger>
        </TabsList>
        <TabsContent value="league">
          <Textarea
            placeholder="Public notes about this game..."
            value={formData.notes || ""}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            rows={3}
          />
        </TabsContent>
        <TabsContent value="away">
          <Textarea
            placeholder="Internal/away team specific notes..."
            value={formData.awayNotes || ""}
            onChange={(e) => setFormData({ ...formData, awayNotes: e.target.value })}
            rows={3}
          />
        </TabsContent>
        <TabsContent value="home">
          <Textarea
            placeholder="Internal/home team specific notes..."
            value={formData.homeNotes || ""}
            onChange={(e) => setFormData({ ...formData, homeNotes: e.target.value })}
            rows={3}
          />
        </TabsContent>
      </Tabs>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={isEditing ? "sm:max-w-4xl max-h-[90vh] overflow-y-auto" : "sm:max-w-[600px] max-h-[90vh] overflow-y-auto"}>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Game" : "Add Game"}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEditing ? "Edit game settings and boxscore stats" : "Add a new game to the season schedule"}
          </DialogDescription>
        </DialogHeader>

        {isEditing ? (
          <Tabs value={modalTab} onValueChange={(val) => handleTabChange(val as "boxscore" | "settings")} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="boxscore">Boxscore &amp; Stats</TabsTrigger>
              <TabsTrigger value="settings">Game Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="boxscore" forceMount className="mt-0 data-[state=inactive]:hidden">
              {formData.isForfeit ? (
                <div className="p-8 text-center text-muted-foreground border border-dashed rounded-lg space-y-2">
                  <Info className="h-8 w-8 mx-auto opacity-40" />
                  <p className="text-sm">Boxscore &amp; player stats are disabled for forfeited games. Manage forfeit settings in the Game Settings tab.</p>
                </div>
              ) : isLoadingEditor ? (
                <div className="flex justify-center p-12">
                  <Spinner className="h-8 w-8 text-muted-foreground" />
                </div>
              ) : !hasLiveScorekeeperData ? (
                <div className="p-8 text-center text-muted-foreground border border-dashed rounded-lg space-y-2">
                  <Info className="h-8 w-8 mx-auto opacity-40" />
                  <p className="text-sm">This game&apos;s stats were imported without live scorekeeper data</p>
                </div>
              ) : game.status !== "final" ? (
                <div className="p-8 text-center text-muted-foreground border border-dashed rounded-lg space-y-2">
                  <Info className="h-8 w-8 mx-auto opacity-40" />
                  <p className="text-sm">Boxscore &amp; player stats can be edited here once the game is finalized</p>
                </div>
              ) : editorData?.liveState ? (
                <AdminGameEditor
                  key={game.id}
                  isPlayoff={formData.gameType === "playoff" || formData.gameType === "championship"}
                  gameId={game.id!}
                  state={editorData.liveState}
                  pin={adminPin || ""}
                  homeSlug={game.homeTeam || formData.homeTeam}
                  awaySlug={game.awayTeam || formData.awayTeam}
                  homeTeam={localTeams.find((t) => t.teamSlug === (game.homeTeam || formData.homeTeam))?.teamName || game.homeTeam || formData.homeTeam}
                  awayTeam={localTeams.find((t) => t.teamSlug === (game.awayTeam || formData.awayTeam))?.teamName || game.awayTeam || formData.awayTeam}
                  homeRoster={editorData.homeRoster}
                  awayRoster={editorData.awayRoster}
                  playerNames={editorData.playerNames}
                  savedGoalies={editorData.savedGoalies}
                  onClose={() => onOpenChange(false)}
                  onSaved={() => {
                    toast.success("Game stats saved")
                    onSaved()
                    onOpenChange(false)
                  }}
                />
              ) : null}
            </TabsContent>

            <TabsContent value="settings" className="mt-0">
              {settingsFormContent}
            </TabsContent>
          </Tabs>
        ) : (
          settingsFormContent
        )}

        {/* Dialog footer */}
        {(!isEditing || modalTab === "settings") && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || isLoadingEditor}>
              {isSubmitting ? "Saving..." : isLoadingEditor ? "Loading..." : isEditing ? "Save Game" : "Add Game"}
            </Button>
          </DialogFooter>
        )}
        {isEditing && modalTab === "boxscore" && (formData.isForfeit || game.status !== "final" || (!hasLiveScorekeeperData && !isLoadingEditor)) && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
