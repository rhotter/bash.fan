"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Pencil, Trash2, Plus } from "lucide-react"
import type { LiveGameState, GoalieChangeEvent, RosterPlayer } from "@/lib/scorekeeper-types"
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

export function GoalieChangesEditor({ isPlayoff = false, state, onChange, homeSlug, awaySlug, homeTeam, awayTeam, homeRoster, awayRoster, nameById }: {
  isPlayoff?: boolean
  state: LiveGameState
  onChange: (changes: GoalieChangeEvent[]) => void
  homeSlug: string; awaySlug: string
  homeTeam: string; awayTeam: string
  homeRoster: RosterPlayer[]; awayRoster: RosterPlayer[]
  nameById: (id: number | null) => string | null
}) {
  const changes = state.goalieChanges ?? []
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingChange, setEditingChange] = useState<GoalieChangeEvent | null>(null)

  const [team, setTeam] = useState(homeSlug)
  const [period, setPeriod] = useState("1")
  const [clockMin, setClockMin] = useState("20")
  const [clockSec, setClockSec] = useState("00")
  const [outGoalieId, setOutGoalieId] = useState("")
  const [inGoalieId, setInGoalieId] = useState("")

  function getTeamGoalies(teamSlug: string): RosterPlayer[] {
    const roster = teamSlug === homeSlug ? homeRoster : awayRoster
    const attendance = teamSlug === homeSlug ? state.homeAttendance : state.awayAttendance
    const goalieId = teamSlug === homeSlug ? state.homeGoalieId : state.awayGoalieId
    return roster
      .filter((p) => attendance.includes(p.id))
      .filter((p) => p.id === goalieId)
  }

  // For the "in" goalie, also allow non-goalie attending players (someone might sub in as goalie)
  function getTeamPlayers(teamSlug: string): RosterPlayer[] {
    const roster = teamSlug === homeSlug ? homeRoster : awayRoster
    const attendance = teamSlug === homeSlug ? state.homeAttendance : state.awayAttendance
    return roster.filter((p) => attendance.includes(p.id))
  }

  function openAdd() {
    setEditingChange(null)
    setTeam(homeSlug)
    setPeriod("1")
    setClockMin("20")
    setClockSec("00")
    setOutGoalieId("")
    setInGoalieId("")
    setDialogOpen(true)
  }

  function openEdit(change: GoalieChangeEvent) {
    setEditingChange(change)
    setTeam(change.team)
    setPeriod(String(change.period))
    const parts = change.clock.split(":")
    setClockMin(safeMin(parts[0]))
    setClockSec(safeSec(parts[1]))
    setOutGoalieId(String(change.outGoalieId))
    setInGoalieId(String(change.inGoalieId))
    setDialogOpen(true)
  }

  function handleSave() {
    const change: GoalieChangeEvent = {
      id: editingChange?.id ?? generateId(),
      team,
      period: parseInt(period),
      clock: `${safeMin(clockMin)}:${safeSec(clockSec)}`,
      outGoalieId: parseInt(outGoalieId),
      inGoalieId: parseInt(inGoalieId),
    }

    if (editingChange) {
      onChange(changes.map((c) => c.id === editingChange.id ? change : c))
    } else {
      onChange([...changes, change])
    }
    setDialogOpen(false)
  }

  function handleDelete(id: string) {
    onChange(changes.filter((c) => c.id !== id))
  }

  const teamGoalies = getTeamGoalies(team)
  const teamPlayers = getTeamPlayers(team)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Goalie Changes</h3>
        <Button size="sm" variant="outline" onClick={openAdd} className="h-7 text-[11px]">
          <Plus className="h-3 w-3 mr-1" /> Add Change
        </Button>
      </div>

      {changes.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 py-2">No goalie changes recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
                <th className="text-left font-medium py-1.5 pr-2">Team</th>
                <th className="text-left font-medium py-1.5 px-2">Per</th>
                <th className="text-left font-medium py-1.5 px-2">Time</th>
                <th className="text-left font-medium py-1.5 px-2">Out</th>
                <th className="text-left font-medium py-1.5 px-2">In</th>
                <th className="text-right font-medium py-1.5 pl-2 w-16 hidden sm:table-cell"></th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.id} className="border-t border-border/20 hover:bg-muted/50 cursor-pointer sm:cursor-default" onClick={() => openEdit(c)}>
                  <td className="py-1.5 pr-2">{c.team === homeSlug ? homeTeam : awayTeam}</td>
                  <td className="py-1.5 px-2">{periodLabel(c.period, isPlayoff)}</td>
                  <td className="py-1.5 px-2 tabular-nums font-mono">{c.clock}</td>
                  <td className="py-1.5 px-2">{nameById(c.outGoalieId) ?? `#${c.outGoalieId}`}</td>
                  <td className="py-1.5 px-2">{nameById(c.inGoalieId) ?? `#${c.inGoalieId}`}</td>
                  <td className="py-1.5 pl-2 text-right hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(c)} className="p-1 hover:text-primary transition-colors">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => handleDelete(c.id)} className="p-1 hover:text-destructive transition-colors">
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
            <DialogTitle className="text-sm">{editingChange ? "Edit Goalie Change" : "Add Goalie Change"}</DialogTitle>
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
            <FieldLabel label="Goalie Out">
              <Select value={outGoalieId} onValueChange={setOutGoalieId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select goalie leaving" /></SelectTrigger>
                <SelectContent>
                  {teamGoalies.length > 0 ? teamGoalies.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  )) : teamPlayers.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabel>
            <FieldLabel label="Goalie In">
              <Select value={inGoalieId} onValueChange={setInGoalieId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select goalie entering" /></SelectTrigger>
                <SelectContent>
                  {teamPlayers.filter((p) => String(p.id) !== outGoalieId).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabel>
          </div>
          <DialogFooter className="flex-row justify-between sm:justify-end">
            {editingChange && (
              <Button variant="ghost" onClick={() => { handleDelete(editingChange.id); setDialogOpen(false) }} className="text-xs text-destructive hover:text-destructive">
                Delete
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="text-xs">Cancel</Button>
              <Button onClick={handleSave} disabled={!outGoalieId || !inGoalieId} className="text-xs">
                {editingChange ? "Update" : "Add"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
