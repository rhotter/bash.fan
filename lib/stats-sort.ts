import type { SkaterStat, GoalieStat } from "./fetch-player-stats"

// Mirror StatMetric / GoalieMetric in ios/BASH/Sources/LeagueData.swift.
// Pin the locale so device/browser language does not change tied rankings.
const names = new Intl.Collator("en-US", { sensitivity: "base", numeric: true })
function identity(a: { name: string; id: number }, b: { name: string; id: number }) {
  return names.compare(a.name, b.name) || a.id - b.id
}

export function compareSkaterStats(a: SkaterStat, b: SkaterStat, key: keyof SkaterStat, dir: "asc" | "desc") {
  const value = (p: SkaterStat) => key === "ptsPg"
    ? (p.gp > 0 ? p.points / p.gp : 0)
    : Number(p[key] ?? 0)
  const difference = value(a) - value(b)
  return (dir === "asc" ? difference : -difference)
    || b.points - a.points || b.goals - a.goals || identity(a, b)
}

export function compareGoalieStats(a: GoalieStat, b: GoalieStat, key: keyof GoalieStat, dir: "asc" | "desc") {
  const difference = Number(a[key] ?? 0) - Number(b[key] ?? 0)
  return (dir === "asc" ? difference : -difference) || identity(a, b)
}
