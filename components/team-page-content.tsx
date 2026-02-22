"use client"

import { useMemo } from "react"
import { formatGameDate } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { playerSlug } from "@/lib/player-slug"
import { useRouter } from "next/navigation"
import type { TeamDetail } from "@/app/api/bash/team/[slug]/route"
import { useSort, SortableTh, statsRowClass, SectionHeader } from "@/components/stats-table"

type SkaterSortKey = "points" | "goals" | "assists" | "pim" | "gp" | "gwg" | "ppg" | "shg" | "eng" | "hatTricks" | "pen" | "ptsPg"
type GoalieSortKey = "savePercentage" | "gaa" | "wins" | "losses" | "gp" | "shutouts" | "saves" | "goalsAgainst" | "shotsAgainst" | "goalieAssists"

const goalieAscKeys = new Set<GoalieSortKey>(["gaa"])

export function TeamPageContent({ team }: { team: TeamDetail }) {
  const { sortKey: skaterSort, sortDir: skaterDir, toggleSort: toggleSkaterSort } = useSort<SkaterSortKey>("points")
  const { sortKey: goalieSort, sortDir: goalieDir, toggleSort: toggleGoalieSort } = useSort<GoalieSortKey>("savePercentage", "desc", goalieAscKeys)

  const sortedSkaters = useMemo(() => {
    return [...team.skaters].sort((a, b) => {
      const av = (a[skaterSort] ?? 0) as number
      const bv = (b[skaterSort] ?? 0) as number
      return skaterDir === "desc" ? bv - av : av - bv
    })
  }, [team, skaterSort, skaterDir])

  const sortedGoalies = useMemo(() => {
    return [...team.goalies].sort((a, b) => {
      const av = (a[goalieSort] ?? 0) as number
      const bv = (b[goalieSort] ?? 0) as number
      return goalieDir === "desc" ? bv - av : av - bv
    })
  }, [team, goalieSort, goalieDir])

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight">{team.name}</h1>
        {team.record && (
          <p className="text-xs text-muted-foreground mt-1">
            {team.record.rank > 0 && <><span className="font-medium">{team.record.rank}{team.record.rank === 1 ? "st" : team.record.rank === 2 ? "nd" : team.record.rank === 3 ? "rd" : "th"}</span> of {team.record.totalTeams}<span className="text-muted-foreground/40 mx-1.5">|</span></>}
            {team.record.w}-{team.record.l}{team.record.otw > 0 ? `-${team.record.otw}` : ""}{team.record.otl > 0 ? `-${team.record.otl}` : ""}
            <span className="text-muted-foreground/40 mx-1.5">|</span>
            {team.record.pts} pts
            <span className="text-muted-foreground/40 mx-1.5">|</span>
            {team.record.gf} GF, {team.record.ga} GA ({team.record.gf - team.record.ga > 0 ? "+" : ""}{team.record.gf - team.record.ga})
          </p>
        )}
      </div>

      {/* Skaters */}
      {sortedSkaters.length > 0 && (
        <div>
          <div className="overflow-x-auto -mx-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[700px] text-[11px] table-fixed">
              <thead>
                <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                  <th className="text-left font-medium py-2.5 min-w-[120px] pl-4 sm:pl-0">Player</th>
                  <SortableTh label="GP" sortKey="gp" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                  <SortableTh label="G" sortKey="goals" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                  <SortableTh label="A" sortKey="assists" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                  <SortableTh label="PTS" sortKey="points" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} bold />
                  <SortableTh label="PTS/G" sortKey="ptsPg" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                  <SortableTh label="GWG" sortKey="gwg" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                  <SortableTh label="PPG" sortKey="ppg" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                  <SortableTh label="SHG" sortKey="shg" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                  <SortableTh label="ENG" sortKey="eng" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                  <SortableTh label="HAT" sortKey="hatTricks" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                  <SortableTh label="PIM" sortKey="pim" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                </tr>
              </thead>
              <tbody>
                {sortedSkaters.map((p, i) => (
                  <tr key={p.id} className={cn("border-t border-border/20 hover:bg-muted/50", i % 2 === 0 && "bg-card/15")}>
                    <td className="py-2 pr-2 pl-4 sm:pl-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-muted-foreground/40 tabular-nums text-[10px] shrink-0">{i + 1}</span>
                        <Link href={`/player/${playerSlug(p.name)}`} className="text-xs font-semibold hover:text-primary transition-colors">{p.name}</Link>
                      </div>
                    </td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.gp}</td>
                    <td className={cn("text-center tabular-nums py-2 px-3", p.goals > 0 && "font-medium")}>{p.goals}</td>
                    <td className={cn("text-center tabular-nums py-2 px-3", p.assists > 0 && "font-medium")}>{p.assists}</td>
                    <td className="text-center tabular-nums py-2 px-3 font-bold">{p.points}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.ptsPg}</td>
                    <td className={cn("text-center tabular-nums py-2 px-3", (p.gwg ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{p.gwg ?? 0}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.ppg ?? 0}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.shg ?? 0}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.eng ?? 0}</td>
                    <td className={cn("text-center tabular-nums py-2 px-3", (p.hatTricks ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{p.hatTricks ?? 0}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.pim}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Goalies */}
      {sortedGoalies.length > 0 && (
        <div>
          <div className="overflow-x-auto -mx-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[600px] text-[11px] table-fixed">
              <thead>
                <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                  <th className="text-left font-medium py-2.5 min-w-[120px] pl-4 sm:pl-0">Goalie</th>
                  <SortableTh label="GP" sortKey="gp" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="W" sortKey="wins" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="L" sortKey="losses" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="SV%" sortKey="savePercentage" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} bold />
                  <SortableTh label="GAA" sortKey="gaa" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="SO" sortKey="shutouts" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="SV" sortKey="saves" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="GA" sortKey="goalsAgainst" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="SA" sortKey="shotsAgainst" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                  <SortableTh label="A" sortKey="goalieAssists" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                </tr>
              </thead>
              <tbody>
                {sortedGoalies.map((g, i) => (
                  <tr key={g.id} className={cn("border-t border-border/20 hover:bg-muted/50", i % 2 === 0 && "bg-card/15")}>
                    <td className="py-2 pr-2 pl-4 sm:pl-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-muted-foreground/40 tabular-nums text-[10px] shrink-0">{i + 1}</span>
                        <Link href={`/player/${playerSlug(g.name)}`} className="text-xs font-semibold hover:text-primary transition-colors">{g.name}</Link>
                      </div>
                    </td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.gp}</td>
                    <td className={cn("text-center tabular-nums py-2 px-3", (g.wins ?? 0) > 0 && "font-medium")}>{g.wins}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.losses}</td>
                    <td className="text-center tabular-nums py-2 px-3 font-bold">{g.savePercentage}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.gaa}</td>
                    <td className={cn("text-center tabular-nums py-2 px-3", (g.shutouts ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{g.shutouts ?? 0}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.saves ?? 0}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.goalsAgainst ?? 0}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.shotsAgainst ?? 0}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.goalieAssists ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Schedule/Results */}
      <div>
        <SectionHeader>Schedule</SectionHeader>
        <div className="flex flex-col gap-1">
          {team.games.map((g) => (
            <GameRow key={g.id} game={g} />
          ))}
        </div>
      </div>
    </div>
  )
}

function GameRow({ game: g }: { game: TeamDetail["games"][number] }) {
  const router = useRouter()
  const isFinal = g.status === "final"

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg",
        isFinal && "hover:bg-muted/50 transition-colors cursor-pointer"
      )}
      onClick={isFinal ? () => router.push(`/game/${g.id}`) : undefined}
    >
      <span className="text-[10px] text-muted-foreground/60 font-medium w-20 shrink-0">
        {formatGameDate(g.date)}
      </span>
      <span className="text-[10px] text-muted-foreground/40 w-6 shrink-0 text-center">
        {g.isHome ? "vs" : "@"}
      </span>
      <span className="flex-1">
        <Link
          href={`/team/${g.opponentSlug}`}
          className="text-xs font-medium text-foreground hover:text-primary transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {g.opponent}
        </Link>
      </span>
      {isFinal ? (
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono tabular-nums font-medium text-muted-foreground">
            {g.result}
          </span>
          <span className="text-xs font-mono tabular-nums text-foreground">
            {g.teamScore}-{g.opponentScore}
          </span>
        </div>
      ) : (
        <span className="text-[10px] text-muted-foreground/40">{g.time}</span>
      )}
    </div>
  )
}
