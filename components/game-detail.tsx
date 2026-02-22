"use client"

import { useState, useMemo } from "react"
import { useGameDetail, type BashGame, type BashGameDetail } from "@/lib/hockey-data"
import { formatGameDate } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import { playerSlug } from "@/lib/player-slug"
import type { PlayerBoxScore, GoalieBoxScore } from "@/app/api/bash/game/[id]/route"
import { useSort, SortableTh, SectionHeader } from "@/components/stats-table"

type SkaterSortKey = "points" | "goals" | "assists" | "pim" | "gwg" | "ppg" | "shg" | "eng" | "hatTricks" | "pen"

interface GameDetailProps {
  game: BashGame
  initialDetail?: BashGameDetail
}

export function GameDetail({ game, initialDetail }: GameDetailProps) {
  const { detail, isLoading, isError } = useGameDetail(game.id, initialDetail)
  const isFinal = game.status === "final"

  return (
    <div className="w-full">
      {/* Game meta */}
      <div className="flex items-center gap-2 mb-3 text-[11px] text-muted-foreground tracking-wide uppercase font-medium flex-wrap">
        <span>{formatGameDate(game.date)}</span>
        <span className="text-border">|</span>
        <span className="normal-case tracking-normal">{game.time}</span>
        <span className="text-border">|</span>
        <span className="normal-case tracking-normal">{game.location}</span>
      </div>

      {/* Hero Scoreboard */}
      <div className={cn(
        "relative rounded-2xl overflow-hidden",
        "bg-gradient-to-b from-card via-card to-background",
        "border border-border/60"
      )}>
        <div className="relative px-6 py-8 sm:py-10">
          <div className="flex items-center justify-between gap-2">
            {/* Away team */}
            <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
              <div className="text-center">
                <Link href={`/team/${game.awaySlug}`} className="text-sm font-bold text-foreground leading-tight hover:text-primary transition-colors">
                  {game.awayTeam}
                </Link>
              </div>
            </div>

            {/* Score block */}
            <div className="flex flex-col items-center gap-2 px-4">
              <div className="flex items-baseline gap-3">
                <span className="text-5xl sm:text-6xl font-black font-mono tabular-nums tracking-tighter text-foreground">
                  {game.awayScore ?? "-"}
                </span>
                <span className="text-2xl text-muted-foreground/40 font-light select-none">&ndash;</span>
                <span className="text-5xl sm:text-6xl font-black font-mono tabular-nums tracking-tighter text-foreground">
                  {game.homeScore ?? "-"}
                </span>
              </div>
              <div className={cn(
                "text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full",
                isFinal && "bg-secondary text-secondary-foreground",
                game.status === "upcoming" && "bg-secondary/40 text-muted-foreground"
              )}>
                {isFinal ? (game.isOvertime ? "Final/OT" : "Final") : "Upcoming"}
              </div>
            </div>

            {/* Home team */}
            <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
              <div className="text-center">
                <Link href={`/team/${game.homeSlug}`} className="text-sm font-bold text-foreground leading-tight hover:text-primary transition-colors">
                  {game.homeTeam}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="pt-6">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">Loading box score&hellip;</span>
          </div>
        )}

        {isError && (
          <div className="text-center py-8">
            <p className="text-xs text-muted-foreground">Unable to load game details.</p>
          </div>
        )}

        {game.status === "upcoming" && !detail && !isLoading && (
          <div className="text-center py-8">
            <p className="text-xs text-muted-foreground">Game has not been played yet.</p>
          </div>
        )}

        {detail && (
          <div className="flex flex-col gap-8">
            {/* Away team box score */}
            {detail.awayPlayers.length > 0 && (
              <div>
                <SectionHeader>{detail.awayTeam}</SectionHeader>
                <SkaterBoxScore players={detail.awayPlayers} />
              </div>
            )}

            {/* Away goalies */}
            {detail.awayGoalies.length > 0 && (
              <GoalieBoxScoreTable goalies={detail.awayGoalies} />
            )}

            {/* Home team box score */}
            {detail.homePlayers.length > 0 && (
              <div>
                <SectionHeader>{detail.homeTeam}</SectionHeader>
                <SkaterBoxScore players={detail.homePlayers} />
              </div>
            )}

            {/* Home goalies */}
            {detail.homeGoalies.length > 0 && (
              <GoalieBoxScoreTable goalies={detail.homeGoalies} />
            )}

            {/* Officials */}
            {detail.officials.length > 0 && (
              <div>
                <SectionHeader>Officials</SectionHeader>
                <div className="flex flex-wrap gap-2">
                  {detail.officials.map((o, i) => (
                    <span key={i} className="text-xs text-muted-foreground bg-card/50 px-3 py-1.5 rounded-md">
                      {o.name}
                      <span className="text-muted-foreground/50 ml-1 text-[9px] uppercase">({o.role})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SkaterBoxScore({ players }: { players: PlayerBoxScore[] }) {
  const { sortKey, sortDir, toggleSort } = useSort<SkaterSortKey>("points")

  const sorted = useMemo(() => {
    return [...players].sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number
      const bv = (b[sortKey] ?? 0) as number
      const cmp = sortDir === "desc" ? bv - av : av - bv
      if (cmp !== 0) return cmp
      return b.points - a.points || b.goals - a.goals
    })
  }, [players, sortKey, sortDir])

  return (
    <div className="overflow-x-auto -mx-4 px-4 mb-3">
      <table className="w-full text-[11px] table-fixed">
        <thead>
          <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
            <th className="text-left font-medium py-2 pr-2 min-w-[120px]">Player</th>
            <SortableTh label="G" sortKey="goals" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="w-8 py-2" />
            <SortableTh label="A" sortKey="assists" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="w-8 py-2" />
            <SortableTh label="PTS" sortKey="points" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} bold className="w-8 py-2" />
            <SortableTh label="GWG" sortKey="gwg" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="hidden sm:table-cell w-8 py-2" />
            <SortableTh label="PPG" sortKey="ppg" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="hidden sm:table-cell w-8 py-2" />
            <SortableTh label="SHG" sortKey="shg" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="hidden sm:table-cell w-8 py-2" />
            <SortableTh label="ENG" sortKey="eng" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="hidden sm:table-cell w-8 py-2" />
            <SortableTh label="HAT" sortKey="hatTricks" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="hidden sm:table-cell w-8 py-2" />
            <SortableTh label="PIM" sortKey="pim" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="w-8 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr
              key={p.name}
              className={cn(
                "border-t border-border/30 hover:bg-muted/50 transition-colors",
                i % 2 === 0 && "bg-card/20"
              )}
            >
              <td className="py-2 pr-2">
                <Link href={`/player/${playerSlug(p.name)}`} className={cn("hover:text-primary transition-colors font-medium", p.points > 0 && "font-semibold text-foreground")}>
                  {p.name}
                </Link>
              </td>
              <td className={cn("text-center tabular-nums py-2 px-3", p.goals > 0 && "font-medium")}>{p.goals}</td>
              <td className={cn("text-center tabular-nums py-2 px-3", p.assists > 0 && "font-medium")}>{p.assists}</td>
              <td className="text-center tabular-nums py-2 px-3 font-bold">{p.points}</td>
              <td className={cn("text-center tabular-nums py-2 px-3 hidden sm:table-cell", (p.gwg ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{p.gwg ?? 0}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground hidden sm:table-cell">{p.ppg ?? 0}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground hidden sm:table-cell">{p.shg ?? 0}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground hidden sm:table-cell">{p.eng ?? 0}</td>
              <td className={cn("text-center tabular-nums py-2 px-3 hidden sm:table-cell", (p.hatTricks ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{p.hatTricks ?? 0}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.pim}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GoalieBoxScoreTable({ goalies }: { goalies: GoalieBoxScore[] }) {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-[11px] table-fixed">
        <thead>
          <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
            <th className="text-left font-medium py-2 pr-2 min-w-[120px]">Goalie</th>
            <th className="text-center font-medium py-2 w-10">MIN</th>
            <th className="text-center font-medium py-2 w-10">SA</th>
            <th className="text-center font-medium py-2 w-10">SV</th>
            <th className="text-center font-medium py-2 w-10">GA</th>
            <th className="text-center font-medium py-2 w-12 font-bold">SV%</th>
            <th className="text-center font-medium py-2 w-10 hidden sm:table-cell">SO</th>
            <th className="text-center font-medium py-2 w-10 hidden sm:table-cell">A</th>
            <th className="text-center font-medium py-2 w-10">DEC</th>
          </tr>
        </thead>
        <tbody>
          {goalies.map((g, i) => (
            <tr
              key={g.name}
              className={cn(
                "border-t border-border/30 hover:bg-muted/50 transition-colors",
                i % 2 === 0 && "bg-card/20"
              )}
            >
              <td className="py-2 pr-2">
                <Link href={`/player/${playerSlug(g.name)}`} className="font-medium hover:text-primary transition-colors">{g.name}</Link>
              </td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.minutes}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.shotsAgainst}</td>
              <td className="text-center tabular-nums py-2 px-3 font-medium">{g.saves}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.goalsAgainst}</td>
              <td className="text-center tabular-nums py-2 px-3 font-bold">{g.savePercentage}</td>
              <td className={cn("text-center tabular-nums py-2 px-3 hidden sm:table-cell", (g.shutouts ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{g.shutouts ?? 0}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground hidden sm:table-cell">{g.goalieAssists ?? 0}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.result ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
