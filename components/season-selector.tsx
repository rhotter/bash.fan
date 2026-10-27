"use client"

import { formatSeasonName } from "@/lib/season-name"
import { useSeasons } from "@/lib/hockey-data"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useCallback } from "react"

export function SeasonSelector() {
  const { seasons } = useSeasons()
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const currentSeason = searchParams.get("season") || ""

  const onChange = useCallback((value: string) => {
    const currentSearch = typeof window !== "undefined" ? window.location.search : searchParams.toString()
    const params = new URLSearchParams(currentSearch)
    if (value) {
      params.set("season", value)
    } else {
      params.delete("season")
    }
    if (value !== "all") {
      params.delete("gameType")
      params.delete("seasonType")
    }
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, searchParams, pathname])

  if (seasons.length === 0) return null

  return (
    <select
      value={currentSeason}
      onChange={(e) => onChange(e.target.value)}
      className="text-[10px] font-semibold bg-transparent border border-border/40 rounded-md px-1.5 py-1 text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/30 max-w-[120px] sm:max-w-none"
    >
      <option value="">{formatSeasonName(seasons.find((s) => s.isCurrent)?.name ?? "Current season")}</option>
      <option value="all">All Time</option>
      {seasons
        .filter((s) => !s.isCurrent && (s.hasGames || s.hasStats) && s.status !== "draft")
        .map((s) => (
          <option key={s.id} value={s.id}>
            {formatSeasonName(s.name)}
          </option>
        ))}
      {/* Seasons without games or stats, grouped at end */}
      {seasons.some((s) => !s.isCurrent && !s.hasGames && !s.hasStats && s.status !== "draft") && (
        <optgroup label="Not yet synced">
          {seasons
            .filter((s) => !s.isCurrent && !s.hasGames && !s.hasStats && s.status !== "draft")
            .map((s) => (
              <option key={s.id} value={s.id}>
                {formatSeasonName(s.name)}
              </option>
            ))}
        </optgroup>
      )}
    </select>
  )
}
