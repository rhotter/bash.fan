"use client"

import { useMemo, useState } from "react"
import { ArrowUpRight, Lock, RotateCcw } from "lucide-react"
import { IntentLink as Link } from "@/components/intent-link"
import { TeamLogo } from "@/components/team-logo"
import { cn } from "@/lib/utils"
import type {
  BigGameImpact,
  BigGameOutcomeKey,
  PlayoffOddsSnapshot,
  PlayoffSimGame,
} from "@/lib/playoff-odds-types"

const OUTCOME_ORDER: readonly BigGameOutcomeKey[] = [
  "away_reg",
  "away_ot",
  "home_ot",
  "home_reg",
] as const

function formatShortDate(isoDate: string): string {
  const parts = isoDate.split("-")
  if (parts.length !== 3) return isoDate
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const m = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  if (!m || !d || m < 1 || m > 12) return isoDate
  return `${months[m - 1]} ${d}`
}

function outcomeButtonLabel(
  key: BigGameOutcomeKey,
  awayName: string,
  homeName: string
): string {
  const short = (name: string) => {
    const words = name.split(" ")
    return words[words.length - 1] || name
  }
  switch (key) {
    case "away_reg":
      return `${short(awayName)} Reg`
    case "away_ot":
      return `${short(awayName)} OT`
    case "home_ot":
      return `${short(homeName)} OT`
    case "home_reg":
      return `${short(homeName)} Reg`
  }
}

export function BigGamesSection({
  snapshot,
  lockedOutcomes,
  onToggleOutcome,
  onClearLocked,
  allUpcomingGames,
}: {
  snapshot: PlayoffOddsSnapshot
  lockedOutcomes: Record<string, BigGameOutcomeKey>
  onToggleOutcome: (gameId: string, outcome: BigGameOutcomeKey) => void
  onClearLocked: () => void
  allUpcomingGames: PlayoffSimGame[]
}) {
  const [scope, setScope] = useState<"next" | "two_weeks">("next")
  const [teamFilter, setTeamFilter] = useState<string>("all")

  const hasSecondWeekGames = useMemo(
    () => snapshot.bigGames.some((g) => !g.isNextMatchday),
    [snapshot.bigGames]
  )

  const lockedGameList = useMemo(() => {
    const lockedIds = Object.keys(lockedOutcomes)
    if (lockedIds.length === 0) return []
    return lockedIds
      .map((id) => {
        const g = allUpcomingGames.find((u) => u.id === id)
        return g ? { game: g, pick: lockedOutcomes[id] } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  }, [lockedOutcomes, allUpcomingGames])

  const visibleGames = useMemo(() => {
    let list = snapshot.bigGames
    if (scope === "next" && hasSecondWeekGames) {
      const nextOnly = list.filter((g) => g.isNextMatchday)
      if (nextOnly.length > 0) list = nextOnly
    }
    if (teamFilter !== "all") {
      list = list.filter((g) => g.affectedTeams.some((t) => t.slug === teamFilter))
    }
    return list
  }, [snapshot.bigGames, scope, hasSecondWeekGames, teamFilter])

  const teamOptions = useMemo(
    () => [...snapshot.teams].sort((a, b) => a.name.localeCompare(b.name)),
    [snapshot.teams]
  )

  if (snapshot.gamesRemaining === 0 && lockedGameList.length === 0) {
    return (
      <section aria-label="Big games" className="rounded-lg border border-border/60 bg-card/50 p-5 text-center">
        <h2 className="text-sm font-semibold text-foreground">Big games — who to root for</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {snapshot.endedEarly
            ? "Regular season ended early — no remaining games to project."
            : "Regular season complete — no remaining regular-season games."}
        </p>
      </section>
    )
  }

  return (
    <section aria-label="Big games — who to root for" className="space-y-4">
      {/* Header & Filters */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Big games — who to root for
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Ranked by total playoff swing across the league. Pick any game outcome below to test a live What-If
            scenario.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasSecondWeekGames && (
            <div
              role="tablist"
              aria-label="Big games date window"
              className="inline-flex rounded-md border border-border/60 bg-muted/40 p-0.5 text-[11px]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={scope === "next"}
                onClick={() => setScope("next")}
                className={cn(
                  "rounded px-2.5 py-1 font-medium transition-colors cursor-pointer",
                  scope === "next" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {snapshot.nextMatchdayDate ? formatShortDate(snapshot.nextMatchdayDate) : "Next matchday"}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scope === "two_weeks"}
                onClick={() => setScope("two_weeks")}
                className={cn(
                  "rounded px-2.5 py-1 font-medium transition-colors cursor-pointer",
                  scope === "two_weeks"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Next 2 matchdays
              </button>
            </div>
          )}

          <label className="sr-only" htmlFor="big-games-team-filter">
            Filter big games by team
          </label>
          <select
            id="big-games-team-filter"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="rounded-md border border-border/60 bg-card px-2.5 py-1 text-[11px] font-medium text-foreground"
          >
            <option value="all">All teams</option>
            {teamOptions.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Currently Locked What-If Games Strip */}
      {lockedGameList.length > 0 && (
        <div className="rounded-lg border border-primary/40 bg-primary/[0.04] p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Lock className="h-3.5 w-3.5 text-primary" />
              <span>Locked What-If picks ({lockedGameList.length})</span>
            </div>
            <button
              type="button"
              onClick={onClearLocked}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              Reset all picks
            </button>
          </div>
          <div className="space-y-2">
            {lockedGameList.map(({ game, pick }) => (
              <div
                key={game.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-card px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <span className="text-[11px] text-muted-foreground">{formatShortDate(game.date)}</span>
                  <span>
                    {game.awayName} @ {game.homeName}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {OUTCOME_ORDER.map((key) => {
                    const active = pick === key
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onToggleOutcome(game.id, key)}
                        className={cn(
                          "rounded px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {outcomeButtonLabel(key, game.awayName, game.homeName)}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Big Game Cards */}
      {visibleGames.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-card/50 p-5 text-center text-xs text-muted-foreground">
          No upcoming games in this window affect the selected team by 0.3% or more.
        </div>
      ) : (
        <div className="space-y-3">
          {visibleGames.map((game) => (
            <BigGameCard
              key={game.gameId}
              game={game}
              allTeamsQualify={snapshot.format.allTeamsQualify}
              onPickOutcome={(outcome) => onToggleOutcome(game.gameId, outcome)}
            />
          ))}
        </div>
      )}

      {/* Footnote */}
      <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
        Outcomes marked <span className="font-semibold text-foreground">*</span> occurred in fewer than 100 simulated
        seasons. Highlighted cells mark the best single-game outcome for each team. Swings across separate games on the
        same day are not strictly additive.
      </p>
    </section>
  )
}

function BigGameCard({
  game,
  allTeamsQualify,
  onPickOutcome,
}: {
  game: BigGameImpact
  allTeamsQualify: boolean
  onPickOutcome: (outcome: BigGameOutcomeKey) => void
}) {
  const showSeedFocus = allTeamsQualify || game.totalPlayoffSwing < 0.3

  return (
    <article className="overflow-hidden rounded-lg border border-border/60 bg-card">
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-muted/30 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <TeamLogo slug={game.awaySlug} name={game.awayName} size={20} />
            <span>{game.awayName}</span>
            <span className="text-muted-foreground font-normal tabular-nums text-[11px]">
              ({game.awayWinProb.toFixed(0)}%)
            </span>
            <span className="text-muted-foreground font-normal">@</span>
            <TeamLogo slug={game.homeSlug} name={game.homeName} size={20} />
            <span>{game.homeName}</span>
            <span className="text-muted-foreground font-normal tabular-nums text-[11px]">
              ({game.homeWinProb.toFixed(0)}%)
            </span>
          </div>

          <span className="text-[11px] text-muted-foreground">
            {formatShortDate(game.date)} · {game.time}
          </span>

          <Link
            href={`/game/${game.gameId}`}
            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Matchup
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">
            {showSeedFocus
              ? `${game.totalSeedSwing.toFixed(2)} seed swing`
              : `${game.totalPlayoffSwing.toFixed(1)}% total swing`}
          </span>

          {/* Interactive What-If quick picker */}
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Simulate outcome for ${game.awayName} at ${game.homeName}`}>
            {OUTCOME_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onPickOutcome(key)}
                title={`Lock ${outcomeButtonLabel(key, game.awayName, game.homeName)} in What-If mode`}
                className="rounded border border-border/70 bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-primary/60 hover:text-foreground transition-colors cursor-pointer"
              >
                {outcomeButtonLabel(key, game.awayName, game.homeName)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4-Outcome Conditional Table */}
      <div
        tabIndex={0}
        role="region"
        aria-label={`Conditional playoff impact for ${game.awayName} at ${game.homeName}`}
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring"
      >
        <table className="w-full min-w-[540px] text-[11px] border-collapse">
          <thead>
            <tr className="border-b border-border/40 text-[10px] text-muted-foreground bg-muted/10">
              <th scope="col" className="px-3.5 py-2 text-left font-medium w-[170px]">
                Team
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium border-r border-border/40">
                Current
              </th>
              <th scope="col" className="px-2.5 py-2 text-right font-medium">
                <div>{game.awayName} Reg</div>
                <div className="text-[9px] font-normal text-muted-foreground/75">3–0 pts</div>
              </th>
              <th scope="col" className="px-2.5 py-2 text-right font-medium">
                <div>{game.awayName} OT/SO</div>
                <div className="text-[9px] font-normal text-muted-foreground/75">2–1 pts</div>
              </th>
              <th scope="col" className="px-2.5 py-2 text-right font-medium">
                <div>{game.homeName} OT/SO</div>
                <div className="text-[9px] font-normal text-muted-foreground/75">1–2 pts</div>
              </th>
              <th scope="col" className="px-3.5 py-2 text-right font-medium">
                <div>{game.homeName} Reg</div>
                <div className="text-[9px] font-normal text-muted-foreground/75">0–3 pts</div>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-border/30">
            {game.affectedTeams.map((team) => {
              const useSeedRow = allTeamsQualify || team.playoffSwing < 0.3
              return (
                <tr key={team.slug} className="hover:bg-muted/25">
                  <th scope="row" className="px-3.5 py-2 text-left font-medium text-foreground">
                    <div className="flex items-center gap-2 min-w-0">
                      <TeamLogo slug={team.slug} name={team.name} size={18} className="shrink-0" />
                      <span className="truncate">{team.name}</span>
                      {!team.isParticipant && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground">
                          Watching
                        </span>
                      )}
                    </div>
                  </th>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground border-r border-border/40">
                    {useSeedRow ? (
                      <span>#{team.currentAvgSeed.toFixed(1)}</span>
                    ) : (
                      <span>{team.currentPlayoffPct.toFixed(1)}%</span>
                    )}
                  </td>

                  {OUTCOME_ORDER.map((key, idx) => {
                    const cell = team.outcomes[key]
                    const isBest = team.bestOutcome === key
                    const delta = useSeedRow ? cell.seedDelta : cell.playoffDelta
                    const isGoodDelta = useSeedRow ? delta < -0.04 : delta > 0.05
                    const isBadDelta = useSeedRow ? delta > 0.04 : delta < -0.05

                    return (
                      <td
                        key={key}
                        className={cn(
                          "py-2 text-right tabular-nums",
                          idx === 3 ? "px-3.5" : "px-2.5",
                          isBest && "bg-emerald-500/10 ring-1 ring-inset ring-emerald-600/20"
                        )}
                      >
                        <div className="font-semibold text-foreground">
                          {cell.lowSample && <span className="text-muted-foreground mr-0.5">*</span>}
                          {useSeedRow ? `#${cell.avgSeed.toFixed(1)}` : `${cell.playoffPct.toFixed(1)}%`}
                        </div>
                        <div
                          className={cn(
                            "text-[10px]",
                            isGoodDelta
                              ? "text-emerald-700"
                              : isBadDelta
                                ? "text-rose-700"
                                : "text-muted-foreground/70"
                          )}
                        >
                          {useSeedRow
                            ? Math.abs(cell.seedDelta) < 0.05
                              ? "0.0"
                              : `${cell.seedDelta > 0 ? "+" : ""}${cell.seedDelta.toFixed(1)}`
                            : Math.abs(cell.playoffDelta) < 0.05
                              ? "0.0%"
                              : `${cell.playoffDelta > 0 ? "+" : ""}${cell.playoffDelta.toFixed(1)}%`}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </article>
  )
}
