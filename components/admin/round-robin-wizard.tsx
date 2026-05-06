"use client"

import { useState, useMemo, useCallback } from "react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, Calendar, Loader2, Info } from "lucide-react"
import {
  generateRoundRobin,
  computeByeTeams,
  getHolidaysForYear,
  type RoundRobinSlot,
  type Holiday,
  type GeneratedGame,
} from "@/lib/schedule-utils"

interface RoundRobinWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  teams: { teamSlug: string; teamName: string }[]
  seasonId: string
  defaultLocation: string
  onSaved: () => void
}

interface WeekSlot {
  date: string
  time: string
  location: string
}

export function RoundRobinWizard({
  open,
  onOpenChange,
  teams,
  seasonId,
  defaultLocation,
  onSaved,
}: RoundRobinWizardProps) {
  const [step, setStep] = useState(1)
  const [isSaving, setIsSaving] = useState(false)
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false)

  // Placeholder mode: when no real teams are assigned, allow specifying a count
  const [placeholderTeamCount, setPlaceholderTeamCount] = useState(teams.length >= 2 ? teams.length : 6)
  const usingPlaceholders = teams.length < 2

  // Effective teams: real teams or generated placeholders
  const effectiveTeams = useMemo(() => {
    if (!usingPlaceholders) return teams
    return Array.from({ length: placeholderTeamCount }, (_, i) => ({
      teamSlug: `placeholder-${i + 1}`,
      teamName: `Team ${i + 1}`,
    }))
  }, [teams, usingPlaceholders, placeholderTeamCount])

  // Step 1: Parameters
  const [gamesPerWeek, setGamesPerWeek] = useState(Math.floor((teams.length >= 2 ? teams.length : 6) / 2))
  const [lengthMode, setLengthMode] = useState<"cycles" | "gamesPerTeam">("cycles")
  const [cycles, setCycles] = useState(3)
  const [gamesPerTeam, setGamesPerTeam] = useState(20)

  // Step 4: Game time defaults
  const [timeDefaults, setTimeDefaults] = useState<string[]>([])

  // Step 2: Start date
  const [startDate, setStartDate] = useState("")

  // Step 3: Skip dates (set of date indices from start date to skip)
  const [skippedDateIndices, setSkippedDateIndices] = useState<Set<number>>(new Set())

  // Step 4: Per-slot times & locations
  const [weekSlots, setWeekSlots] = useState<Record<number, WeekSlot[]>>({})

  // Step 6: Save mode
  const [saveMode, setSaveMode] = useState<"overwrite" | "append">("append")

  // ─── Derived data ─────────────────────────────────────────────────────────

  const slots = useMemo(() => {
    if (lengthMode === "cycles") {
      return generateRoundRobin(effectiveTeams.length, gamesPerWeek, cycles)
    } else {
      const totalGames = Math.floor((effectiveTeams.length * gamesPerTeam) / 2)
      // Generous max cycles so we have enough games to slice
      const maxCycles = Math.ceil(gamesPerTeam / Math.max(1, effectiveTeams.length - 1)) + 1
      return generateRoundRobin(effectiveTeams.length, gamesPerWeek, maxCycles, totalGames)
    }
  }, [effectiveTeams.length, gamesPerWeek, lengthMode, cycles, gamesPerTeam])

  // Group slots by week/round
  const slotsByWeek = useMemo(() => {
    const grouped: Record<number, RoundRobinSlot[]> = {}
    for (const s of slots) {
      if (!grouped[s.round]) grouped[s.round] = []
      grouped[s.round].push(s)
    }
    return grouped
  }, [slots])

  const weekNumbers = useMemo(
    () => Object.keys(slotsByWeek).map(Number).sort((a, b) => a - b),
    [slotsByWeek]
  )

  // Compute which team has a bye each week (only relevant for odd team counts)
  const isOddTeams = effectiveTeams.length % 2 !== 0
  const byeTeamsByWeek = useMemo(
    () => computeByeTeams(slots, effectiveTeams.length),
    [slots, effectiveTeams.length]
  )

  // Compute holidays for the start year and next year
  const holidaysList = useMemo(() => {
    if (!startDate) return []
    const startYear = parseInt(startDate.split("-")[0])
    if (isNaN(startYear)) return []
    return [...getHolidaysForYear(startYear), ...getHolidaysForYear(startYear + 1)]
  }, [startDate])

  const getNearestHoliday = useCallback((dateStr: string): Holiday | null => {
    if (!dateStr) return null
    const targetTime = new Date(dateStr + "T00:00:00").getTime()
    for (const h of holidaysList) {
      const hTime = new Date(h.date + "T00:00:00").getTime()
      const diffDays = Math.abs(hTime - targetTime) / (1000 * 60 * 60 * 24)
      if (diffDays <= 4) return h
    }
    return null
  }, [holidaysList])

  // All rounds are active, we only skip dates not games
  const activeWeeks = weekNumbers

  // Generate date list that accommodates all rounds plus any skipped dates
  const scheduleDates = useMemo(() => {
    if (!startDate) return []
    const base = new Date(startDate + "T00:00:00")
    const dates: { index: number; dateStr: string; isSkipped: boolean; weekNum: number | null; holiday: Holiday | null }[] = []
    
    let dateIndex = 0
    let assignedWeeks = 0
    
    while (assignedWeeks < weekNumbers.length) {
      const isSkipped = skippedDateIndices.has(dateIndex)
      
      const d = new Date(base)
      d.setDate(d.getDate() + dateIndex * 7)
      const dateStr = d.toISOString().split("T")[0]
      
      dates.push({
        index: dateIndex,
        dateStr,
        isSkipped,
        weekNum: isSkipped ? null : weekNumbers[assignedWeeks],
        holiday: getNearestHoliday(dateStr)
      })
      
      if (!isSkipped) {
        assignedWeeks++
      }
      dateIndex++
    }
    return dates
  }, [startDate, weekNumbers, skippedDateIndices, getNearestHoliday])

  // Map weekNum -> dateStr for the rest of the wizard
  const weekDates = useMemo(() => {
    const map: Record<number, string> = {}
    scheduleDates.forEach(d => {
      if (d.weekNum !== null) {
        map[d.weekNum] = d.dateStr
      }
    })
    return map
  }, [scheduleDates])

  // Build final games for preview (Step 4)
  const previewGames = useMemo((): GeneratedGame[] => {
    const result: GeneratedGame[] = []
    for (const week of activeWeeks) {
      const weekGames = slotsByWeek[week] || []
      const slotsForWeek = weekSlots[week] || []
      const baseDate = weekDates[week] || ""

      for (let i = 0; i < weekGames.length; i++) {
        const slot = weekGames[i]
        const slotInfo = slotsForWeek[i] || { date: baseDate, time: "TBD", location: defaultLocation }

        const homeTeam = effectiveTeams[slot.home]
        const awayTeam = effectiveTeams[slot.away]

        result.push({
          date: slotInfo.date || baseDate,
          time: slotInfo.time || "TBD",
          homeTeam: usingPlaceholders ? "tbd" : (homeTeam?.teamSlug ?? "tbd"),
          awayTeam: usingPlaceholders ? "tbd" : (awayTeam?.teamSlug ?? "tbd"),
          homePlaceholder: usingPlaceholders ? (homeTeam?.teamName ?? null) : null,
          awayPlaceholder: usingPlaceholders ? (awayTeam?.teamName ?? null) : null,
          location: slotInfo.location || defaultLocation,
          gameType: "regular",
          status: "upcoming",
        })
      }
    }
    return result
  }, [activeWeeks, slotsByWeek, weekSlots, weekDates, effectiveTeams, defaultLocation, usingPlaceholders])

  // ─── Navigation ───────────────────────────────────────────────────────────

  const totalSteps = 4
  const canGoNext = (): boolean => {
    switch (step) {
      case 1: return effectiveTeams.length >= 2 && gamesPerWeek >= 1 && cycles >= 1 && startDate !== ""
      case 2: return activeWeeks.length > 0
      case 3: return true
      case 4: return previewGames.length > 0
      default: return false
    }
  }

  const handleNext = () => {
    if (step === 2) {
      // Initialize weekSlots with defaults when moving past step 2
      const initial: Record<number, WeekSlot[]> = {}
      for (const week of activeWeeks) {
        const numGames = slotsByWeek[week]?.length || 0
        const baseDate = weekDates[week] || ""
        initial[week] = Array.from({ length: numGames }, (_, i) => {
          let defaultTime = "TBD"
          if (gamesPerWeek === 3) {
            defaultTime = i === 0 ? "09:00" : i === 1 ? "11:00" : i === 2 ? "13:00" : "TBD"
          } else if (gamesPerWeek === 2) {
            defaultTime = i === 0 ? "12:00" : i === 1 ? "14:00" : "TBD"
          }
          return {
            date: baseDate,
            time: defaultTime,
            location: defaultLocation,
          }
        })
      }
      setWeekSlots((prev) => ({ ...initial, ...prev }))
      
      // Initialize default times state based on first active week length
      const firstWeekGames = slotsByWeek[activeWeeks[0]]?.length || gamesPerWeek
      const defaultTimesArray = Array.from({ length: firstWeekGames }, (_, i) => {
        if (gamesPerWeek === 3) return i === 0 ? "09:00" : i === 1 ? "11:00" : i === 2 ? "13:00" : "TBD"
        if (gamesPerWeek === 2) return i === 0 ? "12:00" : i === 1 ? "14:00" : "TBD"
        return "TBD"
      })
      setTimeDefaults(defaultTimesArray)
    }
    setStep((s) => Math.min(s + 1, totalSteps))
  }
  
  const applyTimeDefaults = () => {
    setWeekSlots((prev) => {
      const copy = { ...prev }
      for (const week of Object.keys(copy)) {
        const weekNum = Number(week)
        copy[weekNum] = copy[weekNum].map((slot, i) => ({
          ...slot,
          time: timeDefaults[i] || slot.time
        }))
      }
      return copy
    })
    toast.success("Game times applied to all weeks")
  }
  
  const handleBack = () => setStep((s) => Math.max(s - 1, 1))

  const handleSave = async (force: boolean = false) => {
    setIsSaving(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/schedule/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: saveMode,
          force,
          games: previewGames,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        if (data.error?.includes("final games exist") && !force) {
          setShowOverwriteConfirm(true)
          return
        }
        throw new Error(data.error || "Failed to generate schedule")
      }

      toast.success(`Generated ${previewGames.length} games`)
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
    setSkippedDateIndices(new Set())
    setWeekSlots({})
  }

  const updateSlot = (week: number, index: number, field: keyof WeekSlot, value: string) => {
    setWeekSlots((prev) => {
      const copy = { ...prev }
      if (!copy[week]) copy[week] = []
      if (!copy[week][index]) copy[week][index] = { date: "", time: "TBD", location: defaultLocation }
      copy[week] = [...copy[week]]
      copy[week][index] = { ...copy[week][index], [field]: value }
      return copy
    })
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const stepTitles = [
    "Parameters & Start Date",
    "Skip Weeks",
    "Times & Locations",
    "Review & Save",
  ]

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Round Robin Wizard
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

            {/* ─── Step 1: Parameters ─── */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground mb-4">
                    Configure the round-robin schedule parameters. The algorithm will generate
                    balanced matchups so each team plays every other team.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Teams in League</Label>
                      {usingPlaceholders ? (
                        <>
                          <Input
                            type="number"
                            min={2}
                            max={12}
                            value={placeholderTeamCount}
                            onChange={(e) => {
                              const count = Math.max(2, Math.min(12, parseInt(e.target.value) || 2))
                              setPlaceholderTeamCount(count)
                              setGamesPerWeek(Math.floor(count / 2))
                            }}
                          />
                          <p className="text-xs text-muted-foreground">
                            No teams assigned yet — using placeholder names
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="text-2xl font-bold">{effectiveTeams.length}</div>
                          <p className="text-xs text-muted-foreground">
                            {effectiveTeams.map((t) => t.teamName).join(", ")}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Games Per Week</Label>
                      <Input
                        type="number"
                        min={1}
                        max={Math.floor(effectiveTeams.length / 2)}
                        value={gamesPerWeek}
                        onChange={(e) => setGamesPerWeek(Math.max(1, parseInt(e.target.value) || 1))}
                      />
                      <p className="text-xs text-muted-foreground">
                        Max {Math.floor(effectiveTeams.length / 2)} (each team plays once per week)
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Schedule Length</Label>
                      <Select value={lengthMode} onValueChange={(v: "cycles" | "gamesPerTeam") => setLengthMode(v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cycles">Full Cycles</SelectItem>
                          <SelectItem value="gamesPerTeam">Total Games per Team</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{lengthMode === "cycles" ? "Cycles" : "Games per Team"}</Label>
                      {lengthMode === "cycles" ? (
                        <Select value={String(cycles)} onValueChange={(v) => setCycles(+v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 cycle ({effectiveTeams.length - 1} rounds)</SelectItem>
                            <SelectItem value="2">2 cycles ({(effectiveTeams.length - 1) * 2} rounds)</SelectItem>
                            <SelectItem value="3">3 cycles ({(effectiveTeams.length - 1) * 3} rounds)</SelectItem>
                            <SelectItem value="4">4 cycles ({(effectiveTeams.length - 1) * 4} rounds)</SelectItem>
                            <SelectItem value="5">5 cycles ({(effectiveTeams.length - 1) * 5} rounds)</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          type="number"
                          min={1}
                          value={gamesPerTeam}
                          onChange={(e) => setGamesPerTeam(Math.max(1, parseInt(e.target.value) || 20))}
                        />
                      )}
                    </div>
                  </div>
                  <div className="mt-6 pt-4 border-t space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Choose the date for Week 1. Subsequent weeks will be scheduled 7 days apart.
                    </p>
                    <div className="space-y-2">
                      <Label>Start Date</Label>
                      <Input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-[200px]"
                      />
                    </div>
                    {startDate && (
                      <div className="p-3 border rounded-lg text-sm space-y-1">
                        <div>
                          <strong>Week 1:</strong>{" "}
                          {new Date(startDate + "T00:00:00").toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </div>
                        <div>
                          <strong>Last week (tentative):</strong>{" "}
                          {(() => {
                            const d = new Date(startDate + "T00:00:00")
                            d.setDate(d.getDate() + (weekNumbers.length - 1) * 7)
                            return d.toLocaleDateString("en-US", {
                              weekday: "long",
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            })
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {isOddTeams && (
                  <div className="p-3 border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 rounded-lg text-sm flex items-start gap-2">
                    <Info className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <div>
                      <span className="font-medium text-amber-800 dark:text-amber-300">Odd number of teams ({effectiveTeams.length})</span>
                      <span className="text-amber-700 dark:text-amber-400">
                        {" "}— one team will have a bye each week. Byes rotate so every team sits out an equal number of times per cycle.
                      </span>
                    </div>
                  </div>
                )}
                <div className="p-3 border rounded-lg text-sm bg-muted/10">
                  <strong>Preview:</strong>{" "}
                  {slots.length} total games across {weekNumbers.length} weeks
                  ({gamesPerWeek} games/week)
                </div>
              </div>
            )}

            {/* ─── Step 2: Skip Weeks ─── */}
            {step === 2 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Toggle off any dates you want to skip (holidays, rink closures, etc.).
                  Games scheduled for skipped dates will automatically shift to the next available date.
                </p>
                <div className="border rounded-lg max-h-[300px] overflow-y-auto relative">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b z-10">
                      <tr>
                        <th className="w-16 text-center p-2">Active</th>
                        <th className="text-left p-2">Week</th>
                        <th className="text-left p-2">Date</th>
                        <th className="text-left p-2">
                          <div className="flex items-center gap-1">
                            Nearest Holiday
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger type="button" className="cursor-help text-muted-foreground hover:text-foreground">
                                  <Info className="h-3.5 w-3.5" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[280px]">
                                  We calculate major US holidays mathematically to support cross-year schedules. 
                                  You can verify these dates against the <a href="https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/" target="_blank" rel="noreferrer" className="underline font-medium text-primary hover:text-primary/80">US Office of Personnel Management (OPM)</a>.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </th>
                        <th className="text-right p-2">Games</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleDates.map((dateObj) => {
                        const { index, isSkipped, dateStr, weekNum, holiday } = dateObj
                        
                        return (
                          <tr 
                            key={index} 
                            className={`border-b last:border-0 transition-colors hover:bg-muted/30 cursor-pointer ${isSkipped ? "bg-muted/50 text-muted-foreground" : ""}`}
                            onClick={() => {
                              const next = new Set(skippedDateIndices)
                              if (isSkipped) next.delete(index)
                              else next.add(index)
                              setSkippedDateIndices(next)
                            }}
                          >
                            <td className="p-2 text-center">
                              <Checkbox checked={!isSkipped} />
                            </td>
                            <td className={`p-2 font-medium ${isSkipped ? "italic opacity-60" : ""}`}>
                              {isSkipped ? "Skipped" : `Week ${weekNum}`}
                            </td>
                            <td className="p-2">
                              {new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
                                weekday: "short", month: "short", day: "numeric"
                              })}
                            </td>
                            <td className="p-2">
                              {holiday ? (
                                <div className={`text-xs font-medium ${isSkipped ? "text-muted-foreground" : "text-orange-600 dark:text-orange-400"}`}>
                                  {holiday.name} <span className="ml-1 font-normal opacity-70">({new Date(holiday.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })})</span>
                                </div>
                              ) : null}
                            </td>
                            <td className="p-2 text-right opacity-70">
                              {isSkipped ? "-" : (slotsByWeek[weekNum!]?.length || 0)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="text-sm text-muted-foreground">
                  {activeWeeks.length} of {weekNumbers.length} weeks active
                </div>
              </div>
            )}

            {/* ─── Step 3: Times & Locations ─── */}
            {step === 3 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Set the time and location for each game slot. Defaults to the season location.
                </p>

                <div className="p-3 bg-muted/30 rounded-lg border flex flex-wrap items-end gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground block mb-1">Game Time Defaults (PST)</Label>
                    <div className="flex gap-2">
                      {timeDefaults.map((t, i) => (
                        <div key={i} className="flex flex-col gap-1 w-[130px]">
                          <span className="text-[10px] uppercase text-muted-foreground">Game {i + 1}</span>
                          <Input 
                            type="time" 
                            className="h-8 text-xs bg-background" 
                            value={t === "TBD" ? "" : t} 
                            onChange={(e) => {
                              const newTimes = [...timeDefaults]
                              newTimes[i] = e.target.value || "TBD"
                              setTimeDefaults(newTimes)
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={applyTimeDefaults} className="h-8">
                    Apply to Schedule
                  </Button>
                </div>

                <div className="space-y-6 max-h-[300px] overflow-y-auto pr-2">
                  {activeWeeks.map((week) => {
                    const weekGames = slotsByWeek[week] || []
                    const slotsArr = weekSlots[week] || []
                    const baseDate = weekDates[week] || ""

                    return (
                      <div key={week} className="border rounded-lg p-3 space-y-2">
                        <h4 className="font-medium text-sm flex items-center gap-2">
                          Week {week}
                          {baseDate && (
                            <Badge variant="outline" className="text-xs">
                              {new Date(baseDate + "T00:00:00").toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                            </Badge>
                          )}
                        </h4>
                        {weekGames.map((slot, i) => (
                          <div key={i} className="grid grid-cols-12 gap-2 items-center text-sm">
                            <div className="col-span-3 text-muted-foreground truncate">
                              {effectiveTeams[slot.away]?.teamName ?? "?"} @ {effectiveTeams[slot.home]?.teamName ?? "?"}
                            </div>
                            <div className="col-span-3">
                              <Input
                                type="date"
                                value={slotsArr[i]?.date || baseDate}
                                onChange={(e) => updateSlot(week, i, "date", e.target.value)}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="col-span-2">
                              <Input
                                type="time"
                                placeholder="Time"
                                value={slotsArr[i]?.time === "TBD" ? "" : slotsArr[i]?.time || ""}
                                onChange={(e) => updateSlot(week, i, "time", e.target.value || "TBD")}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="col-span-4">
                              <Input
                                placeholder="Location"
                                value={slotsArr[i]?.location || defaultLocation}
                                onChange={(e) => updateSlot(week, i, "location", e.target.value)}
                                className="h-8 text-xs"
                              />
                            </div>
                          </div>
                        ))}
                        {/* Bye annotation for odd team counts */}
                        {isOddTeams && byeTeamsByWeek[week] !== undefined && (
                          <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 pt-1 border-t border-dashed mt-1">
                            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-700">
                              BYE
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {effectiveTeams[byeTeamsByWeek[week]!]?.teamName ?? `Team ${byeTeamsByWeek[week]! + 1}`}
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ─── Step 4: Review ─── */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                  <div className="grid grid-cols-2 gap-y-1 text-sm">
                    <span className="text-muted-foreground">Total games:</span>
                    <span className="font-medium">{previewGames.length}</span>
                    <span className="text-muted-foreground">Active weeks:</span>
                    <span className="font-medium">{activeWeeks.length}</span>
                    <span className="text-muted-foreground">Skipped Dates:</span>
                    <span className="font-medium">{skippedDateIndices.size}</span>
                    <span className="text-muted-foreground">Games per week:</span>
                    <span className="font-medium">{gamesPerWeek}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Save Mode</Label>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={saveMode === "overwrite"}
                        onCheckedChange={(checked) =>
                          setSaveMode(checked ? "overwrite" : "append")
                        }
                      />
                      <span className="text-sm">
                        {saveMode === "overwrite"
                          ? "Overwrite existing schedule"
                          : "Append to existing schedule"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg max-h-[250px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b">
                      <tr>
                        <th className="text-left p-2">Date</th>
                        <th className="text-left p-2">Time</th>
                        <th className="text-left p-2">Away</th>
                        <th className="text-center p-2">@</th>
                        <th className="text-left p-2">Home</th>
                        <th className="text-left p-2">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewGames.map((g, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-2">{g.date}</td>
                          <td className="p-2">{g.time}</td>
                          <td className="p-2">
                            {effectiveTeams.find((t) => t.teamSlug === g.awayTeam)?.teamName ?? g.awayPlaceholder ?? g.awayTeam}
                          </td>
                          <td className="p-2 text-center text-muted-foreground">@</td>
                          <td className="p-2">
                            {effectiveTeams.find((t) => t.teamSlug === g.homeTeam)?.teamName ?? g.homePlaceholder ?? g.homeTeam}
                          </td>
                          <td className="p-2">
                            <Badge variant="outline" className="capitalize text-[10px]">
                              {g.gameType}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                      {/* Bye rows in review table */}
                      {isOddTeams && (() => {
                        // Group preview games by date to show bye per game-date
                        const dateSet = new Set(previewGames.map(g => g.date))
                        const sortedGameDates = [...dateSet].sort()
                        return sortedGameDates.map(date => {
                          // Find which week this date belongs to
                          const weekEntry = Object.entries(weekDates).find(([, d]) => d === date)
                          if (!weekEntry) return null
                          const weekNum = Number(weekEntry[0])
                          const byeIdx = byeTeamsByWeek[weekNum]
                          if (byeIdx === undefined) return null
                          const byeTeam = effectiveTeams[byeIdx]
                          return (
                            <tr key={`bye-${date}`} className="border-b last:border-0 bg-amber-50/50 dark:bg-amber-950/20">
                              <td className="p-2 text-muted-foreground">{date}</td>
                              <td className="p-2"></td>
                              <td className="p-2 text-right text-muted-foreground italic" colSpan={3}>
                                {byeTeam?.teamName ?? `Team ${byeIdx + 1}`} — BYE
                              </td>
                              <td className="p-2">
                                <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-700">
                                  bye
                                </Badge>
                              </td>
                            </tr>
                          )
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
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
                <Button onClick={() => handleSave(false)} disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    `Generate ${previewGames.length} Games`
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showOverwriteConfirm} onOpenChange={setShowOverwriteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Final games exist</AlertDialogTitle>
            <AlertDialogDescription>
              There are completed (final) games in this schedule. Overwriting will delete all
              non-final games. Final games and their stats will be preserved. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowOverwriteConfirm(false)
                handleSave(true)
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              Overwrite Non-Final Games
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
