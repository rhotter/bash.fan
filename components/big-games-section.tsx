"use client"

import { useMemo, useState } from "react"
import { ChevronRight, Info, Lock, RotateCcw } from "lucide-react"
import { IntentLink as Link } from "@/components/intent-link"
import { TeamLogo } from "@/components/team-logo"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type {
  AttendanceTier,
  BigGameAffectedTeam,
  BigGameImpact,
  BigGameOutcomeKey,
  GameAttendanceOverride,
  PlayoffOddsSnapshot,
  PlayoffSimGame,
  TeamOddsRow,
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

/**
 * Shared 4-outcome What-If picker: "What-If Outcome:" label + two equal-width
 * `[Reg | OT]` segmented controls (Away on left, Home on right) so every
 * card has uniform button widths on both mobile and desktop.
 */
function OutcomeQuickPicker({
  awayName,
  homeName,
  selectedOutcome,
  onPick,
  showLabel = false,
}: {
  awayName: string
  homeName: string
  selectedOutcome?: BigGameOutcomeKey
  onPick: (outcome: BigGameOutcomeKey) => void
  showLabel?: boolean
}) {
  const short = (name: string) => {
    const words = name.split(" ")
    return words[words.length - 1] || name
  }
  const hasSelection = selectedOutcome !== undefined

  return (
    <div
      className={cn(
        "w-full sm:w-auto",
        showLabel && "flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-2.5"
      )}
    >
      {showLabel && (
        <span className="hidden shrink-0 text-[10px] font-medium text-muted-foreground sm:flex sm:h-[22px] sm:items-center">
          What-If Outcome:
        </span>
      )}
      <div
        className="grid w-full grid-cols-2 gap-2 sm:w-[264px] sm:shrink-0"
        role="group"
        aria-label={`Simulate outcome for ${awayName} at ${homeName}`}
      >
        {(
          [
            { teamName: awayName, keys: ["away_reg", "away_ot"] as const },
            { teamName: homeName, keys: ["home_ot", "home_reg"] as const },
          ] as const
        ).map((group) => (
          <div key={group.teamName} className="min-w-0 space-y-1">
            <div className="truncate px-0.5 text-[10px] font-medium text-muted-foreground">
              {short(group.teamName)}
            </div>
            <div className="grid grid-cols-2 overflow-hidden rounded border border-border/70 bg-background divide-x divide-border/70">
              {group.keys.map((key) => {
                const isReg = key === "away_reg" || key === "home_reg"
                const active = selectedOutcome === key
                const fullLabel = outcomeButtonLabel(key, awayName, homeName)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onPick(key)}
                    title={`Lock ${fullLabel} in What-If mode`}
                    aria-label={`Lock ${fullLabel} in What-If mode`}
                    aria-pressed={hasSelection ? active : undefined}
                    className={cn(
                      "py-1 text-center text-[10px] font-medium transition-colors cursor-pointer sm:py-0.5",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    {isReg ? "Reg" : "OT"}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function BigGamesSection({
  snapshot,
  lockedOutcomes,
  onToggleOutcome,
  onClearLocked,
  allUpcomingGames,
  lockedTeamSlug = null,
  baselineTeam,
  whatIfTeam,
  showAttendanceWhatIf = false,
  attendanceOverrides,
  onChangeAttendanceOverride,
  isWhatIfActive = false,
}: {
  snapshot: PlayoffOddsSnapshot
  lockedOutcomes: Record<string, BigGameOutcomeKey>
  onToggleOutcome: (gameId: string, outcome: BigGameOutcomeKey) => void
  onClearLocked: () => void
  allUpcomingGames: PlayoffSimGame[]
  /** When set (team view), ranks games by impact on this team and shows only its row */
  lockedTeamSlug?: string | null
  /** Baseline (pre-What-If) row for the focused team, used in the Locked What-If summary */
  baselineTeam?: TeamOddsRow
  /** Current What-If row for the focused team, used in the Locked What-If summary */
  whatIfTeam?: TeamOddsRow
  showAttendanceWhatIf?: boolean
  attendanceOverrides?: Record<string, GameAttendanceOverride>
  onChangeAttendanceOverride?: (gameId: string, side: "away" | "home", tier: AttendanceTier | null) => void
  isWhatIfActive?: boolean
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
            This week&apos;s games &amp; What-If Scenarios
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {focusedTeamName ? (
              snapshot.format.allTeamsQualify ? (
                `Ranked by seed swing for ${focusedTeamName} — includes their own games and scoreboard-watching matchups that move their projected seed.`
              ) : (
                `Ranked by playoff swing for ${focusedTeamName} — includes their own games and scoreboard-watching matchups that move their odds.`
              )
            ) : (
              <>
                Ranked by largest {snapshot.format.allTeamsQualify ? "seeding" : "playoff picture"} impact. Lock any
                outcome to test a What-If scenario.{" "}
                <span className="rounded-xs bg-emerald-500/10 px-1 py-0.5 font-medium text-foreground ring-1 ring-inset ring-emerald-600/20">
                  Highlighted
                </span>{" "}
                = best outcome for selected team.
              </>
            )}
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
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Lock className="h-3.5 w-3.5 text-primary" />
                <span>Locked What-If picks ({lockedGameList.length})</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                <span className="sm:hidden">All odds, charts &amp; tables updated.</span>
                <span className="hidden sm:inline">
                  All playoff odds, charts, and tables on this page reflect your What-If picks.
                </span>
              </p>
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
          {baselineTeam && whatIfTeam && (
            <div className="rounded-md border border-border/50 bg-card/80 px-3 py-2 text-[11px] tabular-nums space-y-1.5">
              {(
                [
                  { label: "Current:", row: baselineTeam, highlight: false },
                  { label: "What-if:", row: whatIfTeam, highlight: true },
                ] as const
              ).map(({ label, row, highlight }) => (
                <div
                  key={label}
                  className="grid grid-cols-[52px_1fr_auto] sm:grid-cols-[56px_175px_140px] items-baseline gap-x-2.5 sm:gap-x-5 gap-y-0.5"
                >
                  <span
                    className={cn(
                      "font-semibold",
                      highlight ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {label}
                  </span>
                  <div className="min-w-0">
                    <div className={cn("font-semibold", highlight ? "text-foreground" : "text-foreground/90")}>
                      {snapshot.format.allTeamsQualify
                        ? `${row.seedPcts[0]?.toFixed(1) ?? "0.0"}% #1 seed`
                        : `${row.playoffPct.toFixed(1)}% playoffs`}
                    </div>
                    {!snapshot.format.allTeamsQualify && snapshot.format.hasPlayIn && (
                      <div className="text-[10px] text-muted-foreground">
                        {row.directByePct.toFixed(1)}% top 3, {row.playInPct.toFixed(1)}% play-in
                      </div>
                    )}
                  </div>
                  <div className="text-right sm:text-left">
                    <div className={cn("font-semibold", highlight ? "text-foreground" : "text-foreground/90")}>
                      #{row.avgSeed.toFixed(1)} proj seed
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      #{row.bestSeed}–#{row.worstSeed} seed range
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                <OutcomeQuickPicker
                  awayName={game.awayName}
                  homeName={game.homeName}
                  selectedOutcome={pick}
                  onPick={(key) => onToggleOutcome(game.id, key)}
                />
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
              isWhatIf={isWhatIfActive || lockedGameList.length > 0}
              hasLockedPicks={lockedGameList.length > 0}
              isLocked={Boolean(lockedOutcomes[game.gameId])}
              showAttendanceWhatIf={showAttendanceWhatIf}
              attendanceOverride={attendanceOverrides?.[game.gameId]}
              onChangeAttendanceOverride={onChangeAttendanceOverride}
              onPickOutcome={(outcome) => onToggleOutcome(game.gameId, outcome)}
            />
          ))}
        </div>
      )}

      {/* Footnote */}
      <p className="text-[10px] leading-relaxed text-muted-foreground/80">
        <span className="rounded-xs bg-emerald-500/10 px-1 py-0.5 font-medium text-foreground ring-1 ring-inset ring-emerald-600/20">
          Highlighted
        </span>{" "}
        = best outcome · Swings compare reg wins (not additive).
      </p>
    </section>
  )
}

const ATTENDANCE_TIERS: ReadonlyArray<{ value: AttendanceTier; label: string }> = [
  { value: "low", label: "Low" },
  { value: "avg", label: "Avg" },
  { value: "high", label: "High" },
]

function BigGameCard({
  game,
  allTeamsQualify,
  focusedTeamSlug,
  isWhatIf,
  hasLockedPicks = false,
  isLocked,
  showAttendanceWhatIf,
  attendanceOverride,
  onChangeAttendanceOverride,
  onPickOutcome,
}: {
  game: BigGameImpact
  allTeamsQualify: boolean
  focusedTeamSlug: string | null
  isWhatIf: boolean
  hasLockedPicks?: boolean
  isLocked: boolean
  showAttendanceWhatIf: boolean
  attendanceOverride?: GameAttendanceOverride
  onChangeAttendanceOverride?: (gameId: string, side: "away" | "home", tier: AttendanceTier | null) => void
  onPickOutcome: (outcome: BigGameOutcomeKey) => void
}) {
  const [showWatching, setShowWatching] = useState(false)
  const [swingOpen, setSwingOpen] = useState(false)
  const [benchOpen, setBenchOpen] = useState(false)
  const hasBenchOverride = Boolean(attendanceOverride?.away || attendanceOverride?.home)
  const isBenchExpanded = benchOpen && !isLocked

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
  const baselineQualifier = hasLockedPicks
    ? "before this game is played (with your locked What-If picks)"
    : isWhatIf
      ? "before this game is played (with your active What-If scenario)"
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
                    className={cn(
                      "shrink-0 cursor-help rounded bg-muted px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground",
                      !focusedTeamSlug && "hidden sm:inline-flex",
                    )}
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

  const renderAttendanceToggle = (visibilityClass: string) =>
    showAttendanceWhatIf ? (
      <button
        type="button"
        disabled={isLocked}
        aria-expanded={isBenchExpanded}
        onClick={() => setBenchOpen((prev) => !prev)}
        title={
          isLocked
            ? "What-If Attendance disabled while game outcome is locked"
            : "Test projected Win% under Low / Avg / High attendance"
        }
        className={cn(
          "shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap transition-colors sm:h-[24px] sm:py-1",
          visibilityClass,
          isLocked
            ? "cursor-not-allowed border-border/40 bg-muted/40 text-muted-foreground/60 opacity-50"
            : hasBenchOverride
              ? "cursor-pointer border-primary/50 bg-primary/10 text-foreground"
              : "cursor-pointer border-border/60 bg-background text-muted-foreground hover:text-foreground"
        )}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 transition-transform duration-150",
            isBenchExpanded && "rotate-90"
          )}
          aria-hidden="true"
        />
        <span>What-If Attendance</span>
        {hasBenchOverride && !isLocked && (
          <span className="text-[9px] text-muted-foreground">
            (
            {[
              attendanceOverride?.away ? `A:${attendanceOverride.away}` : null,
              attendanceOverride?.home ? `H:${attendanceOverride.home}` : null,
            ]
              .filter(Boolean)
              .join(" ")}
            )
          </span>
        )}
      </button>
    ) : null

  return (
    <article className="overflow-hidden rounded-lg border border-border/60 bg-card">
      {/* Card Header */}
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-b border-border/50 bg-muted/30 px-3.5 py-2.5">
        <div className="flex w-full flex-col items-start gap-1.5 min-w-0 sm:w-auto">
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

          <div className="flex w-full items-center justify-between gap-2 sm:w-auto">
            <Tooltip open={swingOpen} onOpenChange={setSwingOpen} delayDuration={150}>
              <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setSwingOpen((v) => !v)}
                aria-expanded={swingOpen}
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
              </button>
            </TooltipTrigger>
            <TooltipContent
              align="start"
              collisionPadding={12}
              sideOffset={6}
              className="max-w-[290px] text-left text-[11px] leading-snug"
            >
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
            {renderAttendanceToggle("inline-flex sm:hidden")}
          </div>
        </div>

        {/* Interactive What-If quick picker */}
        <div className="flex flex-col items-end gap-1.5 w-full sm:w-auto sm:flex-row sm:items-end sm:gap-2.5">
          <OutcomeQuickPicker
            awayName={game.awayName}
            homeName={game.homeName}
            onPick={onPickOutcome}
            showLabel
          />
          {renderAttendanceToggle("hidden sm:inline-flex")}
        </div>
      </div>

      {/* Expandable Per-Game What-If Attendance Picker */}
      {showAttendanceWhatIf && isBenchExpanded && (
        <div className="flex items-center justify-end border-b border-border/40 bg-muted/20 px-3.5 py-2 text-[10px]">
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex sm:items-center sm:gap-4">
            {(
              [
                { side: "away" as const, name: game.awayName, value: attendanceOverride?.away },
                { side: "home" as const, name: game.homeName, value: attendanceOverride?.home },
              ] as const
            ).map(({ side, name, value }) => (
              <div key={side} className="flex items-center gap-1.5 min-w-0">
                <span className="hidden sm:inline truncate font-medium text-foreground">{name}:</span>
                <div
                  role="group"
                  aria-label={`${name} bench turnout`}
                  className="grid w-full grid-cols-3 overflow-hidden rounded border border-border/70 bg-background divide-x divide-border/70 sm:inline-flex sm:w-auto sm:shrink-0"
                >
                  {ATTENDANCE_TIERS.map((tier) => {
                    const active = value === tier.value
                    return (
                      <button
                        key={tier.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          onChangeAttendanceOverride?.(
                            game.gameId,
                            side,
                            active ? null : tier.value
                          )
                        }
                        className={cn(
                          "px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer sm:py-0.5",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        )}
                      >
                        {tier.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
        <table className="w-full min-w-[560px] table-fixed text-[11px] border-collapse">
          <thead>
            <tr className="border-b border-border/40 text-[10px] text-muted-foreground bg-muted/10">
              <th scope="col" className="w-[155px] sm:w-[200px] px-3.5 py-2 text-left font-medium">
                Team
              </th>
              <th scope="col" className="w-[64px] sm:w-[76px] px-2 py-2 text-right font-medium border-r border-border/40">
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
