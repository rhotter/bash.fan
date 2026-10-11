"use client"

import { LoadingState } from "@/components/loading-state"
import { useMemo } from "react"
import { type BashGame } from "@/lib/hockey-data"
import { WeekNavigator } from "@/components/week-navigator"
import { splitRegularAndPlayoff } from "@/lib/split-games"

export function ScoresTab({ games, isLoading }: { games: BashGame[]; isLoading: boolean }) {
  const { regular: regularGames, playoff: playoffGames, exhibition: exhibitionGames, tryout: tryoutGames } = useMemo(
    () => splitRegularAndPlayoff(games),
    [games]
  )

  if (isLoading && games.length === 0) {
    return <LoadingState variant="scores" label="Loading scores…" />
  }

  return (
    <WeekNavigator
      games={regularGames}
      playoffGames={playoffGames.length > 0 ? playoffGames : undefined}
      exhibitionGames={exhibitionGames.length > 0 ? exhibitionGames : undefined}
      tryoutGames={tryoutGames.length > 0 ? tryoutGames : undefined}
    />
  )
}
