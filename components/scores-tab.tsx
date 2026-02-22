"use client"

import { useState, useMemo } from "react"
import { getGameDates, type BashGame } from "@/lib/hockey-data"
import { formatGameDate } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import { ChevronUp, ChevronDown, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

function getWeekKey(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00")
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setDate(diff)
  return monday.toISOString().slice(0, 10)
}

function getCurrentWeekKey() {
  return getWeekKey(new Date().toISOString().slice(0, 10))
}

type DateGroup = { date: string; games: BashGame[] }

export function ScoresTab({ games, isLoading }: { games: BashGame[]; isLoading: boolean }) {
  const [showEarlier, setShowEarlier] = useState(false)
  const [showFuture, setShowFuture] = useState(false)

  const { earlierResults, recentResults, upcomingGames, futureSchedule } = useMemo(() => {
    const realGames = games.filter((g) => !g.isPlayoff || g.homeSlug !== g.awaySlug)
    const dates = getGameDates(realGames)

    const grouped = realGames.reduce<Record<string, BashGame[]>>((acc, game) => {
      if (!acc[game.date]) acc[game.date] = []
      acc[game.date].push(game)
      return acc
    }, {})

    const today = new Date().toISOString().slice(0, 10)
    const currentWeek = getCurrentWeekKey()

    // Dates in the current week or earlier are "recent" territory (even if not yet final)
    // Only dates AFTER the current week are "upcoming"
    const completedDates = dates.filter(d => {
      const wk = getWeekKey(d)
      if (wk <= currentWeek) return true
      return grouped[d].every(g => g.status === "final")
    })
    const upcomingDates = dates.filter(d => {
      const wk = getWeekKey(d)
      if (wk <= currentWeek) return false
      return grouped[d].some(g => g.status === "upcoming")
    })

    // For completed: find the most recent week with games
    const completedWeeks = [...new Set(completedDates.map(getWeekKey))].sort().reverse()
    const recentWeek = completedWeeks[0] || null

    // For upcoming: find the nearest upcoming week
    // upcomingDates are sorted descending (from getGameDates), reverse for ascending
    const upcomingWeeks = [...new Set(upcomingDates.map(getWeekKey))].sort()
    const nextWeek = upcomingWeeks[0] || null

    const recentResultsDates: DateGroup[] = []
    const earlierResultsDates: DateGroup[] = []
    const upcomingGamesDates: DateGroup[] = []
    const futureScheduleDates: DateGroup[] = []

    for (const date of completedDates) {
      const wk = getWeekKey(date)
      const entry = { date, games: grouped[date] }
      if (wk === recentWeek) {
        recentResultsDates.push(entry)
      } else {
        earlierResultsDates.push(entry)
      }
    }

    // Upcoming dates are in descending order from getGameDates, reverse for chronological
    const upcomingChron = [...upcomingDates].reverse()
    for (const date of upcomingChron) {
      const wk = getWeekKey(date)
      const entry = { date, games: grouped[date] }
      if (wk === nextWeek) {
        upcomingGamesDates.push(entry)
      } else {
        futureScheduleDates.push(entry)
      }
    }

    return {
      earlierResults: earlierResultsDates,
      recentResults: recentResultsDates,
      upcomingGames: upcomingGamesDates,
      futureSchedule: futureScheduleDates,
    }
  }, [games])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const hasContent = recentResults.length > 0 || upcomingGames.length > 0 || earlierResults.length > 0 || futureSchedule.length > 0

  if (!hasContent) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">No games found.</p>
      </div>
    )
  }

  const earlierGameCount = earlierResults.reduce((n, d) => n + d.games.length, 0)
  const futureGameCount = futureSchedule.reduce((n, d) => n + d.games.length, 0)

  return (
    <div className="flex flex-col gap-6">
      {/* Earlier results (hidden by default) */}
      {earlierGameCount > 0 && (
        <>
          {showEarlier && (
            earlierResults.map(({ date, games: dateGames }) => (
              <DateSection key={date} date={date} games={dateGames} />
            ))
          )}
          <button
            onClick={() => setShowEarlier(!showEarlier)}
            className="flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            {showEarlier ? (
              <><ChevronUp className="h-3 w-3" />Hide earlier results</>
            ) : (
              <><ChevronDown className="h-3 w-3" />{earlierGameCount} earlier results</>
            )}
          </button>
        </>
      )}

      {/* This week (always shown) */}
      {recentResults.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70 whitespace-nowrap">
              This Week
            </h2>
            <div className="h-px flex-1 bg-border/40" />
          </div>
          {recentResults.map(({ date, games: dateGames }) => (
            <DateSection key={date} date={date} games={dateGames} />
          ))}
        </div>
      )}

      {/* Upcoming games (always shown) */}
      {upcomingGames.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70 whitespace-nowrap">
              Upcoming
            </h2>
            <div className="h-px flex-1 bg-border/40" />
          </div>
          {upcomingGames.map(({ date, games: dateGames }) => (
            <DateSection key={date} date={date} games={dateGames} />
          ))}
        </div>
      )}

      {/* Future schedule (hidden by default) */}
      {futureGameCount > 0 && (
        <>
          <button
            onClick={() => setShowFuture(!showFuture)}
            className="flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            {showFuture ? (
              <><ChevronUp className="h-3 w-3" />Hide future schedule</>
            ) : (
              <><ChevronDown className="h-3 w-3" />{futureGameCount} more scheduled</>
            )}
          </button>
          {showFuture && (
            futureSchedule.map(({ date, games: dateGames }) => (
              <DateSection key={date} date={date} games={dateGames} />
            ))
          )}
        </>
      )}
    </div>
  )
}

function DateSection({ date, games }: { date: string; games: BashGame[] }) {
  return (
    <div className="mb-4">
      <div className="mb-1">
        <span className="text-[11px] font-semibold text-muted-foreground">
          {formatGameDate(date)}
        </span>
      </div>
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <table className="w-full text-[11px]">
          <tbody>
            {games.map((game) => (
              <GameRow key={game.id} game={game} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GameRow({ game }: { game: BashGame }) {
  const router = useRouter()
  const isFinal = game.status === "final"
  const awayWon = isFinal && game.awayScore != null && game.homeScore != null && game.awayScore > game.homeScore
  const homeWon = isFinal && game.homeScore != null && game.awayScore != null && game.homeScore > game.awayScore

  return (
    <tr
      className={cn(
        "border-t border-border/20 hover:bg-card/60 transition-colors",
        isFinal && "cursor-pointer"
      )}
      onClick={isFinal ? () => router.push(`/game/${game.id}`) : undefined}
    >
      <td className="py-2 pr-2 text-[10px] text-muted-foreground/50 whitespace-nowrap" style={{ width: "1%" }}>
        {game.time}
      </td>
      <td className={cn("py-2 pr-1 text-right whitespace-nowrap w-[40%]", awayWon ? "font-bold" : "font-medium text-muted-foreground")}>
        <Link href={`/team/${game.awaySlug}`} className="hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>
          {game.awayTeam}
        </Link>
      </td>
      <td className={cn("py-2 px-2 text-center tabular-nums font-mono whitespace-nowrap", awayWon ? "font-bold" : "text-muted-foreground")} style={{ width: "1%" }}>
        {game.awayScore ?? "-"}
      </td>
      <td className="py-2 text-center text-muted-foreground/30 text-[9px]" style={{ width: "1%" }}>@</td>
      <td className={cn("py-2 px-2 text-center tabular-nums font-mono whitespace-nowrap", homeWon ? "font-bold" : "text-muted-foreground")} style={{ width: "1%" }}>
        {game.homeScore ?? "-"}
      </td>
      <td className={cn("py-2 pl-1 whitespace-nowrap w-[40%]", homeWon ? "font-bold" : "font-medium text-muted-foreground")}>
        <Link href={`/team/${game.homeSlug}`} className="hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>
          {game.homeTeam}
        </Link>
      </td>
      <td className="py-2 pl-1 text-right" style={{ width: "1%" }}>
        {isFinal && game.isOvertime && (
          <span className="text-[9px] text-muted-foreground/50 uppercase whitespace-nowrap">OT</span>
        )}
      </td>
    </tr>
  )
}
