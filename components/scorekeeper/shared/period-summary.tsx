import { type LiveGameState } from "@/lib/scorekeeper-types"

export function PeriodSummary({ state, homeSlug, awaySlug, homeTeam, awayTeam, isPlayoff = false }: {
  isPlayoff?: boolean; state: LiveGameState; homeSlug: string; awaySlug: string; homeTeam: string; awayTeam: string
}) {
  const periods = Math.max(state.period, 3)
  const periodHeaders = Array.from({ length: Math.min(periods, isPlayoff ? 4 : 5) }, (_, i) => {
    const p = i + 1
    if (p <= 3) return `P${p}`
    if (p === 4) return "OT"
    return "SO"
  })

  const awayGoals = periodHeaders.map((_, i) =>
    state.goals.filter((g) => g.team === awaySlug && (isPlayoff && i === 3 ? g.period >= 4 : g.period === i + 1)).length
  )
  const homeGoals = periodHeaders.map((_, i) =>
    state.goals.filter((g) => g.team === homeSlug && (isPlayoff && i === 3 ? g.period >= 4 : g.period === i + 1)).length
  )

  return (
    <div className="overflow-x-auto">
      {isPlayoff && periods > 4 && <p className="text-[10px] text-muted-foreground">OT totals include all overtime periods.</p>}
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
            <th className="text-left font-medium py-1.5 pr-2"></th>
            {periodHeaders.map((h) => (
              <th key={h} className="text-center font-medium py-1.5 px-2 w-10">{h}</th>
            ))}
            <th className="text-center font-medium py-1.5 px-2 w-10">T</th>
          </tr>
        </thead>
        <tbody>
          {/* Goals */}
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium">Goals</td>
            <td colSpan={periodHeaders.length + 1}></td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-muted-foreground">{awayTeam}</td>
            {awayGoals.map((g, i) => (
              <td key={i} className="text-center tabular-nums font-mono py-1.5 px-2 text-muted-foreground">{g}</td>
            ))}
            <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">{awayGoals.reduce((a, b) => a + b, 0)}</td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-muted-foreground">{homeTeam}</td>
            {homeGoals.map((g, i) => (
              <td key={i} className="text-center tabular-nums font-mono py-1.5 px-2 text-muted-foreground">{g}</td>
            ))}
            <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">{homeGoals.reduce((a, b) => a + b, 0)}</td>
          </tr>
          {/* Shots */}
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium pt-3">Shots</td>
            <td colSpan={periodHeaders.length + 1}></td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-muted-foreground">{awayTeam}</td>
            {periodHeaders.map((_, i) => (
              <td key={i} className="text-center tabular-nums font-mono py-1.5 px-2 text-muted-foreground">{state.awayShots[i] ?? "—"}</td>
            ))}
            <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">{state.awayShots.reduce((a, b) => a + b, 0)}</td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-muted-foreground">{homeTeam}</td>
            {periodHeaders.map((_, i) => (
              <td key={i} className="text-center tabular-nums font-mono py-1.5 px-2 text-muted-foreground">{state.homeShots[i] ?? "—"}</td>
            ))}
            <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">{state.homeShots.reduce((a, b) => a + b, 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
