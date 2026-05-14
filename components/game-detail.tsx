"use client"

import { useState, useMemo, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useGameDetail, useLiveGame, type BashGame, type BashGameDetail } from "@/lib/hockey-data"
import { formatGameDate, formatGameTime } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import { Loader2, Star } from "lucide-react"
import Link from "next/link"
import { playerSlug } from "@/lib/player-slug"
import { formatGoalieTime } from "@/lib/format-goalie-time"
import type { PlayerBoxScore, GoalieBoxScore } from "@/app/api/bash/game/[id]/route"
import { useSort, SortableTh, SectionHeader } from "@/components/stats-table"
import type { LiveGameState, GoalEvent, RosterPlayer } from "@/lib/scorekeeper-types"
import { periodLabel, formatClock, computeCurrentClock, parseClockString, clockToElapsedDisplay } from "@/lib/scorekeeper-types"
import { AdminGameEditor } from "@/components/admin-editor/admin-game-editor"
import { useAdmin } from "@/lib/admin-context"
import { TeamLogo } from "@/components/team-logo"
import { mutate } from "swr"
import { GameTypeBadge } from "@/components/game-type-badge"

type SkaterSortKey = "points" | "goals" | "assists" | "pim" | "gwg" | "ppg" | "shg" | "eng" | "hatTricks" | "pen"

interface GameDetailProps {
  game: BashGame
  initialDetail?: BashGameDetail
  initialLiveData?: { state: unknown; homeScore: number | null; awayScore: number | null; playerNames: Record<number, string>; goalieIds: number[] }
  homeRoster?: RosterPlayer[]
  awayRoster?: RosterPlayer[]
  forceEdit?: boolean
}

export function GameDetail({ game, initialDetail, initialLiveData, homeRoster, awayRoster, forceEdit }: GameDetailProps) {
  const { detail, isLoading, isError } = useGameDetail(game.id, initialDetail)
  const isLive = game.status === "live"
  const isFinal = game.status === "final"
  // Fetch live data for both live and final games (to get goal/penalty event details)
  const { liveData } = useLiveGame(isLive || isFinal ? game.id : null, initialLiveData)

  const liveState: LiveGameState | null = liveData?.state ?? null

  // Avoid hydration mismatch from Date.now() in computeCurrentClock
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Tick every second so the clock updates in real time
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!liveState?.clockRunning) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [liveState?.clockRunning])

  // Admin edit mode
  const { isAdmin, pin: adminPin } = useAdmin()
  const [editMode, setEditMode] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()

  // Show edit button only for admin + scorekeeper games (those with liveState) that are final
  const canEdit = isAdmin && isFinal && liveState && homeRoster && awayRoster

  // Auto-enter edit mode when ?edit=1 is in the URL or forceEdit is set, and conditions are met
  useEffect(() => {
    if ((forceEdit || searchParams.get("edit") === "1") && canEdit && !editMode) {
      setEditMode(true)
    }
  }, [searchParams, canEdit, editMode, forceEdit])

  // Exit edit mode when admin mode is turned off
  useEffect(() => {
    if (!isAdmin && editMode) {
      setEditMode(false)
    }
  }, [isAdmin, editMode])

  // For live games, use live scores
  const displayHomeScore = isLive && liveData ? liveData.homeScore : game.homeScore
  const displayAwayScore = isLive && liveData ? liveData.awayScore : game.awayScore

  return (
    <div className="w-full">
      {/* Game meta */}
      <div className="flex items-center gap-2 mb-3 text-[11px] text-muted-foreground tracking-wide uppercase font-medium flex-wrap">
        <span>{formatGameDate(game.date)}</span>
        <span className="text-border">|</span>
        <span className="normal-case tracking-normal">{formatGameTime(game.time)}</span>
        <span className="text-border">|</span>
        <span className="normal-case tracking-normal">{game.location}</span>
        <GameTypeBadge gameType={game.gameType} />
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
            <Link href={`/team/${game.awaySlug}`} className="flex flex-col items-center gap-2 flex-1 min-w-0 group/away">
              <TeamLogo slug={game.awaySlug} name={game.awayTeam} size={56} />
              <span className="text-sm font-bold text-foreground leading-tight group-hover/away:text-primary transition-colors text-center">
                {game.awayTeam}
              </span>
            </Link>

            {/* Score block */}
            <div className="flex flex-col items-center gap-2 px-4">
              <div className="flex items-baseline gap-3">
                <span className="text-5xl sm:text-6xl font-black font-mono tabular-nums tracking-tighter text-foreground">
                  {displayAwayScore ?? "-"}
                </span>
                <span className="text-2xl text-muted-foreground/40 font-light select-none">&ndash;</span>
                <span className="text-5xl sm:text-6xl font-black font-mono tabular-nums tracking-tighter text-foreground">
                  {displayHomeScore ?? "-"}
                </span>
              </div>
              <div className={cn(
                "text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full",
                isFinal && "bg-secondary text-secondary-foreground",
                isLive && "bg-foreground/10 text-foreground",
                game.status === "upcoming" && "bg-secondary/40 text-muted-foreground"
              )}>
                {isLive ? (
                  <span className="flex items-center gap-1.5">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-foreground/40 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-foreground" />
                    </span>
                    {liveState ? `${periodLabel(liveState.period)} ${formatClock(mounted ? computeCurrentClock(liveState) : liveState.clockSeconds)}` : "Live"}
                  </span>
                ) : isFinal ? (game.isOvertime ? "Final/OT" : game.isForfeit ? "Final/Forfeit" : "Final") : "Upcoming"}
              </div>
            </div>

            {/* Home team */}
            <Link href={`/team/${game.homeSlug}`} className="flex flex-col items-center gap-2 flex-1 min-w-0 group/home">
              <TeamLogo slug={game.homeSlug} name={game.homeTeam} size={56} />
              <span className="text-sm font-bold text-foreground leading-tight group-hover/home:text-primary transition-colors text-center">
                {game.homeTeam}
              </span>
            </Link>
          </div>
        </div>
      </div>

      {/* Admin Editor (replaces normal content) */}
      {editMode && canEdit && (
        <div className="pt-4">
          <AdminGameEditor
            gameId={game.id}
            state={liveState}
            pin={adminPin}
            homeSlug={game.homeSlug}
            awaySlug={game.awaySlug}
            homeTeam={game.homeTeam}
            awayTeam={game.awayTeam}
            homeRoster={homeRoster}
            awayRoster={awayRoster}
            playerNames={{ ...(liveData?.playerNames ?? {}), ...buildPlayerNameMap(detail) }}
            onClose={() => {
              setEditMode(false)
              if (searchParams.get("edit")) router.replace(`/game/${game.id}`)
              window.scrollTo(0, 0)
            }}
            onSaved={() => {
              setEditMode(false)
              if (searchParams.get("edit")) router.replace(`/game/${game.id}`)
              window.scrollTo(0, 0)
              // Revalidate SWR caches so boxscore/live data refreshes
              mutate(`/api/bash/game/${game.id}`)
              mutate(`/api/bash/game/${game.id}/live`)
            }}
          />
        </div>
      )}

      {/* Normal read-only content — hidden when in edit mode */}
      {!editMode && (
        <>
          {/* Three Stars */}
          {liveState?.threeStars && liveState.threeStars.some(id => id > 0) && (
            <ThreeStars
              stars={liveState.threeStars}
              playerNames={{ ...(liveData?.playerNames ?? {}), ...buildPlayerNameMap(detail) }}
            />
          )}

          {/* Period summary (goals + shots by period) */}
          {(isLive || isFinal) && liveState && (
            <div className="pt-4">
              <LivePeriodSummary state={liveState} homeSlug={game.homeSlug} awaySlug={game.awaySlug} homeTeam={game.homeTeam} awayTeam={game.awayTeam} />
            </div>
          )}

          {/* Events (goals + penalties with details) — for both live and final games */}
          {liveState && liveState.goals.length > 0 && (
            <div className="pt-4">
              <EventLog
                state={liveState}
                homeSlug={game.homeSlug}
                awaySlug={game.awaySlug}
                homeTeam={game.homeTeam}
                awayTeam={game.awayTeam}
                playerNames={{ ...(liveData?.playerNames ?? {}), ...buildPlayerNameMap(detail) }}
              />
            </div>
          )}

          {liveState && liveState.penalties.length > 0 && (
            <div className="pt-4">
              <PenaltyLog
                state={liveState}
                homeSlug={game.homeSlug}
                awaySlug={game.awaySlug}
                homeTeam={game.homeTeam}
                awayTeam={game.awayTeam}
                playerNames={{ ...(liveData?.playerNames ?? {}), ...buildPlayerNameMap(detail) }}
              />
            </div>
          )}
        </>
      )}

      {/* Content */}
      {!editMode && <div className="pt-6">
        {isLoading && !isLive && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">Loading box score&hellip;</span>
          </div>
        )}

        {isError && !isLive && (
          <div className="text-center py-8">
            <p className="text-xs text-muted-foreground">Unable to load game details.</p>
          </div>
        )}

        {game.status === "upcoming" && !detail && !isLoading && (
          <div className="text-center py-8">
            <p className="text-xs text-muted-foreground">Game has not been played yet.</p>
          </div>
        )}

        {isLive && liveState && liveData && (
          <LiveBoxScore
            state={liveState}
            homeSlug={game.homeSlug}
            awaySlug={game.awaySlug}
            homeTeam={game.homeTeam}
            awayTeam={game.awayTeam}
            playerNames={liveData.playerNames ?? {}}
            goalieIds={liveData.goalieIds ?? []}
          />
        )}

        {detail && !isLive && (
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

            {/* Notes */}
            {detail.notes && (
              <div>
                <SectionHeader>Notes</SectionHeader>
                <p className="text-xs text-muted-foreground whitespace-pre-line">{detail.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>}
    </div>
  )
}

function buildPlayerNameMap(detail: BashGameDetail | null | undefined): Record<number, string> {
  if (!detail) return {}
  const map: Record<number, string> = {}
  for (const p of [...detail.homePlayers, ...detail.awayPlayers, ...detail.homeGoalies, ...detail.awayGoalies]) {
    map[p.id] = p.name
  }
  return map
}

function ThreeStars({ stars, playerNames }: { stars: number[]; playerNames: Record<number, string> }) {
  const labels = ["1st", "2nd", "3rd"]
  return (
    <div className="mt-4 flex items-center justify-center gap-6 py-3">
      {stars.map((playerId, i) => {
        if (!playerId) return null
        const name = playerNames[playerId] ?? `#${playerId}`
        return (
          <div key={i} className="flex items-center gap-1.5 text-[11px]">
            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
            <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider font-medium">{labels[i]}</span>
            <Link href={`/player/${playerSlug(name)}`} className="font-medium hover:text-primary transition-colors">
              {name}
            </Link>
          </div>
        )
      })}
    </div>
  )
}

function LivePeriodSummary({ state, homeSlug, awaySlug, homeTeam, awayTeam }: {
  state: LiveGameState; homeSlug: string; awaySlug: string; homeTeam: string; awayTeam: string
}) {
  const totalHomeShots = state.homeShots.reduce((a, b) => a + b, 0)
  const totalAwayShots = state.awayShots.reduce((a, b) => a + b, 0)

  const periods = Math.max(state.period, 3)
  const awayGoalsByPeriod: number[] = []
  const homeGoalsByPeriod: number[] = []
  for (let p = 1; p <= periods; p++) {
    awayGoalsByPeriod.push(state.goals.filter((g) => g.team === awaySlug && g.period === p).length)
    homeGoalsByPeriod.push(state.goals.filter((g) => g.team === homeSlug && g.period === p).length)
  }

  const periodHeaders = Array.from({ length: periods }, (_, i) => {
    const p = i + 1
    if (p <= 3) return `P${p}`
    if (p === 4) return "OT"
    return "SO"
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
            <th className="text-left font-medium py-1.5 pr-2"></th>
            {periodHeaders.map((h) => (
              <th key={h} className="text-center font-medium py-1.5 px-2 w-10">{h}</th>
            ))}
            <th className="text-center font-medium py-1.5 px-2 w-10">T</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium">Goals</td>
            <td colSpan={periodHeaders.length + 1}></td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-muted-foreground">{awayTeam}</td>
            {awayGoalsByPeriod.map((g, i) => (
              <td key={i} className="text-center tabular-nums font-mono py-1.5 px-2 text-muted-foreground">{g}</td>
            ))}
            <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">
              {awayGoalsByPeriod.reduce((a, b) => a + b, 0)}
            </td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-muted-foreground">{homeTeam}</td>
            {homeGoalsByPeriod.map((g, i) => (
              <td key={i} className="text-center tabular-nums font-mono py-1.5 px-2 text-muted-foreground">{g}</td>
            ))}
            <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">
              {homeGoalsByPeriod.reduce((a, b) => a + b, 0)}
            </td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium pt-3">Shots</td>
            <td colSpan={periodHeaders.length + 1}></td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-muted-foreground">{awayTeam}</td>
            {state.awayShots.slice(0, periods).map((s, i) => (
              <td key={i} className="text-center tabular-nums font-mono py-1.5 px-2 text-muted-foreground">{s}</td>
            ))}
            <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">{totalAwayShots}</td>
          </tr>
          <tr className="border-t border-border/20">
            <td className="py-1.5 pr-2 text-muted-foreground">{homeTeam}</td>
            {state.homeShots.slice(0, periods).map((s, i) => (
              <td key={i} className="text-center tabular-nums font-mono py-1.5 px-2 text-muted-foreground">{s}</td>
            ))}
            <td className="text-center tabular-nums font-mono py-1.5 px-2 font-bold">{totalHomeShots}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function EventLog({ state, homeSlug, awaySlug, homeTeam, awayTeam, playerNames }: {
  state: LiveGameState; homeSlug: string; awaySlug: string; homeTeam: string; awayTeam: string
  playerNames: Record<number, string>
}) {
  const nameById = (id: number | null) => {
    if (id == null) return null
    return playerNames[id] ?? `#${id}`
  }

  const events = [
    ...state.goals.map((g) => ({ type: "goal" as const, period: g.period, clock: g.clock, event: g })),
  ].sort((a, b) => a.period - b.period || parseClockString(b.clock) - parseClockString(a.clock))

  // Compute running score at each goal
  const goalsChrono = state.goals
    .map((g) => ({ ...g }))
    .sort((a, b) => a.period - b.period || parseClockString(b.clock) - parseClockString(a.clock))
  const runningScores = new Map<string, { away: number; home: number }>()
  let runAway = 0, runHome = 0
  for (const g of goalsChrono) {
    if (g.team === awaySlug) runAway++
    else runHome++
    runningScores.set(g.id, { away: runAway, home: runHome })
  }

  // Group by period
  const periods = [...new Set(events.map((e) => e.period))].sort()

  return (
    <div className="space-y-4">
      <SectionHeader>Scoring</SectionHeader>
      {periods.map((period) => {
        const periodEvents = events.filter((e) => e.period === period)
        return (
          <div key={period}>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">
              {periodLabel(period)}
            </div>
            <div className="space-y-0">
              {periodEvents.map((item) => {
                if (item.type === "goal") {
                  const g = item.event as GoalEvent
                  const scorer = nameById(g.scorerId)
                  const a1 = nameById(g.assist1Id)
                  const a2 = nameById(g.assist2Id)
                  const score = runningScores.get(g.id)
                  return (
                    <div key={g.id} className="flex items-center gap-2.5 py-2.5 border-t border-border/30">
                      <TeamLogo slug={g.team} name={g.team === homeSlug ? homeTeam : awayTeam} size={20} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px]">
                          <span className="font-semibold text-foreground">{scorer}</span>
                          {(a1 || a2) ? (
                            <span className="text-muted-foreground">
                              {" "}({a1}{a2 ? `, ${a2}` : ""})
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50"> (unassisted)</span>
                          )}
                        </div>
                        {g.flags.length > 0 && (
                          <span className="text-[9px] text-muted-foreground/60">{g.flags.join(", ")}</span>
                        )}
                      </div>
                      {score && (
                        <span className="text-[11px] font-bold tabular-nums font-mono text-foreground shrink-0 w-10 text-right">
                          {score.away}-{score.home}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/40 tabular-nums font-mono shrink-0 w-10 text-right">{clockToElapsedDisplay(g.clock, g.period)}</span>
                    </div>
                  )
                }
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PenaltyLog({ state, homeSlug, awaySlug: _awaySlug, homeTeam, awayTeam, playerNames }: {
  state: LiveGameState; homeSlug: string; awaySlug: string; homeTeam: string; awayTeam: string
  playerNames: Record<number, string>
}) {
  const nameById = (id: number) => playerNames[id] ?? `#${id}`

  const sorted = [...state.penalties].sort(
    (a, b) => a.period - b.period || parseClockString(b.clock) - parseClockString(a.clock)
  )

  const periods = [...new Set(sorted.map((p) => p.period))].sort()

  return (
    <div className="space-y-4">
      <SectionHeader>Penalties</SectionHeader>
      {periods.map((period) => {
        const periodPenalties = sorted.filter((p) => p.period === period)
        return (
          <div key={period}>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">
              {periodLabel(period)}
            </div>
            <div className="space-y-0">
              {periodPenalties.map((p) => (
                <div key={p.id} className="flex items-center gap-2.5 py-2.5 border-t border-border/30">
                  <TeamLogo slug={p.team} name={p.team === homeSlug ? homeTeam : awayTeam} size={20} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px]">
                      <span className="font-semibold text-foreground">{nameById(p.playerId)}</span>
                      <span className="text-muted-foreground"> — {p.infraction} ({p.minutes} min)</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground/40 tabular-nums font-mono shrink-0 w-10 text-right">{clockToElapsedDisplay(p.clock, p.period)}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LiveBoxScore({ state, homeSlug, awaySlug, homeTeam, awayTeam, playerNames, goalieIds }: {
  state: LiveGameState; homeSlug: string; awaySlug: string; homeTeam: string; awayTeam: string
  playerNames: Record<number, string>; goalieIds: number[]
}) {
  const goalieSet = useMemo(() => new Set(goalieIds), [goalieIds])

  const { homePlayers, awayPlayers, homeGoalies, awayGoalies } = useMemo(() => {
    // Build skater stats from goals/penalties
    const stats = new Map<number, { goals: number; assists: number; points: number; ppg: number; shg: number; eng: number; pen: number; pim: number }>()

    function getOrCreate(id: number) {
      if (!stats.has(id)) stats.set(id, { goals: 0, assists: 0, points: 0, ppg: 0, shg: 0, eng: 0, pen: 0, pim: 0 })
      return stats.get(id)!
    }

    // Init all attending players
    for (const id of [...state.homeAttendance, ...state.awayAttendance]) getOrCreate(id)

    for (const goal of state.goals) {
      if (goal.period >= 5) continue
      const s = getOrCreate(goal.scorerId)
      s.goals++; s.points++
      if (goal.flags.includes("PPG")) s.ppg++
      if (goal.flags.includes("SHG")) s.shg++
      if (goal.flags.includes("ENG")) s.eng++
      if (goal.assist1Id) { const a = getOrCreate(goal.assist1Id); a.assists++; a.points++ }
      if (goal.assist2Id) { const a = getOrCreate(goal.assist2Id); a.assists++; a.points++ }
    }

    for (const pen of state.penalties) {
      const p = getOrCreate(pen.playerId)
      p.pen++; p.pim += pen.minutes
    }

    function buildSkaters(attendance: number[]): PlayerBoxScore[] {
      return attendance
        .filter((id) => !goalieSet.has(id))
        .map((id) => {
          const s = stats.get(id)!
          return { id, name: playerNames[id] ?? `#${id}`, goals: s.goals, assists: s.assists, points: s.points, gwg: 0, ppg: s.ppg, shg: s.shg, eng: s.eng, hatTricks: s.goals >= 3 ? 1 : 0, pen: s.pen, pim: s.pim }
        })
    }

    // Goalie stats
    const homeGoalsAgainst = state.goals.filter((g) => g.team === awaySlug && g.period <= 4).length
    const awayGoalsAgainst = state.goals.filter((g) => g.team === homeSlug && g.period <= 4).length
    const totalHomeShots = state.homeShots.reduce((a, b) => a + b, 0)
    const totalAwayShots = state.awayShots.reduce((a, b) => a + b, 0)

    function buildGoalies(attendance: number[], shotsAgainst: number, goalsAgainst: number): GoalieBoxScore[] {
      return attendance
        .filter((id) => goalieSet.has(id))
        .map((id) => {
          const saves = shotsAgainst - goalsAgainst
          const svPct = shotsAgainst > 0 ? (saves / shotsAgainst).toFixed(3).replace(/^0/, "") : "-"
          return { id, name: playerNames[id] ?? `#${id}`, seconds: 0, goalsAgainst, shotsAgainst, saves, savePercentage: svPct, shutouts: goalsAgainst === 0 ? 1 : 0, goalieAssists: 0, result: null }
        })
    }

    return {
      homePlayers: buildSkaters(state.homeAttendance),
      awayPlayers: buildSkaters(state.awayAttendance),
      homeGoalies: buildGoalies(state.homeAttendance, totalAwayShots, homeGoalsAgainst),
      awayGoalies: buildGoalies(state.awayAttendance, totalHomeShots, awayGoalsAgainst),
    }
  }, [state, homeSlug, awaySlug, playerNames, goalieSet])

  return (
    <div className="flex flex-col gap-8">
      {awayPlayers.length > 0 && (
        <div>
          <SectionHeader>{awayTeam}</SectionHeader>
          <SkaterBoxScore players={awayPlayers} />
        </div>
      )}
      {awayGoalies.length > 0 && <GoalieBoxScoreTable goalies={awayGoalies} />}
      {homePlayers.length > 0 && (
        <div>
          <SectionHeader>{homeTeam}</SectionHeader>
          <SkaterBoxScore players={homePlayers} />
        </div>
      )}
      {homeGoalies.length > 0 && <GoalieBoxScoreTable goalies={homeGoalies} />}
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
    <div className="overflow-x-auto -mx-4 sm:mx-0 mb-3">
      <table className="w-full min-w-[600px] text-[11px] table-fixed">
        <thead>
          <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
            <th className="text-left font-medium py-2 sticky left-0 z-10 bg-background pl-4 sm:pl-2 w-[140px] max-w-[140px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none">Player</th>
            <SortableTh label="G" sortKey="goals" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="w-8 py-2" />
            <SortableTh label="A" sortKey="assists" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="w-8 py-2" />
            <SortableTh label="PTS" sortKey="points" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} bold className="w-8 py-2" />
            <SortableTh label="GWG" sortKey="gwg" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="w-8 py-2" />
            <SortableTh label="PPG" sortKey="ppg" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="w-8 py-2" />
            <SortableTh label="SHG" sortKey="shg" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="w-8 py-2" />
            <SortableTh label="ENG" sortKey="eng" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="w-8 py-2" />
            <SortableTh label="HAT" sortKey="hatTricks" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="w-8 py-2" />
            <SortableTh label="PIM" sortKey="pim" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="w-8 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr
              key={p.name}
              className={cn(
                "group border-t border-border/30 hover:bg-muted/50",
                i % 2 === 0 && "bg-card/20"
              )}
            >
              <td className="py-2 whitespace-nowrap sticky left-0 z-10 bg-background group-hover:bg-muted/50 pl-4 sm:pl-2 w-[140px] max-w-[140px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
                <Link href={`/player/${playerSlug(p.name)}`} className="hover:text-primary transition-colors truncate block pr-4">
                  {p.name}
                </Link>
              </td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.goals}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.assists}</td>
              <td className="text-center tabular-nums py-2 px-3 font-bold">{p.points}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.gwg ?? 0}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.ppg ?? 0}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.shg ?? 0}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.eng ?? 0}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{p.hatTricks ?? 0}</td>
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
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="w-full min-w-[550px] text-[11px] table-fixed">
        <thead>
          <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
            <th className="text-left font-medium py-2 sticky left-0 z-10 bg-background pl-4 sm:pl-2 w-[140px] max-w-[140px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none">Goalie</th>
            <th className="text-center font-medium py-2 w-10">MIN</th>
            <th className="text-center font-medium py-2 w-10">SA</th>
            <th className="text-center font-medium py-2 w-10">SV</th>
            <th className="text-center font-medium py-2 w-10">GA</th>
            <th className="text-center font-medium py-2 w-12 font-bold">SV%</th>
            <th className="text-center font-medium py-2 w-10">SO</th>
            <th className="text-center font-medium py-2 w-10">A</th>
            <th className="text-center font-medium py-2 w-10">DEC</th>
          </tr>
        </thead>
        <tbody>
          {goalies.map((g, i) => (
            <tr
              key={g.name}
              className={cn(
                "group border-t border-border/30 hover:bg-muted/50",
                i % 2 === 0 && "bg-card/20"
              )}
            >
              <td className="py-2 whitespace-nowrap sticky left-0 z-10 bg-background group-hover:bg-muted/50 pl-4 sm:pl-2 w-[140px] max-w-[140px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
                <Link href={`/player/${playerSlug(g.name)}`} className="hover:text-primary transition-colors truncate block pr-4">{g.name}</Link>
              </td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{formatGoalieTime(g.seconds)}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.shotsAgainst}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.saves}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.goalsAgainst}</td>
              <td className="text-center tabular-nums py-2 px-3 font-bold">{g.savePercentage}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.shutouts ?? 0}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.goalieAssists ?? 0}</td>
              <td className="text-center tabular-nums py-2 px-3 text-muted-foreground">{g.result ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
