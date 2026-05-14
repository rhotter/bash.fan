import type { BashGame } from "@/lib/hockey-data"

export function splitRegularAndPlayoff(games: BashGame[]) {
  const regular = games.filter((g) => !g.isPlayoff && g.gameType === "regular")
  const playoff = games.filter((g) => g.isPlayoff || g.gameType === "playoff" || g.gameType === "championship")
  const exhibition = games.filter((g) => g.gameType === "exhibition")
  const tryout = games.filter((g) => g.gameType === "tryout")
  return { regular, playoff, exhibition, tryout }
}
