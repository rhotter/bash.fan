"use client"

import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from "react"
import { type BashGame } from "@/lib/hockey-data"
import { cn } from "@/lib/utils"
import { DateSection } from "@/components/game-card"

function getWeekKey(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00")
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setDate(diff)
  return monday.toISOString().slice(0, 10)
}

function formatWeekRange(mondayStr: string): string {
  const [y, m, d] = mondayStr.split("-").map(Number)
  const monday = new Date(y, m - 1, d)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const monMonth = monday.toLocaleDateString("en-US", { month: "short" })
  const sunMonth = sunday.toLocaleDateString("en-US", { month: "short" })

  if (monMonth === sunMonth) {
    return `${monMonth} ${monday.getDate()}\u2013${sunday.getDate()}`
  }
  return `${monMonth} ${monday.getDate()}\u2013${sunMonth} ${sunday.getDate()}`
}

type Week = {
  key: string
  label: string
  dates: { date: string; games: BashGame[] }[]
  isCurrent: boolean
}

function buildWeeks(games: BashGame[]): Week[] {
  const weekMap = new Map<string, BashGame[]>()
  for (const game of games) {
    const wk = getWeekKey(game.date)
    if (!weekMap.has(wk)) weekMap.set(wk, [])
    weekMap.get(wk)!.push(game)
  }

  const today = new Date().toISOString().slice(0, 10)
  const todayWeek = getWeekKey(today)

  return [...weekMap.keys()].sort().map((key): Week => {
    const weekGames = weekMap.get(key)!
    const dateMap = new Map<string, BashGame[]>()
    for (const g of weekGames) {
      if (!dateMap.has(g.date)) dateMap.set(g.date, [])
      dateMap.get(g.date)!.push(g)
    }

    return {
      key,
      label: formatWeekRange(key),
      dates: [...dateMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, dGames]) => ({ date, games: dGames })),
      isCurrent: key === todayWeek,
    }
  })
}

export function WeekNavigator({
  games,
  playoffGames,
  gameHref,
}: {
  games: BashGame[]
  playoffGames?: BashGame[]
  gameHref?: (game: BashGame) => string
}) {
  const regularWeeks = useMemo(() => buildWeeks(games), [games])
  const pWeeks = useMemo(() => buildWeeks(playoffGames || []), [playoffGames])
  const allWeeks = useMemo(() => [...regularWeeks, ...pWeeks], [regularWeeks, pWeeks])
  const hasPlayoffs = pWeeks.length > 0
  const playoffStartIndex = regularWeeks.length

  const defaultIndex = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const todayWeek = getWeekKey(today)
    const currentIdx = allWeeks.findIndex((w) => w.isCurrent)
    if (currentIdx !== -1) return currentIdx

    for (let i = allWeeks.length - 1; i >= 0; i--) {
      if (allWeeks[i].key <= todayWeek) return i
    }

    return Math.max(0, allWeeks.length - 1)
  }, [allWeeks])

  const [selectedIndex, setSelectedIndex] = useState(defaultIndex)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pillRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  const idx = Math.min(selectedIndex, Math.max(0, allWeeks.length - 1))

  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef.current
    const pill = pillRefs.current.get(index)
    if (!container || !pill) return
    const scrollLeft = pill.offsetLeft - container.offsetWidth / 2 + pill.offsetWidth / 2
    container.scrollTo({ left: scrollLeft, behavior })
  }, [])

  useEffect(() => {
    requestAnimationFrame(() => scrollToIndex(idx, "instant"))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    scrollToIndex(idx)
  }, [idx, scrollToIndex])

  if (allWeeks.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">No games found.</p>
      </div>
    )
  }

  const selectedWeek = allWeeks[idx]

  return (
    <div className="flex flex-col gap-4">
      {/* Week navigation strip */}
      <div
        ref={scrollRef}
        className="overflow-x-auto flex gap-1 py-1"
        style={{ scrollbarWidth: "none" }}
      >
        {allWeeks.map((week, i) => (
          <Fragment key={`${i >= playoffStartIndex && hasPlayoffs ? "p-" : ""}${week.key}`}>
            {i === playoffStartIndex && hasPlayoffs && (
              <div className="shrink-0 flex items-center gap-2 px-2">
                <div className="w-px h-4 bg-border" />
                <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Playoffs</span>
              </div>
            )}
            <button
              ref={(el) => {
                if (el) pillRefs.current.set(i, el)
                else pillRefs.current.delete(i)
              }}
              onClick={() => setSelectedIndex(i)}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer relative",
                i === idx
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {week.label}
              {week.isCurrent && i !== idx && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-foreground/40" />
              )}
            </button>
          </Fragment>
        ))}
      </div>

      {/* Games for selected week */}
      <div className="flex flex-col">
        {selectedWeek.dates.map(({ date, games: dateGames }) => (
          <DateSection key={date} date={date} games={dateGames} gameHref={gameHref} />
        ))}
      </div>
    </div>
  )
}
