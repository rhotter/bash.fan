/** A single fixed rink rig. Only observed scorekeeper activity establishes coverage. */
export interface ObservedGame {
  id: string
  status: string
  firstStart?: number
  observations: number[]
  clockStartedAt?: number | null
  clockSeconds?: number
  clockRunning?: boolean
}
export interface GameWindow { gameId: string; start: number; end: number }
const MAX_GAME_MS = 4 * 60 * 60 * 1000
const LIVE_GRACE_MS = 15 * 60 * 1000
export function gameWindows(games: ObservedGame[], now: number): GameWindow[] {
  return games.flatMap(game => {
    const start = game.firstStart
    if (!Number.isFinite(start) || start! > now) return []
    const observations = game.observations.filter(t => Number.isFinite(t) && t >= start! && t <= Math.min(now, start! + MAX_GAME_MS))
    const last = Math.max(start!, ...observations)
    const runningUntil = game.clockRunning && Number.isFinite(game.clockStartedAt) && Number.isFinite(game.clockSeconds)
      ? game.clockStartedAt! + Math.max(0, game.clockSeconds!) * 1000 : last
    const end = game.status === "live"
      ? Math.min(now, start! + MAX_GAME_MS, Math.max(last + LIVE_GRACE_MS, runningUntil))
      : last
    return end > start! ? [{ gameId: game.id, start: start!, end }] : []
  })
}
/** Whole clips only: crossing a boundary or any competing game is ambiguous. */
export function matchedGame(windows: GameWindow[], start: number, end: number): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const overlaps = windows.filter(w => w.start < end && w.end > start)
  return overlaps.length === 1 && overlaps[0].start <= start && overlaps[0].end >= end ? overlaps[0].gameId : null
}
export function liveGame(windows: GameWindow[], now: number): string | null {
  const matches = windows.filter(w => w.start <= now && w.end >= now)
  return matches.length === 1 ? matches[0].gameId : null
}
