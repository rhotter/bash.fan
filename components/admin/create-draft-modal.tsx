"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { toast } from "sonner"

interface CreateDraftModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  seasonId: string
  seasonType: string
  rosterCount: number
  teamCount: number
  onComplete: () => void
}

function suggestDraftName(seasonType: string): string {
  const now = new Date()
  const year = now.getFullYear()
  if (seasonType === "summer") return `${year} Summer Draft`
  return `${year}-${year + 1} BASH Draft`
}

export function CreateDraftModal({
  open, onOpenChange, seasonId, seasonType, rosterCount, teamCount, onComplete,
}: CreateDraftModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suggestedRounds = teamCount > 0 && rosterCount > 0
    ? Math.max(1, Math.ceil(rosterCount / teamCount))
    : null

  const [form, setForm] = useState({
    name: suggestDraftName(seasonType),
    draftType: "snake" as "snake" | "linear",
    rounds: null as number | null,
    timerSeconds: 120,
    maxKeepers: seasonType === "summer" ? 1 : 8,
    draftDate: "",
    draftTime: "19:00",
    location: "",
  })

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      let draftDate: string | null = null
      if (form.draftDate) {
        const dateStr = form.draftTime
          ? `${form.draftDate}T${form.draftTime}:00`
          : `${form.draftDate}T18:00:00`
        draftDate = new Date(dateStr).toISOString()
      }

      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          draftType: form.draftType,
          rounds: form.rounds ?? suggestedRounds ?? 0,
          timerSeconds: form.timerSeconds,
          maxKeepers: form.maxKeepers,
          draftDate,
          location: form.location || null,
          teams: [],
          captains: [],
          preDraftTrades: [],
        }),
      })

      if (res.ok) {
        toast.success("Draft created! You can now publish it to announce the date, or continue setup once teams and roster are ready.")
        onComplete()
        setForm({
          name: suggestDraftName(seasonType),
          draftType: "snake",
          rounds: null,
          timerSeconds: 120,
          maxKeepers: seasonType === "summer" ? 1 : 8,
          draftDate: "",
          draftTime: "19:00",
          location: "",
        })
      } else {
        const data = await res.json()
        setError(data.error || "Failed to create draft")
      }
    } catch {
      setError("Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = !!form.name && form.timerSeconds > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Draft</DialogTitle>
          <DialogDescription>
            Set up the draft basics. You can publish immediately to announce the date, then configure teams, players, and captains later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Draft Name */}
          <div className="space-y-2">
            <Label>Draft Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. 2026 Summer Draft"
            />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={form.draftDate}
                onChange={(e) => setForm(f => ({ ...f, draftDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Time</Label>
              <Input
                type="time"
                value={form.draftTime}
                onChange={(e) => setForm(f => ({ ...f, draftTime: e.target.value }))}
              />
              <p className="text-[10px] text-muted-foreground">Default: 7:00 PM</p>
            </div>
          </div>

          {/* Location */}
          <div className="space-y-2">
            <Label>Location</Label>
            <Input
              value={form.location}
              onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))}
              placeholder="e.g. The Connecticut Yankee"
            />
          </div>

          {/* Draft Format */}
          <div className="space-y-2">
            <Label>Draft Format</Label>
            <RadioGroup
              value={form.draftType}
              onValueChange={(v) => setForm(f => ({ ...f, draftType: v as "snake" | "linear" }))}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="snake" id="create-snake" />
                <Label htmlFor="create-snake" className="font-normal cursor-pointer">Snake</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="linear" id="create-linear" />
                <Label htmlFor="create-linear" className="font-normal cursor-pointer">Linear</Label>
              </div>
            </RadioGroup>
            <p className="text-[10px] text-muted-foreground">
              Snake: even rounds reverse order. Linear: same order every round.
            </p>
          </div>

          {/* Rounds / Timer / Keepers */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Rounds</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={form.rounds ?? ""}
                placeholder={suggestedRounds ? String(suggestedRounds) : "TBD"}
                onChange={(e) => {
                  const val = e.target.value
                  setForm(f => ({ ...f, rounds: val === "" ? null : (parseInt(val) || null) }))
                }}
              />
              <p className="text-[10px] text-muted-foreground">
                {form.rounds === null && suggestedRounds
                  ? `Auto: ${suggestedRounds} (${rosterCount} ÷ ${teamCount} teams)`
                  : form.rounds === null
                    ? "Will be set once roster is imported"
                    : "Leave empty to auto-calculate"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Timer (sec)</Label>
              <Input
                type="number"
                min={30}
                max={600}
                step={30}
                value={form.timerSeconds}
                onChange={(e) => setForm(f => ({ ...f, timerSeconds: parseInt(e.target.value) || 120 }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Max Keepers</Label>
              <Input
                type="number"
                min={1}
                max={15}
                value={form.maxKeepers}
                onChange={(e) => setForm(f => ({ ...f, maxKeepers: parseInt(e.target.value) || 1 }))}
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving || !canSubmit}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Create Draft
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
