"use client"

import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
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
import { Plus, Loader2, X, Search, Database } from "lucide-react"

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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

const AD_HOC_GAME_TYPES = ["exhibition", "tryout"]

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

  // Local copy of teams that can grow when new teams are created/assigned inline
  const [localTeams, setLocalTeams] = useState(initialTeams)

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

  // Sync local teams when prop changes
  useEffect(() => {
    setLocalTeams(initialTeams)
  }, [initialTeams])

  useEffect(() => {
    if (open) {
      setPickerState(null)
      setNewTeamName("")
      setNewTeamColor("#6366f1")
      setGlobalSearch("")
      hasFetchedGlobal.current = false
      if (game) {
        setFormData(game)
      } else {
        setFormData({
          date: new Date().toISOString().split("T")[0],
          time: "12:00p",
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
      }
    }
  }, [open, game, defaultLocation])

  // Fetch global teams once when search mode is first opened
  const fetchGlobalTeams = async () => {
    if (hasFetchedGlobal.current) return
    hasFetchedGlobal.current = true
    setIsLoadingGlobal(true)
    try {
      const res = await fetch("/api/bash/admin/teams")
      if (res.ok) {
        const data = await res.json()
        setGlobalTeams(data.teams || [])
      }
    } catch {
      toast.error("Failed to load teams")
    } finally {
      setIsLoadingGlobal(false)
    }
  }

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

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save game")
      }

      toast.success(isEditing ? "Game updated" : "Game added")
      onSaved()
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "An error occurred")
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
        const err = await createRes.json()
        toast.error(err.error || "Failed to create team")
        return
      }

      const { team } = await createRes.json()

      // 2. Assign to this season with the chosen color
      const assignRes = await fetch(`/api/bash/admin/seasons/${seasonId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug: team.slug, color: newTeamColor }),
      })

      if (!assignRes.ok) {
        const err = await assignRes.json()
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
    } catch {
      toast.error("Connection error")
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
        const err = await res.json()
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
    } catch {
      toast.error("Connection error")
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

  // Include the TBD placeholder team
  const allTeams = [{ teamSlug: "tbd", teamName: "(TBD)" }, ...localTeams]
  const assignedSlugs = new Set(localTeams.map((t) => t.teamSlug))

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
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Plus className="h-3 w-3 mr-1" />
              )}
              Create & Select
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
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
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
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{t.slug}</span>
                  </button>
                ))
              )}
            </div>
          </div>

        /* ── Default: Team dropdown ── */
        ) : (
          <>
            <Select
              value={formData[fieldKey]}
              onValueChange={(val) => setFormData({ ...formData, [fieldKey]: val })}
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
              </SelectContent>
            </Select>

            {/* Action buttons for ad-hoc game types */}
            {isAdHocType && (
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-primary hover:text-primary/80 px-0"
                  onClick={() => {
                    setPickerState({ side, mode: "search" })
                    fetchGlobalTeams()
                  }}
                >
                  <Database className="h-3 w-3 mr-1" />
                  Add from database
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-primary hover:text-primary/80 px-0"
                  onClick={() => {
                    setPickerState({ side, mode: "create" })
                    setNewTeamName("")
                    setNewTeamColor("#6366f1")
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Create new team
                </Button>
              </div>
            )}
          </>
        )}

        {/* Score input */}
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
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Game" : "Add Game"}</DialogTitle>
        </DialogHeader>

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
              <Label>Time *</Label>
              <Input
                placeholder="e.g., 10:00a or TBD"
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
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
          </div>

          <div className="grid grid-cols-5 gap-4 items-end bg-muted/30 p-4 rounded-lg">
            <div className="col-span-2">
              {renderTeamPicker("away", "Away Team")}
            </div>
            <div className="col-span-1 flex items-center justify-center pb-2 text-sm text-muted-foreground font-medium">
              VS
            </div>
            <div className="col-span-2">
              {renderTeamPicker("home", "Home Team")}
            </div>
          </div>

          <div className="bg-muted/10 p-4 rounded-lg border">
            <div className="flex flex-wrap gap-8 items-center justify-between sm:justify-start">
              <div className="flex items-center gap-2">
                <Switch
                  id="overtime"
                  checked={formData.isOvertime}
                  onCheckedChange={(checked) => setFormData({ ...formData, isOvertime: checked })}
                />
                <Label htmlFor="overtime">Overtime</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="shootout"
                  checked={formData.hasShootout}
                  onCheckedChange={(checked) => setFormData({ ...formData, hasShootout: checked })}
                />
                <Label htmlFor="shootout">Shootout</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="forfeit"
                  checked={formData.isForfeit}
                  onCheckedChange={(checked) => setFormData({ ...formData, isForfeit: checked })}
                />
                <Label htmlFor="forfeit" className="text-destructive">Forfeit</Label>
              </div>
            </div>
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Game"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
