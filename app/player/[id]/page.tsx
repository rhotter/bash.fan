"use client"

import { use } from "react"
import useSWR from "swr"
import { SiteHeader } from "@/components/site-header"
import { formatGameDate } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import type { PlayerDetail } from "@/app/api/bash/player/[id]/route"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: player, isLoading, error } = useSWR<PlayerDetail>(
    `/api/bash/player/${id}`, fetcher, { revalidateOnFocus: false }
  )

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-center py-20">
            <p className="text-sm text-muted-foreground">Player not found.</p>
          </div>
        )}

        {player && (
          <div className="flex flex-col gap-8">
            <div>
              <h1 className="text-2xl font-black tracking-tight">{player.name}</h1>
              <Link href={`/team/${player.teamSlug}`} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                {player.team}
              </Link>
            </div>

            {/* Skater season stats */}
            {player.seasonStats && (
              <div>
                <SectionHeader>Season Totals</SectionHeader>
                <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                        <th className="text-center font-medium py-2.5 w-10">GP</th>
                        <th className="text-center font-medium py-2.5 w-10">G</th>
                        <th className="text-center font-medium py-2.5 w-10">A</th>
                        <th className="text-center font-medium py-2.5 w-10 font-bold">PTS</th>
                        <th className="text-center font-medium py-2.5 w-12">PTS/G</th>
                        <th className="text-center font-medium py-2.5 w-10">GWG</th>
                        <th className="text-center font-medium py-2.5 w-10">PPG</th>
                        <th className="text-center font-medium py-2.5 w-10">SHG</th>
                        <th className="text-center font-medium py-2.5 w-10">ENG</th>
                        <th className="text-center font-medium py-2.5 w-10">HAT</th>
                        <th className="text-center font-medium py-2.5 w-10">PIM</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border/20 bg-card/15">
                        <td className="text-center tabular-nums py-2">{player.seasonStats.gp}</td>
                        <td className="text-center tabular-nums py-2 font-medium">{player.seasonStats.goals}</td>
                        <td className="text-center tabular-nums py-2 font-medium">{player.seasonStats.assists}</td>
                        <td className="text-center tabular-nums py-2 font-bold">{player.seasonStats.points}</td>
                        <td className="text-center tabular-nums py-2 text-muted-foreground">{player.seasonStats.ptsPg}</td>
                        <td className="text-center tabular-nums py-2 text-muted-foreground">{player.seasonStats.gwg}</td>
                        <td className="text-center tabular-nums py-2 text-muted-foreground">{player.seasonStats.ppg}</td>
                        <td className="text-center tabular-nums py-2 text-muted-foreground">{player.seasonStats.shg}</td>
                        <td className="text-center tabular-nums py-2 text-muted-foreground">{player.seasonStats.eng ?? 0}</td>
                        <td className="text-center tabular-nums py-2 text-muted-foreground">{player.seasonStats.hatTricks ?? 0}</td>
                        <td className="text-center tabular-nums py-2 text-muted-foreground">{player.seasonStats.pim}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Goalie season stats */}
            {player.goalieSeasonStats && (
              <div>
                <SectionHeader>Season Totals</SectionHeader>
                <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                        <th className="text-center font-medium py-2.5 w-10">GP</th>
                        <th className="text-center font-medium py-2.5 w-10">W</th>
                        <th className="text-center font-medium py-2.5 w-10">L</th>
                        <th className="text-center font-medium py-2.5 w-12 font-bold">SV%</th>
                        <th className="text-center font-medium py-2.5 w-12">GAA</th>
                        <th className="text-center font-medium py-2.5 w-10">SO</th>
                        <th className="text-center font-medium py-2.5 w-10">SV</th>
                        <th className="text-center font-medium py-2.5 w-10">GA</th>
                        <th className="text-center font-medium py-2.5 w-10">SA</th>
                        <th className="text-center font-medium py-2.5 w-10">A</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border/20 bg-card/15">
                        <td className="text-center tabular-nums py-2">{player.goalieSeasonStats.gp}</td>
                        <td className="text-center tabular-nums py-2 font-medium">{player.goalieSeasonStats.wins}</td>
                        <td className="text-center tabular-nums py-2">{player.goalieSeasonStats.losses}</td>
                        <td className="text-center tabular-nums py-2 font-bold">{player.goalieSeasonStats.savePercentage}</td>
                        <td className="text-center tabular-nums py-2">{player.goalieSeasonStats.gaa}</td>
                        <td className="text-center tabular-nums py-2">{player.goalieSeasonStats.shutouts}</td>
                        <td className="text-center tabular-nums py-2 text-muted-foreground">{player.goalieSeasonStats.saves}</td>
                        <td className="text-center tabular-nums py-2 text-muted-foreground">{player.goalieSeasonStats.goalsAgainst}</td>
                        <td className="text-center tabular-nums py-2 text-muted-foreground">{player.goalieSeasonStats.shotsAgainst}</td>
                        <td className="text-center tabular-nums py-2 text-muted-foreground">{player.goalieSeasonStats.goalieAssists ?? 0}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Game-by-game skater */}
            {player.games.length > 0 && (
              <div>
                <SectionHeader>Game Log</SectionHeader>
                <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                        <th className="text-left font-medium py-2.5 w-20">Date</th>
                        <th className="text-left font-medium py-2.5">Opp</th>
                        <th className="text-center font-medium py-2.5 w-14">Score</th>
                        <th className="text-center font-medium py-2.5 w-10">G</th>
                        <th className="text-center font-medium py-2.5 w-10">A</th>
                        <th className="text-center font-medium py-2.5 w-10 font-bold">PTS</th>
                        <th className="text-center font-medium py-2.5 w-10 hidden sm:table-cell">GWG</th>
                        <th className="text-center font-medium py-2.5 w-10 hidden sm:table-cell">PPG</th>
                        <th className="text-center font-medium py-2.5 w-10 hidden sm:table-cell">SHG</th>
                        <th className="text-center font-medium py-2.5 w-10 hidden sm:table-cell">ENG</th>
                        <th className="text-center font-medium py-2.5 w-10 hidden sm:table-cell">HAT</th>
                        <th className="text-center font-medium py-2.5 w-10">PIM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {player.games.map((g, i) => (
                        <tr key={g.gameId} className={cn("border-t border-border/20 hover:bg-card/60", i % 2 === 0 && "bg-card/15")}>
                          <td className="py-2 text-[10px] text-muted-foreground">
                            <Link href={`/game/${g.gameId}`} className="hover:text-primary transition-colors">
                              {formatGameDate(g.date)}
                            </Link>
                          </td>
                          <td className="py-2 text-xs font-medium">
                            <span className="text-muted-foreground/40 mr-1">{g.isHome ? "vs" : "@"}</span>
                            <Link href={`/team/${g.opponentSlug}`} className="hover:text-primary transition-colors">
                              {g.opponent}
                            </Link>
                          </td>
                          <td className="text-center py-2 text-xs tabular-nums">
                            {g.teamScore != null ? `${g.teamScore}-${g.opponentScore}` : "-"}
                            {g.result && <span className="ml-1 text-[9px] text-muted-foreground/50">{g.result}</span>}
                          </td>
                          <td className={cn("text-center tabular-nums py-2", g.goals > 0 && "font-medium")}>{g.goals}</td>
                          <td className={cn("text-center tabular-nums py-2", g.assists > 0 && "font-medium")}>{g.assists}</td>
                          <td className="text-center tabular-nums py-2 font-bold">{g.points}</td>
                          <td className={cn("text-center tabular-nums py-2 hidden sm:table-cell", (g.gwg ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{g.gwg ?? 0}</td>
                          <td className="text-center tabular-nums py-2 text-muted-foreground hidden sm:table-cell">{g.ppg ?? 0}</td>
                          <td className="text-center tabular-nums py-2 text-muted-foreground hidden sm:table-cell">{g.shg ?? 0}</td>
                          <td className="text-center tabular-nums py-2 text-muted-foreground hidden sm:table-cell">{g.eng ?? 0}</td>
                          <td className={cn("text-center tabular-nums py-2 hidden sm:table-cell", (g.hatTricks ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{g.hatTricks ?? 0}</td>
                          <td className="text-center tabular-nums py-2 text-muted-foreground">{g.pim}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Game-by-game goalie */}
            {player.goalieGames.length > 0 && (
              <div>
                <SectionHeader>Game Log</SectionHeader>
                <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                        <th className="text-left font-medium py-2.5 w-20">Date</th>
                        <th className="text-left font-medium py-2.5">Opp</th>
                        <th className="text-center font-medium py-2.5 w-14">Score</th>
                        <th className="text-center font-medium py-2.5 w-10">DEC</th>
                        <th className="text-center font-medium py-2.5 w-10">SA</th>
                        <th className="text-center font-medium py-2.5 w-10">SV</th>
                        <th className="text-center font-medium py-2.5 w-10">GA</th>
                        <th className="text-center font-medium py-2.5 w-12 font-bold">SV%</th>
                        <th className="text-center font-medium py-2.5 w-10 hidden sm:table-cell">SO</th>
                        <th className="text-center font-medium py-2.5 w-10 hidden sm:table-cell">A</th>
                      </tr>
                    </thead>
                    <tbody>
                      {player.goalieGames.map((g, i) => (
                        <tr key={g.gameId} className={cn("border-t border-border/20 hover:bg-card/60", i % 2 === 0 && "bg-card/15")}>
                          <td className="py-2 text-[10px] text-muted-foreground">
                            <Link href={`/game/${g.gameId}`} className="hover:text-primary transition-colors">
                              {formatGameDate(g.date)}
                            </Link>
                          </td>
                          <td className="py-2 text-xs font-medium">
                            <span className="text-muted-foreground/40 mr-1">{g.isHome ? "vs" : "@"}</span>
                            <Link href={`/team/${g.opponentSlug}`} className="hover:text-primary transition-colors">
                              {g.opponent}
                            </Link>
                          </td>
                          <td className="text-center py-2 text-xs tabular-nums">
                            {g.teamScore != null ? `${g.teamScore}-${g.opponentScore}` : "-"}
                          </td>
                          <td className="text-center tabular-nums py-2">{g.result ?? "-"}</td>
                          <td className="text-center tabular-nums py-2 text-muted-foreground">{g.shotsAgainst}</td>
                          <td className="text-center tabular-nums py-2 font-medium">{g.saves}</td>
                          <td className="text-center tabular-nums py-2 text-muted-foreground">{g.goalsAgainst}</td>
                          <td className="text-center tabular-nums py-2 font-bold">{g.savePercentage}</td>
                          <td className={cn("text-center tabular-nums py-2 hidden sm:table-cell", (g.shutouts ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{g.shutouts ?? 0}</td>
                          <td className="text-center tabular-nums py-2 text-muted-foreground hidden sm:table-cell">{g.goalieAssists ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground whitespace-nowrap">
        {children}
      </h4>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  )
}
