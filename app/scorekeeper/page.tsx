import { sql } from "@/lib/db"
import { getCurrentSeason } from "@/lib/seasons"
import { formatGameDate } from "@/lib/format-time"
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
      <div className="mx-auto w-full max-w-2xl px-4 py-5 md:py-8">
        <h1 className="text-lg font-semibold mb-6">Scorekeeper</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Select a game to scorekeep.
        </p>

        <div className="flex flex-col gap-6">
          {dates.map((date) => (
            <div key={date}>
              <div className="mb-1">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  {formatGameDate(date)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <tbody>
                    {grouped[date].map((game) => (
                      <tr
                        key={game.id}
                        className="border-t border-border/20 hover:bg-muted/50 cursor-pointer"
                      >
                        <td className="py-2 pr-2 text-[10px] text-muted-foreground/50 whitespace-nowrap" style={{ width: "1%" }}>
                          {game.status === "live" ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-foreground/40 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-foreground" />
                              </span>
                              <span className="text-foreground font-bold uppercase">Live</span>
                            </span>
                          ) : game.time}
                        </td>
                        <td className="py-2 pr-1 text-right whitespace-nowrap w-[40%] text-muted-foreground">
                          <Link href={`/scorekeeper/${game.id}`} prefetch={false} className="hover:text-foreground transition-colors">
                            {game.away_team_name}
                          </Link>
                        </td>
                        <td className="py-2 px-2 text-center tabular-nums font-mono whitespace-nowrap text-muted-foreground" style={{ width: "1%" }}>
                          {game.status === "final" || game.status === "live" ? game.away_score : "-"}
                        </td>
                        <td className="py-2 text-center text-muted-foreground/30 text-[9px]" style={{ width: "1%" }}>@</td>
                        <td className="py-2 px-2 text-center tabular-nums font-mono whitespace-nowrap text-muted-foreground" style={{ width: "1%" }}>
                          {game.status === "final" || game.status === "live" ? game.home_score : "-"}
                        </td>
                        <td className="py-2 pl-1 whitespace-nowrap w-[40%] text-muted-foreground">
                          <Link href={`/scorekeeper/${game.id}`} prefetch={false} className="hover:text-foreground transition-colors">
                            {game.home_team_name}
                          </Link>
                        </td>
                        <td className="py-2 pl-1 text-right" style={{ width: "1%" }}>
                          {game.status === "final" && (
                            <span className="text-[9px] text-muted-foreground/50 uppercase whitespace-nowrap">Final</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
