"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { RosterPlayer, ShootoutAttempt } from "@/lib/scorekeeper-types"

export function ShootoutPanel({
  homeSlug, awaySlug, homeTeam, awayTeam,
  shootout, homeRoster, awayRoster,
  onAttempt, onUndo,
}: {
  homeSlug: string; awaySlug: string; homeTeam: string; awayTeam: string
  shootout: { homeAttempts: ShootoutAttempt[]; awayAttempts: ShootoutAttempt[] }
  homeRoster: RosterPlayer[]; awayRoster: RosterPlayer[]
  onAttempt: (team: string, playerId: number, scored: boolean) => void
  onUndo: (team: string) => void
}) {
  const [selectedShooter, setSelectedShooter] = useState<string>("")
  const awayTurn = shootout.awayAttempts.length <= shootout.homeAttempts.length
  const currentTeam = awayTurn ? awaySlug : homeSlug
  const currentTeamName = awayTurn ? awayTeam : homeTeam
  const currentRoster = awayTurn ? awayRoster : homeRoster

  const homeGoals = shootout.homeAttempts.filter((a) => a.scored).length
  const awayGoals = shootout.awayAttempts.filter((a) => a.scored).length

  // Filter out already-used shooters (can't repeat until all have shot)
  const usedShooterIds = (awayTurn ? shootout.awayAttempts : shootout.homeAttempts).map((a) => a.playerId)
  const allShooterIds = new Set(currentRoster.map((p) => p.id))
  const availableShooters = usedShooterIds.length >= allShooterIds.size
    ? currentRoster // everyone has gone, reset pool
    : currentRoster.filter((p) => !usedShooterIds.includes(p.id))

  return (
    <div className="space-y-3">
      <div className="text-center">
        <span className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-secondary text-secondary-foreground">
          Shootout
        </span>
        <div className="flex items-baseline justify-center gap-3 mt-3">
          <div className="text-center">
            <div className="text-[11px] text-muted-foreground mb-0.5">{awayTeam}</div>
            <div className="text-2xl font-black font-mono tabular-nums">{awayGoals}</div>
          </div>
          <span className="text-muted-foreground/30">&ndash;</span>
          <div className="text-center">
            <div className="text-[11px] text-muted-foreground mb-0.5">{homeTeam}</div>
            <div className="text-2xl font-black font-mono tabular-nums">{homeGoals}</div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <div className="text-[10px] font-bold text-muted-foreground mb-2">{currentTeamName} shoots</div>
        <Select value={selectedShooter} onValueChange={setSelectedShooter}>
          <SelectTrigger><SelectValue placeholder="Select shooter" /></SelectTrigger>
          <SelectContent>
            {availableShooters.map((p) => (
              <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2 mt-2">
          <Button
            className="flex-1"
            onClick={() => { if (selectedShooter) { onAttempt(currentTeam, parseInt(selectedShooter), true); setSelectedShooter("") } }}
            disabled={!selectedShooter}
          >
            Goal
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => { if (selectedShooter) { onAttempt(currentTeam, parseInt(selectedShooter), false); setSelectedShooter("") } }}
            disabled={!selectedShooter}
          >
            Miss
          </Button>
        </div>
      </div>

      {/* Shootout log */}
      <div className="space-y-0">
        {[...shootout.awayAttempts.map((a, i) => ({ ...a, team: awaySlug, teamName: awayTeam, round: i + 1 })),
          ...shootout.homeAttempts.map((a, i) => ({ ...a, team: homeSlug, teamName: homeTeam, round: i + 1 })),
        ]
          .sort((a, b) => a.round - b.round)
          .map((a, i) => {
            const roster = a.team === homeSlug ? homeRoster : awayRoster
            const name = roster.find((p) => p.id === a.playerId)?.name ?? `#${a.playerId}`
            return (
              <div key={i} className="flex items-center gap-2 text-[11px] py-1 border-t border-border/20">
                <span className={cn("text-[9px] font-bold uppercase tracking-wider w-8", a.scored ? "text-foreground" : "text-muted-foreground/30")}>
                  {a.scored ? "GOAL" : "MISS"}
                </span>
                <span className="text-muted-foreground">{a.teamName}</span>
                <span>{name}</span>
              </div>
            )
          })}
      </div>

      {/* Undo buttons */}
      <div className="flex gap-2">
        {shootout.awayAttempts.length > 0 && (
          <button type="button" className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors" onClick={() => onUndo(awaySlug)}>
            Undo {awayTeam}
          </button>
        )}
        {shootout.homeAttempts.length > 0 && (
          <button type="button" className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors" onClick={() => onUndo(homeSlug)}>
            Undo {homeTeam}
          </button>
        )}
      </div>
    </div>
  )
}
