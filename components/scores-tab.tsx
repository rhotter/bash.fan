"use client"

import { useState, useMemo } from "react"
import { getGameDates, type BashGame } from "@/lib/hockey-data"
import { cn } from "@/lib/utils"
import { ChevronUp, ChevronDown, Loader2 } from "lucide-react"
import { GameCard, DateSection } from "@/components/game-card"

function getWeekKey(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00")
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setDate(diff)
  return monday.toISOString().slice(0, 10)
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

    // Dates up to and including today go under "Latest"
    // Dates after today go under "Upcoming"
    const today = new Date().toISOString().slice(0, 10)
    const completedDates = dates.filter(d => d <= today)
    const upcomingDates = dates.filter(d => d > today)

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
              Latest
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

