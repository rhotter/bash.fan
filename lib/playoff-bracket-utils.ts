import type { BashGame } from "@/lib/hockey-data"
import { compareGamesChronological } from "@/lib/format-time"

export const ROUND_ORDER = ["play-in", "quarterfinal", "semifinal", "final"] as const
export type CanonicalRound = (typeof ROUND_ORDER)[number]

export const ROUND_LABELS: Record<CanonicalRound, string> = {
  "play-in": "Play-In",
  quarterfinal: "Quarterfinals",
  semifinal: "Semifinals",
  final: "Finals",
}

export function normalizeRound(round: string | null | undefined): CanonicalRound | null {
  if (!round) return null
  const r = round.toLowerCase()
  if (r === "play-in" || r === "playin") return "play-in"
  if (r === "quarterfinal" || r === "quarterfinals") return "quarterfinal"
  if (r === "semifinal" || r === "semifinals") return "semifinal"
  if (r === "final" || r === "finals" || r === "championship") return "final"
  return null
}

export interface SeriesSide {
  name: string
  slug: string
  isTbd: boolean
  wins: number
}

export interface BracketSeries {
  seriesId: string
  round: CanonicalRound
  games: BashGame[]
  top: SeriesSide
  bottom: SeriesSide
  clinchedBy: "top" | "bottom" | null
}

export interface BracketRoundColumn {
  round: CanonicalRound
  label: string
  series: BracketSeries[]
}

export function hasBracketMetadata(games: BashGame[]): boolean {
  return games.some((g) => Boolean(g.seriesId && normalizeRound(g.bracketRound)))
}

export function buildBracketRounds(games: BashGame[]): BracketRoundColumn[] {
  const byRound = new Map<CanonicalRound, Map<string, BashGame[]>>()

  for (const g of games) {
    const round = normalizeRound(g.bracketRound)
    if (!round || !g.seriesId) continue
    if (!byRound.has(round)) byRound.set(round, new Map())
    const roundMap = byRound.get(round)!
    if (!roundMap.has(g.seriesId)) roundMap.set(g.seriesId, [])
    roundMap.get(g.seriesId)!.push(g)
  }

  return ROUND_ORDER.filter((r) => byRound.has(r)).map((round) => {
    const seriesMap = byRound.get(round)!
    const seriesList: BracketSeries[] = [...seriesMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([seriesId, rawGames]) => {
        const sortedGames = [...rawGames].sort((a, b) => {
          if (a.seriesGameNumber != null && b.seriesGameNumber != null && a.seriesGameNumber !== b.seriesGameNumber) {
            return a.seriesGameNumber - b.seriesGameNumber
          }
          const d = a.date.localeCompare(b.date)
          return d !== 0 ? d : compareGamesChronological(a, b)
        })

        const refGame = sortedGames[0]
        const refAwayTbd = !refGame.awaySlug || refGame.awaySlug === "tbd"
        const refHomeTbd = !refGame.homeSlug || refGame.homeSlug === "tbd"

        const top: SeriesSide = {
          name: refAwayTbd && refGame.awayPlaceholder ? refGame.awayPlaceholder : refGame.awayTeam,
          slug: refGame.awaySlug || "tbd",
          isTbd: refAwayTbd,
          wins: 0,
        }
        const bottom: SeriesSide = {
          name: refHomeTbd && refGame.homePlaceholder ? refGame.homePlaceholder : refGame.homeTeam,
          slug: refGame.homeSlug || "tbd",
          isTbd: refHomeTbd,
          wins: 0,
        }

        if (top.isTbd || bottom.isTbd) {
          const candidates: { name: string; slug: string }[] = []
          for (const g of sortedGames) {
            if (g.awaySlug && g.awaySlug !== "tbd" && !candidates.some((c) => c.slug === g.awaySlug)) {
              candidates.push({ name: g.awayTeam, slug: g.awaySlug })
            }
            if (g.homeSlug && g.homeSlug !== "tbd" && !candidates.some((c) => c.slug === g.homeSlug)) {
              candidates.push({ name: g.homeTeam, slug: g.homeSlug })
            }
          }
          if (top.isTbd) {
            const match = candidates.find((c) => c.slug !== bottom.slug)
            if (match) {
              top.name = match.name
              top.slug = match.slug
              top.isTbd = false
            }
          }
          if (bottom.isTbd) {
            const match = candidates.find((c) => c.slug !== top.slug)
            if (match) {
              bottom.name = match.name
              bottom.slug = match.slug
              bottom.isTbd = false
            }
          }
        }

        for (const g of sortedGames) {
          if (g.status !== "final" || g.awayScore == null || g.homeScore == null || g.awayScore === g.homeScore) {
            continue
          }
          const winnerSlug = g.awayScore > g.homeScore ? g.awaySlug : g.homeSlug
          if (!top.isTbd && winnerSlug === top.slug) top.wins++
          else if (!bottom.isTbd && winnerSlug === bottom.slug) bottom.wins++
        }

        const winsNeeded = sortedGames.length === 1 ? 1 : Math.floor(sortedGames.length / 2) + 1
        const clinchedBy: "top" | "bottom" | null =
          top.wins >= winsNeeded ? "top" : bottom.wins >= winsNeeded ? "bottom" : null

        return {
          seriesId,
          round,
          games: sortedGames,
          top,
          bottom,
          clinchedBy,
        }
      })

    return {
      round,
      label: ROUND_LABELS[round],
      series: seriesList,
    }
  })
}
