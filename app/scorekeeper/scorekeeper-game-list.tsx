"use client"

import type { BashGame } from "@/lib/hockey-data"
import { GameCard, DateSection } from "@/components/game-card"
import { formatGameDate } from "@/lib/format-time"

export function ScorekeeperGameList({ games }: { games: BashGame[] }) {
  // Separate test games from real games
  const testGames = games.filter((g) => g.id.startsWith("test-"))
  const realGames = games.filter((g) => !g.id.startsWith("test-"))

  // Group by date
  const grouped: Record<string, BashGame[]> = {}
  for (const game of realGames) {
    if (!grouped[game.date]) grouped[game.date] = []
    grouped[game.date].push(game)
  }

  // Upcoming/live dates first (chronological), then past dates (reverse chronological)
  const dates = Object.keys(grouped).sort((a, b) => {
    const aHasActive = grouped[a].some((g) => g.status !== "final")
    const bHasActive = grouped[b].some((g) => g.status !== "final")
    if (aHasActive && !bHasActive) return -1
    if (!aHasActive && bHasActive) return 1
    if (aHasActive && bHasActive) return a.localeCompare(b)
    return b.localeCompare(a)
  })

  const scorekeeperHref = (game: BashGame) => `/scorekeeper/${game.id}`

  return (
    <div className="flex flex-col gap-6">
      {testGames.length > 0 && (
        <div>
          <div className="mb-1.5">
            <span className="text-[11px] font-semibold text-amber-500">
              Test Games
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {testGames.map((game) => (
              <GameCard key={game.id} game={game} href={`/scorekeeper/${game.id}`} />
            ))}
          </div>
        </div>
      )}
      {dates.map((date) => (
        <DateSection key={date} date={date} games={grouped[date]} gameHref={scorekeeperHref} />
      ))}
    </div>
  )
}
