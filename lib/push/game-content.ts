import { periodLabel, formatClock } from "@/lib/scorekeeper-types"

export interface AlertGoal { id: string; scorerId: number; assist1Id?: number | null; assist2Id?: number | null; period: number; clock: string; team: string }
export function goalText(goal: AlertGoal, names: Record<string, string>, playoff = false) {
 const scorer = names[goal.scorerId] ?? "Goal"
 const assists = [goal.assist1Id, goal.assist2Id].filter((id): id is number => id != null).map(id => names[id]).filter(Boolean)
 return { scorer, play: `${scorer} · ${periodLabel(goal.period, playoff)} ${goal.clock}`, assists: assists.length ? `Assists: ${assists.join(", ")}` : "" }
}
export interface LiveScoreSource {
 status: string; home_score: number | null; away_score: number | null; is_playoff: boolean;
 state?: { period?: number; clockSeconds?: number; clockRunning?: boolean; clockStartedAt?: number | null; goals?: AlertGoal[]; finalizationPending?: unknown } | null;
}
export function liveScoreContent(row: LiveScoreSource, names: Record<string, string> = {}, now = Date.now()) {
 const state = row.state
 const final = row.status === "final" && !state?.finalizationPending
 const period = state?.period ?? 0
 const base = Math.max(0, state?.clockSeconds ?? 0)
 const running = row.status === "live" && state?.clockRunning === true && !!state.clockStartedAt
 const seconds = Math.max(0, base - (running ? Math.max(0, now - state!.clockStartedAt!) / 1000 : 0))
 const goal = state?.goals?.slice().sort((a, b) => b.period - a.period || clockValue(a.clock) - clockValue(b.clock)).at(0)
 const event = goal ? goalText(goal, names, row.is_playoff) : null
 return {
  homeScore: row.home_score ?? 0, awayScore: row.away_score ?? 0,
  period: periodLabel(period, row.is_playoff), clock: formatClock(seconds),
  // Numeric seconds since Unix epoch, shared explicitly with Swift (not Codable Date).
  clockEndsAt: running ? now / 1000 + seconds : null,
  final, status: final ? "Final" : row.status === "live" ? "Live" : "Game paused",
  scorer: event?.play ?? "", assists: event?.assists ?? "",
 }
}
function clockValue(clock: string) { const [m, s] = clock.split(":").map(Number); return (m || 0) * 60 + (s || 0) }
