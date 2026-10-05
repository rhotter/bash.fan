"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Check, AlertTriangle, HelpCircle, Trash2, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
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
import { toast } from "sonner"
const STANDINGS_OPTIONS = [
  { value: "pts-pbla", label: "Points (PBLA)", description: "W=3, OTW=2, OTL=1, L=0 (BASH default)" },
  { value: "pts-standard", label: "Points (Standard)", description: "W=2, T=1, OTL=1, L=0" },
  { value: "win-pct", label: "Win Percentage", description: "Strictly Win-Loss percentage. Ties excluded." },
  { value: "pts-custom", label: "Custom Points", description: "Custom points calculation." },
]

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft", description: "Season is being set up. Not visible to the public." },
  { value: "active", label: "Active", description: "Move to Active after the draft is finalized and you're ready for regular season games to begin. Official standings, stats tracking, and regular season scoring will be enabled." },
  { value: "completed", label: "Completed", description: "Season is finished. Stats are frozen and visible as historical data." },
  { value: "archived", label: "Archived", description: "Hidden from most views. Data is preserved but not surfaced." },
]

interface SeasonFormProps {
  season: {
    id: string
    name: string
    seasonType: string
    leagueId: string | null
    status: string
    standingsMethod: string | null
    gameLength: number | null
    defaultLocation: string | null
    adminNotes: string | null
    statsOnly: boolean
    playoffTeams: number | null
    isCurrent?: boolean
    enableSync: boolean
  }
}

export function SeasonForm({ season }: SeasonFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    status: string
    title: string
    description: string
  }>({ open: false, status: "", title: "", description: "" })

  const [deleteDialog, setDeleteDialog] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)

  const [form, setForm] = useState({
    name: season.name,
    seasonType: season.seasonType,
    leagueId: season.leagueId || "",
    status: season.status,
    standingsMethod: season.standingsMethod || "pts-pbla",
    gameLength: season.gameLength || 60,
    defaultLocation: season.defaultLocation || "",
    adminNotes: season.adminNotes || "",
    statsOnly: season.statsOnly || false,
    playoffTeams: season.playoffTeams as number | null,
    isCurrent: season.isCurrent ?? false,
    enableSync: season.enableSync ?? true,
  })


  async function handleSave() {
    setSaving(true)
    setError("")
    setSaved(false)

    try {
      const res = await fetch(`/api/bash/admin/seasons/${season.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })

      if (res.ok) {
        setSaved(true)
        toast.success("Season settings saved")
        setTimeout(() => setSaved(false), 3000)
        router.refresh()
      } else {
        const data = await res.json()
        const errMsg = data.error || "Failed to save"
        setError(errMsg)
        toast.error(errMsg)
      }
    } catch {
      setError("Connection error")
      toast.error("Connection error")
    } finally {
      setSaving(false)
    }
  }

  function promptStatusTransition(newStatus: string) {
    if (newStatus === season.status) return
    const descriptions: Record<string, { title: string; description: string }> = {
      draft: {
        title: "Move season to Draft?",
        description: "The season will be marked as in-progress setup. It will not be visible as the current season on the public site.",
      },
      active: {
        title: "Activate this season?",
        description: "Move to Active after the draft is finalized and you're ready for regular season games to begin. Official standings, stats tracking, and regular season scoring will be enabled.",
      },
      completed: {
        title: "Mark season as completed?",
        description: "This will close the books on this season. It will remain the \u2018current\u2019 season on the public site until you activate a new one.",
      },
      archived: {
        title: "Archive this season?",
        description: "The season will be hidden from most views but its data will be preserved. You can restore it later by changing the status back.",
      },
    }
    const info = descriptions[newStatus] || { title: `Change status to ${newStatus}?`, description: "Are you sure you want to change the season status?" }
    setConfirmDialog({ open: true, status: newStatus, ...info })
  }

  async function executeStatusTransition() {
    const newStatus = confirmDialog.status
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/bash/admin/seasons/${season.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        setForm((f) => ({
          ...f,
          status: newStatus,
          ...(newStatus === "active" ? { isCurrent: true } : {}),
        }))
        setConfirmDialog((d) => ({ ...d, open: false }))
        toast.success(`Season status changed to ${newStatus}`)
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        const errMsg = data.error || "Failed to transition"
        setError(errMsg)
        toast.error(errMsg)
        // Revert dropdown on failure
        setForm((f) => ({ ...f, status: season.status }))
        setConfirmDialog((d) => ({ ...d, open: false }))
      }
    } catch {
      const errMsg = "Failed to transition season status"
      setError(errMsg)
      toast.error(errMsg)
      setForm((f) => ({ ...f, status: season.status }))
      setConfirmDialog((d) => ({ ...d, open: false }))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError("")
    try {
      const force = season.status !== "draft" ? "?force=true" : ""
      const res = await fetch(`/api/bash/admin/seasons/${season.id}${force}`, {
        method: "DELETE",
      })
      if (res.ok) {
        router.push("/admin/seasons")
        router.refresh()
      } else {
        const data = await res.json()
        setError(data.error || "Failed to delete season")
        setDeleteDialog(false)
      }
    } catch {
      setError("Connection error")
      setDeleteDialog(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Season Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">League ID</Label>
              <Input
                value={form.leagueId}
                onChange={(e) => setForm((f) => ({ ...f, leagueId: e.target.value }))}
                placeholder="Sportability reference"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Season Type</Label>
              <Select
                value={form.seasonType}
                onValueChange={(v) => setForm((f) => ({ ...f, seasonType: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fall">Fall</SelectItem>
                  <SelectItem value="summer">Summer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Season Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => {
                setForm((f) => ({ ...f, status: v }))
                promptStatusTransition(v)
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex flex-col">
                      <span>{opt.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {STATUS_OPTIONS.find((opt) => opt.value === form.status)?.description}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Featured on Homepage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              Featured on Homepage
            </span>
            {form.isCurrent ? (
              <Badge variant="outline" className="border-primary/40 text-primary bg-primary/5 text-[10px] font-medium">
                <Globe className="h-3 w-3" />
                Current Season (Homepage)
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground border-border text-[10px] font-medium">
                Not Featured
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="isCurrent" className="text-sm font-medium cursor-pointer">
                Featured on Homepage
              </Label>
              <p className="text-xs text-muted-foreground">
                Display this season by default on the public homepage. Tryout games, registration announcements, and schedules for this season will be featured to visitors.
              </p>
            </div>
            <Switch
              id="isCurrent"
              checked={form.isCurrent}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, isCurrent: checked }))}
            />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {form.isCurrent
              ? "This season is currently set as the default season on the public homepage. It can remain in Draft status while teams, rosters, drafts, and schedules are being configured."
              : "This season is not currently featured on the homepage. Toggle this on or use the 'Set as Current Season' button in the header above to make it the default season on the public site."}
          </p>
        </CardContent>
      </Card>

      {/* Season Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground cursor-help">Standings Method</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground/50 hover:text-foreground cursor-help transition-colors" />
                  </TooltipTrigger>
                  <TooltipContent className="text-center w-64 text-sm" side="top">
                    {STANDINGS_OPTIONS.find((opt) => opt.value === form.standingsMethod)?.description || "The method used to calculate team points."}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <select
              value={form.standingsMethod}
              onChange={(e) => setForm((f) => ({ ...f, standingsMethod: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {STANDINGS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Game Length (min)</Label>
              <Input
                type="number"
                min={20}
                max={120}
                value={form.gameLength}
                onChange={(e) => setForm((f) => ({ ...f, gameLength: parseInt(e.target.value) || 60 }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Default Location</Label>
              <Input
                value={form.defaultLocation}
                onChange={(e) => setForm((f) => ({ ...f, defaultLocation: e.target.value }))}
                placeholder="Venue name"
              />
            </div>
          </div>



          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Admin Notes</Label>
            <textarea
              value={form.adminNotes}
              onChange={(e) => setForm((f) => ({ ...f, adminNotes: e.target.value }))}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
              placeholder="Internal notes about this season..."
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="statsOnly"
              checked={form.statsOnly}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, statsOnly: checked === true }))}
            />
            <div className="grid gap-1.5 leading-none">
              <Label htmlFor="statsOnly" className="text-sm font-medium leading-none cursor-pointer">
                Stats-only season
              </Label>
              <p className="text-xs text-muted-foreground">
                For legacy seasons imported before we had individual game data. Stats are read from pre-aggregated totals instead of game-by-game box scores.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="enableSync"
              checked={form.enableSync}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, enableSync: checked === true }))}
            />
            <div className="grid gap-1.5 leading-none">
              <Label htmlFor="enableSync" className="text-sm font-medium leading-none cursor-pointer">
                Enable daily sync with Sportability
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatically pull game scores and player box scores from Sportability daily. Turn off if games and stats are managed directly on the BASH site.
              </p>
            </div>
          </div>

        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div>
          {error && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {error}
            </p>
          )}
          {saved && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <Check className="h-3 w-3" /> Saved successfully
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={saving}
            size="sm"
            className="font-semibold cursor-pointer"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Check className="h-4 w-4 mr-1.5" />
            )}
            Save Changes
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => {
        if (!open) {
          setConfirmDialog((d) => ({ ...d, open: false }))
          // Revert dropdown only when dismissed/cancelled while not saving
          if (!saving) {
            setForm((f) => ({ ...f, status: season.status }))
          }
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {confirmDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                executeStatusTransition()
              }}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>



      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete this season</p>
              <p className="text-xs text-muted-foreground">Permanently remove this season and all associated data (games, stats, rosters, awards).</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setDeleteDialog(true); setDeleteConfirmText("") }}
              className="cursor-pointer shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete Season
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialog} onOpenChange={(open) => { if (!open) { setDeleteDialog(false); setDeleteConfirmText("") } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete "{season.name}"?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">This action is <strong>permanent and irreversible</strong>. It will delete:</span>
              <span className="block text-xs text-muted-foreground">• All games and box scores<br/>• All player stats and rosters<br/>• All awards for this season<br/>• The season itself</span>
              <span className="block pt-2">Type <strong>{season.name}</strong> to confirm:</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={season.name}
            className="mt-2"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || deleteConfirmText !== season.name}
              className="cursor-pointer"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Permanently Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
