"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, X } from "lucide-react"
import type { LiveGameState } from "@/lib/scorekeeper-types"

export function ShotsEditor({ state, onChange, homeTeam, awayTeam }: {
  state: LiveGameState
  onChange: (patch: Partial<LiveGameState>) => void
  homeTeam: string; awayTeam: string
}) {
  const hasOT = state.homeShots.length > 3 || state.awayShots.length > 3
  const periods = Math.max(state.homeShots.length, state.awayShots.length, 3)
  const headers = Array.from({ length: periods }, (_, i) => {
    const p = i + 1
    if (p <= 3) return `P${p}`
    if (p === 4) return "OT"
    return `P${p}`
  })

  function updateShot(isHome: boolean, periodIdx: number, value: string) {
    const shots = isHome ? [...state.homeShots] : [...state.awayShots]
    while (shots.length <= periodIdx) shots.push(0)
    shots[periodIdx] = Math.max(0, parseInt(value) || 0)
    if (isHome) {
      onChange({ homeShots: shots })
    } else {
      onChange({ awayShots: shots })
    }
  }

  function addOT() {
    const homeShots = [...state.homeShots]
    const awayShots = [...state.awayShots]
    while (homeShots.length < 4) homeShots.push(0)
    while (awayShots.length < 4) awayShots.push(0)
    onChange({ homeShots, awayShots })
  }

  function removeOT() {
    onChange({
      homeShots: state.homeShots.slice(0, 3),
      awayShots: state.awayShots.slice(0, 3),
    })
  }

  const awayTotal = state.awayShots.reduce((a, b) => a + b, 0)
  const homeTotal = state.homeShots.reduce((a, b) => a + b, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Shots</h3>
        {!hasOT ? (
          <Button size="sm" variant="outline" onClick={addOT} className="h-7 text-[11px]">
            <Plus className="h-3 w-3 mr-1" /> Add OT
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={removeOT} className="h-7 text-[11px] text-destructive hover:text-destructive">
            <X className="h-3 w-3 mr-1" /> Remove OT
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="text-[11px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
              <th className="text-left font-medium py-1.5 pr-4 min-w-[80px]"></th>
              {headers.map((h) => (
                <th key={h} className="text-center font-medium py-1.5 px-1 w-16">{h}</th>
              ))}
              <th className="text-center font-medium py-1.5 px-2 w-12">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border/20">
              <td className="py-1.5 pr-4 text-muted-foreground">{awayTeam}</td>
              {headers.map((_, i) => (
                <td key={i} className="py-1 px-1">
                  <Input
                    type="number"
                    min={0}
                    value={state.awayShots[i] ?? 0}
                    onChange={(e) => updateShot(false, i, e.target.value)}
                    className="h-7 text-xs text-center w-14 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </td>
              ))}
              <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">{awayTotal}</td>
            </tr>
            <tr className="border-t border-border/20">
              <td className="py-1.5 pr-4 text-muted-foreground">{homeTeam}</td>
              {headers.map((_, i) => (
                <td key={i} className="py-1 px-1">
                  <Input
                    type="number"
                    min={0}
                    value={state.homeShots[i] ?? 0}
                    onChange={(e) => updateShot(true, i, e.target.value)}
                    className="h-7 text-xs text-center w-14 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </td>
              ))}
              <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">{homeTotal}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
