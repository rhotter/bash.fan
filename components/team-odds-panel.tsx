"use client"

import { useMemo, useState } from "react"
import { Info } from "lucide-react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts"
import { IntentLink as Link } from "@/components/intent-link"
import { TeamLogo } from "@/components/team-logo"
import { Switch } from "@/components/ui/switch"
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getTeamChartColor } from "@/lib/chart-colors"
import { cn } from "@/lib/utils"
import type {
  PlayoffOddsSnapshot,
  TeamOddsRow,
} from "@/lib/playoff-odds-types"

type ChartMetric = "playoffPct" | "avgSeed" | "ptsAbove500"

type MetricKey = "playoffPct" | "avgSeed" | "ptsAbove500"

const METRIC_LABELS: Record<MetricKey, string> = {
  playoffPct: "Playoff %",
  avgSeed: "Avg seed",
  ptsAbove500: "vs .500 pace",
}

/** Card label with an info icon that explains the card on hover/focus/tap. */
function InfoLabel({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <UiTooltip open={open} onOpenChange={setOpen} delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex cursor-help items-center gap-1 rounded-sm text-[11px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {label}
          <Info className="h-3 w-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        align="start"
        collisionPadding={12}
        sideOffset={6}
        className="max-w-[280px] text-left text-[11px] leading-snug"
      >
        {children}
      </TooltipContent>
    </UiTooltip>
  )
}

export function TeamOddsPanel({
  team,
  snapshot,
  isWhatIfActive,
}: {
  team: TeamOddsRow
  snapshot: PlayoffOddsSnapshot
  isWhatIfActive: boolean
}) {
  const [chartMetric, setChartMetric] = useState<ChartMetric>(
    snapshot.format.allTeamsQualify ? "avgSeed" : "playoffPct"
  )
  const [withOtl, setWithOtl] = useState(true)
  const effectiveChartMetric: ChartMetric =
    snapshot.format.allTeamsQualify && chartMetric === "playoffPct" ? "avgSeed" : chartMetric
  const availableMetrics: ChartMetric[] = snapshot.format.allTeamsQualify
    ? ["avgSeed", "ptsAbove500"]
    : ["playoffPct", "avgSeed", "ptsAbove500"]

  const chartData = useMemo(() => {
    const base = snapshot.timeline.map((pt) => {
      const entry = pt.teams[team.slug]
      return {
        label: pt.label,
        date: pt.date,
        playoffPct: entry?.playoffPct ?? 0,
        avgSeed: entry?.avgSeed ?? snapshot.format.teamCount,
        ptsAbove500: entry?.ptsAbove500 ?? 0,
        pts: entry?.pts ?? 0,
        whatIfPlayoffPct: undefined as number | undefined,
        whatIfAvgSeed: undefined as number | undefined,
        whatIfPtsAbove500: undefined as number | undefined,
      }
    })

    if (isWhatIfActive && base.length > 0) {
      const last = base[base.length - 1]
      last.whatIfPlayoffPct = last.playoffPct
      last.whatIfAvgSeed = last.avgSeed
      last.whatIfPtsAbove500 = last.ptsAbove500
      base.push({
        label: "What-If",
        date: "What-If",
        playoffPct: undefined as unknown as number,
        avgSeed: undefined as unknown as number,
        ptsAbove500: undefined as unknown as number,
        pts: team.pts,
        whatIfPlayoffPct: team.playoffPct,
        whatIfAvgSeed: team.avgSeed,
        whatIfPtsAbove500: Math.round((team.pts - 1.5 * team.gp) * 10) / 10,
      })
    }

    return base
  }, [
    snapshot.timeline,
    snapshot.format.teamCount,
    team.slug,
    team.playoffPct,
    team.avgSeed,
    team.pts,
    team.gp,
    isWhatIfActive,
  ])

  const whatIfDataKey =
    effectiveChartMetric === "playoffPct"
      ? "whatIfPlayoffPct"
      : effectiveChartMetric === "avgSeed"
        ? "whatIfAvgSeed"
        : "whatIfPtsAbove500"

  const activeWhatIfRows = !withOtl && team.whatIfRowsNoOt ? team.whatIfRowsNoOt : team.whatIfRows
  const hasTailProbes = activeWhatIfRows.some((r) => r.isTailProbe)
  const { stroke: teamColor, outline: teamOutline } = getTeamChartColor(team.slug, snapshot.teamColors)
  const luckText =
    Math.abs(team.luckDelta) < 0.025
      ? "Right on expected pace"
      : team.luckDelta > 0
        ? `+${(team.luckDelta * 100).toFixed(1)}% above goal-based pace`
        : `${(team.luckDelta * 100).toFixed(1)}% below goal-based pace`

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  const metricHelp: Record<MetricKey, string> = {
    playoffPct: `${team.name}'s chance to make the playoffs after each matchday, re-simulated using only the results known at that point. Start is the preseason projection.`,
    avgSeed: snapshot.format.allTeamsQualify
      ? `${team.name}'s projected average finishing seed after each matchday (#1 is best). Every team makes the playoffs this season, so seeding is the race.`
      : `${team.name}'s projected average finishing seed after each matchday (#1 is best). The dashed line is the playoff cutoff (top ${snapshot.format.playoffSpots}).`,
    ptsAbove500: `Points above or below a .500 pace (1.5 points per game played), BASH's version of Sports Club Stats' "points above .500". Above 0 means ${team.name} is earning more than half the available points.`,
  }

  return (
    <section
      aria-label={`${team.name} playoff projection breakdown`}
      className="rounded-lg border border-border/70 bg-card p-4 sm:p-5 space-y-5"
    >
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-border/50 pb-4">
        <Link
          href={`/team/${team.slug}?season=${snapshot.seasonId}`}
          aria-label={`${team.name} team page`}
          title={`${team.name} team page`}
          className="shrink-0 mt-0.5 rounded-md transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <TeamLogo slug={team.slug} name={team.name} size={36} />
        </Link>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <h3 className="text-base font-semibold text-foreground">{team.name}</h3>
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              ({team.w}-{team.otw + team.sow}-{team.otl}-{team.l}
              {team.ties ? `-${team.ties}T` : ""}, {team.pts}pts)
            </span>
          </div>
          {snapshot.format.allTeamsQualify ? (
            <p className="text-xs text-muted-foreground leading-snug">
              All teams qualify for playoffs
            </p>
          ) : team.clinched ? (
            <div className="space-y-0.5 text-xs text-muted-foreground leading-snug">
              <p>
                <span className="font-semibold text-emerald-700">Clinched playoffs</span>
              </p>
              {snapshot.format.hasPlayIn && (
                <p className="text-[11px] tabular-nums">
                  {team.directByePct.toFixed(1)}% top-3 bye, {team.playInPct.toFixed(1)}% play-in
                </p>
              )}
            </div>
          ) : team.eliminated ? (
            <p className="text-xs text-muted-foreground leading-snug">
              <span className="font-semibold text-rose-700">Eliminated from playoff contention</span>
            </p>
          ) : (
            <div className="space-y-0.5 text-xs text-muted-foreground leading-snug">
              <p>
                <span className="font-semibold text-foreground tabular-nums">
                  {team.playoffPct === 100
                    ? ">99.9%"
                    : team.playoffPct === 0
                      ? "<0.1%"
                      : `${team.playoffPct.toFixed(1)}%`}
                </span>{" "}
                to make playoffs
              </p>
              {snapshot.format.hasPlayIn && (
                <p className="text-[11px] tabular-nums">
                  {team.directByePct.toFixed(1)}% top-3 bye, {team.playInPct.toFixed(1)}% play-in
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick context metrics strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
        <div className="rounded-md bg-muted/50 px-3 py-2">
          <InfoLabel label="Projected Seed">
            {snapshot.format.allTeamsQualify ? (
              <p className="text-background/90">
                Every team makes the playoffs this season, so seeding is the race. Projected average finishing seed and
                simulated range (#1 to #{snapshot.format.teamCount}).
              </p>
            ) : snapshot.format.hasPlayIn ? (
              <p className="text-background/90">
                Projected average finishing seed and simulated range across 100k runs. Top 3 seeds earn a direct bye
                to the semifinals; seeds #4 and #5 meet in the play-in game.
              </p>
            ) : (
              <p className="text-background/90">
                Projected average finishing seed and simulated range across 100k runs. Top {snapshot.format.playoffSpots}{" "}
                teams qualify for the playoffs.
              </p>
            )}
          </InfoLabel>
          <div className="mt-0.5 font-semibold text-foreground tabular-nums">
            #{team.avgSeed.toFixed(1)}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            Range: #{team.bestSeed}–#{team.worstSeed}
            {snapshot.format.allTeamsQualify && ` · ${team.seedPcts[0]?.toFixed(1) ?? "0.0"}% #1`}
          </div>
        </div>
        <div className="rounded-md bg-muted/50 px-3 py-2">
          <InfoLabel label="Rating & Pace">
            <p className="font-semibold">Strength (.{Math.round(team.strength * 1000).toString().padStart(3, "0")})</p>
            <p className="mt-0.5 text-background/90">
              {snapshot.mode === "50_50"
                ? "Our 0–1 estimate of team quality (.500 = average). The 50/50 model ignores it and treats every remaining game as a coin flip."
                : snapshot.mode === "classic"
                  ? "Our 0–1 estimate of team quality (.500 = average), from points percentage pulled toward .500 early in the season (original Sports Club Stats formula). It sets the win odds for remaining games."
                  : "Our 0–1 estimate of team quality (.500 = average), from goals for vs. against and pulled toward .500 early in the season. It sets the win odds for remaining games."}
            </p>
            <p className="mt-1.5 font-semibold">Pace</p>
            <p className="mt-0.5 text-background/90">
              Actual points % ({pct(team.actualPtsPct)}) vs. what their goals for/against predict ({pct(team.rawPythPct)}).
              Above pace usually means close-game or OT luck; below pace means they&apos;ve outplayed their record.
            </p>
          </InfoLabel>
          <div className="mt-0.5 font-semibold text-foreground tabular-nums">
            .{Math.round(team.strength * 1000).toString().padStart(3, "0")} strength
          </div>
          <div className="text-[11px] text-muted-foreground">{luckText}</div>
        </div>

        <div className="rounded-md bg-muted/50 px-3 py-2">
          <InfoLabel label="RPI">
            <p>
              <span className="font-semibold">RPI (.{Math.round(team.rpi * 1000).toString().padStart(3, "0")})</span>{" "}
              <span className="text-background/90">
                ranks record against strength of schedule (25% win %, 50% opponents&apos; win %, 25% opponents&apos;
                opponents&apos; win %) — shown for reference, not used in the simulations.
              </span>
            </p>
            <p className="mt-1">
              <span className="font-semibold">ROW</span>{" "}
              <span className="text-background/90">
                = regulation + overtime wins (shootout wins don&apos;t count), the first tiebreaker after points.
              </span>
            </p>
            <p className="mt-1">
              <span className="font-semibold">GD</span> <span className="text-background/90">= goal differential.</span>
            </p>
          </InfoLabel>
          <div className="mt-0.5 font-semibold text-foreground tabular-nums">
            #{team.rpiRank} (.{Math.round(team.rpi * 1000).toString().padStart(3, "0")})
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            ROW {team.row} · GD {team.gd > 0 ? `+${team.gd}` : team.gd}
          </div>
        </div>

        <div className="rounded-md bg-muted/50 px-3 py-2">
          <InfoLabel label="Schedule">
            <p>
              <span className="font-semibold">Last game:</span>{" "}
              <span className="text-background/90">
                {team.lastGame
                  ? `${team.name}'s most recent completed regular-season game (${
                      team.lastGame.resultLabel === "W" ||
                      team.lastGame.resultLabel === "OTW" ||
                      team.lastGame.resultLabel === "SOW"
                        ? "win"
                        : team.lastGame.resultLabel === "FFW"
                          ? "forfeit win"
                          : team.lastGame.resultLabel === "T"
                            ? "tie"
                            : "loss"
                    }).`
                  : `${team.name} hasn't completed a regular-season game yet.`}
              </span>
            </p>
            <p className="mt-1">
              <span className="font-semibold">Next game:</span>{" "}
              <span className="text-background/90">
                {team.nextGame
                  ? `${team.name}'s next scheduled regular-season matchup. Click either line to open its game page.`
                  : `${team.name} has no remaining regular-season games.`}
              </span>
            </p>
          </InfoLabel>
          {team.lastGame ? (
            <Link
              href={`/game/${team.lastGame.gameId}`}
              className="mt-0.5 block font-semibold text-foreground hover:text-primary transition-colors"
            >
              {team.lastGame.resultLabel} {team.lastGame.teamScore}–{team.lastGame.opponentScore}{" "}
              {team.lastGame.isHome ? "vs" : "@"} {team.lastGame.opponentName}
            </Link>
          ) : (
            <div className="mt-0.5 font-medium text-muted-foreground">No games played</div>
          )}
          {team.nextGame ? (
            <Link
              href={`/game/${team.nextGame.gameId}`}
              className="block text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Next: {team.nextGame.isHome ? "vs" : "@"} {team.nextGame.opponentName}
            </Link>
          ) : (
            <div className="text-[11px] text-muted-foreground">Season complete</div>
          )}
        </div>
      </div>

      {/* Main content: Timeline Chart + What-If Table (hidden when 0 games remain) */}
      {(() => {
        const showWhatIfFinish = team.gamesRemaining > 0 && snapshot.seasonStatus !== "completed"
        return (
          <div className={showWhatIfFinish ? "grid gap-5 lg:grid-cols-2" : "grid gap-5"}>
        {/* Timeline Chart */}
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-foreground">
              Season trajectory
              {isWhatIfActive && (
                <span className="ml-1.5 font-normal text-muted-foreground">(with What-If)</span>
              )}
            </h4>
            <div
              role="tablist"
              aria-label="Trajectory chart metric"
              className="inline-flex rounded-md border border-border/60 bg-muted/40 p-0.5 text-[11px]"
            >
              {availableMetrics.map((metric, idx) => {
                const active = effectiveChartMetric === metric
                const label = METRIC_LABELS[metric]
                return (
                  <UiTooltip key={metric} delayDuration={200}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        data-metric={metric}
                        onClick={() => setChartMetric(metric)}
                        onKeyDown={(e) => {
                          let nextIdx: number
                          if (e.key === "ArrowRight") nextIdx = (idx + 1) % availableMetrics.length
                          else if (e.key === "ArrowLeft")
                            nextIdx = (idx - 1 + availableMetrics.length) % availableMetrics.length
                          else if (e.key === "Home") nextIdx = 0
                          else if (e.key === "End") nextIdx = availableMetrics.length - 1
                          else return
                          e.preventDefault()
                          const nextMetric = availableMetrics[nextIdx]
                          setChartMetric(nextMetric)
                          e.currentTarget.parentElement
                            ?.querySelector<HTMLButtonElement>(`button[data-metric="${nextMetric}"]`)
                            ?.focus()
                        }}
                        className={cn(
                          "relative rounded px-2 py-0.5 font-medium transition-colors cursor-pointer",
                          "aria-selected:after:content-[''] aria-selected:after:absolute aria-selected:after:inset-x-1.5 aria-selected:after:bottom-0 aria-selected:after:border-b-2 aria-selected:after:border-foreground",
                          active
                            ? "bg-card text-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent sideOffset={6} className="max-w-[260px] text-left text-[11px] leading-snug">
                      {metricHelp[metric]}
                    </TooltipContent>
                  </UiTooltip>
                )
              })}
            </div>
          </div>

          {/* Visible on every device (no hover needed) */}
          <p className="text-[11px] leading-snug text-muted-foreground">{metricHelp[effectiveChartMetric]}</p>

          {chartData.length >= 2 ? (
            <div className="h-[220px] w-full rounded-md border border-border/50 bg-background/60 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 12, left: -12, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--border)" }}
                  />
                  <YAxis
                    domain={
                      effectiveChartMetric === "playoffPct"
                        ? [0, 100]
                        : effectiveChartMetric === "avgSeed"
                          ? [1, snapshot.format.teamCount]
                          : ["auto", "auto"]
                    }
                    reversed={effectiveChartMetric === "avgSeed"}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      effectiveChartMetric === "playoffPct"
                        ? `${v}%`
                        : effectiveChartMetric === "avgSeed"
                          ? `#${v}`
                          : v > 0
                            ? `+${v}`
                            : `${v}`
                    }
                  />
                  {effectiveChartMetric === "ptsAbove500" && (
                    <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeOpacity={0.5} />
                  )}
                  {effectiveChartMetric === "avgSeed" && !snapshot.format.allTeamsQualify && (
                    <ReferenceLine
                      y={snapshot.format.playoffSpots + 0.5}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                  )}
                  <Tooltip
                    content={({ active, label, payload }) => {
                      if (!active || !payload || payload.length === 0) return null
                      const baseItem = payload.find(
                        (p) => p.dataKey === effectiveChartMetric && p.value !== undefined && p.value !== null
                      )
                      const item =
                        baseItem ??
                        payload.find((p) => p.dataKey === whatIfDataKey && p.value !== undefined && p.value !== null)
                      if (!item) return null
                      const val = Number(item.value)
                      const isWhatIfPoint = item.dataKey === whatIfDataKey
                      const prefix = isWhatIfPoint ? "What-If " : ""
                      const formatted =
                        effectiveChartMetric === "playoffPct"
                          ? `${val.toFixed(1)}%`
                          : effectiveChartMetric === "avgSeed"
                            ? `#${val.toFixed(2)}`
                            : val > 0
                              ? `+${val.toFixed(1)}`
                              : val.toFixed(1)
                      const metricLabel =
                        effectiveChartMetric === "playoffPct"
                          ? `${prefix}Playoff odds`
                          : effectiveChartMetric === "avgSeed"
                            ? `${prefix}Avg seed`
                            : `${prefix}Pts vs 1.5/GP pace`
                      return (
                        <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-md">
                          <div className="mb-0.5 font-medium text-popover-foreground">{label}</div>
                          <div className="text-popover-foreground tabular-nums">
                            {metricLabel}: <span className="font-semibold">{formatted}</span>
                          </div>
                        </div>
                      )
                    }}
                  />
                  {teamOutline && (
                    <Line
                      type="monotone"
                      dataKey={effectiveChartMetric}
                      stroke={teamOutline}
                      strokeWidth={4}
                      dot={false}
                      activeDot={false}
                      legendType="none"
                      tooltipType="none"
                      isAnimationActive={false}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey={effectiveChartMetric}
                    stroke={teamColor}
                    strokeWidth={2.25}
                    dot={{ r: 3, fill: teamColor, stroke: teamOutline ?? teamColor, strokeWidth: teamOutline ? 1.25 : 0 }}
                    activeDot={{ r: 5, fill: teamColor, stroke: teamOutline ?? teamColor, strokeWidth: teamOutline ? 1.5 : 0 }}
                    isAnimationActive={false}
                  />
                  {isWhatIfActive && teamOutline && (
                    <Line
                      type="linear"
                      dataKey={whatIfDataKey}
                      stroke={teamOutline}
                      strokeWidth={4}
                      strokeDasharray="4 4"
                      dot={false}
                      activeDot={false}
                      legendType="none"
                      tooltipType="none"
                      isAnimationActive={false}
                    />
                  )}
                  {isWhatIfActive && (
                    <Line
                      type="linear"
                      dataKey={whatIfDataKey}
                      stroke={teamColor}
                      strokeWidth={2.25}
                      strokeDasharray="4 4"
                      dot={{ r: 3.5, fill: "var(--card)", stroke: teamColor, strokeWidth: 2 }}
                      activeDot={{ r: 5, fill: teamColor, stroke: teamOutline ?? teamColor, strokeWidth: 1.5 }}
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[220px] items-center justify-center rounded-md border border-border/50 bg-muted/20 text-xs text-muted-foreground">
              Timeline builds as matchdays are completed.
            </div>
          )}
        </div>

        {/* What-If Finish Table (hidden when 0 games remain or season is complete) */}
        {showWhatIfFinish && (
          <div className="min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-foreground">
                Finish scenarios (
                <span className="sm:hidden">{team.gamesRemaining}gms left</span>
                <span className="hidden sm:inline">
                  {team.gamesRemaining} {team.gamesRemaining === 1 ? "game" : "games"} left
                </span>
                )
              </h4>
              <div className="flex items-center gap-3">
                {team.whatIfRowsNoOt && team.whatIfRowsNoOt.length > 0 && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="sm:hidden">OTLs:</span>
                    <span className="hidden sm:inline">With OTLs</span>
                    <Switch
                      checked={withOtl}
                      onCheckedChange={setWithOtl}
                      aria-label="Include OT/SO games in finish scenarios"
                      className="scale-90"
                    />
                  </label>
                )}
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  Max {team.pts + team.gamesRemaining * 3} pts
                </span>
              </div>
            </div>

            {activeWhatIfRows.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-border/50">
                <table className="w-full text-[10px] sm:text-[11px]">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/40 text-muted-foreground">
                      <th scope="col" className="whitespace-nowrap px-1.5 py-1.5 sm:px-2.5 text-left font-medium">
                        Reg wins
                      </th>
                      <th scope="col" className="whitespace-nowrap px-1 py-1.5 sm:px-2 text-right font-medium">
                        Final PTS
                      </th>
                      <th scope="col" className="whitespace-nowrap px-1 py-1.5 sm:px-2 text-right font-medium">
                        {snapshot.format.allTeamsQualify ? "Avg seed" : "Playoff %"}
                      </th>
                      <th scope="col" className="whitespace-nowrap px-1 py-1.5 sm:px-2 text-right font-medium">
                        Seed range
                      </th>
                      <th scope="col" className="whitespace-nowrap px-1.5 py-1.5 sm:px-2.5 text-right font-medium">
                        Sims
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {activeWhatIfRows.map((row) => (
                      <tr key={row.label} className="hover:bg-muted/30">
                        <th scope="row" className="whitespace-nowrap px-1.5 py-1.5 sm:px-2.5 text-left font-medium text-foreground">
                          {row.lowSample && !row.isTailProbe && (
                            <span className="mr-0.5 text-muted-foreground" title="Fewer than 250 simulated seasons">
                              *
                            </span>
                          )}
                          {row.label}
                          {row.isTailProbe && (
                            <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[9px] font-normal text-muted-foreground">
                              probe
                            </span>
                          )}
                        </th>
                        <td className="whitespace-nowrap px-1 py-1.5 sm:px-2 text-right tabular-nums text-muted-foreground">
                          {row.minFinalPts === row.maxFinalPts
                            ? row.minFinalPts
                            : `${row.minFinalPts}–${row.maxFinalPts}`}
                        </td>
                        <td className="whitespace-nowrap px-1 py-1.5 sm:px-2 text-right font-semibold tabular-nums text-foreground">
                          {snapshot.format.allTeamsQualify
                            ? `#${row.avgSeed.toFixed(1)}`
                            : `${row.playoffPct.toFixed(1)}%`}
                        </td>
                        <td className="whitespace-nowrap px-1 py-1.5 sm:px-2 text-right tabular-nums text-muted-foreground">
                          {row.bestSeed === row.worstSeed
                            ? `#${row.bestSeed}`
                            : `#${row.bestSeed}–#${row.worstSeed}`}
                        </td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 sm:px-2.5 text-right tabular-nums text-muted-foreground">
                          {row.simCount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex h-[120px] items-center justify-center rounded-md border border-border/50 bg-muted/20 text-xs text-muted-foreground">
                Regular season complete for {team.name}.
              </div>
            )}

            {activeWhatIfRows.some((r) => r.lowSample && !r.isTailProbe) && (
              <p className="text-[10px] text-muted-foreground/80">
                Rows marked <span className="font-medium">*</span> come from fewer than 250 simulated seasons, so their
                odds can be off by several points.
              </p>
            )}

            {hasTailProbes && (
              <p className="text-[10px] text-muted-foreground/80">
                Rows tagged <span className="font-medium">probe</span> use an isolated 1,000-run simulation so extreme
                win-out/lose-out outcomes stay visible without biasing main playoff odds.
              </p>
            )}
          </div>
        )}
          </div>
        )
      })()}

    </section>
  )
}
