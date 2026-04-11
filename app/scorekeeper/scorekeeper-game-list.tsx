"use client"

import type { BashGame } from "@/lib/hockey-data"
import { GameCard } from "@/components/game-card"
import { WeekNavigator } from "@/components/week-navigator"

const scorekeeperHref = (game: BashGame) => `/scorekeeper/${game.id}`

export function ScorekeeperGameList({ games }: { games: BashGame[] }) {
  const testGames = games.filter((g) => g.id.startsWith("test-"))
  const realGames = games.filter((g) => !g.id.startsWith("test-") && !(g.isPlayoff && g.homeSlug === g.awaySlug))

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
      <WeekNavigator games={realGames} gameHref={scorekeeperHref} />
    </div>
  )
}
