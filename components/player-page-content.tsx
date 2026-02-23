"use client"

import { formatGameDate } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import Link from "next/link"
import type { PlayerDetail, SkaterStats, GoalieStats, SeasonSkaterStats, SeasonGoalieStats, SkaterGameLog, GoalieGameLog } from "@/app/api/bash/player/[slug]/route"
import { SectionHeader, statsRowClass } from "@/components/stats-table"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Trophy } from "lucide-react"

export function PlayerPageContent({ player }: { player: PlayerDetail }) {
  const hasSkaterData = player.perSeasonStats.length > 0 || player.allTimeStats
  const hasGoalieData = player.perSeasonGoalieStats.length > 0 || player.allTimeGoalieStats
  const isDualRole = hasSkaterData && hasGoalieData

  const hasPlayoffSkaterData = player.playoffPerSeasonStats.length > 0 || player.playoffAllTimeStats
  const hasPlayoffGoalieData = player.playoffPerSeasonGoalieStats.length > 0 || player.playoffAllTimeGoalieStats
  const hasPlayoffData = hasPlayoffSkaterData || hasPlayoffGoalieData || player.playoffGames.length > 0 || player.playoffGoalieGames.length > 0

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-black tracking-tight">{player.name}</h1>
          {player.championships.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-100 to-amber-200/80 pl-1.5 pr-2.5 py-0.5 cursor-default ring-1 ring-amber-300/50 shadow-sm hover:shadow-md hover:ring-amber-400/60 transition-all duration-200">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 shadow-inner">
                    <Trophy className="h-3 w-3 text-white drop-shadow-sm" strokeWidth={2.5} />
                  </span>
                  <span className="text-[11px] font-bold tracking-tight text-amber-900/80">x {player.championships.length}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent sideOffset={4}>
                <div className="flex flex-col gap-0.5">
                  {player.championships.map((c) => (
                    <span key={c.seasonId} className="whitespace-nowrap">{c.seasonName}</span>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <Link href={`/team/${player.teamSlug}`} className="text-sm text-muted-foreground hover:text-primary transition-colors">
          {player.team}
        </Link>
      </div>

      {/* Skater stats */}
      {hasSkaterData && (
        <SkaterStatsTable
          title={isDualRole ? "Skater Stats" : "Stats"}
          perSeasonStats={player.perSeasonStats}
          allTimeStats={player.allTimeStats}
        />
      )}

      {/* Goalie stats */}
      {hasGoalieData && (
        <GoalieStatsTable
          title={isDualRole ? "Goalie Stats" : "Stats"}
          perSeasonStats={player.perSeasonGoalieStats}
          allTimeStats={player.allTimeGoalieStats}
        />
      )}

      {/* Playoff stats */}
      {hasPlayoffSkaterData && (
        <SkaterStatsTable
          title={isDualRole ? "Playoff Skater Stats" : "Playoff Stats"}
          perSeasonStats={player.playoffPerSeasonStats}
          allTimeStats={player.playoffAllTimeStats}
        />
      )}

      {hasPlayoffGoalieData && (
        <GoalieStatsTable
          title={isDualRole ? "Playoff Goalie Stats" : "Playoff Stats"}
          perSeasonStats={player.playoffPerSeasonGoalieStats}
          allTimeStats={player.playoffAllTimeGoalieStats}
        />
      )}

      {/* Game logs */}
      {player.games.length > 0 && (
        <SkaterGameLogTable
          title={isDualRole ? "Skater Game Log" : "Game Log"}
          games={player.games}
        />
      )}

      {player.goalieGames.length > 0 && (
        <GoalieGameLogTable
          title={isDualRole ? "Goalie Game Log" : "Game Log"}
          games={player.goalieGames}
        />
      )}

      {player.playoffGames.length > 0 && (
        <SkaterGameLogTable
          title={isDualRole ? "Playoff Skater Game Log" : "Playoff Game Log"}
          games={player.playoffGames}
        />
      )}

      {player.playoffGoalieGames.length > 0 && (
        <GoalieGameLogTable
          title={isDualRole ? "Playoff Goalie Game Log" : "Playoff Game Log"}
          games={player.playoffGoalieGames}
        />
      )}
    </div>
  )
}

// ─── Reusable table components ────────────────────────────────────────────────

function SkaterStatsTable({ title, perSeasonStats, allTimeStats }: {
  title: string
  perSeasonStats: SeasonSkaterStats[]
  allTimeStats: SkaterStats | null
}) {
  return (
    <div>
      <SectionHeader>{title}</SectionHeader>
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <table className="w-full text-[11px] table-fixed min-w-[650px]">
          <thead>
            <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
              <th className="text-left font-medium py-2.5 w-[16%] whitespace-nowrap pr-3">Season</th>
              <th className="text-left font-medium py-2.5 w-[14%] whitespace-nowrap pr-3">Team</th>
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
            {perSeasonStats.map((s, i) => (
              <tr key={`${s.seasonId}-${s.teamSlug}`} className={cn("border-t border-border/20 hover:bg-muted/50 transition-colors", i === 0 && "bg-card/15")}>
                <td className="text-left py-2 text-[10px] font-medium text-muted-foreground whitespace-nowrap pr-3">
                  <Link href={`/standings?season=${s.seasonId}`} className="hover:text-primary transition-colors">{s.seasonName}</Link>
                </td>
                <td className="text-left py-2 text-[10px] font-medium text-muted-foreground truncate pr-3">
                  <Link href={`/team/${s.teamSlug}?season=${s.seasonId}`} className="hover:text-primary transition-colors">{s.teamName}</Link>
                </td>
                <td className="text-center tabular-nums py-2 px-3 whitespace-nowrap">{s.stats.gp}</td>
                <td className="text-center tabular-nums py-2 px-3 font-medium">{s.stats.goals}</td>
                <td className="text-center tabular-nums py-2 px-3 font-medium">{s.stats.assists}</td>
                <td className="text-center tabular-nums py-2 px-3 font-bold">{s.stats.points}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{s.stats.ptsPg}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{s.stats.gwg}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{s.stats.ppg}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{s.stats.shg}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{s.stats.eng ?? 0}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{s.stats.hatTricks ?? 0}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{s.stats.pim}</td>
              </tr>
            ))}
            {allTimeStats && perSeasonStats.length > 1 && (
              <tr className="border-t-2 border-border/40 hover:bg-muted/50 transition-colors">
                <td className="text-left py-2 text-[10px] font-bold text-muted-foreground whitespace-nowrap pr-3">All Time</td>
                <td className="text-left py-2 text-[10px] text-muted-foreground whitespace-nowrap pr-3"></td>
                <td className="text-center tabular-nums py-2 px-3 whitespace-nowrap">{allTimeStats.gp}</td>
                <td className="text-center tabular-nums py-2 px-3 font-medium">{allTimeStats.goals}</td>
                <td className="text-center tabular-nums py-2 px-3 font-medium">{allTimeStats.assists}</td>
                <td className="text-center tabular-nums py-2 px-3 font-bold">{allTimeStats.points}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{allTimeStats.ptsPg}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{allTimeStats.gwg}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{allTimeStats.ppg}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{allTimeStats.shg}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{allTimeStats.eng ?? 0}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{allTimeStats.hatTricks ?? 0}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{allTimeStats.pim}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GoalieStatsTable({ title, perSeasonStats, allTimeStats }: {
  title: string
  perSeasonStats: SeasonGoalieStats[]
  allTimeStats: GoalieStats | null
}) {
  return (
    <div>
      <SectionHeader>{title}</SectionHeader>
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <table className="w-full text-[11px] table-fixed min-w-[600px]">
          <thead>
            <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
              <th className="text-left font-medium py-2.5 w-[16%] whitespace-nowrap pr-3">Season</th>
              <th className="text-left font-medium py-2.5 w-[14%] whitespace-nowrap pr-3">Team</th>
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
            {perSeasonStats.map((s, i) => (
              <tr key={`${s.seasonId}-${s.teamSlug}`} className={cn("border-t border-border/20 hover:bg-muted/50 transition-colors", i === 0 && "bg-card/15")}>
                <td className="text-left py-2 text-[10px] font-medium text-muted-foreground whitespace-nowrap pr-3">
                  <Link href={`/standings?season=${s.seasonId}`} className="hover:text-primary transition-colors">{s.seasonName}</Link>
                </td>
                <td className="text-left py-2 text-[10px] font-medium text-muted-foreground truncate pr-3">
                  <Link href={`/team/${s.teamSlug}?season=${s.seasonId}`} className="hover:text-primary transition-colors">{s.teamName}</Link>
                </td>
                <td className="text-center tabular-nums py-2 px-3 whitespace-nowrap">{s.stats.gp}</td>
                <td className="text-center tabular-nums py-2 px-3 font-medium">{s.stats.wins}</td>
                <td className="text-center tabular-nums py-2 px-3">{s.stats.losses}</td>
                <td className="text-center tabular-nums py-2 px-3 font-bold">{s.stats.savePercentage}</td>
                <td className="text-center tabular-nums py-2 px-3">{s.stats.gaa}</td>
                <td className="text-center tabular-nums py-2 px-3">{s.stats.shutouts}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{s.stats.saves}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{s.stats.goalsAgainst}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{s.stats.shotsAgainst}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{s.stats.goalieAssists ?? 0}</td>
              </tr>
            ))}
            {allTimeStats && perSeasonStats.length > 1 && (
              <tr className="border-t-2 border-border/40 hover:bg-muted/50 transition-colors">
                <td className="text-left py-2 text-[10px] font-bold text-muted-foreground whitespace-nowrap pr-3">All Time</td>
                <td className="text-left py-2 text-[10px] text-muted-foreground whitespace-nowrap pr-3"></td>
                <td className="text-center tabular-nums py-2 px-3 whitespace-nowrap">{allTimeStats.gp}</td>
                <td className="text-center tabular-nums py-2 px-3 font-medium">{allTimeStats.wins}</td>
                <td className="text-center tabular-nums py-2 px-3">{allTimeStats.losses}</td>
                <td className="text-center tabular-nums py-2 px-3 font-bold">{allTimeStats.savePercentage}</td>
                <td className="text-center tabular-nums py-2 px-3">{allTimeStats.gaa}</td>
                <td className="text-center tabular-nums py-2 px-3">{allTimeStats.shutouts}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{allTimeStats.saves}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{allTimeStats.goalsAgainst}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{allTimeStats.shotsAgainst}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{allTimeStats.goalieAssists ?? 0}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SkaterGameLogTable({ title, games }: { title: string; games: SkaterGameLog[] }) {
  return (
    <div>
      <SectionHeader>{title}</SectionHeader>
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <table className="w-full text-[11px] table-fixed min-w-[620px]">
          <thead>
            <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
              <th className="text-left font-medium py-2.5 w-[12%] whitespace-nowrap pr-3">Date</th>
              <th className="text-left font-medium py-2.5 w-[14%] whitespace-nowrap pr-3">Opp</th>
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
            {games.map((g, i) => (
              <tr key={g.gameId} className={cn("border-t border-border/20 hover:bg-muted/50", i % 2 === 0 && "bg-card/15")}>
                <td className="py-2 text-[10px] text-muted-foreground whitespace-nowrap pr-3">
                  <Link href={`/game/${g.gameId}`} className="hover:text-primary transition-colors">
                    {formatGameDate(g.date)}
                  </Link>
                </td>
                <td className="py-2 text-xs font-medium truncate pr-3">
                  <span className="text-muted-foreground/40 mr-1">{g.isHome ? "vs" : "@"}</span>
                  <Link href={`/team/${g.opponentSlug}`} className="hover:text-primary transition-colors">
                    {g.opponent}
                  </Link>
                </td>
                <td className="text-center py-2 text-[10px] tabular-nums text-muted-foreground">
                  {g.teamScore != null ? (
                    <Link href={`/game/${g.gameId}`} className="hover:underline transition-colors">
                      {g.teamScore}-{g.opponentScore}
                      {g.result && <span className="ml-1">{g.result}</span>}
                    </Link>
                  ) : "-"}
                </td>
                <td className={cn("text-center tabular-nums py-2 px-3", g.goals > 0 && "font-medium")}>{g.goals}</td>
                <td className={cn("text-center tabular-nums py-2 px-3", g.assists > 0 && "font-medium")}>{g.assists}</td>
                <td className="text-center tabular-nums py-2 px-3 font-bold">{g.points}</td>
                <td className={cn("text-center tabular-nums py-2 px-3", (g.gwg ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{g.gwg ?? 0}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.ppg ?? 0}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.shg ?? 0}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.eng ?? 0}</td>
                <td className={cn("text-center tabular-nums py-2 px-3", (g.hatTricks ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{g.hatTricks ?? 0}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.pim}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GoalieGameLogTable({ title, games }: { title: string; games: GoalieGameLog[] }) {
  return (
    <div>
      <SectionHeader>{title}</SectionHeader>
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <table className="w-full text-[11px] table-fixed min-w-[550px]">
          <thead>
            <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
              <th className="text-left font-medium py-2.5 w-[12%] whitespace-nowrap pr-3">Date</th>
              <th className="text-left font-medium py-2.5 w-[14%] whitespace-nowrap pr-3">Opp</th>
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
            {games.map((g, i) => (
              <tr key={g.gameId} className={cn("border-t border-border/20 hover:bg-muted/50", i % 2 === 0 && "bg-card/15")}>
                <td className="py-2 text-[10px] text-muted-foreground whitespace-nowrap pr-3">
                  <Link href={`/game/${g.gameId}`} className="hover:text-primary transition-colors">
                    {formatGameDate(g.date)}
                  </Link>
                </td>
                <td className="py-2 text-xs font-medium truncate pr-3">
                  <span className="text-muted-foreground/40 mr-1">{g.isHome ? "vs" : "@"}</span>
                  <Link href={`/team/${g.opponentSlug}`} className="hover:text-primary transition-colors">
                    {g.opponent}
                  </Link>
                </td>
                <td className="text-center py-2 text-[10px] tabular-nums text-muted-foreground">
                  {g.teamScore != null ? (
                    <Link href={`/game/${g.gameId}`} className="hover:underline transition-colors">
                      {g.teamScore}-{g.opponentScore}
                    </Link>
                  ) : "-"}
                </td>
                <td className="text-center tabular-nums py-2 px-3">{g.result ?? "-"}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.shotsAgainst}</td>
                <td className="text-center tabular-nums py-2 px-3 font-medium">{g.saves}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.goalsAgainst}</td>
                <td className="text-center tabular-nums py-2 px-3 font-bold">{g.savePercentage}</td>
                <td className={cn("text-center tabular-nums py-2 px-3", (g.shutouts ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{g.shutouts ?? 0}</td>
                <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.goalieAssists ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
