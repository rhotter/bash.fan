"use client"

import { useMemo } from "react"
import { type BashGame } from "@/lib/hockey-data"
import { Loader2 } from "lucide-react"
import { WeekNavigator } from "@/components/week-navigator"
import { splitRegularAndPlayoff } from "@/lib/split-games"

export function ScoresTab({ games, isLoading }: { games: BashGame[]; isLoading: boolean }) {
  const { regular: regularGames, playoff: playoffGames, exhibition: exhibitionGames, tryout: tryoutGames } = useMemo(
    () => splitRegularAndPlayoff(games),
    [games]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
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
