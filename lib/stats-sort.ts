import type { SkaterStat, GoalieStat } from "./fetch-player-stats"

// NHL.com summary defaults: points/goals/assists and wins/savePct.
// Its request builder appends playerId ASC; single-column sorts use that alone.
// Sources: https://api.nhle.com/stats/rest/en/config and NHL stats client bundle.
// Mirror StatMetric / GoalieMetric in ios/BASH/Sources/LeagueData.swift.
export function compareSkaterStats(a: SkaterStat, b: SkaterStat, key: keyof SkaterStat, dir: "asc" | "desc") {
  const value = (p: SkaterStat) => key === "ptsPg"
    ? (p.gp > 0 ? p.points / p.gp : 0)
    : Number(p[key] ?? 0)
  const difference = value(a) - value(b)
  return (dir === "asc" ? difference : -difference)
    || (key === "points" ? b.goals - a.goals || b.assists - a.assists : 0)
    || a.id - b.id
}

export function compareGoalieStats(a: GoalieStat, b: GoalieStat, key: keyof GoalieStat, dir: "asc" | "desc") {
  const difference = Number(a[key] ?? 0) - Number(b[key] ?? 0)
  return (dir === "asc" ? difference : -difference) || (key === "wins" ? b.savePercentage - a.savePercentage : 0) || a.id - b.id
}
