"use client"

import { useState, useMemo } from "react"
import { formatGameDate } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronUp } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { TeamDetail } from "@/app/api/bash/team/[slug]/route"

type SkaterSortKey = "points" | "goals" | "assists" | "pim" | "gp" | "gwg" | "ppg" | "shg" | "eng" | "hatTricks" | "pen"
type GoalieSortKey = "savePercentage" | "gaa" | "wins" | "losses" | "gp" | "shutouts" | "saves" | "goalsAgainst" | "shotsAgainst" | "goalieAssists"
type SortDir = "asc" | "desc"

export function TeamPageContent({ team }: { team: TeamDetail }) {
  const [skaterSort, setSkaterSort] = useState<SkaterSortKey>("points")
  const [skaterDir, setSkaterDir] = useState<SortDir>("desc")
  const [goalieSort, setGoalieSort] = useState<GoalieSortKey>("savePercentage")
  const [goalieDir, setGoalieDir] = useState<SortDir>("desc")

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

  function toggleSkaterSort(key: SkaterSortKey) {
    if (skaterSort === key) setSkaterDir((d) => (d === "desc" ? "asc" : "desc"))
    else { setSkaterSort(key); setSkaterDir("desc") }
  }

  function toggleGoalieSort(key: GoalieSortKey) {
    if (goalieSort === key) setGoalieDir((d) => (d === "desc" ? "asc" : "desc"))
    else { setGoalieSort(key); setGoalieDir(key === "gaa" ? "asc" : "desc") }
  }

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
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                  <th className="text-left font-medium py-2.5 min-w-[120px]">Player</th>
                  <SkaterSortableTh label="GP" sortKey="gp" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                  <SkaterSortableTh label="G" sortKey="goals" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                  <SkaterSortableTh label="A" sortKey="assists" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                  <SkaterSortableTh label="PTS" sortKey="points" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} bold />
                  <SkaterSortableTh label="GWG" sortKey="gwg" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} className="hidden sm:table-cell" />
                  <SkaterSortableTh label="PPG" sortKey="ppg" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} className="hidden sm:table-cell" />
                  <SkaterSortableTh label="SHG" sortKey="shg" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} className="hidden sm:table-cell" />
                  <SkaterSortableTh label="ENG" sortKey="eng" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} className="hidden sm:table-cell" />
                  <SkaterSortableTh label="HAT" sortKey="hatTricks" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} className="hidden sm:table-cell" />
                  <SkaterSortableTh label="PIM" sortKey="pim" currentKey={skaterSort} dir={skaterDir} onToggle={toggleSkaterSort} />
                </tr>
              </thead>
              <tbody>
                {sortedSkaters.map((p, i) => (
                  <tr key={p.id} className={cn("border-t border-border/20 hover:bg-muted/50", i % 2 === 0 && "bg-card/15")}>
                    <td className="py-2 pr-2">
                      <Link href={`/player/${p.id}`} className="text-xs font-semibold hover:text-primary transition-colors">{p.name}</Link>
                    </td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.gp}</td>
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
        </div>
      )}

      {/* Goalies */}
      {sortedGoalies.length > 0 && (
        <div>
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                  <th className="text-left font-medium py-2.5 min-w-[120px]">Goalie</th>
                  <GoalieSortableTh label="GP" sortKey="gp" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                  <GoalieSortableTh label="W" sortKey="wins" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                  <GoalieSortableTh label="L" sortKey="losses" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                  <GoalieSortableTh label="SV%" sortKey="savePercentage" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} bold />
                  <GoalieSortableTh label="GAA" sortKey="gaa" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} />
                  <GoalieSortableTh label="SO" sortKey="shutouts" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} className="hidden sm:table-cell" />
                  <GoalieSortableTh label="SV" sortKey="saves" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} className="hidden sm:table-cell" />
                  <GoalieSortableTh label="GA" sortKey="goalsAgainst" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} className="hidden sm:table-cell" />
                  <GoalieSortableTh label="SA" sortKey="shotsAgainst" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} className="hidden sm:table-cell" />
                  <GoalieSortableTh label="A" sortKey="goalieAssists" currentKey={goalieSort} dir={goalieDir} onToggle={toggleGoalieSort} className="hidden sm:table-cell" />
                </tr>
              </thead>
              <tbody>
                {sortedGoalies.map((g, i) => (
                  <tr key={g.id} className={cn("border-t border-border/20 hover:bg-muted/50", i % 2 === 0 && "bg-card/15")}>
                    <td className="py-2 pr-2">
                      <Link href={`/player/${g.id}`} className="text-xs font-semibold hover:text-primary transition-colors">{g.name}</Link>
                    </td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.gp}</td>
                    <td className={cn("text-center tabular-nums py-2 px-3", (g.wins ?? 0) > 0 && "font-medium")}>{g.wins}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.losses}</td>
                    <td className="text-center tabular-nums py-2 px-3 font-bold">{g.savePercentage}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.gaa}</td>
                    <td className={cn("text-center tabular-nums py-2 px-3 hidden sm:table-cell", (g.shutouts ?? 0) > 0 ? "font-medium" : "text-muted-foreground")}>{g.shutouts ?? 0}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground hidden sm:table-cell">{g.saves ?? 0}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground hidden sm:table-cell">{g.goalsAgainst ?? 0}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground hidden sm:table-cell">{g.shotsAgainst ?? 0}</td>
                    <td className="text-center tabular-nums py-2 px-3 text-muted-foreground hidden sm:table-cell">{g.goalieAssists ?? 0}</td>
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
      <Link
        href={`/team/${g.opponentSlug}`}
        className="text-xs font-medium text-foreground hover:text-primary transition-colors flex-1"
        onClick={(e) => e.stopPropagation()}
      >
        {g.opponent}
      </Link>
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

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/30" />
  return dir === "desc"
    ? <ChevronDown className="h-2.5 w-2.5 text-primary" />
    : <ChevronUp className="h-2.5 w-2.5 text-primary" />
}

function SkaterSortableTh({ label, sortKey, currentKey, dir, onToggle, bold, className }: {
  label: string; sortKey: SkaterSortKey; currentKey: SkaterSortKey; dir: SortDir
  onToggle: (k: SkaterSortKey) => void; bold?: boolean; className?: string
}) {
  return (
    <th
      className={cn("text-center font-medium py-2.5 w-10 cursor-pointer select-none", className)}
      onClick={() => onToggle(sortKey)}
    >
      <div className="flex items-center justify-center gap-0.5">
        <span className={cn(bold && "font-bold")}>{label}</span>
        <SortIcon active={currentKey === sortKey} dir={dir} />
      </div>
    </th>
  )
}

function GoalieSortableTh({ label, sortKey, currentKey, dir, onToggle, bold, className }: {
  label: string; sortKey: GoalieSortKey; currentKey: GoalieSortKey; dir: SortDir
  onToggle: (k: GoalieSortKey) => void; bold?: boolean; className?: string
}) {
  return (
    <th
      className={cn("text-center font-medium py-2.5 w-10 cursor-pointer select-none", className)}
      onClick={() => onToggle(sortKey)}
    >
      <div className="flex items-center justify-center gap-0.5">
        <span className={cn(bold && "font-bold")}>{label}</span>
        <SortIcon active={currentKey === sortKey} dir={dir} />
      </div>
    </th>
  )
}
