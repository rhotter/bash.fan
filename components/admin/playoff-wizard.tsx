"use client"

import { useState, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
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
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, Trophy, Loader2, ArrowRight } from "lucide-react"
import { generateBracket, type BracketGame } from "@/lib/schedule-utils"
import type { ScheduleGame } from "./season-schedule-tab"

interface PlayoffWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  teams: { teamSlug: string; teamName: string }[]
  seasonId: string
  defaultLocation: string
  lastRegularSeasonDate: string | null
  games: ScheduleGame[]
  onSaved: () => void
}

export function PlayoffWizard({
  open,
  onOpenChange,
  teams,
  seasonId,
  defaultLocation,
  lastRegularSeasonDate,
  games,
  onSaved,
}: PlayoffWizardProps) {
  const [step, setStep] = useState(1)
  const [wizardMode, setWizardMode] = useState<"generate" | "resolve">("generate")
  const [isSaving, setIsSaving] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // Step 2 (Generate): Format & Teams
  const usingPlaceholderTeams = teams.length < 2
  const [numTeams, setNumTeams] = useState(usingPlaceholderTeams ? 4 : Math.min(teams.length, 4))
  const [playIn, setPlayIn] = useState(false)
  const [quarterSeriesLength, setQuarterSeriesLength] = useState<1 | 3>(1)
  const [semiSeriesLength, setSemiSeriesLength] = useState<1 | 3>(1)
  const [finalSeriesLength, setFinalSeriesLength] = useState<1 | 3>(1)
  const [usePlaceholders, setUsePlaceholders] = useState(true)

  // Step 3 (Generate): Seeding — ordered list of team slugs
  const [seeds, setSeeds] = useState<string[]>(() =>
    usingPlaceholderTeams
      ? Array.from({ length: 8 }, (_, i) => `seed-${i + 1}`)
      : teams.slice(0, Math.min(teams.length, 8)).map((t) => t.teamSlug)
  )

  // Generated bracket
  const bracketGames = useMemo((): BracketGame[] => {
    return generateBracket({
      numTeams,
      playIn: playIn && numTeams % 2 !== 0,
      quarterSeriesLength,
      semiSeriesLength,
      finalSeriesLength,
      seeds: seeds.slice(0, numTeams),
      usePlaceholders,
      defaultLocation,
    })
  }, [numTeams, playIn, quarterSeriesLength, semiSeriesLength, finalSeriesLength, seeds, usePlaceholders, defaultLocation])

  // Step 4 (Generate): Game details
  const [gameDetails, setGameDetails] = useState<
    Record<string, { date: string; time: string; location: string }>
  >({})

  // Resolve mode state
  const [resolveMappings, setResolveMappings] = useState<Record<string, string>>({})
  const uniquePlaceholders = useMemo(() => {
    const set = new Set<string>()
    if (games) {
      games.forEach((g) => {
        if (g.gameType === "playoff" || g.isPlayoff) {
          if (g.homeSlug?.toLowerCase() === "tbd" && g.homePlaceholder) set.add(g.homePlaceholder)
          if (g.awaySlug?.toLowerCase() === "tbd" && g.awayPlaceholder) set.add(g.awayPlaceholder)
        }
      })
    }
    return Array.from(set).sort()
  }, [games])

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const teamNameForSlug = (slug: string): string => {
    return teams.find((t) => t.teamSlug === slug)?.teamName ?? slug
  }

  const displayTeam = (slug: string, placeholder: string | null): string => {
    if (slug === "tbd" && placeholder) return placeholder
    return teamNameForSlug(slug)
  }

  const roundLabel = (round: string): string => {
    switch (round) {
      case "play-in": return "Play-in"
      case "quarterfinal": return "Quarterfinals"
      case "semifinal": return "Semi-Finals"
      case "final": return "Finals"
      default: return round
    }
  }

  // Group bracket games by round for display, sorted by game number then series ID
  const gamesByRound = useMemo(() => {
    const grouped: Record<string, BracketGame[]> = {}
    for (const g of bracketGames) {
      if (!grouped[g.bracketRound]) grouped[g.bracketRound] = []
      grouped[g.bracketRound].push(g)
    }

    // Sort each round's games
    for (const round of Object.keys(grouped)) {
      grouped[round].sort((a, b) => {
        if (a.seriesGameNumber !== b.seriesGameNumber) {
          return a.seriesGameNumber - b.seriesGameNumber
        }
        return a.seriesId.localeCompare(b.seriesId)
      })
    }

    return grouped
  }, [bracketGames])

  const roundOrder = ["play-in", "quarterfinal", "semifinal", "final"]

  const defaultDateStr = useMemo(() => {
    if (!lastRegularSeasonDate) return ""
    const d = new Date(lastRegularSeasonDate + "T12:00:00")
    d.setDate(d.getDate() + 1)
    return d.toISOString().split("T")[0]
  }, [lastRegularSeasonDate])

  // ─── Navigation ───────────────────────────────────────────────────────────

  const totalSteps = wizardMode === "generate" ? 4 : 2
  const canGoNext = (): boolean => {
    if (step === 1) return true
    if (wizardMode === "resolve") {
      if (step === 2) {
        return Object.values(resolveMappings).filter(v => v !== "").length > 0
      }
    } else {
      switch (step) {
        case 2: return numTeams >= 4
        case 3: return usePlaceholders || seeds.filter(Boolean).length >= numTeams
        case 4: return bracketGames.length > 0
      }
    }
    return false
  }

  const handleNext = () => {
    if (wizardMode === "generate") {
      if (step === 2 && !usePlaceholders && seeds.length < numTeams) {
        // Pad seeds
        const padded = [...seeds]
        while (padded.length < numTeams) padded.push("")
        setSeeds(padded)
      }
      if (step === 3) {
        // Initialize game details with defaults
        const initial: Record<string, { date: string; time: string; location: string }> = {}
        for (const g of bracketGames) {
          if (!gameDetails[g.id]) {
            const defaultTime = g.seriesId === "sf-b" ? "13:00" : "11:00"
            initial[g.id] = { date: defaultDateStr, time: defaultTime, location: defaultLocation }
          }
        }
        setGameDetails((prev) => ({ ...initial, ...prev }))
      }
    }
    setStep((s) => Math.min(s + 1, totalSteps))
  }
  const handleBack = () => setStep((s) => Math.max(s - 1, 1))

  const handleSave = async () => {
    setIsSaving(true)
    try {
      if (wizardMode === "resolve") {
        const payload = Object.entries(resolveMappings).filter(([_, v]) => v !== "")
        if (payload.length === 0) throw new Error("No mappings selected")

        const res = await fetch(`/api/bash/admin/seasons/${seasonId}/schedule/resolve-seeds`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mappings: resolveMappings }),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Failed to resolve seeds")
        }
        toast.success("Playoff seeds resolved successfully!")
      } else {
        // Generate mode
        const payload = bracketGames.map((g) => {
          const details = gameDetails[g.id] || { date: defaultDateStr, time: "11:00", location: defaultLocation }
          return {
            ...g,
            date: details.date,
            time: details.time,
            location: details.location,
          }
        })

        const res = await fetch(`/api/bash/admin/seasons/${seasonId}/schedule/playoffs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ games: payload, playoffTeams: numTeams }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Failed to generate playoffs")
        }

        toast.success(`Generated ${bracketGames.length} playoff games`)
      }
      
      onSaved()
      handleReset()
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setStep(1)
    setGameDetails({})
    setResolveMappings({})
  }

  const moveSeed = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= seeds.length) return
    const next = [...seeds]
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item)
    setSeeds(next)
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const stepTitlesGenerate = ["Action", "Format & Teams", "Assign Seeds", "Game Details"]
  const stepTitlesResolve = ["Action", "Resolve Seeds"]
  const stepTitles = wizardMode === "generate" ? stepTitlesGenerate : stepTitlesResolve

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Playoff Bracket Wizard
              <Badge variant="outline" className="ml-2">Step {step}/{totalSteps}</Badge>
            </DialogTitle>
          </DialogHeader>

          {/* Progress bar */}
          <div className="flex gap-1 mb-4">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i < step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>

          <div className="py-2 min-h-[300px]">
            <h3 className="font-semibold text-base mb-4">{stepTitles[step - 1]}</h3>

            {/* ─── Step 1: Action ─── */}
            {step === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Would you like to generate a new playoff schedule or assign actual teams to an existing one?
                </p>
                <RadioGroup
                  value={wizardMode}
                  onValueChange={(v: "generate" | "resolve") => setWizardMode(v)}
                  className="space-y-3 pt-2"
                >
                  <div className="flex items-start space-x-3 border p-4 rounded-lg bg-card">
                    <RadioGroupItem value="generate" id="generate" className="mt-1" />
                    <div>
                      <Label htmlFor="generate" className="font-semibold text-base cursor-pointer">
                        Create / Replace Bracket
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Build a fresh bracket using either placeholders or actual teams. This will replace any existing unplayed playoff games.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3 border p-4 rounded-lg bg-card">
                    <RadioGroupItem value="resolve" id="resolve" className="mt-1" />
                    <div>
                      <Label htmlFor="resolve" className="font-semibold text-base cursor-pointer">
                        Resolve Existing Seeds
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Select this if you generated a placeholder bracket at the start of the year and now want to swap the "Seed" placeholders with the actual teams.
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* ─── Resolve Mode: Step 2 ─── */}
            {step === 2 && wizardMode === "resolve" && (() => {
              // Sort: "Seed N" first by number, then everything else alphabetically
              const seedPlaceholders = uniquePlaceholders
                .filter((p) => /^seed\s+\d+$/i.test(p))
                .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]))
              const otherPlaceholders = uniquePlaceholders
                .filter((p) => !/^seed\s+\d+$/i.test(p))
                .sort()

              const renderRow = (placeholder: string) => (
                <div key={placeholder} className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/40 transition-colors">
                  <span className="text-sm font-medium w-36 shrink-0 truncate" title={placeholder}>
                    {placeholder}
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  <Select
                    value={resolveMappings[placeholder] || ""}
                    onValueChange={(val) => setResolveMappings((prev) => ({ ...prev, [placeholder]: val }))}
                  >
                    <SelectTrigger className="flex-1 h-8 text-sm">
                      <SelectValue placeholder="Select team..." />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((t) => (
                        <SelectItem key={t.teamSlug} value={t.teamSlug}>
                          {t.teamName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )

              return (
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                  <p className="text-sm text-muted-foreground">
                    Map your placeholder seeds to actual teams. This automatically updates all upcoming playoff games.
                  </p>
                  {uniquePlaceholders.length === 0 ? (
                    <div className="text-center p-6 border rounded-lg bg-muted/20">
                      <p className="text-sm text-muted-foreground">No placeholder seeds found in the schedule.</p>
                    </div>
                  ) : (
                    <>
                      {seedPlaceholders.length > 0 && (
                        <div className="space-y-0.5">
                          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Seedings</Label>
                          <div className="border rounded-lg divide-y">
                            {seedPlaceholders.map(renderRow)}
                          </div>
                        </div>
                      )}
                      {otherPlaceholders.length > 0 && (
                        <div className="space-y-0.5">
                          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Advancement Slots</Label>
                          <div className="border rounded-lg divide-y">
                            {otherPlaceholders.map(renderRow)}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })()}

            {/* ─── Generate Mode: Step 2: Format & Teams ─── */}
            {step === 2 && wizardMode === "generate" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Number of Playoff Teams</Label>
                    <Select
                      value={String(numTeams)}
                      onValueChange={(v) => {
                        const n = +v
                        setNumTeams(n)
                        // Auto-enable play-in for odd counts
                        setPlayIn(n % 2 !== 0)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="4">4 teams</SelectItem>
                        {(usingPlaceholderTeams || teams.length >= 5) && <SelectItem value="5">5 teams</SelectItem>}
                        {(usingPlaceholderTeams || teams.length >= 6) && <SelectItem value="6">6 teams</SelectItem>}
                        {(usingPlaceholderTeams || teams.length >= 7) && <SelectItem value="7">7 teams</SelectItem>}
                        {(usingPlaceholderTeams || teams.length >= 8) && <SelectItem value="8">8 teams</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>

                  {numTeams % 2 !== 0 && (
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={playIn}
                        onCheckedChange={setPlayIn}
                        id="play-in"
                      />
                      <Label htmlFor="play-in">
                        Play-in Game (#{numTeams - 1} vs #{numTeams})
                      </Label>
                    </div>
                  )}
                </div>

                <div className={`grid gap-4 ${numTeams >= 6 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {numTeams >= 6 && (
                    <div className="space-y-2">
                      <Label>Quarterfinal Format</Label>
                      <Select
                        value={String(quarterSeriesLength)}
                        onValueChange={(v) => setQuarterSeriesLength(+v as 1 | 3)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Single Game</SelectItem>
                          <SelectItem value="3">Best of 3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Semi-Final Format</Label>
                    <Select
                      value={String(semiSeriesLength)}
                      onValueChange={(v) => setSemiSeriesLength(+v as 1 | 3)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Single Game</SelectItem>
                        <SelectItem value="3">Best of 3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Finals Format</Label>
                    <Select
                      value={String(finalSeriesLength)}
                      onValueChange={(v) => setFinalSeriesLength(+v as 1 | 3)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Single Game</SelectItem>
                        <SelectItem value="3">Best of 3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <Label className="text-base">Are playoff teams known?</Label>
                  <RadioGroup
                    value={usePlaceholders ? "no" : "yes"}
                    onValueChange={(v) => setUsePlaceholders(v === "no")}
                    className="flex gap-6"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="yes" id="known-yes" />
                      <Label htmlFor="known-yes" className="cursor-pointer">Yes</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="no" id="known-no" />
                      <Label htmlFor="known-no" className="cursor-pointer">No</Label>
                    </div>
                  </RadioGroup>
                  <p className="text-sm text-muted-foreground">
                    {usingPlaceholderTeams
                      ? "No teams assigned yet. The schedule will be generated using placeholder labels (e.g. Seed 1 vs Seed 2)."
                      : 'If "No", the schedule will be generated using placeholder labels (e.g. Seed 1 vs Seed 2).'}
                  </p>
                </div>

                <div className="p-3 border rounded-lg text-sm bg-muted/30">
                  <strong>Preview:</strong>{" "}
                  {bracketGames.length} total playoff games
                  {playIn && " (including play-in)"}
                  {numTeams >= 6 && quarterSeriesLength === 3 && " • Best-of-3 quarters"}
                  {semiSeriesLength === 3 && " • Best-of-3 semis"}
                  {finalSeriesLength === 3 && " • Best-of-3 finals"}
                </div>
              </div>
            )}

            {/* ─── Generate Mode: Step 3: Assign Seeds ─── */}
            {step === 3 && wizardMode === "generate" && (
              <div className="space-y-4">
                {usePlaceholders ? (
                  <p className="text-sm text-muted-foreground">
                    Playoff teams are not yet known. The bracket will be generated using placeholder seeds.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Assign seeding for the playoff bracket. Drag to reorder or use the dropdown to
                      change each seed.
                    </p>
                    <div className="space-y-2">
                      {Array.from({ length: numTeams }, (_, i) => (
                        <div key={i} className="flex items-center gap-3 p-2 border rounded-lg">
                          <Badge className="w-8 h-8 flex items-center justify-center rounded-full text-xs">
                            #{i + 1}
                          </Badge>
                          <Select
                            value={seeds[i] || ""}
                            onValueChange={(v) => {
                              const next = [...seeds]
                              const existingIdx = next.indexOf(v)
                              if (existingIdx !== -1 && existingIdx !== i) {
                                next[existingIdx] = next[i]
                              }
                              next[i] = v
                              setSeeds(next)
                            }}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select team..." />
                            </SelectTrigger>
                            <SelectContent>
                              {teams.map((t) => (
                                <SelectItem key={t.teamSlug} value={t.teamSlug}>
                                  {t.teamName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={i === 0}
                              onClick={() => moveSeed(i, i - 1)}
                            >
                              ↑
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={i === numTeams - 1}
                              onClick={() => moveSeed(i, i + 1)}
                            >
                              ↓
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Visual bracket preview */}
                <div className="p-3 border rounded-lg text-sm bg-muted/30 space-y-1">
                  <strong>Bracket Preview:</strong>
                  {bracketGames
                    .filter((g, i, arr) => arr.findIndex((x) => x.seriesId === g.seriesId) === i)
                    .map((g) => (
                      <div key={g.seriesId} className="ml-2">
                        <span className="uppercase text-xs font-medium text-muted-foreground">{g.seriesId}:</span>{" "}
                        {displayTeam(g.homeTeam, g.homePlaceholder)} vs{" "}
                        {displayTeam(g.awayTeam, g.awayPlaceholder)}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* ─── Generate Mode: Step 4: Game Details ─── */}
            {step === 4 && wizardMode === "generate" && (
              <div className="space-y-6 max-h-[400px] overflow-y-auto pr-2">
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-muted-foreground">
                    Set dates, times, and locations for each playoff game. Each game date and time can be edited via the schedule page any time before the game is played.
                  </p>
                  {lastRegularSeasonDate && (
                    <p className="text-xs font-medium text-primary">
                      For reference: The final regular season game is scheduled for {new Date(lastRegularSeasonDate + "T12:00:00").toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}.
                    </p>
                  )}
                </div>
                {roundOrder
                  .filter((r) => gamesByRound[r])
                  .map((round) => (
                    <div key={round} className="space-y-2">
                      <h4 className="font-medium text-sm flex items-center gap-2">
                        {roundLabel(round)}
                        <Badge variant="outline" className="text-xs">
                          {gamesByRound[round].length} game{gamesByRound[round].length !== 1 && "s"}
                        </Badge>
                      </h4>
                      {gamesByRound[round].map((g) => {
                        const details = gameDetails[g.id] || {
                          date: defaultDateStr,
                          time: "11:00",
                          location: defaultLocation,
                        }
                        return (
                          <div key={g.id} className="grid grid-cols-12 gap-2 items-center text-sm border p-2 rounded">
                            <div className="col-span-3 text-muted-foreground truncate text-xs">
                              {g.seriesId !== "play-in" && (
                                <span className="uppercase font-medium">{g.seriesId} </span>
                              )}
                              Gm{g.seriesGameNumber}
                              <br />
                              {displayTeam(g.awayTeam, g.awayPlaceholder)} @{" "}
                              {displayTeam(g.homeTeam, g.homePlaceholder)}
                            </div>
                            <div className="col-span-3">
                              <Input
                                type="date"
                                value={details.date}
                                onChange={(e) =>
                                  setGameDetails((prev) => ({
                                    ...prev,
                                    [g.id]: { ...details, date: e.target.value },
                                  }))
                                }
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="col-span-2">
                              <Input
                                type="time"
                                placeholder="Time"
                                value={details.time}
                                onChange={(e) =>
                                  setGameDetails((prev) => ({
                                    ...prev,
                                    [g.id]: { ...details, time: e.target.value },
                                  }))
                                }
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="col-span-4">
                              <Input
                                placeholder="Location"
                                value={details.location}
                                onChange={(e) =>
                                  setGameDetails((prev) => ({
                                    ...prev,
                                    [g.id]: { ...details, location: e.target.value },
                                  }))
                                }
                                className="h-8 text-xs"
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
              </div>
            )}

          </div>

          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <div className="flex justify-end gap-2">
              {step > 1 && (
                <Button variant="outline" onClick={handleBack}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
              )}
              {step < totalSteps ? (
                <Button onClick={handleNext} disabled={!canGoNext()}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button onClick={() => setShowConfirm(true)} disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Trophy className="h-4 w-4 mr-2" />
                      Generate Playoffs
                    </>
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate Playoff Bracket?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create {bracketGames.length} playoff games and replace any existing upcoming
              playoff games for this season. Completed playoff games will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowConfirm(false)
                handleSave()
              }}
            >
              Generate Playoffs
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
