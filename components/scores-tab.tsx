"use client"

import { LoadingState } from "@/components/loading-state"
import { useMemo } from "react"
import { type BashGame } from "@/lib/hockey-data"
import { WeekNavigator } from "@/components/week-navigator"
import { splitRegularAndPlayoff } from "@/lib/split-games"
import { IntentLink } from "@/components/intent-link"
import { CalendarDays } from "lucide-react"

export function ScoresTab({ games, isLoading, season }: { games: BashGame[]; isLoading: boolean; season?: string }) {
  const { regular: regularGames, playoff: playoffGames, exhibition: exhibitionGames, tryout: tryoutGames } = useMemo(
    () => splitRegularAndPlayoff(games),
    [games]
  )

  if (isLoading && games.length === 0) {
    return <LoadingState variant="scores" label="Loading scores…" />
  }

  const scheduleHref = season ? `/schedule?season=${season}` : "/schedule"

  return (
    <WeekNavigator
      games={regularGames}
      playoffGames={playoffGames.length > 0 ? playoffGames : undefined}
      exhibitionGames={exhibitionGames.length > 0 ? exhibitionGames : undefined}
      tryoutGames={tryoutGames.length > 0 ? tryoutGames : undefined}
      firstDateAction={
        <IntentLink
          href={scheduleHref}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground border border-border/40 hover:border-border bg-card/50 hover:bg-muted/40 px-2.5 py-1 rounded-md transition-colors shrink-0"
        >
          <CalendarDays className="h-3 w-3" />
          Full schedule
        </IntentLink>
      }
    />
  )
}
