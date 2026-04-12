import type { BashGame } from "@/lib/hockey-data"

export function splitRegularAndPlayoff(games: BashGame[]) {
  const regular = games.filter((g) => !g.isPlayoff)
  const playoff = games.filter((g) => g.isPlayoff && g.homeSlug !== g.awaySlug)
  return { regular, playoff }
}
