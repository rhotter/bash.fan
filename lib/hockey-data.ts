import useSWR from "swr"
import type { BashApiData, BashGame, Standing } from "@/app/api/bash/route"
import type { PlayerStatsData, SkaterStat, GoalieStat } from "@/app/api/bash/players/route"
import type { RefStatsData, RefStat } from "@/app/api/bash/refs/route"
import type { BashGameDetail } from "@/app/api/bash/game/[id]/route"
import type { SeasonsData } from "@/app/api/bash/seasons/route"

export type { BashApiData, BashGame, Standing, PlayerStatsData, SkaterStat, GoalieStat, RefStatsData, RefStat, BashGameDetail, SeasonsData }

const fetcher = (url: string) => fetch(url).then((res) => res.json())

// Fire-and-forget sync trigger — at most once per page load
let syncTriggered = false
function triggerSync() {
  if (syncTriggered) return
  syncTriggered = true
  fetch("/api/bash/sync").catch(() => {})
}

export function useBashData(season?: string, fallbackData?: BashApiData) {
  const url = season ? `/api/bash?season=${season}` : "/api/bash"
  const isCurrentSeason = !season

  const { data, error, isLoading, mutate } = useSWR<BashApiData>(url, fetcher, {
    refreshInterval: (latestData) => (latestData ?? fallbackData)?.games?.some((g) => g.status === "live") ? 10_000 : 60_000,
    revalidateOnFocus: true,
    dedupingInterval: 5_000,
    onSuccess: () => { if (isCurrentSeason) triggerSync() },
    fallbackData,
  })

  return {
    games: data?.games ?? [],
    standings: data?.standings ?? [],
    lastUpdated: data?.lastUpdated ?? null,
    isLoading: fallbackData ? false : isLoading,
    isError: !!error,
    refresh: mutate,
  }
}

export function usePlayerStats(season?: string, fallbackData?: PlayerStatsData, playoff?: boolean) {
  const params = new URLSearchParams()
  if (season) params.set("season", season)
  if (playoff) params.set("playoff", "true")
  const qs = params.toString()
  const url = qs ? `/api/bash/players?${qs}` : "/api/bash/players"

  const { data, error, isLoading } = useSWR<PlayerStatsData>(url, fetcher, {
    refreshInterval: 120_000,
    revalidateOnFocus: true,
    dedupingInterval: 60_000,
    fallbackData,
  })

  return {
    skaters: data?.skaters ?? [],
    goalies: data?.goalies ?? [],
    teams: data?.teams ?? [],
    hasPlayoffs: data?.hasPlayoffs ?? false,
    lastUpdated: data?.lastUpdated ?? null,
    isLoading: fallbackData ? false : isLoading,
    isError: !!error,
  }
}

export function useRefStats() {
  const { data, error, isLoading } = useSWR<RefStatsData>("/api/bash/refs", fetcher, {
    refreshInterval: 120_000,
    revalidateOnFocus: true,
    dedupingInterval: 60_000,
  })

  return {
    refs: data?.refs ?? [],
    lastUpdated: data?.lastUpdated ?? null,
    isLoading,
    isError: !!error,
  }
}

export function useGameDetail(gameId: string | null, fallbackData?: BashGameDetail) {
  const { data, error, isLoading } = useSWR<BashGameDetail>(
    gameId ? `/api/bash/game/${gameId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000, fallbackData }
  )

  return {
    detail: data ?? null,
    isLoading: fallbackData ? false : isLoading,
    isError: !!error,
  }
}

export function useSeasons() {
  const { data, error, isLoading } = useSWR<SeasonsData>("/api/bash/seasons", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
  })

  return {
    seasons: data?.seasons ?? [],
    isLoading,
    isError: !!error,
  }
}

export function useLiveGame(gameId: string | null, fallbackData?: unknown) {
  const { data, error, isLoading } = useSWR(
    gameId ? `/api/bash/game/${gameId}/live` : null,
    fetcher,
    { refreshInterval: 10_000, revalidateOnFocus: true, dedupingInterval: 5_000, fallbackData }
  )

  return {
    liveData: data ?? null,
    isLoading,
    isError: !!error,
  }
}

// Get unique dates from games (for grouping)
export function getGameDates(games: BashGame[]): string[] {
  return [...new Set(games.map((g) => g.date))].sort().reverse()
}

export function getSeriesText(game: BashGame, allGames: BashGame[]): string | null {
  if (!game.seriesId || !game.bracketRound) return null

  // Filter to games in this series that are completed and ordered up to this game
  const seriesGames = allGames.filter((g) => g.seriesId === game.seriesId)
  const relevantGames = seriesGames.filter((g) =>
    g.status === "final" &&
    g.homeScore !== null &&
    g.awayScore !== null &&
    g.seriesGameNumber !== null &&
    game.seriesGameNumber !== null &&
    g.seriesGameNumber <= (game.status === "final" ? game.seriesGameNumber : game.seriesGameNumber - 1)
  )

  let homeWins = 0
  let awayWins = 0
  const team1 = game.homeTeam
  const team2 = game.awayTeam

  for (const g of relevantGames) {
    const homeWon = g.homeScore! > g.awayScore!
    if (g.homeTeam === team1) {
      if (homeWon) homeWins++
      else awayWins++
    } else {
      if (homeWon) awayWins++
      else homeWins++
    }
  }

  const roundName = game.bracketRound.charAt(0).toUpperCase() + game.bracketRound.slice(1)
  const prefix = `${roundName}, Game ${game.seriesGameNumber} \u2022 `

  if (homeWins === 0 && awayWins === 0) {
    if (game.seriesGameNumber === 1) return `${roundName}, Game 1`
    return `${prefix}Series tied 0-0`
  }

  if (homeWins === awayWins) {
    return `${prefix}Series tied ${homeWins}-${awayWins}`
  }

  const leadingTeam = homeWins > awayWins ? team1 : team2
  const leadingWins = Math.max(homeWins, awayWins)
  const trailingWins = Math.min(homeWins, awayWins)

  const totalSeriesGames = allGames.filter((g) => g.seriesId === game.seriesId).length
  const winsRequired = Math.floor(totalSeriesGames / 2) + 1

  const verbWin = leadingTeam.endsWith('s') ? 'win' : 'wins'
  const verbLead = leadingTeam.endsWith('s') ? 'lead' : 'leads'

  if (leadingWins === winsRequired) {
    if (game.bracketRound === "finals") {
      return `${prefix}\uD83C\uDFC6 ${leadingTeam} ${verbWin} the Championship!`
    }
    if (game.bracketRound === "play-in") {
      return `${prefix}${leadingTeam} ${verbWin} play-in`
    }
    return `${prefix}${leadingTeam} ${verbWin} series ${leadingWins}-${trailingWins}`
  }

  return `${prefix}${leadingTeam} ${verbLead} series ${leadingWins}-${trailingWins}`
}
