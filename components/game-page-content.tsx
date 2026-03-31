"use client"

import { GameDetail } from "@/components/game-detail"
import type { BashGameDetail } from "@/lib/hockey-data"
import type { BashGame } from "@/lib/hockey-data"
import type { LiveGameData } from "@/lib/fetch-live-game"
import type { RosterPlayer } from "@/lib/scorekeeper-types"

export function GamePageContent({ initialDetail, initialLiveData, homeRoster, awayRoster }: {
  initialDetail: BashGameDetail
  initialLiveData?: LiveGameData | null
  homeRoster?: RosterPlayer[]
  awayRoster?: RosterPlayer[]
}) {
  const game: BashGame = {
    id: initialDetail.id,
    date: initialDetail.date,
    time: initialDetail.time,
    homeTeam: initialDetail.homeTeam,
    homeSlug: initialDetail.homeSlug,
    awayTeam: initialDetail.awayTeam,
    awaySlug: initialDetail.awaySlug,
    homeScore: initialDetail.homeScore,
    awayScore: initialDetail.awayScore,
    status: initialDetail.status as "final" | "upcoming" | "live",
    isOvertime: initialDetail.isOvertime,
    isPlayoff: false,
    location: initialDetail.location,
    hasBoxscore: initialDetail.homePlayers.length > 0 || initialDetail.awayPlayers.length > 0,
    hasLiveStats: !!initialLiveData,
    livePeriod: (initialLiveData?.state as any)?.period ?? null,
    liveClockSeconds: (initialLiveData?.state as any)?.clockSeconds ?? null,
    liveClockRunning: (initialLiveData?.state as any)?.clockRunning ?? null,
    liveClockStartedAt: (initialLiveData?.state as any)?.clockStartedAt ?? null,
  }

  return (
    <GameDetail
      game={game}
      initialDetail={initialDetail}
      initialLiveData={initialLiveData ?? undefined}
      homeRoster={homeRoster}
      awayRoster={awayRoster}
    />
  )
}
