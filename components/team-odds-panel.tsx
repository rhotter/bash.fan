"use client"

import { useMemo, useState } from "react"
import { X, ArrowUpRight, Info } from "lucide-react"
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
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getTeamChartColor } from "@/lib/chart-colors"
import { cn } from "@/lib/utils"
import type {
  PlayoffOddsSnapshot,
  TeamOddsRow,
} from "@/lib/playoff-odds-types"

type ChartMetric = "playoffPct" | "avgSeed" | "ptsAbove500"

function formatShortDate(isoDate: string): string {
  const parts = isoDate.split("-")
  if (parts.length !== 3) return isoDate
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const m = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  if (!m || !d || m < 1 || m > 12) return isoDate
  return `${months[m - 1]} ${d}`
}

type MetricKey = "playoffPct" | "avgSeed" | "ptsAbove500"

const METRIC_LABELS: Record<MetricKey, string> = {
  playoffPct: "Playoff %",
  avgSeed: "Avg seed",
  ptsAbove500: "vs .500 pace",
}

/** Card label with an info icon that explains the card on hover/focus. */
function InfoLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <UiTooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex cursor-help items-center gap-1 rounded-sm text-[11px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {label}
          <Info className="h-3 w-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent align="start" sideOffset={6} className="max-w-[280px] text-left text-[11px] leading-snug">
        {children}
      </TooltipContent>
    </UiTooltip>
  )
}

export function TeamOddsPanel({
  team,
  snapshot,
  isWhatIfActive,
  onClose,
}: {
  team: TeamOddsRow
  snapshot: PlayoffOddsSnapshot
  isWhatIfActive: boolean
  onClose: () => void
}) {
  const [chartMetric, setChartMetric] = useState<ChartMetric>(
    snapshot.format.allTeamsQualify ? "avgSeed" : "playoffPct"
  )
  const effectiveChartMetric: ChartMetric =
    snapshot.format.allTeamsQualify && chartMetric === "playoffPct" ? "avgSeed" : chartMetric
  const availableMetrics: ChartMetric[] = snapshot.format.allTeamsQualify
    ? ["avgSeed", "ptsAbove500"]
    : ["playoffPct", "avgSeed", "ptsAbove500"]

  const chartData = useMemo(() => {
    return snapshot.timeline.map((pt) => {
      const entry = pt.teams[team.slug]
      return {
        label: pt.label,
        date: pt.date,
        playoffPct: entry?.playoffPct ?? 0,
        avgSeed: entry?.avgSeed ?? snapshot.format.teamCount,
        ptsAbove500: entry?.ptsAbove500 ?? 0,
        pts: entry?.pts ?? 0,
      }
    })
  }, [snapshot.timeline, snapshot.format.teamCount, team.slug])

  const hasTailProbes = team.whatIfRows.some((r) => r.isTailProbe)
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
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 pb-4">
        <div className="flex items-start gap-3 min-w-0">
          <TeamLogo slug={team.slug} name={team.name} size={36} className="shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">{team.name}</h3>
              <Link
                href={`/team/${team.slug}?season=${snapshot.seasonId}`}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Team page
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {snapshot.format.allTeamsQualify ? (
                <>
                  Projected <span className="font-semibold text-foreground tabular-nums">#{team.avgSeed.toFixed(1)}</span>{" "}
                  seed (range <span className="tabular-nums">#{team.bestSeed}–#{team.worstSeed}</span>) with{" "}
                  <span className="font-semibold text-foreground tabular-nums">{team.seedPcts[0]?.toFixed(1) ?? "0.0"}%</span>{" "}
                  chance at the #1 seed.
                </>
              ) : team.clinched ? (
                <>
                  <span className="font-semibold text-emerald-700">Clinched playoffs</span> — projected{" "}
                  <span className="font-semibold text-foreground tabular-nums">#{team.avgSeed.toFixed(1)}</span> seed
                  (range <span className="tabular-nums">#{team.bestSeed}–#{team.worstSeed}</span>).
                </>
              ) : team.eliminated ? (
                <>
                  <span className="font-semibold text-rose-700">Eliminated from playoff contention</span> — projected{" "}
                  <span className="font-semibold text-foreground tabular-nums">#{team.avgSeed.toFixed(1)}</span> seed.
                </>
              ) : (
                <>
                  <span className="font-semibold text-foreground tabular-nums">
                    {team.playoffPct === 100
                      ? ">99.9%"
                      : team.playoffPct === 0
                        ? "<0.1%"
                        : `${team.playoffPct.toFixed(1)}%`}
                  </span>{" "}
                  chance to make playoffs
                  {snapshot.format.hasPlayIn && (
                    <>
                      {" "}
                      (<span className="tabular-nums">{team.directByePct.toFixed(1)}%</span> top-3 bye,{" "}
                      <span className="tabular-nums">{team.playInPct.toFixed(1)}%</span> play-in)
                    </>
                  )}
                  . Projected <span className="font-semibold text-foreground tabular-nums">#{team.avgSeed.toFixed(1)}</span>{" "}
                  seed (range <span className="tabular-nums">#{team.bestSeed}–#{team.worstSeed}</span>).
                </>
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Back to all teams"
          title="Back to all teams"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Quick context metrics strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
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
          <InfoLabel label="Record & ROW">
            <p>
              <span className="font-semibold">Record</span>{" "}
              <span className="text-background/90">
                is W–OTW/SOW–OTL–L ({team.gp} GP). Points: 3 for a regulation win, 2 for an OT/SO win, 1 for an OT/SO
                loss.
              </span>
            </p>
            <p className="mt-1">
              <span className="font-semibold">ROW</span>{" "}
              <span className="text-background/90">
                = regulation + overtime wins (shootout wins don&apos;t count), the first tiebreaker after points.
              </span>
            </p>
            <p className="mt-1">
              <span className="font-semibold">GD</span> <span className="text-background/90">= goal differential.</span>{" "}
              <span className="font-semibold">RPI</span>{" "}
              <span className="text-background/90">
                ranks record against strength of schedule — shown for reference, not used in the simulations.
              </span>
            </p>
          </InfoLabel>
          <div className="mt-0.5 font-semibold text-foreground tabular-nums">
            {team.w}-{team.otw + team.sow}-{team.otl}-{team.l}
            {team.ties ? `-${team.ties}T` : ""} ({team.pts} pts)
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            ROW {team.row} · GD {team.gd > 0 ? `+${team.gd}` : team.gd} · RPI #{team.rpiRank}
          </div>
        </div>

        <div className="rounded-md bg-muted/50 px-3 py-2">
          <InfoLabel label="Last game">
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
                }). Click the result to open the game page.`
              : `${team.name} hasn't completed a regular-season game yet.`}
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
            <div className="mt-0.5 font-medium text-muted-foreground">None played</div>
          )}
          {team.lastGame && (
            <div className="text-[11px] text-muted-foreground">{formatShortDate(team.lastGame.date)}</div>
          )}
        </div>

        <div className="rounded-md bg-muted/50 px-3 py-2">
          <InfoLabel label="Next game">
            {team.nextGame
              ? `${team.name}'s next scheduled regular-season game. See "This week's games" below for how each result would move their odds, or click to open the matchup page.`
              : `${team.name} has no remaining regular-season games.`}
          </InfoLabel>
          {team.nextGame ? (
            <Link
              href={`/game/${team.nextGame.gameId}`}
              className="mt-0.5 block font-semibold text-foreground hover:text-primary transition-colors"
            >
              {team.nextGame.isHome ? "vs" : "@"} {team.nextGame.opponentName}
            </Link>
          ) : (
            <div className="mt-0.5 font-medium text-muted-foreground">Season complete</div>
          )}
          {team.nextGame && (
            <div className="text-[11px] text-muted-foreground">
              {formatShortDate(team.nextGame.date)} · {team.nextGame.time}
            </div>
          )}
        </div>
      </div>

      {/* Main 2-column content: Timeline Chart + What-If Table */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Timeline Chart */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-foreground">
              Season trajectory
              {isWhatIfActive && (
                <span className="ml-1.5 font-normal text-muted-foreground">(baseline history)</span>
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
                    contentStyle={{
                      backgroundColor: "var(--popover)",
                      borderColor: "var(--border)",
                      borderRadius: "6px",
                      fontSize: "11px",
                    }}
                    formatter={(value: number) => {
                      if (effectiveChartMetric === "playoffPct") return [`${value.toFixed(1)}%`, "Playoff odds"]
                      if (effectiveChartMetric === "avgSeed") return [`#${value.toFixed(2)}`, "Avg seed"]
                      return [value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1), "Pts vs 1.5/GP pace"]
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
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[220px] items-center justify-center rounded-md border border-border/50 bg-muted/20 text-xs text-muted-foreground">
              Timeline builds as matchdays are completed.
            </div>
          )}
        </div>

        {/* What-If Finish Table */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-foreground">
              How {team.name} needs to finish ({team.gamesRemaining} games left)
            </h4>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              Max {team.pts + team.gamesRemaining * 3} pts
            </span>
          </div>

          {team.whatIfRows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border/50">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/40 text-muted-foreground">
                    <th scope="col" className="px-2.5 py-1.5 text-left font-medium">
                      Remaining pts
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">
                      Final PTS
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">
                      {snapshot.format.allTeamsQualify ? "Avg seed" : "Playoff %"}
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">
                      Seed range
                    </th>
                    <th scope="col" className="px-2.5 py-1.5 text-right font-medium">
                      Sims
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {team.whatIfRows.map((row) => (
                    <tr key={row.label} className="hover:bg-muted/30">
                      <th scope="row" className="px-2.5 py-1.5 text-left font-medium text-foreground">
                        {row.lowSample && !row.isTailProbe && (
                          <span className="mr-0.5 text-muted-foreground" title="Fewer than 250 simulated seasons">
                            *
                          </span>
                        )}
                        {row.label}
                        {row.isTailProbe && (
                          <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[9px] font-normal text-muted-foreground">
                            probe
                          </span>
                        )}
                      </th>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {row.minFinalPts === row.maxFinalPts
                          ? row.minFinalPts
                          : `${row.minFinalPts}–${row.maxFinalPts}`}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-foreground">
                        {snapshot.format.allTeamsQualify
                          ? `#${row.avgSeed.toFixed(1)}`
                          : `${row.playoffPct.toFixed(1)}%`}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {row.bestSeed === row.worstSeed
                          ? `#${row.bestSeed}`
                          : `#${row.bestSeed}–#${row.worstSeed}`}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">
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

          {team.whatIfRows.some((r) => r.lowSample && !r.isTailProbe) && (
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
      </div>

    </section>
  )
}
