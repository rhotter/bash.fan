"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Check, AlertTriangle, HelpCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

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
  }
}

export function SeasonForm({ season }: SeasonFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")

  const [form, setForm] = useState({
    name: season.name,
    seasonType: season.seasonType,
    leagueId: season.leagueId || "",
    standingsMethod: season.standingsMethod || "pts-pbla",
    gameLength: season.gameLength || 60,
    defaultLocation: season.defaultLocation || "",
    adminNotes: season.adminNotes || "",
    statsOnly: season.statsOnly || false,
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

  async function handleStatusTransition(newStatus: string) {
    if (!confirm(`Transition season to "${newStatus}"?`)) return
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
          {season.status === "draft" && (
            <Button
              onClick={() => handleStatusTransition("active")}
              disabled={saving}
              variant="outline"
              size="sm"
              className="text-green-700 border-green-300 hover:bg-green-50 cursor-pointer"
            >
              Activate Season
            </Button>
          )}
          {season.status === "active" && (
            <Button
              onClick={() => handleStatusTransition("completed")}
              disabled={saving}
              variant="outline"
              size="sm"
              className="text-muted-foreground cursor-pointer"
            >
              Mark Completed
            </Button>
          )}
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
    </div>
  )
}
