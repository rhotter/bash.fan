"use client"

import { useMemo } from "react"
import { type BashGame } from "@/lib/hockey-data"
import { Loader2 } from "lucide-react"
import { WeekNavigator } from "@/components/week-navigator"

export function ScoresTab({ games, isLoading }: { games: BashGame[]; isLoading: boolean }) {
  const regularGames = useMemo(
    () => games.filter((g) => !g.isPlayoff),
    [games]
  )

  const playoffGames = useMemo(
    () => games.filter((g) => g.isPlayoff && g.homeSlug !== g.awaySlug),
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
    />
  )
}
