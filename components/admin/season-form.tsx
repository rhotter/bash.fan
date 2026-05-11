"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Check, AlertTriangle, HelpCircle, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
const STANDINGS_OPTIONS = [
  { value: "pts-pbla", label: "Points (PBLA)", description: "W=3, OTW=2, OTL=1, L=0 (BASH default)" },
  { value: "pts-standard", label: "Points (Standard)", description: "W=2, T=1, OTL=1, L=0" },
  { value: "win-pct", label: "Win Percentage", description: "Strictly Win-Loss percentage. Ties excluded." },
  { value: "pts-custom", label: "Custom Points", description: "Custom points calculation." },
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
    standingsMethod: season.standingsMethod || "pts-pbla",
    gameLength: season.gameLength || 60,
    defaultLocation: season.defaultLocation || "",
    adminNotes: season.adminNotes || "",
    statsOnly: season.statsOnly || false,
    playoffTeams: season.playoffTeams as number | null,
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
        setTimeout(() => setSaved(false), 3000)
        router.refresh()
      } else {
        const data = await res.json()
        setError(data.error || "Failed to save")
      }
    } catch {
      setError("Connection error")
    } finally {
      setSaving(false)
    }
  }

  function promptStatusTransition(newStatus: string) {
    if (newStatus === "completed") {
      setConfirmDialog({
        open: true,
        status: "completed",
        title: "Mark season as completed?",
        description: "This is a permanent action that will close the books on this season. It will remain the 'current' season on the public site until you activate a new one.",
      })
    } else if (newStatus === "active") {
      setConfirmDialog({
        open: true,
        status: "active",
        title: "Activate this season?",
        description: "This will make it the current active season and lock season settings like team count, and playoff configuration.",
      })
    }
  }

  async function executeStatusTransition() {
    const newStatus = confirmDialog.status
    setConfirmDialog({ ...confirmDialog, open: false })
    setSaving(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${season.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        const data = await res.json()
        setError(data.error || "Failed to transition")
      }
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
                Check this if the season only tracks aggregate stats (no individual game schedules)
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

      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => !open && setConfirmDialog({ ...confirmDialog, open: false })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {confirmDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeStatusTransition} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Complete Season */}
      {season.status === "active" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Complete Season</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Mark this season as completed</p>
                <p className="text-xs text-muted-foreground">Closes the books on this season. It will remain the &lsquo;current&rsquo; season on the public site until you activate a new one.</p>
              </div>
              <Button
                onClick={() => promptStatusTransition("completed")}
                disabled={saving}
                variant="outline"
                size="sm"
                className="text-muted-foreground cursor-pointer shrink-0"
              >
                Complete Season
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
