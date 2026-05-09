"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, ArrowRight, Check, Loader2, Shuffle, GripVertical,
  Upload, X, FileCheck, Search, Crown, ArrowLeftRight, Plus, Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"

const STEPS_CREATE = ["Settings", "Player Pool", "Teams & Captains", "Draft Order", "Review & Create"]
const STEPS_CONFIGURE = ["Settings", "Teams & Captains", "Draft Order", "Review & Keepers"]

/** Lightweight roster player — fetched lazily for the captain picker */
interface RosterPlayer {
  playerId: number
  playerName: string
  teamSlug: string
  isCaptain?: boolean
}

/** Captain assignment: one player assigned as captain of one team */
interface CaptainAssignment {
  teamSlug: string
  playerId: number
  playerName: string
}

/**
 * Pre-draft pick swap between two teams.
 * `teamAOriginalOwner` identifies who originally owned the pick Team A is trading.
 * Defaults to teamASlug (their own pick), but differs for acquired/chain-traded picks.
 */
interface PreDraftTrade {
  teamASlug: string
  teamARound: number
  teamAOriginalOwner: string  // original slot owner — differs from teamASlug for acquired picks
  teamBSlug: string
  teamBRound: number
  teamBOriginalOwner: string  // original slot owner — differs from teamBSlug for acquired picks
}

interface ExistingDraftData {
  id: string
  name: string
  draftType: string
  rounds: number
  timerSeconds: number
  maxKeepers: number
  draftDate: string | null
  location: string | null
}

interface DraftWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  seasonId: string
  seasonType: string
  teams: { teamSlug: string; teamName: string; color?: string | null }[]
  rosterCount: number
  onComplete: () => void
  /** When provided, the wizard runs in "configure" mode — syncs season data and updates the existing draft */
  existingDraft?: ExistingDraftData | null
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
  teamOrder: { teamSlug: string; teamName: string; color?: string | null }[]
  captains: CaptainAssignment[]
  preDraftTrades: PreDraftTrade[]
}

function suggestDraftName(seasonType: string): string {
  const now = new Date()
  const year = now.getFullYear()
  if (seasonType === "summer") return `${year} Summer Draft`
  return `${year}-${year + 1} BASH Draft`
}

function parseDateFromISO(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "19:00" }
  try {
    const d = new Date(iso)
    return { date: d.toLocaleDateString("en-CA"), time: d.toTimeString().slice(0, 5) }
  } catch {
    return { date: "", time: "19:00" }
  }
}

export function DraftWizard({ open, onOpenChange, seasonId, seasonType, teams, rosterCount, onComplete, existingDraft }: DraftWizardProps) {
  const router = useRouter()
  const isConfigureMode = !!existingDraft
  const STEPS = isConfigureMode ? STEPS_CONFIGURE : STEPS_CREATE

  const [step, setStep] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [csvFile, setCsvFile] = useState<File | null>(null)

  // Suggested rounds: ceil(rosterCount / teamCount), minimum 1
  const suggestedRounds = teams.length > 0
    ? Math.max(1, Math.ceil(rosterCount / teams.length))
    : seasonType === "summer" ? 10 : 14

  // Roster players fetched lazily for captain picker
  const [rosterPlayers, setRosterPlayers] = useState<RosterPlayer[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)

  const defaultForm = (): WizardForm => {
    if (existingDraft) {
      const { date, time } = parseDateFromISO(existingDraft.draftDate)
      return {
        name: existingDraft.name,
        draftType: existingDraft.draftType as "snake" | "linear",
        rounds: existingDraft.rounds > 0 ? existingDraft.rounds : null,
        timerSeconds: existingDraft.timerSeconds,
        maxKeepers: existingDraft.maxKeepers,
        draftDate: date,
        draftTime: time,
        location: existingDraft.location || "",
        teamOrder: teams.map((t) => ({ ...t })),
        captains: [],
        preDraftTrades: [],
      }
    }
    return {
      name: suggestDraftName(seasonType),
      draftType: "snake",
      rounds: null,
      timerSeconds: 120,
      maxKeepers: seasonType === "summer" ? 1 : 8,
      draftDate: "",
      draftTime: "19:00",
      location: "",
      teamOrder: teams.map((t) => ({ ...t })),
      captains: [],
      preDraftTrades: [],
    }
  }

  const [form, setForm] = useState<WizardForm>(defaultForm)

  // Re-initialize form when the modal opens or existingDraft changes
  useEffect(() => {
    if (open) {
      setForm(defaultForm())
      setStep(0)
      setError(null)
      setRosterPlayers([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existingDraft?.id])

  // Fetch roster players when entering the Teams & Captains step
  const teamsCaptainsStepIndex = STEPS.indexOf("Teams & Captains")
  useEffect(() => {
    if (step === teamsCaptainsStepIndex && rosterPlayers.length === 0 && !rosterLoading) {
      setRosterLoading(true)
      fetch(`/api/bash/admin/seasons/${seasonId}/draft/roster-players`)
        .then(res => res.ok ? res.json() : { players: [] })
        .then(data => {
          const players = data.players || []
          setRosterPlayers(players)
          
          // Auto-populate captains if they aren't already set
          if (form.captains.length === 0) {
            const autoCaptains: CaptainAssignment[] = []
            players.forEach((p: RosterPlayer) => {
              if (p.isCaptain) {
                // Count how many captains already mapped for this team
                const teamCapCount = autoCaptains.filter(c => c.teamSlug === p.teamSlug).length
                if (teamCapCount < 2) { // Enforce max 2 captains per team
                  autoCaptains.push({
                    teamSlug: p.teamSlug,
                    playerId: p.playerId,
                    playerName: p.playerName
                  })
                }
              }
            })
            if (autoCaptains.length > 0) {
              setForm(f => ({ ...f, captains: autoCaptains }))
            }
          }
        })
        .catch(() => {})
        .finally(() => setRosterLoading(false))
    }
  }, [step, teamsCaptainsStepIndex, seasonId, rosterPlayers.length, rosterLoading, form.captains.length])

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

  async function handleSubmit() {
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

      if (isConfigureMode && existingDraft) {
        // ── Configure mode ──────────────────────────────────────────────
        // 1. Sync teams & pool from season (clears + recreates pool from roster)
        const syncRes = await fetch(
          `/api/bash/admin/seasons/${seasonId}/draft/${existingDraft.id}/sync`,
          { method: "POST" }
        )
        if (!syncRes.ok) {
          const err = await syncRes.json()
          throw new Error(err.error || "Failed to sync teams & roster from season")
        }

        // 2. Update draft settings + re-apply the wizard's custom team order
        //    (sync recreates team order from season_teams in default order,
        //     so we must overwrite it with the wizard's ordered list)
        const putRes = await fetch(
          `/api/bash/admin/seasons/${seasonId}/draft/${existingDraft.id}`,
          {
            method: "PUT",
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
          }
        )
        if (!putRes.ok) {
          const err = await putRes.json()
          throw new Error(err.error || "Failed to update draft settings")
        }

        // 3. Save captain designations to playerSeasons.isCaptain
        const capRes = await fetch(
          `/api/bash/admin/seasons/${seasonId}/draft/${existingDraft.id}/captains`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ captains: form.captains }),
          }
        )
        if (!capRes.ok) {
          const err = await capRes.json()
          throw new Error(err.error || "Failed to save captain assignments")
        }

        // 4. Save pre-draft trades entered in the wizard
        if (form.preDraftTrades.length > 0) {
          for (const trade of form.preDraftTrades) {
            const tradeRes = await fetch(
              `/api/bash/admin/seasons/${seasonId}/draft/${existingDraft.id}/trade`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "pre_draft_pick_swap",
                  teamASlug: trade.teamASlug,
                  teamARound: trade.teamARound,
                  teamAOriginalOwner: trade.teamAOriginalOwner,
                  teamBSlug: trade.teamBSlug,
                  teamBRound: trade.teamBRound,
                  teamBOriginalOwner: trade.teamBOriginalOwner,
                }),
              }
            )
            if (!tradeRes.ok) {
              console.error("Failed to save pre-draft trade:", await tradeRes.text())
            }
          }
        }

        toast.success("Draft configured! Proceeding to keeper setup\u2026")
        onComplete()
        router.push(`/admin/seasons/${seasonId}/draft/${existingDraft.id}/board`)
      } else {
        // ── Create mode ─────────────────────────────────────────────────
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
            captains: form.captains,
            preDraftTrades: form.preDraftTrades,
          }),
        })

        if (res.ok) {
          const draftData = await res.json()
          const newDraftId = draftData.draft?.id
          if (csvFile && newDraftId) {
            try {
              const previewForm = new FormData()
              previewForm.append("file", csvFile)
              const previewRes = await fetch(
                `/api/bash/admin/seasons/${seasonId}/draft/${newDraftId}/pool/import-csv?action=preview`,
                { method: "POST", body: previewForm }
              )
              if (previewRes.ok) {
                const previewData = await previewRes.json()
                const confirmRes = await fetch(
                  `/api/bash/admin/seasons/${seasonId}/draft/${newDraftId}/pool/import-csv?action=confirm`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ players: previewData.mappedPlayers, mode: "append" }),
                  }
                )
                if (confirmRes.ok) {
                  const importResult = await confirmRes.json()
                  toast.success(`Draft created! CSV imported: ${importResult.added} added, ${importResult.skipped} enriched.`)
                } else {
                  toast.success("Draft created! CSV import had an issue \u2014 you can retry from the draft card.")
                }
              } else {
                toast.success("Draft created! CSV parsing failed \u2014 you can retry from the draft card.")
              }
            } catch {
              toast.success("Draft created! CSV import failed \u2014 you can retry from the draft card.")
            }
          } else {
            toast.success("Draft created!")
          }
          onComplete()
          setStep(0)
          setCsvFile(null)
          setForm(defaultForm())
        } else {
          const data = await res.json()
          setError(data.error || "Failed to create draft")
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred."
      setError(message)
    } finally {
      setCreating(false)
    }
  }
  const currentStepName = STEPS[step]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isConfigureMode ? "Configure Draft" : "Create Draft"}</DialogTitle>
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
          Step {step + 1}: {currentStepName}
        </p>

        {/* Step Content — rendered by step name for mode-independence */}
        <div className="space-y-4 min-h-[200px]">
          {currentStepName === "Settings" && <StepSettings form={form} setForm={setForm} seasonType={seasonType} rosterCount={rosterCount} teamCount={teams.length} suggestedRounds={suggestedRounds} />}
          {currentStepName === "Player Pool" && <StepPool rosterCount={rosterCount} teamCount={teams.length} csvFile={csvFile} onCsvFileChange={setCsvFile} />}
          {currentStepName === "Teams & Captains" && (
            <StepTeamsCaptains
              teams={form.teamOrder}
              captains={form.captains}
              rosterPlayers={rosterPlayers}
              rosterLoading={rosterLoading}
              onCaptainsChange={(c) => setForm(f => ({ ...f, captains: c }))}
            />
          )}
          {currentStepName === "Draft Order" && (
            <StepOrderTrades
              teamOrder={form.teamOrder}
              preDraftTrades={form.preDraftTrades}
              resolvedRounds={form.rounds ?? suggestedRounds}
              onRandomize={randomizeOrder}
              onMove={moveTeam}
              onTradesChange={(t) => setForm(f => ({ ...f, preDraftTrades: t }))}
            />
          )}
          {(currentStepName === "Review & Create" || currentStepName === "Review & Keepers") && <StepReview form={form} rosterCount={rosterCount} suggestedRounds={suggestedRounds} />}
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
            <Button size="sm" onClick={handleSubmit} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {isConfigureMode ? "Save & Set Keepers" : "Create Draft"}
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

function StepPool({ rosterCount, teamCount, csvFile, onCsvFileChange }: {
  rosterCount: number
  teamCount: number
  csvFile: File | null
  onCsvFileChange: (file: File | null) => void
}) {
  const suggestedRounds = teamCount > 0 ? Math.max(1, Math.ceil(rosterCount / teamCount)) : 0
  const fileInputRef = useRef<HTMLInputElement>(null)

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
        <p className="text-sm font-medium mb-2">Sportability CSV Import (optional)</p>
        <p className="text-xs text-muted-foreground mb-3">
          Upload a Sportability registration CSV to enrich pool players with skill levels, positions, and other registration data. The CSV will be imported automatically after the draft is created.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onCsvFileChange(f)
          }}
        />

        {csvFile ? (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800">
            <FileCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-sm text-emerald-800 dark:text-emerald-200 flex-1 truncate">{csvFile.name}</span>
            <button
              type="button"
              onClick={() => {
                onCsvFileChange(null)
                if (fileInputRef.current) fileInputRef.current.value = ""
              }}
              className="p-0.5 rounded-sm hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors"
            >
              <X className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            </button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Select CSV File
          </Button>
        )}
      </div>
    </div>
  )
}

function StepTeamsCaptains({
  teams,
  captains,
  rosterPlayers,
  rosterLoading,
  onCaptainsChange,
}: {
  teams: { teamSlug: string; teamName: string; color?: string | null }[]
  captains: CaptainAssignment[]
  rosterPlayers: RosterPlayer[]
  rosterLoading: boolean
  onCaptainsChange: (captains: CaptainAssignment[]) => void
}) {
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({})
  const [focusedTeam, setFocusedTeam] = useState<string | null>(null)

  const MAX_CAPTAINS_PER_TEAM = 2

  if (teams.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground border rounded-md border-dashed">
        No teams assigned to this season yet. Add teams in the Teams tab first.
      </div>
    )
  }

  /** Get all captains assigned to a given team */
  const getCaptains = (teamSlug: string) => captains.filter(c => c.teamSlug === teamSlug)

  /** Add a captain to a team (up to MAX_CAPTAINS_PER_TEAM) */
  const addCaptain = (teamSlug: string, player: RosterPlayer) => {
    const teamCaptains = getCaptains(teamSlug)
    if (teamCaptains.length >= MAX_CAPTAINS_PER_TEAM) return
    onCaptainsChange([
      ...captains,
      { teamSlug, playerId: player.playerId, playerName: player.playerName },
    ])
    // Clear search and focus for this team after selection
    setSearchTerms(prev => ({ ...prev, [teamSlug]: "" }))
    setFocusedTeam(null)
  }

  /** Remove a specific captain from a team */
  const removeCaptain = (teamSlug: string, playerId: number) => {
    onCaptainsChange(captains.filter(c => !(c.teamSlug === teamSlug && c.playerId === playerId)))
  }

  /** Filter roster players for search — exclude already-assigned captains across all teams, sort isCaptain first */
  const getFilteredPlayers = (teamSlug: string) => {
    const term = (searchTerms[teamSlug] || "").toLowerCase()
    const assignedIds = new Set(captains.map(c => c.playerId))
    const list = rosterPlayers
      .filter(p => !assignedIds.has(p.playerId))
      .filter(p => !term || p.playerName.toLowerCase().includes(term))
      
    // Sort so that isCaptain=true are first, then alphabetical
    list.sort((a, b) => {
      // Prioritize captains for *this* specific team if we know their team
      const aIsTeamCap = a.isCaptain && a.teamSlug === teamSlug
      const bIsTeamCap = b.isCaptain && b.teamSlug === teamSlug
      if (aIsTeamCap && !bIsTeamCap) return -1
      if (!aIsTeamCap && bIsTeamCap) return 1

      // Then prioritize any captain
      if (a.isCaptain && !b.isCaptain) return -1
      if (!a.isCaptain && b.isCaptain) return 1

      return a.playerName.localeCompare(b.playerName)
    })
    
    return list.slice(0, 8) // Limit dropdown results
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Assign up to {MAX_CAPTAINS_PER_TEAM} captains per team. Captains become mandatory keepers in the draft.
          {rosterLoading && <span className="ml-1 text-muted-foreground/60">(Loading roster…)</span>}
        </p>
        <p className="text-[11px] text-muted-foreground/80 italic">
          Note: If captains have changed, update them here. This will automatically update the official team captains for the season.
        </p>
      </div>
      <div className="space-y-2">
        {teams.map(t => {
          const teamCaptains = getCaptains(t.teamSlug)
          const search = searchTerms[t.teamSlug] || ""
          const isFocused = focusedTeam === t.teamSlug
          const canAddMore = teamCaptains.length < MAX_CAPTAINS_PER_TEAM
          const showSearch = canAddMore && rosterPlayers.length > 0
          const filtered = showSearch && (search.length > 0 || isFocused) ? getFilteredPlayers(t.teamSlug) : []

          return (
            <div key={t.teamSlug} className="border rounded-md p-2.5 space-y-2" style={{ borderLeftWidth: t.color ? '3px' : undefined, borderLeftColor: t.color || undefined }}>
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold shrink-0" style={{ backgroundColor: t.color ? `${t.color}20` : undefined, color: t.color || undefined }} >
                  {t.teamName.charAt(0)}
                </div>
                <span className="text-sm font-medium flex-1">{t.teamName}</span>
                {/* Show all assigned captain badges */}
                {teamCaptains.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    {teamCaptains.map(cap => (
                      <div key={cap.playerId} className="flex items-center gap-0.5">
                        <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 gap-1">
                          <Crown className="h-3 w-3" />
                          {cap.playerName}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => removeCaptain(t.teamSlug, cap.playerId)}
                          className="p-0.5 rounded hover:bg-muted transition-colors"
                        >
                          <X className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Captain search input — shown while under the captain limit */}
              {showSearch && (
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder={teamCaptains.length === 0 ? "Search player to assign as captain…" : "Search for a 2nd captain…"}
                    className="h-8 pl-7 text-xs"
                    value={search}
                    onFocus={() => setFocusedTeam(t.teamSlug)}
                    onBlur={() => {
                      // Small timeout to allow click to register on dropdown buttons
                      setTimeout(() => {
                        setFocusedTeam(null)
                      }, 150)
                    }}
                    onChange={(e) => setSearchTerms(prev => ({ ...prev, [t.teamSlug]: e.target.value }))}
                  />
                  {/* Dropdown results */}
                  {filtered.length > 0 && (
                    <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-background border rounded-md shadow-lg max-h-32 overflow-y-auto">
                      {filtered.map(p => (
                        <button
                          key={p.playerId}
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center justify-between"
                          onClick={() => addCaptain(t.teamSlug, p)}
                        >
                          <span>{p.playerName}</span>
                          {p.isCaptain && (
                            <Badge variant="outline" className="text-[9px] h-4 leading-none bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 py-0">
                              Captain
                            </Badge>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Loading placeholder */}
              {teamCaptains.length === 0 && rosterPlayers.length === 0 && rosterLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading roster players…
                </div>
              )}
              {/* Empty roster — no player_seasons exist yet (new season) */}
              {teamCaptains.length === 0 && rosterPlayers.length === 0 && !rosterLoading && (
                <p className="text-[11px] text-muted-foreground/70 italic py-0.5">
                  No roster players yet — captains can be assigned after draft creation.
                </p>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Captain designation is optional during wizard setup. You can also assign captains after creation.
      </p>
    </div>
  )
}

function StepOrderTrades({
  teamOrder,
  preDraftTrades,
  resolvedRounds,
  onRandomize,
  onMove,
  onTradesChange,
}: {
  teamOrder: { teamSlug: string; teamName: string; color?: string | null }[]
  preDraftTrades: PreDraftTrade[]
  resolvedRounds: number
  onRandomize: () => void
  onMove: (index: number, direction: "up" | "down") => void
  onTradesChange: (trades: PreDraftTrade[]) => void
}) {
  const teamSlugs = teamOrder.map(t => t.teamSlug)
  const teamNameMap: Record<string, string> = {}
  teamOrder.forEach(t => { teamNameMap[t.teamSlug] = t.teamName })

  /**
   * Compute pick ownership state BEFORE a given trade index.
   * Used to show "(via Team)" annotations for acquired picks.
   */
  const getOwnershipBefore = (tradeIndex: number): Map<string, string> => {
    const ownership = new Map<string, string>()
    for (const slug of teamSlugs) {
      for (let r = 1; r <= resolvedRounds; r++) {
        ownership.set(`${slug}::${r}`, slug)
      }
    }
    // Process trades [0..tradeIndex-1]
    for (let i = 0; i < tradeIndex; i++) {
      const t = preDraftTrades[i]
      const keyA = `${t.teamAOriginalOwner}::${t.teamARound}`
      const keyB = `${t.teamBOriginalOwner}::${t.teamBRound}`
      const ownerA = ownership.get(keyA)
      const ownerB = ownership.get(keyB)
      if (ownerA !== undefined && ownerB !== undefined) {
        ownership.set(keyA, ownerB)
        ownership.set(keyB, ownerA)
      }
    }
    return ownership
  }

  /**
   * For a given trade, check if either side involves an acquired pick
   * and return the original owner's team name for the "(via X)" label.
   */
  const getViaLabels = (tradeIndex: number) => {
    const trade = preDraftTrades[tradeIndex]
    return {
      sideA: trade.teamAOriginalOwner !== trade.teamASlug
        ? teamNameMap[trade.teamAOriginalOwner] || trade.teamAOriginalOwner
        : null,
      sideB: trade.teamBOriginalOwner !== trade.teamBSlug
        ? teamNameMap[trade.teamBOriginalOwner] || trade.teamBOriginalOwner
        : null,
    }
  }

  /**
   * Find picks currently owned by a team at a given trade index.
   * Returns list of { originalOwner, round } for populating the "acquired picks" options.
   */
  const getPicksOwnedByTeam = (teamSlug: string, tradeIndex: number) => {
    const ownership = getOwnershipBefore(tradeIndex)
    const picks: { originalOwner: string; round: number }[] = []
    for (const [key, owner] of ownership) {
      if (owner === teamSlug) {
        const [orig, rd] = key.split("::")
        picks.push({ originalOwner: orig, round: parseInt(rd) })
      }
    }
    picks.sort((a, b) => a.round - b.round)
    return picks
  }

  /** Find the first round still owned by a team that isn't already being traded away */
  const getNextAvailableRound = (teamSlug: string, atTradeIndex: number) => {
    const owned = getPicksOwnedByTeam(teamSlug, atTradeIndex)
    // Rounds already committed in other trades for this team
    const committedKeys = new Set<string>()
    for (let i = 0; i < preDraftTrades.length; i++) {
      if (i >= atTradeIndex) continue // only consider trades before this one
      const t = preDraftTrades[i]
      if (t.teamASlug === teamSlug) committedKeys.add(`${t.teamAOriginalOwner}::${t.teamARound}`)
      if (t.teamBSlug === teamSlug) committedKeys.add(`${t.teamBOriginalOwner}::${t.teamBRound}`)
    }
    const available = owned.filter((p) => !committedKeys.has(`${p.originalOwner}::${p.round}`))
    return available.length > 0 ? available[0] : owned[0] // fallback to first owned
  }

  const addTrade = () => {
    if (teamOrder.length < 2) return
    const newIndex = preDraftTrades.length
    const teamA = teamOrder[0].teamSlug
    const teamB = teamOrder[1].teamSlug
    const pickA = getNextAvailableRound(teamA, newIndex)
    const pickB = getNextAvailableRound(teamB, newIndex)
    onTradesChange([
      ...preDraftTrades,
      {
        teamASlug: teamA,
        teamARound: pickA?.round ?? 1,
        teamAOriginalOwner: pickA?.originalOwner ?? teamA,
        teamBSlug: teamB,
        teamBRound: pickB?.round ?? 1,
        teamBOriginalOwner: pickB?.originalOwner ?? teamB,
      },
    ])
  }

  /** Update a trade field, auto-syncing originalOwner and default round when team changes */
  const updateTrade = (index: number, field: keyof PreDraftTrade, value: string | number) => {
    const updated = [...preDraftTrades]
    const trade = { ...updated[index], [field]: value }

    // When the team changes, auto-default to that team's next available pick
    if (field === "teamASlug") {
      const pick = getNextAvailableRound(value as string, index)
      trade.teamAOriginalOwner = pick?.originalOwner ?? (value as string)
      trade.teamARound = pick?.round ?? 1
    }
    if (field === "teamBSlug") {
      const pick = getNextAvailableRound(value as string, index)
      trade.teamBOriginalOwner = pick?.originalOwner ?? (value as string)
      trade.teamBRound = pick?.round ?? 1
    }

    updated[index] = trade
    onTradesChange(updated)
  }

  /** Update the pick being traded (round + originalOwner together) */
  const updateTradePick = (index: number, side: "A" | "B", pickKey: string) => {
    const [originalOwner, roundStr] = pickKey.split("::")
    const updated = [...preDraftTrades]
    if (side === "A") {
      updated[index] = { ...updated[index], teamAOriginalOwner: originalOwner, teamARound: parseInt(roundStr) }
    } else {
      updated[index] = { ...updated[index], teamBOriginalOwner: originalOwner, teamBRound: parseInt(roundStr) }
    }
    onTradesChange(updated)
  }

  const removeTrade = (index: number) => {
    onTradesChange(preDraftTrades.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-5">
      {/* Draft Order Section */}
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
            <div key={t.teamSlug} className="flex items-center gap-2 p-2 border rounded-md group" style={{ borderLeftWidth: t.color ? '3px' : undefined, borderLeftColor: t.color || undefined }}>
              <span className="w-6 text-center text-xs font-mono text-muted-foreground">{i + 1}</span>
              <GripVertical className="h-4 w-4 text-muted-foreground/50" />
              <span className="text-sm font-medium flex-1">{t.teamName}</span>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMove(i, "up")} disabled={i === 0}>↑</Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMove(i, "down")} disabled={i === teamOrder.length - 1}>↓</Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pre-Draft Trades Section */}
      <div className="space-y-3 pt-3 border-t">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Pre-Draft Pick Swaps
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Configure pick trades agreed upon before draft day. Trades are processed in order.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={addTrade} disabled={teamOrder.length < 2}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Swap
          </Button>
        </div>

        {preDraftTrades.length === 0 ? (
          <div className="text-center py-4 text-xs text-muted-foreground border rounded-md border-dashed">
            No pre-draft pick swaps configured. This is optional.
          </div>
        ) : (
          <div className="space-y-2">
            {preDraftTrades.map((trade, i) => {
              const viaLabels = getViaLabels(i)
              const picksA = getPicksOwnedByTeam(trade.teamASlug, i)
              const picksB = getPicksOwnedByTeam(trade.teamBSlug, i)
              const currentPickKeyA = `${trade.teamAOriginalOwner}::${trade.teamARound}`
              const currentPickKeyB = `${trade.teamBOriginalOwner}::${trade.teamBRound}`

              return (
                <div key={i} className="border rounded-md bg-muted/30">
                  {/* Trade header */}
                  <div className="px-2.5 pt-2 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Trade {i + 1}
                  </div>
                  <div className="flex items-center gap-2 px-2.5 pb-2.5">
                    {/* Side A: Team + Pick */}
                    <div className="flex-1 space-y-1">
                      <Select value={trade.teamASlug} onValueChange={(v) => updateTrade(i, "teamASlug", v)}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {teamOrder.map(t => (
                            <SelectItem key={t.teamSlug} value={t.teamSlug} className="text-xs">{t.teamName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={currentPickKeyA} onValueChange={(v) => updateTradePick(i, "A", v)}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Select pick" />
                        </SelectTrigger>
                        <SelectContent>
                          {picksA.map(p => {
                            const isAcquired = p.originalOwner !== trade.teamASlug
                            const label = isAcquired
                              ? `Rd ${p.round} (via ${teamNameMap[p.originalOwner] || p.originalOwner})`
                              : `Rd ${p.round}`
                            return (
                              <SelectItem key={`${p.originalOwner}::${p.round}`} value={`${p.originalOwner}::${p.round}`} className="text-xs">
                                {label}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                      {viaLabels.sideA && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 pl-1">via {viaLabels.sideA}</p>
                      )}
                    </div>

                    {/* Swap icon */}
                    <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0" />

                    {/* Side B: Team + Pick */}
                    <div className="flex-1 space-y-1">
                      <Select value={trade.teamBSlug} onValueChange={(v) => updateTrade(i, "teamBSlug", v)}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {teamOrder.map(t => (
                            <SelectItem key={t.teamSlug} value={t.teamSlug} className="text-xs">{t.teamName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={currentPickKeyB} onValueChange={(v) => updateTradePick(i, "B", v)}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Select pick" />
                        </SelectTrigger>
                        <SelectContent>
                          {picksB.map(p => {
                            const isAcquired = p.originalOwner !== trade.teamBSlug
                            const label = isAcquired
                              ? `Rd ${p.round} (via ${teamNameMap[p.originalOwner] || p.originalOwner})`
                              : `Rd ${p.round}`
                            return (
                              <SelectItem key={`${p.originalOwner}::${p.round}`} value={`${p.originalOwner}::${p.round}`} className="text-xs">
                                {label}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                      {viaLabels.sideB && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 pl-1">via {viaLabels.sideB}</p>
                      )}
                    </div>

                    {/* Remove */}
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeTrade(i)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
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
        <ReviewItem label="Captains" value={form.captains.length > 0 ? form.captains.length : "None"} />
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
            <span key={t.teamSlug} className="text-xs px-2 py-1 rounded-md" style={{ backgroundColor: t.color ? `${t.color}15` : undefined, borderLeft: t.color ? `3px solid ${t.color}` : undefined }}>
              {i + 1}. {t.teamName}
            </span>
          ))}
        </div>
      </div>

      {form.preDraftTrades.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pre-Draft Pick Swaps</p>
          <div className="space-y-1">
            {form.preDraftTrades.map((trade, i) => {
              const teamA = form.teamOrder.find(t => t.teamSlug === trade.teamASlug)?.teamName || trade.teamASlug
              const teamB = form.teamOrder.find(t => t.teamSlug === trade.teamBSlug)?.teamName || trade.teamBSlug
              const viaA = trade.teamAOriginalOwner !== trade.teamASlug
                ? form.teamOrder.find(t => t.teamSlug === trade.teamAOriginalOwner)?.teamName || trade.teamAOriginalOwner
                : null
              const viaB = trade.teamBOriginalOwner !== trade.teamBSlug
                ? form.teamOrder.find(t => t.teamSlug === trade.teamBOriginalOwner)?.teamName || trade.teamBOriginalOwner
                : null
              return (
                <div key={i} className="text-xs bg-muted/50 px-2 py-1.5 rounded-md flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">{teamA}</span>
                  <span>Rd {trade.teamARound}</span>
                  {viaA && <span className="text-amber-600 dark:text-amber-400">(via {viaA})</span>}
                  <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">{teamB}</span>
                  <span>Rd {trade.teamBRound}</span>
                  {viaB && <span className="text-amber-600 dark:text-amber-400">(via {viaB})</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

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
