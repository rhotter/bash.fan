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
import type { LiveGameState, PenaltyEvent, RosterPlayer } from "@/lib/scorekeeper-types"
import { periodLabel } from "@/lib/scorekeeper-types"
import { FieldLabel } from "@/components/scorekeeper/shared/field-label"
import { INFRACTIONS } from "@/components/scorekeeper/shared/constants"

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

export function PenaltiesEditor({ isPlayoff = false, state, onChange, homeSlug, awaySlug, homeTeam, awayTeam, homeRoster, awayRoster, nameById }: {
  isPlayoff?: boolean
  state: LiveGameState
  onChange: (penalties: PenaltyEvent[]) => void
  homeSlug: string; awaySlug: string
  homeTeam: string; awayTeam: string
  homeRoster: RosterPlayer[]; awayRoster: RosterPlayer[]
  nameById: (id: number | null) => string | null
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingPenalty, setEditingPenalty] = useState<PenaltyEvent | null>(null)

  const [team, setTeam] = useState(homeSlug)
  const [period, setPeriod] = useState("1")
  const [clockMin, setClockMin] = useState("20")
  const [clockSec, setClockSec] = useState("00")
  const [playerId, setPlayerId] = useState("")
  const [infraction, setInfraction] = useState("")
  const [minutes, setMinutes] = useState("2")

  function openAdd() {
    setEditingPenalty(null)
    setTeam(homeSlug)
    setPeriod("1")
    setClockMin("20")
    setClockSec("00")
    setPlayerId("")
    setInfraction("")
    setMinutes("2")
    setDialogOpen(true)
  }

  function openEdit(pen: PenaltyEvent) {
    setEditingPenalty(pen)
    setTeam(pen.team)
    setPeriod(String(pen.period))
    const parts = pen.clock.split(":")
    setClockMin(safeMin(parts[0]))
    setClockSec(safeSec(parts[1]))
    setPlayerId(String(pen.playerId))
    setInfraction(pen.infraction)
    setMinutes(String(pen.minutes))
    setDialogOpen(true)
  }

  function handleSave() {
    const pen: PenaltyEvent = {
      id: editingPenalty?.id ?? generateId(),
      team,
      period: parseInt(period),
      clock: `${safeMin(clockMin)}:${safeSec(clockSec)}`,
      playerId: parseInt(playerId),
      infraction,
      minutes: parseInt(minutes),
    }

    if (editingPenalty) {
      onChange(state.penalties.map((p) => p.id === editingPenalty.id ? pen : p))
    } else {
      onChange([...state.penalties, pen])
    }
    setDialogOpen(false)
  }

  function handleDelete(id: string) {
    onChange(state.penalties.filter((p) => p.id !== id))
  }

  const roster = team === homeSlug ? homeRoster : awayRoster
  const attending = team === homeSlug ? state.homeAttendance : state.awayAttendance
  const availablePlayers = roster.filter((p) => attending.includes(p.id))

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Penalties</h3>
        <Button size="sm" variant="outline" onClick={openAdd} className="h-7 text-[11px]">
          <Plus className="h-3 w-3 mr-1" /> Add Penalty
        </Button>
      </div>

      {state.penalties.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 py-2">No penalties recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
                <th className="text-left font-medium py-1.5 pr-2">Per</th>
                <th className="text-left font-medium py-1.5 px-2">Time</th>
                <th className="text-left font-medium py-1.5 px-2">Team</th>
                <th className="text-left font-medium py-1.5 px-2">Player</th>
                <th className="text-left font-medium py-1.5 px-2">Infraction</th>
                <th className="text-left font-medium py-1.5 px-2">Min</th>
                <th className="text-right font-medium py-1.5 pl-2 w-16 hidden sm:table-cell"></th>
              </tr>
            </thead>
            <tbody>
              {state.penalties.map((p) => (
                <tr key={p.id} className="border-t border-border/20 hover:bg-muted/50 cursor-pointer sm:cursor-default" onClick={() => openEdit(p)}>
                  <td className="py-1.5 pr-2">{periodLabel(p.period, isPlayoff)}</td>
                  <td className="py-1.5 px-2 tabular-nums font-mono">{p.clock}</td>
                  <td className="py-1.5 px-2">{p.team === homeSlug ? homeTeam : awayTeam}</td>
                  <td className="py-1.5 px-2 font-medium">{nameById(p.playerId) ?? `#${p.playerId}`}</td>
                  <td className="py-1.5 px-2 text-muted-foreground">{p.infraction}</td>
                  <td className="py-1.5 px-2 tabular-nums">{p.minutes}</td>
                  <td className="py-1.5 pl-2 text-right hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(p)} className="p-1 hover:text-primary transition-colors">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => handleDelete(p.id)} className="p-1 hover:text-destructive transition-colors">
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
            <DialogTitle className="text-sm">{editingPenalty ? "Edit Penalty" : "Add Penalty"}</DialogTitle>
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
            <FieldLabel label="Player">
              <Select value={playerId} onValueChange={setPlayerId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select player" /></SelectTrigger>
                <SelectContent>
                  {availablePlayers.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabel>
            <FieldLabel label="Infraction">
              <Select value={infraction} onValueChange={setInfraction}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select infraction" /></SelectTrigger>
                <SelectContent>
                  {INFRACTIONS.map((inf) => (
                    <SelectItem key={inf} value={inf}>{inf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabel>
            <FieldLabel label="Minutes">
              <Select value={minutes} onValueChange={setMinutes}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="4">4 (Double Minor)</SelectItem>
                  <SelectItem value="5">5 (Major)</SelectItem>
                  <SelectItem value="10">10 (Misconduct)</SelectItem>
                </SelectContent>
              </Select>
            </FieldLabel>
          </div>
          <DialogFooter className="flex-row justify-between sm:justify-end">
            {editingPenalty && (
              <Button variant="ghost" onClick={() => { handleDelete(editingPenalty.id); setDialogOpen(false) }} className="text-xs text-destructive hover:text-destructive">
                Delete
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="text-xs">Cancel</Button>
              <Button onClick={handleSave} disabled={!playerId || !infraction} className="text-xs">
                {editingPenalty ? "Update" : "Add"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
