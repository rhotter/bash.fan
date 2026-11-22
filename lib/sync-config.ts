// Refresh and deduping intervals (ms) for client-side SWR hooks.
// Tune here, not at call sites.

export const REFRESH = {
  LIVE_GAME: 10_000,
  SCORES: 60_000,
  PLAYER_STATS: 120_000,
  REFS: 120_000,
  PLAYOFF_ODDS: 120_000,
} as const

export const DEDUPE = {
  LIVE_GAME: 5_000,
  SCORES: 5_000,
  PLAYER_STATS: 60_000,
  REFS: 60_000,
  GAME_DETAIL: 30_000,
  SEASONS: 300_000,
  PLAYOFF_ODDS: 30_000,
} as const
