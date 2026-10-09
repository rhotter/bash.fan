"use client"

import { Input } from "@/components/ui/input"

export interface ShotAllocationGoalie { id: number; name: string; team: string }

export function GoalieShotAllocation({ goalies, value, onChange }: {
  goalies: ShotAllocationGoalie[]
  value: Record<string, number> | undefined
  onChange: (allocation: Record<string, number>) => void
}) {
  if (!goalies.length) return null
  return <div className="space-y-2 text-xs">
    <p className="font-medium">Goalie shots against</p>
    <p className="text-muted-foreground">Leave blank for a single full-game goalie. After goalie changes or pulls, enter each goalie's recorded shots against. Totals exclude empty-net goals.</p>
    {goalies.map((goalie) => <label key={`${goalie.team}-${goalie.id}`} className="flex items-center justify-between gap-2">
      <span>{goalie.name} ({goalie.team})</span>
      <Input type="number" min={0} step={1} className="h-8 w-20 text-xs" placeholder="Auto"
        aria-label={`Shots against for ${goalie.name} (${goalie.team})`}
        value={value?.[goalie.id] ?? ""}
        onChange={(event) => {
          const next = { ...value }
          if (event.target.value === "") delete next[goalie.id]
          else next[goalie.id] = Number(event.target.value)
          onChange(next)
        }} />
    </label>)}
  </div>
}
