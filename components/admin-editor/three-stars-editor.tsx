"use client"

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import type { LiveGameState, RosterPlayer } from "@/lib/scorekeeper-types"
import { TeamLogo } from "@/components/team-logo"

export function ThreeStarsEditor({ state, onChange, homeRoster, awayRoster, homeSlug, awaySlug, homeTeam, awayTeam }: {
  state: LiveGameState
  onChange: (stars: number[]) => void
  homeRoster: RosterPlayer[]; awayRoster: RosterPlayer[]
  homeSlug: string; awaySlug: string
  homeTeam: string; awayTeam: string
}) {
  const stars = state.threeStars ?? [0, 0, 0]
  const allAttending = [
    ...awayRoster.filter((p) => state.awayAttendance.includes(p.id)).map((p) => ({ ...p, teamSlug: awaySlug, teamName: awayTeam })),
    ...homeRoster.filter((p) => state.homeAttendance.includes(p.id)).map((p) => ({ ...p, teamSlug: homeSlug, teamName: homeTeam })),
  ]

  const labels = ["1st Star", "2nd Star", "3rd Star"]

  function setStar(index: number, value: string) {
    const newStars = [...stars]
    newStars[index] = value === "none" ? 0 : parseInt(value)
    onChange(newStars)
  }

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Three Stars</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {labels.map((label, i) => (
          <div key={i}>
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
            <Select value={stars[i] ? String(stars[i]) : "none"} onValueChange={(v) => setStar(i, v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {allAttending.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)} textValue={p.name}>
                    <span className="inline-flex items-center gap-2">
                      <TeamLogo slug={p.teamSlug} name={p.teamName} size={20} className="shrink-0" />
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  )
}
