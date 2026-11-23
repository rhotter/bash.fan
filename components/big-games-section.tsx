"use client"

import { useMemo, useState } from "react"
import { ChevronRight, Info, Lock, RotateCcw } from "lucide-react"
import { IntentLink as Link } from "@/components/intent-link"
import { TeamLogo } from "@/components/team-logo"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type {
  BigGameAffectedTeam,
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
  lockedTeamSlug = null,
}: {
  snapshot: PlayoffOddsSnapshot
  lockedOutcomes: Record<string, BigGameOutcomeKey>
  onToggleOutcome: (gameId: string, outcome: BigGameOutcomeKey) => void
  onClearLocked: () => void
  allUpcomingGames: PlayoffSimGame[]
  /** When set (team view), ranks games by impact on this team and shows only its row */
  lockedTeamSlug?: string | null
}) {
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

  const teamOptions = useMemo(
    () => [...snapshot.teams].sort((a, b) => a.name.localeCompare(b.name)),
    [snapshot.teams]
  )

  const effectiveTeamFilter =
    lockedTeamSlug && teamOptions.some((t) => t.slug === lockedTeamSlug) ? lockedTeamSlug : "all"

  const focusedTeamName = useMemo(() => {
    if (effectiveTeamFilter === "all") return null
    return teamOptions.find((t) => t.slug === effectiveTeamFilter)?.name ?? null
  }, [effectiveTeamFilter, teamOptions])

  const visibleGames = useMemo(() => {
    // Only the upcoming matchday ("this week")
    const nextOnly = snapshot.bigGames.filter((g) => g.isNextMatchday)
    let list = nextOnly.length > 0 ? nextOnly : snapshot.bigGames
    if (effectiveTeamFilter !== "all") {
      list = list
        .filter((g) => g.affectedTeams.some((t) => t.slug === effectiveTeamFilter))
        .sort((a, b) => {
          const aTeam = a.affectedTeams.find((t) => t.slug === effectiveTeamFilter)!
          const bTeam = b.affectedTeams.find((t) => t.slug === effectiveTeamFilter)!
          if (
            !snapshot.format.allTeamsQualify &&
            Math.abs(bTeam.playoffSwing - aTeam.playoffSwing) > 0.05
          ) {
            return bTeam.playoffSwing - aTeam.playoffSwing
          }
          if (Math.abs(bTeam.seedSwing - aTeam.seedSwing) > 0.01) {
            return bTeam.seedSwing - aTeam.seedSwing
          }
          if (aTeam.isParticipant !== bTeam.isParticipant) {
            return aTeam.isParticipant ? -1 : 1
          }
          return a.date.localeCompare(b.date) || a.gameId.localeCompare(b.gameId)
        })
    }
    return list
  }, [snapshot.bigGames, snapshot.format.allTeamsQualify, effectiveTeamFilter])

  if (snapshot.gamesRemaining === 0 && lockedGameList.length === 0) {
    return (
      <section aria-label="This week's games" className="rounded-lg border border-border/60 bg-card/50 p-5 text-center">
        <h2 className="text-sm font-semibold text-foreground">This week&apos;s games</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {snapshot.endedEarly
            ? "Regular season ended early — no remaining games to project."
            : "Regular season complete — no remaining regular-season games."}
        </p>
      </section>
    )
  }

  return (
    <section aria-label="This week's games" className="space-y-4">
      {/* Header & Filters */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            This week&apos;s games
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {focusedTeamName
              ? snapshot.format.allTeamsQualify
                ? `Ranked by seed swing for ${focusedTeamName} — includes their own games and scoreboard-watching matchups that move their projected seed.`
                : `Ranked by playoff swing for ${focusedTeamName} — includes their own games and scoreboard-watching matchups that move their odds.`
              : snapshot.format.allTeamsQualify
                ? "Ranked by league-wide seed swing. Pick a team above to see the games that move their seed, or lock any outcome to test a What-If."
                : "Ranked by league-wide probability swing. Pick a team above to see the games that move their odds, or lock any outcome to test a What-If."}
          </p>
        </div>

        {snapshot.nextMatchdayDate && (
          <span className="rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-foreground">
            {formatShortDate(snapshot.nextMatchdayDate)}
          </span>
        )}
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
          <p>
            {snapshot.gamesRemaining === 0
              ? "All remaining regular-season games are locked in your What-If scenario."
              : snapshot.format.allTeamsQualify
                ? "No games this week measurably move this team's projected seed."
                : "No games this week measurably move this team's playoff odds."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleGames.map((game) => (
            <BigGameCard
              key={game.gameId}
              game={game}
              allTeamsQualify={snapshot.format.allTeamsQualify}
              focusedTeamSlug={effectiveTeamFilter === "all" ? null : effectiveTeamFilter}
              isWhatIf={lockedGameList.length > 0}
              onPickOutcome={(outcome) => onToggleOutcome(game.gameId, outcome)}
            />
          ))}
        </div>
      )}

      {/* Footnote */}
      <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
        Outcomes marked <span className="font-semibold text-foreground">*</span> occurred in fewer than 500 simulated
        seasons (wider error).{" "}
        <span className="rounded-xs bg-emerald-500/10 px-1 py-0.5 font-medium text-foreground ring-1 ring-inset ring-emerald-600/20">
          Highlighted cells
        </span>{" "}
        mark the best single-game outcome for each team. Swings compare the two regulation results; other teams are
        listed only when the effect is larger than simulation noise. Swings across separate games on the same day are
        not strictly additive.
      </p>
    </section>
  )
}

function BigGameCard({
  game,
  allTeamsQualify,
  focusedTeamSlug,
  isWhatIf,
  onPickOutcome,
}: {
  game: BigGameImpact
  allTeamsQualify: boolean
  focusedTeamSlug: string | null
  isWhatIf: boolean
  onPickOutcome: (outcome: BigGameOutcomeKey) => void
}) {
  const [showWatching, setShowWatching] = useState(false)

  const displayedTeams = focusedTeamSlug
    ? game.affectedTeams.filter((t) => t.slug === focusedTeamSlug)
    : game.affectedTeams
  const focusedTeam = focusedTeamSlug ? displayedTeams[0] ?? null : null
  const participantTeams = focusedTeamSlug
    ? displayedTeams
    : displayedTeams.filter((t) => t.isParticipant)
  const watchingTeams = focusedTeamSlug
    ? []
    : displayedTeams.filter((t) => !t.isParticipant)
  const visibleRows = showWatching ? [...participantTeams, ...watchingTeams] : participantTeams

  const isSeedRow = (team: BigGameAffectedTeam) =>
    allTeamsQualify || (team.optimizeSeed ?? team.playoffSwing < 0.5)

  const showSeedFocus = focusedTeam
    ? isSeedRow(focusedTeam)
    : allTeamsQualify || game.totalPlayoffSwing < 0.5

  const allRowsUseSeed =
    allTeamsQualify || (visibleRows.length > 0 && visibleRows.every(isSeedRow))
  const someRowsUseSeed =
    !allRowsUseSeed && visibleRows.some(isSeedRow)
  const baselineQualifier = isWhatIf
    ? "before this game is played (with your locked What-If picks)"
    : "before this game is played"
  const currentHeaderTooltip = allRowsUseSeed
    ? `Each team's projected average seed ${baselineQualifier}. The four columns to the right show the new seed and +/- change from this baseline.`
    : someRowsUseSeed
      ? `Each team's current chance to make the playoffs ${baselineQualifier} (or projected average seed once playoff odds are settled). The +/- values to the right compare against this baseline.`
      : `Each team's current chance to make the playoffs ${baselineQualifier}. The four columns to the right show the new odds and +/- change from this baseline.`

  const renderTeamRow = (team: BigGameAffectedTeam) => {
    const useSeedRow = isSeedRow(team)
    return (
      <tr key={team.slug} className="hover:bg-muted/25">
        <th scope="row" className="px-3.5 py-2 text-left font-medium text-foreground">
          <div className="flex items-center gap-2 min-w-0">
            <TeamLogo slug={team.slug} name={team.name} size={18} className="shrink-0" />
            <span className="truncate">{team.name}</span>
            {!team.isParticipant && (
              <Tooltip delayDuration={150}>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="shrink-0 cursor-help rounded bg-muted px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground"
                  >
                    Watching
                  </span>
                </TooltipTrigger>
                <TooltipContent sideOffset={4} className="max-w-[240px] text-[11px] leading-snug">
                  Scoreboard-watching game — not playing in this matchup, but the outcome moves{" "}
                  {allTeamsQualify ? "projected seed" : "playoff odds"} for {team.name}.
                </TooltipContent>
              </Tooltip>
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
  }

  return (
    <article className="overflow-hidden rounded-lg border border-border/60 bg-card">
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-muted/30 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
          <Link
            href={`/game/${game.gameId}`}
            title={`View ${game.awayName} @ ${game.homeName} matchup`}
            className="group inline-flex flex-wrap items-center gap-1.5 text-xs font-semibold text-foreground"
          >
            <TeamLogo slug={game.awaySlug} name={game.awayName} size={20} />
            <span className="group-hover:underline decoration-muted-foreground/60 underline-offset-2">
              {game.awayName}
            </span>
            <span className="text-muted-foreground font-normal tabular-nums text-[11px]">
              ({game.awayWinProb.toFixed(0)}%)
            </span>
            <span className="text-muted-foreground font-normal">@</span>
            <TeamLogo slug={game.homeSlug} name={game.homeName} size={20} />
            <span className="group-hover:underline decoration-muted-foreground/60 underline-offset-2">
              {game.homeName}
            </span>
            <span className="text-muted-foreground font-normal tabular-nums text-[11px]">
              ({game.homeWinProb.toFixed(0)}%)
            </span>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Tooltip delayDuration={150}>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground cursor-help focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span>
                  {focusedTeam
                    ? showSeedFocus
                      ? `${focusedTeam.seedSwing.toFixed(2)} seed swing for ${focusedTeam.name}`
                      : `${focusedTeam.playoffSwing.toFixed(1)}% swing for ${focusedTeam.name}`
                    : showSeedFocus
                      ? `League seed impact: ${game.totalSeedSwing.toFixed(2)}`
                      : `League Playoff impact: ${game.totalPlayoffSwing.toFixed(1)}pp`}
                </span>
                <Info className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              </span>
            </TooltipTrigger>
            <TooltipContent align="end" sideOffset={6} className="max-w-[290px] text-left text-[11px] leading-snug">
              {focusedTeam ? (
                showSeedFocus ? (
                  <div className="space-y-1">
                    <div className="font-semibold">Projected seed swing for {focusedTeam.name}</div>
                    <p className="text-background/90">
                      How far {focusedTeam.name}&apos;s projected average seed moves between an away regulation win
                      and a home regulation win in this game.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="font-semibold">Playoff-odds swing for {focusedTeam.name}</div>
                    <p className="text-background/90">
                      How far {focusedTeam.name}&apos;s playoff odds move between an away regulation win and a home
                      regulation win in this game.
                    </p>
                  </div>
                )
              ) : showSeedFocus ? (
                <div className="space-y-1">
                  <div className="font-semibold">League-wide seed swing</div>
                  <p className="text-background/90">
                    How much each affected team&apos;s projected seed moves between the two regulation results, added
                    up across the league and used to rank game importance. Teams whose change is within simulation
                    noise are left out.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="font-semibold">League-wide probability swing</div>
                  <p className="text-background/90">
                    How much each affected team&apos;s playoff odds move between an away and a home regulation win,
                    added up across the league and used to rank game importance. Teams whose change is within
                    simulation noise are left out.
                  </p>
                  <p className="text-background/75">
                    Because several teams&apos; odds can shift on one result, late-season games can exceed 100pp.
                  </p>
                </div>
              )}
            </TooltipContent>
          </Tooltip>

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
        aria-label={
          focusedTeam
            ? `Conditional playoff impact for ${focusedTeam.name} in ${game.awayName} at ${game.homeName}`
            : `Conditional playoff impact for ${game.awayName} at ${game.homeName}`
        }
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring"
      >
        <table className="w-full min-w-[540px] text-[11px] border-collapse">
          <thead>
            <tr className="border-b border-border/40 text-[10px] text-muted-foreground bg-muted/10">
              <th scope="col" className="px-3.5 py-2 text-left font-medium w-[170px]">
                Team
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium border-r border-border/40">
                <Tooltip delayDuration={150}>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2"
                    >
                      Current
                    </span>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={6} className="max-w-[260px] text-left text-[11px] font-normal leading-snug">
                    {currentHeaderTooltip}
                  </TooltipContent>
                </Tooltip>
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
            {participantTeams.map(renderTeamRow)}

            {watchingTeams.length > 0 && (
              <tr className="bg-muted/15">
                <td colSpan={6} className="p-0">
                  <button
                    type="button"
                    aria-expanded={showWatching}
                    onClick={() => setShowWatching((prev) => !prev)}
                    className="flex w-full items-center gap-1.5 px-3.5 py-2 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors cursor-pointer"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-transform duration-150",
                        showWatching && "rotate-90"
                      )}
                      aria-hidden="true"
                    />
                    <span>Impact to other teams ({watchingTeams.length})</span>
                    <span className="hidden sm:inline truncate font-normal text-muted-foreground/75">
                      · {watchingTeams.map((t) => t.name).join(", ")}
                    </span>
                  </button>
                </td>
              </tr>
            )}

            {showWatching && watchingTeams.map(renderTeamRow)}
          </tbody>
        </table>
      </div>
    </article>
  )
}
