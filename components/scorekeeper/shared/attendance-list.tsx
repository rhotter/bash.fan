import { Checkbox } from "@/components/ui/checkbox"
import type { RosterPlayer } from "@/lib/scorekeeper-types"

export function AttendanceList({
  label, count, team, roster, attendance, onToggle, onSelectAll, onUnselectAll, newPlayerIds,
}: {
  label: string; count: number; team: string; roster: RosterPlayer[]; attendance: number[]
  onToggle: (team: string, id: number) => void; onSelectAll: (team: string) => void
  onUnselectAll: (team: string) => void
  newPlayerIds?: Set<number>
}) {
  const allSelected = roster.length > 0 && roster.every((p) => attendance.includes(p.id))
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label} <span className="text-muted-foreground/40 font-normal">{count}</span></h4>
        <button
          onClick={() => allSelected ? onUnselectAll(team) : onSelectAll(team)}
          className="text-[9px] text-foreground hover:underline"
        >
          {allSelected ? "Unselect all" : "Select all"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {roster.map((p) => (
          <label key={p.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted/50 cursor-pointer">
            <Checkbox
              checked={attendance.includes(p.id)}
              onCheckedChange={() => onToggle(team, p.id)}
              className="data-[state=checked]:bg-foreground data-[state=checked]:border-foreground data-[state=checked]:text-background"
            />
            <span className="text-[11px] truncate flex-1">
              {p.name}
            </span>
            {newPlayerIds?.has(p.id) && (
              <span className="text-[8px] font-bold uppercase tracking-wider text-teal-600 bg-teal-500/10 px-1 py-0.5 rounded shrink-0">
                new
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  )
}
