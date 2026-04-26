"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"

const STEPS = ["Basics", "Teams", "Confirm"]

function suggestSeasonName(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  if (month >= 3 && month <= 8) return `${year} Summer`
  return `${year}-${year + 1}`
}

function suggestSeasonType(): "fall" | "summer" {
  const month = new Date().getMonth()
  return month >= 3 && month <= 8 ? "summer" : "fall"
}

export function SeasonWizard() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: suggestSeasonName(),
    seasonType: suggestSeasonType(),
    leagueId: "",
    teamCount: 7,
    teamCountUnknown: false,
    playoffTeams: 4,
  })

  function nextStep() {
    if (step < STEPS.length - 1) setStep(step + 1)
  }

  function prevStep() {
    if (step > 0) setStep(step - 1)
  }

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/bash/admin/seasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          seasonType: form.seasonType,
          leagueId: form.leagueId || null,
          teamCount: form.teamCountUnknown ? null : form.teamCount,
          playoffTeams: form.playoffTeams,
        }),
      })

      if (res.ok) {
        // The API returns { id, name, status }
        // Success: instead of pushing directly, we can show a success state or just push
        // The user requested to be returned to the all seasons page
        router.push("/admin/seasons")
        router.refresh()
      } else {
        const data = await res.json()
        setError(data.error || "Failed to create season")
      }
    } catch {
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Progress Dots */}
      <div className="flex items-center justify-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className={`h-2 w-2 rounded-full transition-colors ${
                  i <= step ? "bg-primary" : "bg-muted"
                }`}
              />
              <span
                className={`text-xs transition-colors ${
                  i <= step ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px ${i < step ? "bg-primary" : "bg-muted"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="pt-6">
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Season Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  autoFocus
                />
                <p className="text-[10px] text-muted-foreground">Auto-suggested based on current date</p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Season Type</Label>
                <RadioGroup
                  value={form.seasonType}
                  onValueChange={(v) => setForm((f) => ({ ...f, seasonType: v as "fall" | "summer" }))}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="fall" id="type-fall" />
                    <Label htmlFor="type-fall" className="text-sm cursor-pointer">Fall</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="summer" id="type-summer" />
                    <Label htmlFor="type-summer" className="text-sm cursor-pointer">Summer</Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">League ID (optional)</Label>
                <Input
                  value={form.leagueId}
                  onChange={(e) => setForm((f) => ({ ...f, leagueId: e.target.value }))}
                  placeholder="Sportability reference — can be added later"
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Number of Teams</Label>
                <Input
                  type="number"
                  min={2}
                  max={32}
                  value={form.teamCount}
                  onChange={(e) => setForm((f) => ({ ...f, teamCount: parseInt(e.target.value) || 2 }))}
                  disabled={form.teamCountUnknown}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="unknown-count"
                  checked={form.teamCountUnknown}
                  onCheckedChange={(c) => setForm((f) => ({ ...f, teamCountUnknown: !!c }))}
                />
                <Label htmlFor="unknown-count" className="text-sm text-muted-foreground cursor-pointer">
                  Team count hasn&apos;t been decided yet
                </Label>
              </div>

              <div className="space-y-2 mt-4 pt-4 border-t">
                <Label className="text-xs text-muted-foreground">Number of Playoff Teams</Label>
                <Input
                  type="number"
                  min={0}
                  max={16}
                  value={form.playoffTeams}
                  onChange={(e) => setForm((f) => ({ ...f, playoffTeams: parseInt(e.target.value) || 0 }))}
                />
                <p className="text-[10px] text-muted-foreground">
                  We will automatically create playoff placeholder teams (e.g. seed-1, seed-2)
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Review</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{form.name}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-medium capitalize">{form.seasonType}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Teams</span>
                  <span className="font-medium">
                    {form.teamCountUnknown ? "TBD" : form.teamCount}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Playoff Teams</span>
                  <span className="font-medium">{form.playoffTeams}</span>
                </div>
                {form.leagueId && (
                  <div className="flex justify-between py-1.5 border-b">
                    <span className="text-muted-foreground">League ID</span>
                    <span className="font-medium">{form.leagueId}</span>
                  </div>
                )}
                <div className="flex justify-between py-1.5">
                  <span className="text-muted-foreground">Status</span>
                  <span className="text-amber-700 font-medium">Draft</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={prevStep}
          disabled={step === 0}
          className="cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back
        </Button>

        {step < STEPS.length - 1 ? (
          <Button
            onClick={nextStep}
            disabled={!form.name}
            className="font-semibold cursor-pointer"
          >
            Next
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        ) : (
          <div className="flex items-center gap-3">
            {error && (
              <p className="text-xs text-destructive flex items-center gap-1">
                {error}
              </p>
            )}
            <Button
              onClick={handleCreate}
              disabled={creating || !form.name}
              className="font-semibold cursor-pointer"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Check className="h-4 w-4 mr-1.5" />
              )}
              Create Season
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
