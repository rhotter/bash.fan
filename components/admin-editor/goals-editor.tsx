"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Pencil, Trash2, Plus } from "lucide-react"
import type { LiveGameState, GoalEvent, RosterPlayer } from "@/lib/scorekeeper-types"
import { periodLabel } from "@/lib/scorekeeper-types"
import { FieldLabel } from "@/components/scorekeeper/shared/field-label"

function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

function safeMin(s: string): string {
  const n = parseInt(s)
  return isNaN(n) ? "0" : String(n)
}

function safeSec(s: string): string {
  const n = parseInt(s)
  return isNaN(n) ? "00" : String(n).padStart(2, "0")
}

export function GoalsEditor({ isPlayoff = false, state, onChange, homeSlug, awaySlug, homeTeam, awayTeam, homeRoster, awayRoster, nameById }: {
  isPlayoff?: boolean
  state: LiveGameState
  onChange: (goals: GoalEvent[]) => void
  homeSlug: string; awaySlug: string
  homeTeam: string; awayTeam: string
  homeRoster: RosterPlayer[]; awayRoster: RosterPlayer[]
  nameById: (id: number | null) => string | null
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<GoalEvent | null>(null)

  // Form state
  const [team, setTeam] = useState(homeSlug)
  const [period, setPeriod] = useState("1")
  const [clockMin, setClockMin] = useState("20")
  const [clockSec, setClockSec] = useState("00")
  const [scorerId, setScorerId] = useState("")
  const [assist1Id, setAssist1Id] = useState("none")
  const [assist2Id, setAssist2Id] = useState("none")
  const [ppg, setPpg] = useState(false)
  const [shg, setShg] = useState(false)
  const [eng, setEng] = useState(false)

  function openAdd() {
    setEditingGoal(null)
    setTeam(homeSlug)
    setPeriod("1")
    setClockMin("20")
    setClockSec("00")
    setScorerId("")
    setAssist1Id("none")
    setAssist2Id("none")
    setPpg(false)
    setShg(false)
    setEng(false)
    setDialogOpen(true)
  }

  function openEdit(goal: GoalEvent) {
    setEditingGoal(goal)
    setTeam(goal.team)
    setPeriod(String(goal.period))
    const parts = goal.clock.split(":")
    setClockMin(safeMin(parts[0]))
    setClockSec(safeSec(parts[1]))
    setScorerId(String(goal.scorerId))
    setAssist1Id(goal.assist1Id ? String(goal.assist1Id) : "none")
    setAssist2Id(goal.assist2Id ? String(goal.assist2Id) : "none")
    setPpg(goal.flags.includes("PPG"))
    setShg(goal.flags.includes("SHG"))
    setEng(goal.flags.includes("ENG"))
    setDialogOpen(true)
  }

  function handleSave() {
    const flags: string[] = []
    if (ppg) flags.push("PPG")
    if (shg) flags.push("SHG")
    if (eng) flags.push("ENG")

    const goal: GoalEvent = {
      id: editingGoal?.id ?? generateId(),
      team,
      period: parseInt(period),
      clock: `${safeMin(clockMin)}:${safeSec(clockSec)}`,
      scorerId: parseInt(scorerId),
      assist1Id: assist1Id !== "none" ? parseInt(assist1Id) : null,
      assist2Id: assist2Id !== "none" ? parseInt(assist2Id) : null,
      flags,
    }

    if (editingGoal) {
      onChange(state.goals.map((g) => g.id === editingGoal.id ? goal : g))
    } else {
      onChange([...state.goals, goal])
    }
    setDialogOpen(false)
  }

  function handleDelete(id: string) {
    onChange(state.goals.filter((g) => g.id !== id))
  }

  const roster = team === homeSlug ? homeRoster : awayRoster
  const attending = team === homeSlug ? state.homeAttendance : state.awayAttendance
  const availablePlayers = roster.filter((p) => attending.includes(p.id))

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Goals</h3>
        <Button size="sm" variant="outline" onClick={openAdd} className="h-7 text-[11px]">
          <Plus className="h-3 w-3 mr-1" /> Add Goal
        </Button>
      </div>

      {state.goals.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 py-2">No goals recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
                <th className="text-left font-medium py-1.5 pr-2">Per</th>
                <th className="text-left font-medium py-1.5 px-2">Time</th>
                <th className="text-left font-medium py-1.5 px-2">Team</th>
                <th className="text-left font-medium py-1.5 px-2">Scorer</th>
                <th className="text-left font-medium py-1.5 px-2">A1</th>
                <th className="text-left font-medium py-1.5 px-2">A2</th>
                <th className="text-left font-medium py-1.5 px-2">Flags</th>
                <th className="text-right font-medium py-1.5 pl-2 w-16 hidden sm:table-cell"></th>
              </tr>
            </thead>
            <tbody>
              {state.goals.map((g) => (
                <tr key={g.id} className="border-t border-border/20 hover:bg-muted/50 cursor-pointer sm:cursor-default" onClick={() => openEdit(g)}>
                  <td className="py-1.5 pr-2">{periodLabel(g.period, isPlayoff)}</td>
                  <td className="py-1.5 px-2 tabular-nums font-mono">{g.clock}</td>
                  <td className="py-1.5 px-2">{g.team === homeSlug ? homeTeam : awayTeam}</td>
                  <td className="py-1.5 px-2 font-medium">{nameById(g.scorerId) ?? `#${g.scorerId}`}</td>
                  <td className="py-1.5 px-2 text-muted-foreground">{nameById(g.assist1Id) ?? "-"}</td>
                  <td className="py-1.5 px-2 text-muted-foreground">{nameById(g.assist2Id) ?? "-"}</td>
                  <td className="py-1.5 px-2 text-muted-foreground/60">{g.flags.join(", ") || "-"}</td>
                  <td className="py-1.5 pl-2 text-right hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(g)} className="p-1 hover:text-primary transition-colors">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => handleDelete(g.id)} className="p-1 hover:text-destructive transition-colors">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{editingGoal ? "Edit Goal" : "Add Goal"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FieldLabel label="Team">
                <Select value={team} onValueChange={setTeam}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={awaySlug}>{awayTeam}</SelectItem>
                    <SelectItem value={homeSlug}>{homeTeam}</SelectItem>
                  </SelectContent>
                </Select>
              </FieldLabel>
              <FieldLabel label="Period">
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">P1</SelectItem>
                    <SelectItem value="2">P2</SelectItem>
                    <SelectItem value="3">P3</SelectItem>
                    <SelectItem value="4">OT</SelectItem>
                    {isPlayoff && Array.from({ length: Math.max(0, state.period - 4) }, (_, i) => i + 5).map(p => (
                      <SelectItem key={p} value={String(p)}>{periodLabel(p, true)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldLabel>
            </div>
            <FieldLabel label="Clock (remaining)">
              <div className="flex items-center gap-1">
                <Input type="number" min={0} max={20} value={clockMin} onChange={(e) => setClockMin(e.target.value)} className="h-8 text-xs w-16 text-center" />
                <span className="text-muted-foreground">:</span>
                <Input type="number" min={0} max={59} value={clockSec} onChange={(e) => setClockSec(e.target.value)} className="h-8 text-xs w-16 text-center" />
              </div>
            </FieldLabel>
            <FieldLabel label="Scorer">
              <Select value={scorerId} onValueChange={setScorerId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select scorer" /></SelectTrigger>
                <SelectContent>
                  {availablePlayers.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabel>
            <FieldLabel label="Assist 1">
              <Select value={assist1Id} onValueChange={setAssist1Id}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {availablePlayers.filter((p) => String(p.id) !== scorerId).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabel>
            <FieldLabel label="Assist 2">
              <Select value={assist2Id} onValueChange={setAssist2Id}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {availablePlayers.filter((p) => String(p.id) !== scorerId && String(p.id) !== assist1Id).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabel>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-[11px]">
                <Checkbox checked={ppg} onCheckedChange={(v) => setPpg(!!v)} /> PPG
              </label>
              <label className="flex items-center gap-1.5 text-[11px]">
                <Checkbox checked={shg} onCheckedChange={(v) => setShg(!!v)} /> SHG
              </label>
              <label className="flex items-center gap-1.5 text-[11px]">
                <Checkbox checked={eng} onCheckedChange={(v) => setEng(!!v)} /> ENG
              </label>
            </div>
          </div>
          <DialogFooter className="flex-row justify-between sm:justify-end">
            {editingGoal && (
              <Button variant="ghost" onClick={() => { handleDelete(editingGoal.id); setDialogOpen(false) }} className="text-xs text-destructive hover:text-destructive">
                Delete
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="text-xs">Cancel</Button>
              <Button onClick={handleSave} disabled={!scorerId} className="text-xs">
                {editingGoal ? "Update" : "Add"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
