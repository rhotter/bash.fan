"use client"

import { useState } from "react"
import { ArrowLeft, ArrowRight, Check, Loader2, Shuffle, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "sonner"

const STEPS = ["Settings", "Player Pool", "Teams & Captains", "Draft Order", "Review & Create"]

interface DraftWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  seasonId: string
  seasonType: string
  teams: { teamSlug: string; teamName: string }[]
  rosterCount: number
  onComplete: () => void
}

interface WizardForm {
  name: string
  draftType: "snake" | "linear"
  rounds: number | null
  timerSeconds: number
  maxKeepers: number
  draftDate: string
  draftTime: string
  location: string
  teamOrder: { teamSlug: string; teamName: string }[]
}

function suggestDraftName(seasonType: string): string {
  const now = new Date()
  const year = now.getFullYear()
  if (seasonType === "summer") return `${year} Summer Draft`
  return `${year}-${year + 1} BASH Draft`
}

export function DraftWizard({ open, onOpenChange, seasonId, seasonType, teams, rosterCount, onComplete }: DraftWizardProps) {
  const [step, setStep] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Suggested rounds: ceil(rosterCount / teamCount), minimum 1
  const suggestedRounds = teams.length > 0
    ? Math.max(1, Math.ceil(rosterCount / teams.length))
    : seasonType === "summer" ? 10 : 14

  const [form, setForm] = useState<WizardForm>({
    name: suggestDraftName(seasonType),
    draftType: "snake",
    rounds: null,
    timerSeconds: 120,
    maxKeepers: seasonType === "summer" ? 1 : 8,
    draftDate: "",
    draftTime: "19:00",
    location: "",
    teamOrder: teams.map((t) => ({ ...t })),
  })

  const canNext = () => {
    if (step === 0) return !!form.name && form.timerSeconds > 0
    return true
  }

  function nextStep() {
    if (step < STEPS.length - 1 && canNext()) setStep(step + 1)
  }

  function prevStep() {
    if (step > 0) setStep(step - 1)
  }

  function randomizeOrder() {
    setForm(f => {
      const shuffled = [...f.teamOrder]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      return { ...f, teamOrder: shuffled }
    })
  }

  function moveTeam(fromIndex: number, direction: "up" | "down") {
    const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1
    if (toIndex < 0 || toIndex >= form.teamOrder.length) return
    setForm(f => {
      const order = [...f.teamOrder];
      [order[fromIndex], order[toIndex]] = [order[toIndex], order[fromIndex]]
      return { ...f, teamOrder: order }
    })
  }

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      // Combine date and time
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
          rounds: form.rounds ?? suggestedRounds,
          timerSeconds: form.timerSeconds,
          maxKeepers: form.maxKeepers,
          draftDate,
          location: form.location || null,
          teams: form.teamOrder.map((t, i) => ({
            teamSlug: t.teamSlug,
            position: i + 1,
          })),
        }),
      })

      if (res.ok) {
        toast.success("Draft created!")
        onComplete()
        // Reset wizard
        setStep(0)
        setForm({
          name: suggestDraftName(seasonType),
          draftType: "snake",
          rounds: null,
          timerSeconds: 120,
          maxKeepers: seasonType === "summer" ? 1 : 8,
          draftDate: "",
          draftTime: "19:00",
          location: "",
          teamOrder: teams.map((t) => ({ ...t })),
        })
      } else {
        const data = await res.json()
        setError(data.error || "Failed to create draft")
      }
    } catch {
      setError("An unexpected error occurred.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Draft</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div
                className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-colors ${
                  i <= step
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 ${i < step ? "bg-primary" : "bg-muted"}`} />
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Step {step + 1}: {STEPS[step]}
        </p>

        {/* Step Content */}
        <div className="space-y-4 min-h-[200px]">
          {step === 0 && <StepSettings form={form} setForm={setForm} seasonType={seasonType} rosterCount={rosterCount} teamCount={teams.length} suggestedRounds={suggestedRounds} />}
          {step === 1 && <StepPool rosterCount={rosterCount} teamCount={teams.length} />}
          {step === 2 && <StepTeams teams={form.teamOrder} />}
          {step === 3 && (
            <StepOrder
              teamOrder={form.teamOrder}
              onRandomize={randomizeOrder}
              onMove={moveTeam}
            />
          )}
          {step === 4 && <StepReview form={form} rosterCount={rosterCount} suggestedRounds={suggestedRounds} />}
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-2 border-t">
          <Button variant="ghost" size="sm" onClick={prevStep} disabled={step === 0}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button size="sm" onClick={nextStep} disabled={!canNext()}>
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Create Draft
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Step Components ──────────────────────────────────────────────────────────

function StepSettings({
  form, setForm, seasonType: _seasonType, rosterCount, teamCount, suggestedRounds,
}: {
  form: WizardForm
  setForm: React.Dispatch<React.SetStateAction<WizardForm>>
  seasonType: string
  rosterCount: number
  teamCount: number
  suggestedRounds: number
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Draft Name</Label>
        <Input
          value={form.name}
          onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="e.g. 2026-2027 BASH Draft"
        />
      </div>

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

      <div className="space-y-2">
        <Label>Location</Label>
        <Input
          value={form.location}
          onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))}
          placeholder="e.g. The Connecticut Yankee"
        />
      </div>

      <div className="space-y-2">
        <Label>Draft Format</Label>
        <RadioGroup
          value={form.draftType}
          onValueChange={(v) => setForm(f => ({ ...f, draftType: v as "snake" | "linear" }))}
          className="flex gap-4"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="snake" id="snake" />
            <Label htmlFor="snake" className="font-normal cursor-pointer">Snake</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="linear" id="linear" />
            <Label htmlFor="linear" className="font-normal cursor-pointer">Linear</Label>
          </div>
        </RadioGroup>
        <p className="text-[10px] text-muted-foreground">
          Snake: even rounds reverse order. Linear: same order every round.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Rounds</Label>
          <Input
            type="number"
            min={1}
            max={30}
            value={form.rounds ?? ""}
            placeholder={String(suggestedRounds)}
            onChange={(e) => {
              const val = e.target.value
              setForm(f => ({ ...f, rounds: val === "" ? null : (parseInt(val) || null) }))
            }}
          />
          <p className="text-[10px] text-muted-foreground">
            {form.rounds === null
              ? `Auto: ${suggestedRounds} (${rosterCount} ÷ ${teamCount} teams)`
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
  )
}

function StepPool({ rosterCount, teamCount }: { rosterCount: number; teamCount: number }) {
  const suggestedRounds = teamCount > 0 ? Math.max(1, Math.ceil(rosterCount / teamCount)) : 0
  return (
    <div className="space-y-4">
      <div className="p-4 border rounded-md bg-muted/30">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="p-3 rounded-md bg-background">
            <p className="text-2xl font-bold">{rosterCount}</p>
            <p className="text-xs text-muted-foreground">Season Roster Players</p>
          </div>
          <div className="p-3 rounded-md bg-background">
            <p className="text-2xl font-bold">{suggestedRounds}</p>
            <p className="text-xs text-muted-foreground">Suggested Rounds</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          All <strong>{rosterCount}</strong> players currently on the season roster will be automatically added to the draft pool.
        </p>
      </div>

      <div className="border rounded-md border-dashed p-4">
        <p className="text-sm font-medium mb-1">Sportability CSV Import (optional)</p>
        <p className="text-xs text-muted-foreground">
          After creating the draft, you can import a Sportability registration CSV to enrich pool players with skill levels, positions, game commitment, and other registration data. This is available via the <strong>Import CSV</strong> button on the draft card.
        </p>
      </div>
    </div>
  )
}

function StepTeams({ teams }: { teams: { teamSlug: string; teamName: string }[] }) {
  if (teams.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground border rounded-md border-dashed">
        No teams assigned to this season yet. Add teams in the Teams tab first.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        These teams from the season will participate in the draft. Captain designation is available after creation.
      </p>
      <div className="space-y-2">
        {teams.map(t => (
          <div key={t.teamSlug} className="flex items-center gap-3 p-2.5 border rounded-md">
            <div className="w-7 h-7 rounded bg-muted flex items-center justify-center text-xs font-bold">
              {t.teamName.charAt(0)}
            </div>
            <span className="text-sm font-medium">{t.teamName}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function StepOrder({
  teamOrder,
  onRandomize,
  onMove,
}: {
  teamOrder: { teamSlug: string; teamName: string }[]
  onRandomize: () => void
  onMove: (index: number, direction: "up" | "down") => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">First pick at top, last pick at bottom.</p>
        <Button variant="outline" size="sm" onClick={onRandomize}>
          <Shuffle className="h-3.5 w-3.5 mr-1.5" />
          Randomize
        </Button>
      </div>
      <div className="space-y-1.5">
        {teamOrder.map((t, i) => (
          <div key={t.teamSlug} className="flex items-center gap-2 p-2 border rounded-md group">
            <span className="w-6 text-center text-xs font-mono text-muted-foreground">{i + 1}</span>
            <GripVertical className="h-4 w-4 text-muted-foreground/50" />
            <span className="text-sm font-medium flex-1">{t.teamName}</span>
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onMove(i, "up")}
                disabled={i === 0}
              >
                ↑
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onMove(i, "down")}
                disabled={i === teamOrder.length - 1}
              >
                ↓
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StepReview({ form, rosterCount, suggestedRounds }: { form: WizardForm; rosterCount: number; suggestedRounds: number }) {
  const resolvedRounds = form.rounds ?? suggestedRounds
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <ReviewItem label="Name" value={form.name} />
        <ReviewItem label="Format" value={form.draftType === "snake" ? "Snake" : "Linear"} />
        <ReviewItem label="Rounds" value={form.rounds === null ? `${resolvedRounds} (auto)` : resolvedRounds} />
        <ReviewItem label="Timer" value={`${form.timerSeconds}s`} />
        <ReviewItem label="Max Keepers" value={form.maxKeepers} />
        <ReviewItem label="Teams" value={form.teamOrder.length} />
        <ReviewItem label="Pool Size" value={rosterCount} />
        {form.draftDate && (
          <ReviewItem
            label="Date"
            value={`${new Date(form.draftDate).toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric",
            })} at ${form.draftTime || "19:00"}`}
          />
        )}
        {form.location && <ReviewItem label="Location" value={form.location} />}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Draft Order</p>
        <div className="flex flex-wrap gap-1.5">
          {form.teamOrder.map((t, i) => (
            <span key={t.teamSlug} className="text-xs bg-muted px-2 py-1 rounded-md">
              {i + 1}. {t.teamName}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        The draft will be created in <strong>draft</strong> status with <strong>{rosterCount}</strong> players auto-added to the pool from the season roster. You can enrich with Sportability CSV data and edit all settings before publishing.
      </p>
    </div>
  )
}

function ReviewItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-muted/50 p-2 rounded-md">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}
