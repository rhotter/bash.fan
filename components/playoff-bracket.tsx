"use client"

import { useMemo } from "react"
import { IntentLink } from "@/components/intent-link"
import { TeamLogo } from "@/components/team-logo"
import type { BashGame } from "@/lib/hockey-data"
import { formatGameDateShort } from "@/lib/format-time"
import {
  buildBracketRounds,
  hasBracketMetadata,
  type BracketSeries,
  type SeriesSide,
} from "@/lib/playoff-bracket-utils"
import { cn } from "@/lib/utils"

export { hasBracketMetadata }

export function PlayoffBracket({ games }: { games: BashGame[] }) {
  const rounds = useMemo(() => buildBracketRounds(games), [games])

  if (rounds.length === 0) return null

  return (
    <section aria-label="Playoff Bracket" className="rounded-lg border border-border/50 bg-card/50 p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Playoff Bracket
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-flow-col md:auto-cols-fr gap-4 overflow-x-auto">
        {rounds.map((col) => (
          <div key={col.round} className="flex flex-col gap-2.5 min-w-[210px]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-0.5">
              {col.label}
            </div>
            <div className={cn("flex flex-col flex-1 gap-3", col.round === "play-in" ? "justify-start" : "justify-around")}>
              {col.series.map((s) => (
                <SeriesCard key={s.seriesId} series={s} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

interface GameCell {
  id: string
  label: string
  score: number | null
  won: boolean
  lost: boolean
  isLive: boolean
}

function getTeamScoresForGame(
  g: BashGame,
  top: SeriesSide,
  bottom: SeriesSide,
): { topScore: number | null; bottomScore: number | null } {
  if (g.status !== "final" && g.status !== "live") {
    return { topScore: null, bottomScore: null }
  }
  const awayScore = g.awayScore ?? 0
  const homeScore = g.homeScore ?? 0

  if (!top.isTbd) {
    if (g.awaySlug === top.slug) return { topScore: awayScore, bottomScore: homeScore }
    if (g.homeSlug === top.slug) return { topScore: homeScore, bottomScore: awayScore }
  }
  if (!bottom.isTbd) {
    if (g.homeSlug === bottom.slug) return { topScore: awayScore, bottomScore: homeScore }
    if (g.awaySlug === bottom.slug) return { topScore: homeScore, bottomScore: awayScore }
  }
  return { topScore: awayScore, bottomScore: homeScore }
}

function SeriesCard({ series }: { series: BracketSeries }) {
  const isSingleGame = series.games.length === 1
  const singleGame = isSingleGame ? series.games[0] : null
  const seriesLabel = series.seriesId === "play-in" ? "Play-In" : series.seriesId === "final" ? "Final" : series.seriesId.toUpperCase()

  const topCells: GameCell[] = []
  const bottomCells: GameCell[] = []

  if (!isSingleGame) {
    series.games.forEach((g, idx) => {
      const label = `G${g.seriesGameNumber ?? idx + 1}`
      const { topScore, bottomScore } = getTeamScoresForGame(g, series.top, series.bottom)
      const isFinal = g.status === "final"
      const isLive = g.status === "live"
      const topWon = isFinal && topScore != null && bottomScore != null && topScore > bottomScore
      const bottomWon = isFinal && topScore != null && bottomScore != null && bottomScore > topScore

      topCells.push({ id: g.id, label, score: topScore, won: topWon, lost: bottomWon, isLive })
      bottomCells.push({ id: g.id, label, score: bottomScore, won: bottomWon, lost: topWon, isLive })
    })
  }

  const singleScores = singleGame ? getTeamScoresForGame(singleGame, series.top, series.bottom) : null
  const topScore = isSingleGame
    ? singleScores?.topScore ?? "–"
    : series.top.wins
  const bottomScore = isSingleGame
    ? singleScores?.bottomScore ?? "–"
    : series.bottom.wins

  const unplayedGames = series.games.filter((g) => g.status !== "final" && g.status !== "live")

  return (
    <div className="rounded-lg border border-border/50 bg-card overflow-hidden">
      <div className="px-2.5 py-1 border-b border-border/30 bg-muted/30 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="font-semibold shrink-0">{seriesLabel}</span>
        {isSingleGame ? (
          <span>Single Game</span>
        ) : (
          <div className="flex items-center gap-1.5 font-mono">
            {series.games.map((g, idx) => (
              <IntentLink
                key={g.id}
                href={`/game/${g.id}`}
                className="w-5 text-center hover:text-foreground transition-colors"
              >
                G{g.seriesGameNumber ?? idx + 1}
              </IntentLink>
            ))}
            <span className="w-6 text-right font-semibold text-foreground">SER</span>
          </div>
        )}
      </div>

      <div className="divide-y divide-border/20">
        <SeriesTeamRow
          side={series.top}
          gameCells={topCells}
          seriesScore={topScore}
          singleGameHref={singleGame && (singleGame.status === "final" || singleGame.status === "live") ? `/game/${singleGame.id}` : undefined}
          won={series.clinchedBy === "top"}
          lost={series.clinchedBy === "bottom"}
        />
        <SeriesTeamRow
          side={series.bottom}
          gameCells={bottomCells}
          seriesScore={bottomScore}
          singleGameHref={singleGame && (singleGame.status === "final" || singleGame.status === "live") ? `/game/${singleGame.id}` : undefined}
          won={series.clinchedBy === "bottom"}
          lost={series.clinchedBy === "top"}
        />
      </div>

      {unplayedGames.length > 0 && (
        <div className="px-2.5 py-1.5 border-t border-border/20 bg-muted/15 flex flex-wrap gap-1.5">
          {unplayedGames.map((g) => {
            const gameIdx = series.games.indexOf(g)
            const label = isSingleGame ? "" : `G${g.seriesGameNumber ?? gameIdx + 1}: `
            return (
              <IntentLink
                key={g.id}
                href={`/game/${g.id}`}
                className="text-[10px] tabular-nums text-muted-foreground hover:text-foreground bg-background/70 hover:bg-muted border border-border/40 rounded px-1.5 py-0.5 transition-colors"
              >
                {label}
                {formatGameDateShort(g.date)}
              </IntentLink>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SeriesTeamRow({
  side,
  gameCells,
  seriesScore,
  singleGameHref,
  won,
  lost,
}: {
  side: SeriesSide
  gameCells: GameCell[]
  seriesScore: number | string
  singleGameHref?: string
  won: boolean
  lost: boolean
}) {
  const nameClass = cn(
    "text-xs truncate",
    won ? "font-bold text-foreground" : lost ? "text-muted-foreground/60" : "font-medium text-foreground",
  )

  return (
    <div className="px-2.5 py-1.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <TeamLogo slug={side.slug || "tbd"} name={side.name} size={18} className={cn("shrink-0", lost && "opacity-50")} />
        {side.isTbd ? (
          <span className={nameClass}>{side.name}</span>
        ) : (
          <IntentLink href={`/team/${side.slug}`} className={cn(nameClass, "hover:text-primary transition-colors")}>
            {side.name}
          </IntentLink>
        )}
      </div>

      <div className="flex items-center gap-1.5 font-mono tabular-nums text-xs shrink-0">
        {gameCells.map((cell) => (
          <IntentLink
            key={cell.id}
            href={`/game/${cell.id}`}
            className={cn(
              "w-5 text-center hover:text-primary transition-colors",
              cell.won
                ? "font-bold text-foreground"
                : cell.lost
                  ? "text-muted-foreground/50"
                  : cell.isLive
                    ? "font-bold text-red-500"
                    : "text-muted-foreground/40",
            )}
          >
            {cell.score ?? "–"}
          </IntentLink>
        ))}

        {singleGameHref ? (
          <IntentLink
            href={singleGameHref}
            className={cn(
              "w-6 text-right hover:text-primary transition-colors",
              won ? "font-bold text-foreground" : lost ? "text-muted-foreground/50" : "text-muted-foreground",
            )}
          >
            {seriesScore}
          </IntentLink>
        ) : (
          <span
            className={cn(
              gameCells.length > 0 && "w-6 text-right",
              won ? "font-bold text-foreground" : lost ? "text-muted-foreground/50" : "text-muted-foreground",
            )}
          >
            {seriesScore}
          </span>
        )}
      </div>
    </div>
  )
}
