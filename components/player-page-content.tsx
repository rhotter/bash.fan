"use client"

import { formatGameDate } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import Link from "next/link"
import type { PlayerDetail } from "@/app/api/bash/player/[id]/route"

export function PlayerPageContent({ player }: { player: PlayerDetail }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight">{player.name}</h1>
        <Link href={`/team/${player.teamSlug}`} className="text-sm text-muted-foreground hover:text-primary transition-colors">
          {player.team}
        </Link>
      </div>

      {/* Skater stats */}
      {(player.perSeasonStats.length > 0 || player.allTimeStats) && (
        <div>
          <SectionHeader>Stats</SectionHeader>
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                  <th className="text-left font-medium py-2.5 whitespace-nowrap pr-3">Season</th>
                  <th className="text-center font-medium py-2.5 whitespace-nowrap">GP</th>
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
                {player.perSeasonStats.map((s, i) => (
                  <tr key={s.seasonId} className={cn("border-t border-border/20 hover:bg-card/60 transition-colors", i === 0 && "bg-card/15")}>
                    <td className="text-left py-2 text-[10px] font-medium text-muted-foreground whitespace-nowrap pr-3">{s.seasonName}</td>
                    <td className="text-center tabular-nums py-2 whitespace-nowrap">{s.stats.gp}</td>
                    <td className="text-center tabular-nums py-2 font-medium">{s.stats.goals}</td>
                    <td className="text-center tabular-nums py-2 font-medium">{s.stats.assists}</td>
                    <td className="text-center tabular-nums py-2 font-bold">{s.stats.points}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{s.stats.ptsPg}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{s.stats.gwg}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{s.stats.ppg}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{s.stats.shg}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{s.stats.eng ?? 0}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{s.stats.hatTricks ?? 0}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{s.stats.pim}</td>
                  </tr>
                ))}
                {player.allTimeStats && player.perSeasonStats.length > 1 && (
                  <tr className="border-t-2 border-border/40 hover:bg-card/60 transition-colors">
                    <td className="text-left py-2 text-[10px] font-bold text-muted-foreground whitespace-nowrap pr-3">All Time</td>
                    <td className="text-center tabular-nums py-2 whitespace-nowrap">{player.allTimeStats.gp}</td>
                    <td className="text-center tabular-nums py-2 font-medium">{player.allTimeStats.goals}</td>
                    <td className="text-center tabular-nums py-2 font-medium">{player.allTimeStats.assists}</td>
                    <td className="text-center tabular-nums py-2 font-bold">{player.allTimeStats.points}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{player.allTimeStats.ptsPg}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{player.allTimeStats.gwg}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{player.allTimeStats.ppg}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{player.allTimeStats.shg}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{player.allTimeStats.eng ?? 0}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{player.allTimeStats.hatTricks ?? 0}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{player.allTimeStats.pim}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Goalie stats */}
      {(player.perSeasonGoalieStats.length > 0 || player.allTimeGoalieStats) && (
        <div>
          <SectionHeader>Stats</SectionHeader>
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                  <th className="text-left font-medium py-2.5 whitespace-nowrap pr-3">Season</th>
                  <th className="text-center font-medium py-2.5 whitespace-nowrap">GP</th>
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
                {player.perSeasonGoalieStats.map((s, i) => (
                  <tr key={s.seasonId} className={cn("border-t border-border/20 hover:bg-card/60 transition-colors", i === 0 && "bg-card/15")}>
                    <td className="text-left py-2 text-[10px] font-medium text-muted-foreground whitespace-nowrap pr-3">{s.seasonName}</td>
                    <td className="text-center tabular-nums py-2 whitespace-nowrap">{s.stats.gp}</td>
                    <td className="text-center tabular-nums py-2 font-medium">{s.stats.wins}</td>
                    <td className="text-center tabular-nums py-2">{s.stats.losses}</td>
                    <td className="text-center tabular-nums py-2 font-bold">{s.stats.savePercentage}</td>
                    <td className="text-center tabular-nums py-2">{s.stats.gaa}</td>
                    <td className="text-center tabular-nums py-2">{s.stats.shutouts}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{s.stats.saves}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{s.stats.goalsAgainst}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{s.stats.shotsAgainst}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{s.stats.goalieAssists ?? 0}</td>
                  </tr>
                ))}
                {player.allTimeGoalieStats && player.perSeasonGoalieStats.length > 1 && (
                  <tr className="border-t-2 border-border/40 hover:bg-card/60 transition-colors">
                    <td className="text-left py-2 text-[10px] font-bold text-muted-foreground whitespace-nowrap pr-3">All Time</td>
                    <td className="text-center tabular-nums py-2 whitespace-nowrap">{player.allTimeGoalieStats.gp}</td>
                    <td className="text-center tabular-nums py-2 font-medium">{player.allTimeGoalieStats.wins}</td>
                    <td className="text-center tabular-nums py-2">{player.allTimeGoalieStats.losses}</td>
                    <td className="text-center tabular-nums py-2 font-bold">{player.allTimeGoalieStats.savePercentage}</td>
                    <td className="text-center tabular-nums py-2">{player.allTimeGoalieStats.gaa}</td>
                    <td className="text-center tabular-nums py-2">{player.allTimeGoalieStats.shutouts}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{player.allTimeGoalieStats.saves}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{player.allTimeGoalieStats.goalsAgainst}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{player.allTimeGoalieStats.shotsAgainst}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{player.allTimeGoalieStats.goalieAssists ?? 0}</td>
                  </tr>
                )}
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
                  <th className="text-left font-medium py-2.5 whitespace-nowrap pr-3">Date</th>
                  <th className="text-left font-medium py-2.5 whitespace-nowrap pr-3">Opp</th>
                  <th className="text-center font-medium py-2.5 w-14">Score</th>
                  <th className="text-center font-medium py-2.5 w-10">G</th>
                  <th className="text-center font-medium py-2.5 w-10">A</th>
                  <th className="text-center font-medium py-2.5 w-10 font-bold">PTS</th>
                  <th className="text-center font-medium py-2.5 w-10">GWG</th>
                  <th className="text-center font-medium py-2.5 w-10">PPG</th>
                  <th className="text-center font-medium py-2.5 w-10">SHG</th>
                  <th className="text-center font-medium py-2.5 w-10">ENG</th>
                  <th className="text-center font-medium py-2.5 w-10">HAT</th>
                  <th className="text-center font-medium py-2.5 w-10">PIM</th>
                </tr>
              </thead>
              <tbody>
                {player.games.map((g, i) => (
                  <tr key={g.gameId} className={cn("border-t border-border/20 hover:bg-card/60", i % 2 === 0 && "bg-card/15")}>
                    <td className="py-2 text-[10px] text-muted-foreground whitespace-nowrap pr-3">
                      <Link href={`/game/${g.gameId}`} className="hover:text-primary transition-colors">
                        {formatGameDate(g.date)}
                      </Link>
                    </td>
                    <td className="py-2 text-xs font-medium whitespace-nowrap pr-3">
                      <span className="text-muted-foreground/40 mr-1">{g.isHome ? "vs" : "@"}</span>
                      <Link href={`/team/${g.opponentSlug}`} className="hover:text-primary transition-colors">
                        {g.opponent}
                      </Link>
                    </td>
                    <td className="text-center py-2 text-xs tabular-nums">
                      {g.teamScore != null ? (
                        <Link href={`/game/${g.gameId}`} className="hover:underline transition-colors">
                          {g.teamScore}-{g.opponentScore}
                          {g.result && <span className="ml-1">{g.result}</span>}
                        </Link>
                      ) : "-"}
                    </td>
                    <td className={cn("text-center tabular-nums py-2", g.goals > 0 && "font-medium")}>{g.goals}</td>
                    <td className={cn("text-center tabular-nums py-2", g.assists > 0 && "font-medium")}>{g.assists}</td>
                    <td className="text-center tabular-nums py-2 font-bold">{g.points}</td>
                    <td className={cn("text-center tabular-nums py-2", (g.gwg ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{g.gwg ?? 0}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{g.ppg ?? 0}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{g.shg ?? 0}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{g.eng ?? 0}</td>
                    <td className={cn("text-center tabular-nums py-2", (g.hatTricks ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{g.hatTricks ?? 0}</td>
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
                  <th className="text-left font-medium py-2.5 whitespace-nowrap pr-3">Date</th>
                  <th className="text-left font-medium py-2.5 whitespace-nowrap pr-3">Opp</th>
                  <th className="text-center font-medium py-2.5 w-14">Score</th>
                  <th className="text-center font-medium py-2.5 w-10">DEC</th>
                  <th className="text-center font-medium py-2.5 w-10">SA</th>
                  <th className="text-center font-medium py-2.5 w-10">SV</th>
                  <th className="text-center font-medium py-2.5 w-10">GA</th>
                  <th className="text-center font-medium py-2.5 w-12 font-bold">SV%</th>
                  <th className="text-center font-medium py-2.5 w-10">SO</th>
                  <th className="text-center font-medium py-2.5 w-10">A</th>
                </tr>
              </thead>
              <tbody>
                {player.goalieGames.map((g, i) => (
                  <tr key={g.gameId} className={cn("border-t border-border/20 hover:bg-card/60", i % 2 === 0 && "bg-card/15")}>
                    <td className="py-2 text-[10px] text-muted-foreground whitespace-nowrap pr-3">
                      <Link href={`/game/${g.gameId}`} className="hover:text-primary transition-colors">
                        {formatGameDate(g.date)}
                      </Link>
                    </td>
                    <td className="py-2 text-xs font-medium whitespace-nowrap pr-3">
                      <span className="text-muted-foreground/40 mr-1">{g.isHome ? "vs" : "@"}</span>
                      <Link href={`/team/${g.opponentSlug}`} className="hover:text-primary transition-colors">
                        {g.opponent}
                      </Link>
                    </td>
                    <td className="text-center py-2 text-xs tabular-nums">
                      {g.teamScore != null ? (
                        <Link href={`/game/${g.gameId}`} className="hover:underline transition-colors">
                          {g.teamScore}-{g.opponentScore}
                        </Link>
                      ) : "-"}
                    </td>
                    <td className="text-center tabular-nums py-2">{g.result ?? "-"}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{g.shotsAgainst}</td>
                    <td className="text-center tabular-nums py-2 font-medium">{g.saves}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{g.goalsAgainst}</td>
                    <td className="text-center tabular-nums py-2 font-bold">{g.savePercentage}</td>
                    <td className={cn("text-center tabular-nums py-2", (g.shutouts ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{g.shutouts ?? 0}</td>
                    <td className="text-center tabular-nums py-2 text-muted-foreground">{g.goalieAssists ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
