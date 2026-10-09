import type { LiveGameState } from "./scorekeeper-types"

/** The admin editor fills missing legacy arrays on open; that is not an edit. */
export function gameEditMode(before: LiveGameState, after: LiveGameState): "unchanged" | "shots" | "full" | "mixed" {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  let shots = false
  let other = false
  for (const key of keys) {
    if (key === "updatedAt" || key === "shotCorrections" || key === "finalizationPending") continue
    const field = key as keyof LiveGameState
    const fallback = ["goaliePulls", "goalieChanges", "timeouts"].includes(key) ? [] : key === "goalieShotsAgainst" ? {} : undefined
    if (JSON.stringify(before[field] ?? fallback) === JSON.stringify(after[field] ?? fallback)) continue
    if (["homeShots", "awayShots", "goalieShotsAgainst"].includes(key)) shots = true
    else other = true
  }
  return shots ? (other ? "mixed" : "shots") : other ? "full" : "unchanged"
}
