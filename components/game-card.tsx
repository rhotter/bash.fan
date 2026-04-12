"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Pencil } from "lucide-react"
import { useRouter } from "next/navigation"
import { useAdmin } from "@/lib/admin-context"
import { TeamLogo } from "@/components/team-logo"
import { periodLabel, formatClock } from "@/lib/scorekeeper-types"
import { formatGameDate, formatGameTime } from "@/lib/format-time"
import type { BashGame } from "@/lib/hockey-data"

export function useLiveClock(game: BashGame) {
  const isLive = game.status === "live"
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!isLive || !game.liveClockRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isLive, game.liveClockRunning])

  if (!isLive || game.livePeriod == null || game.liveClockSeconds == null) return null

  let seconds = game.liveClockSeconds
  if (game.liveClockRunning && game.liveClockStartedAt) {
    seconds = Math.max(0, seconds - (now - game.liveClockStartedAt) / 1000)
  }

  return { period: game.livePeriod, clock: formatClock(seconds) }
}

export function GameCard({ game, href }: { game: BashGame; href?: string }) {
  const router = useRouter()
  const { isAdmin } = useAdmin()
  const isFinal = game.status === "final"
  const isLive = game.status === "live"
  const awayWon = isFinal && game.awayScore != null && game.homeScore != null && game.awayScore > game.homeScore
  const homeWon = isFinal && game.homeScore != null && game.awayScore != null && game.homeScore > game.awayScore
  const liveClock = useLiveClock(game)

  const showAdminEdit = isAdmin && isFinal && game.hasLiveStats
  const target = href ?? `/game/${game.id}`

  return (
    <div
      className={cn(
        "rounded-lg border border-border/40 bg-card select-none overflow-hidden",
        showAdminEdit && "border-amber-500/30"
      )}
    >
      {/* Card body — clickable */}
      <div
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => router.push(target)}
      >
        {/* Status bar */}
        <div className="px-3 pt-2 pb-1 border-b border-border/20 flex items-center justify-between">
          {isLive && liveClock ? (
            <span className="text-[10px] tabular-nums font-mono text-muted-foreground/70">
              {periodLabel(liveClock.period)} {liveClock.clock}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/50">{formatGameTime(game.time)}</span>
          )}
          {isLive ? (
            <span className="inline-flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
              </span>
              <span className="text-[9px] text-red-500 font-bold uppercase">Live</span>
            </span>
          ) : isFinal ? (
            <span className="text-[9px] text-muted-foreground/50 font-medium uppercase">Final{game.isOvertime ? "/OT" : game.isForfeit ? "/Forfeit" : ""}</span>
          ) : null}
        </div>

        {/* Teams and scores */}
        <div className="px-3 py-2 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <TeamLogo slug={game.awaySlug} name={game.awayTeam} size={24} className="shrink-0" />
              <span className={cn(
                "text-xs truncate",
                awayWon ? "font-semibold" : "text-muted-foreground",
              )}>
                {game.awayTeam}
              </span>
            </div>
            <span className={cn(
              "text-sm tabular-nums font-mono w-6 text-right shrink-0",
              awayWon ? "font-bold" : isLive ? "font-bold" : "text-muted-foreground"
            )}>
              {game.awayScore ?? "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <TeamLogo slug={game.homeSlug} name={game.homeTeam} size={24} className="shrink-0" />
              <span className={cn(
                "text-xs truncate",
                homeWon ? "font-semibold" : "text-muted-foreground",
              )}>
                {game.homeTeam}
              </span>
            </div>
            <span className={cn(
              "text-sm tabular-nums font-mono w-6 text-right shrink-0",
              homeWon ? "font-bold" : isLive ? "font-bold" : "text-muted-foreground"
            )}>
              {game.homeScore ?? "-"}
            </span>
          </div>
        </div>
      </div>

      {/* Admin edit bar — separate hover zone */}
      {showAdminEdit && (
        <button
          className="w-full border-t border-amber-500/20 bg-amber-500/10 px-3 py-1.5 flex items-center justify-center gap-1.5 hover:bg-amber-500/25 transition-colors cursor-pointer"
          onClick={() => router.push(`/game/${game.id}?edit=1`)}
        >
          <Pencil className="h-3 w-3 text-amber-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Edit</span>
        </button>
      )}
    </div>
  )
}

export function DateSection({ date, games, gameHref }: { date: string; games: BashGame[]; gameHref?: (game: BashGame) => string }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5">
        <span className="text-[11px] font-semibold text-muted-foreground">
          {formatGameDate(date)}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {games.map((game) => (
          <GameCard key={game.id} game={game} href={gameHref?.(game)} />
        ))}
      </div>
    </div>
  )
}
