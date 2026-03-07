import { sql } from "@/lib/db"
import { getCurrentSeason } from "@/lib/seasons"
import { formatGameDate } from "@/lib/format-time"
import { SiteHeader } from "@/components/site-header"
import Link from "next/link"

export const dynamic = "force-dynamic"

export default async function ScorekeeperIndexPage() {
  const season = getCurrentSeason()

  const games = await sql`
    SELECT g.id, g.date, g.time, g.status,
      g.home_score, g.away_score,
      ht.name as home_team_name,
      awt.name as away_team_name
    FROM games g
    JOIN teams ht ON g.home_team = ht.slug
    JOIN teams awt ON g.away_team = awt.slug
    WHERE g.season_id = ${season.id}
    ORDER BY g.date ASC, g.time ASC
  `

  // Group by date
  const grouped: Record<string, typeof games> = {}
  for (const game of games) {
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

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SiteHeader />
      <div className="mx-auto w-full max-w-2xl px-4 py-5 md:py-8">
        <h1 className="text-lg font-semibold mb-2">Scorekeeper</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Select a game to scorekeep.
        </p>
        <div className="flex flex-col gap-6">
          {dates.map((date) => (
            <div key={date}>
              <div className="mb-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  {formatGameDate(date)}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {grouped[date].map((game) => {
                  const isFinal = game.status === "final"
                  const isLive = game.status === "live"
                  const awayScore = isFinal || isLive ? game.away_score : null
                  const homeScore = isFinal || isLive ? game.home_score : null
                  const awayWon = isFinal && awayScore != null && homeScore != null && awayScore > homeScore
                  const homeWon = isFinal && homeScore != null && awayScore != null && homeScore > awayScore

                  return (
                    <Link
                      key={game.id}
                      href={`/scorekeeper/${game.id}`}
                      prefetch={false}
                      className={`rounded-lg border bg-card hover:bg-muted/50 transition-colors block ${isLive ? "border-red-500/30" : "border-border/40"}`}
                    >
                      <div className="px-3 pt-2 pb-1 border-b border-border/20 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground/50">{game.time}</span>
                        {isLive ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                            </span>
                            <span className="text-[9px] text-red-500 font-bold uppercase">Live</span>
                          </span>
                        ) : isFinal ? (
                          <span className="text-[9px] text-muted-foreground/50 font-medium uppercase">Final</span>
                        ) : null}
                      </div>
                      <div className="px-3 py-2 flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-xs truncate ${awayWon ? "font-semibold" : "text-muted-foreground"}`}>
                            {game.away_team_name}
                          </span>
                          <span className={`text-sm tabular-nums font-mono w-6 text-right shrink-0 ${awayWon ? "font-bold" : isLive ? "font-bold" : "text-muted-foreground"}`}>
                            {awayScore ?? "-"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-xs truncate ${homeWon ? "font-semibold" : "text-muted-foreground"}`}>
                            {game.home_team_name}
                          </span>
                          <span className={`text-sm tabular-nums font-mono w-6 text-right shrink-0 ${homeWon ? "font-bold" : isLive ? "font-bold" : "text-muted-foreground"}`}>
                            {homeScore ?? "-"}
                          </span>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
