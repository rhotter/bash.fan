import type { BashGame, Standing } from "@/app/api/bash/route"
import { isLegacyTeamSlug } from "@/lib/team-filters"

export function computeStandings(games: BashGame[]): Standing[] {
  const teamMap = new Map<string, Standing>()

  const regularGames = games.filter(
    (g) =>
      g.gameType === "regular" &&
      !g.isPlayoff &&
      !isLegacyTeamSlug(g.homeSlug) &&
      !isLegacyTeamSlug(g.awaySlug)
  )

  for (const game of regularGames) {
    if (!teamMap.has(game.homeSlug)) {
      teamMap.set(game.homeSlug, {
        team: game.homeTeam, slug: game.homeSlug,
        gp: 0, w: 0, otw: 0, l: 0, otl: 0, gf: 0, ga: 0, gd: 0, pts: 0,
      })
    }
    if (!teamMap.has(game.awaySlug)) {
      teamMap.set(game.awaySlug, {
        team: game.awayTeam, slug: game.awaySlug,
        gp: 0, w: 0, otw: 0, l: 0, otl: 0, gf: 0, ga: 0, gd: 0, pts: 0,
      })
    }
  }

  for (const game of regularGames) {
    if (game.status !== "final") continue
    if (game.homeScore === null || game.awayScore === null) continue

    const home = teamMap.get(game.homeSlug)!
    const away = teamMap.get(game.awaySlug)!

    home.gp++; away.gp++

    if (game.isForfeit && game.homeScore === game.awayScore) {
      // Double forfeit: both teams receive a 0-5 regulation loss
      home.ga += 5
      away.ga += 5
      home.l++
      away.l++
      continue
    }

    home.gf += game.homeScore; home.ga += game.awayScore
    away.gf += game.awayScore; away.ga += game.homeScore

    if (game.homeScore > game.awayScore) {
      if (game.isOvertime || game.hasShootout) {
        home.otw++; home.pts += 2
        away.otl++; away.pts += 1
      } else {
        home.w++; home.pts += 3
        away.l++
      }
    } else {
      if (game.isOvertime || game.hasShootout) {
        away.otw++; away.pts += 2
        home.otl++; home.pts += 1
      } else {
        away.w++; away.pts += 3
        home.l++
      }
    }
  }

  for (const t of teamMap.values()) {
    t.gd = t.gf - t.ga
  }

  for (const slug of [...teamMap.keys()]) {
    if (isLegacyTeamSlug(slug)) teamMap.delete(slug)
  }

  return [...teamMap.values()].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
}
