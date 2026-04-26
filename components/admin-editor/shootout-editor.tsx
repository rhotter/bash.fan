"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Trash2, Plus } from "lucide-react"
import type { LiveGameState, ShootoutState, RosterPlayer } from "@/lib/scorekeeper-types"
import { FieldLabel } from "@/components/scorekeeper/shared/field-label"

export function ShootoutEditor({ state, onChange, homeSlug, awaySlug, homeTeam, awayTeam, homeRoster, awayRoster }: {
  state: LiveGameState
  onChange: (shootout: ShootoutState | null) => void
  homeSlug: string; awaySlug: string
  homeTeam: string; awayTeam: string
  homeRoster: RosterPlayer[]; awayRoster: RosterPlayer[]
}) {
  const shootout = state.shootout
  const [dialogOpen, setDialogOpen] = useState(false)
  const [team, setTeam] = useState(awaySlug)
  const [playerId, setPlayerId] = useState("")
  const [result, setResult] = useState("miss")

  if (!shootout) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Shootout</h3>
          <Button
            size="sm" variant="outline" className="h-7 text-[11px]"
            onClick={() => onChange({ homeAttempts: [], awayAttempts: [] })}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Shootout
          </Button>
        </div>
        <p className="text-xs text-muted-foreground/50 py-2">No shootout.</p>
      </div>
    )
  }

  const allAttempts = [
    ...shootout.awayAttempts.map((a, i) => ({ ...a, team: awaySlug, teamName: awayTeam, index: i })),
    ...shootout.homeAttempts.map((a, i) => ({ ...a, team: homeSlug, teamName: homeTeam, index: i })),
  ]

  const roster = team === homeSlug ? homeRoster : awayRoster
  const attending = team === homeSlug ? state.homeAttendance : state.awayAttendance
  const availablePlayers = roster.filter((p) => attending.includes(p.id))

  function handleAdd() {
    if (!shootout) return
    const attempt = { playerId: parseInt(playerId), scored: result === "goal" }
    const newShootout: ShootoutState = { homeAttempts: [...shootout.homeAttempts], awayAttempts: [...shootout.awayAttempts] }
    if (team === homeSlug) {
      newShootout.homeAttempts = [...shootout.homeAttempts, attempt]
    } else {
      newShootout.awayAttempts = [...shootout.awayAttempts, attempt]
    }
    onChange(newShootout)
    setDialogOpen(false)
    setPlayerId("")
    setResult("miss")
  }

  function handleDeleteAttempt(teamSlug: string, index: number) {
    if (!shootout) return
    const newShootout: ShootoutState = { homeAttempts: [...shootout.homeAttempts], awayAttempts: [...shootout.awayAttempts] }
    if (teamSlug === homeSlug) {
      newShootout.homeAttempts = shootout.homeAttempts.filter((_, i) => i !== index)
    } else {
      newShootout.awayAttempts = shootout.awayAttempts.filter((_, i) => i !== index)
    }
    onChange(newShootout)
  }

  function handleRemoveShootout() {
    onChange(null)
  }

  const nameById = (id: number) => {
    const p = [...homeRoster, ...awayRoster].find((r) => r.id === id)
    return p?.name ?? `#${id}`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Shootout</h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => { setTeam(awaySlug); setDialogOpen(true) }} className="h-7 text-[11px]">
            <Plus className="h-3 w-3 mr-1" /> Add Attempt
          </Button>
          <Button size="sm" variant="ghost" onClick={handleRemoveShootout} className="h-7 text-[11px] text-destructive">
            Remove Shootout
          </Button>
        </div>
      </div>

      {allAttempts.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 py-2">No attempts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
                <th className="text-left font-medium py-1.5 pr-2">Team</th>
                <th className="text-left font-medium py-1.5 px-2">Player</th>
                <th className="text-left font-medium py-1.5 px-2">Result</th>
                <th className="text-right font-medium py-1.5 pl-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {allAttempts.map((a) => (
                <tr key={`${a.team}-${a.index}`} className="border-t border-border/20 hover:bg-muted/50">
                  <td className="py-1.5 pr-2">{a.teamName}</td>
                  <td className="py-1.5 px-2 font-medium">{nameById(a.playerId)}</td>
                  <td className="py-1.5 px-2">{a.scored ? "Goal" : "Miss"}</td>
                  <td className="py-1.5 pl-2 text-right">
                    <button onClick={() => handleDeleteAttempt(a.team, a.index)} className="p-1 hover:text-destructive transition-colors">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Add Shootout Attempt</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <FieldLabel label="Team">
              <Select value={team} onValueChange={setTeam}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={awaySlug}>{awayTeam}</SelectItem>
                  <SelectItem value={homeSlug}>{homeTeam}</SelectItem>
                </SelectContent>
              </Select>
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
            <FieldLabel label="Result">
              <Select value={result} onValueChange={setResult}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="goal">Goal</SelectItem>
                  <SelectItem value="miss">Miss</SelectItem>
                </SelectContent>
              </Select>
            </FieldLabel>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="text-xs">Cancel</Button>
            <Button onClick={handleAdd} disabled={!playerId} className="text-xs">Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
