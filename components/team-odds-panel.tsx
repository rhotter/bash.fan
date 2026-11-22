"use client"

import { useMemo, useState } from "react"
import { X, ArrowUpRight } from "lucide-react"
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
import { getTeamLogoColor } from "@/lib/team-logo-colors"
import { cn } from "@/lib/utils"
import type {
  BigGameOutcomeKey,
  PlayoffOddsSnapshot,
  TeamOddsRow,
} from "@/lib/playoff-odds-types"

type ChartMetric = "playoffPct" | "avgSeed" | "ptsAbove500"

function formatOutcomeLabel(
  outcome: BigGameOutcomeKey,
  awayName: string,
  homeName: string
): string {
  switch (outcome) {
    case "away_reg":
      return `${awayName} reg win`
    case "away_ot":
      return `${awayName} OT/SO win`
    case "home_ot":
      return `${homeName} OT/SO win`
    case "home_reg":
      return `${homeName} reg win`
  }
}

function formatShortDate(isoDate: string): string {
  const parts = isoDate.split("-")
  if (parts.length !== 3) return isoDate
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const m = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  if (!m || !d || m < 1 || m > 12) return isoDate
  return `${months[m - 1]} ${d}`
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

  const teamRootingGames = useMemo(() => {
    return snapshot.bigGames
      .map((bg) => {
        const aff = bg.affectedTeams.find((a) => a.slug === team.slug)
        if (!aff) return null
        return { game: bg, impact: aff }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.impact.playoffSwing - a.impact.playoffSwing || b.impact.seedSwing - a.impact.seedSwing)
      .slice(0, 6)
  }, [snapshot.bigGames, team.slug])

  const hasTailProbes = team.whatIfRows.some((r) => r.isTailProbe)
  const teamColor = getTeamLogoColor(team.slug) || "var(--foreground)"
  const luckText =
    Math.abs(team.luckDelta) < 0.025
      ? "Right on expected pace"
      : team.luckDelta > 0
        ? `+${(team.luckDelta * 100).toFixed(1)}% above goal-based pace`
        : `${(team.luckDelta * 100).toFixed(1)}% below goal-based pace`

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
          aria-label={`Close ${team.name} breakdown`}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Quick context metrics strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
        <div className="rounded-md bg-muted/50 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Rating &amp; Pace</div>
          <div className="mt-0.5 font-semibold text-foreground tabular-nums">
            .{Math.round(team.strength * 1000).toString().padStart(3, "0")} strength
          </div>
          <div className="text-[11px] text-muted-foreground">{luckText}</div>
        </div>

        <div className="rounded-md bg-muted/50 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Record &amp; ROW</div>
          <div className="mt-0.5 font-semibold text-foreground tabular-nums">
            {team.w}-{team.otw + team.sow}-{team.otl}-{team.l} ({team.pts} pts)
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            ROW {team.row} · GD {team.gd > 0 ? `+${team.gd}` : team.gd} · RPI #{team.rpiRank}
          </div>
        </div>

        <div className="rounded-md bg-muted/50 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Last game</div>
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
          <div className="text-[11px] text-muted-foreground">Next game</div>
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
              {!snapshot.format.allTeamsQualify && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={chartMetric === "playoffPct"}
                  onClick={() => setChartMetric("playoffPct")}
                  className={cn(
                    "rounded px-2 py-0.5 font-medium transition-colors cursor-pointer",
                    chartMetric === "playoffPct"
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Playoff %
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={chartMetric === "avgSeed"}
                onClick={() => setChartMetric("avgSeed")}
                className={cn(
                  "rounded px-2 py-0.5 font-medium transition-colors cursor-pointer",
                  chartMetric === "avgSeed"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Avg seed
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={chartMetric === "ptsAbove500"}
                onClick={() => setChartMetric("ptsAbove500")}
                className={cn(
                  "rounded px-2 py-0.5 font-medium transition-colors cursor-pointer",
                  chartMetric === "ptsAbove500"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                vs .500 pace
              </button>
            </div>
          </div>

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
                      chartMetric === "playoffPct"
                        ? [0, 100]
                        : chartMetric === "avgSeed"
                          ? [1, snapshot.format.teamCount]
                          : ["auto", "auto"]
                    }
                    reversed={chartMetric === "avgSeed"}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      chartMetric === "playoffPct"
                        ? `${v}%`
                        : chartMetric === "avgSeed"
                          ? `#${v}`
                          : v > 0
                            ? `+${v}`
                            : `${v}`
                    }
                  />
                  {chartMetric === "ptsAbove500" && (
                    <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeOpacity={0.5} />
                  )}
                  {chartMetric === "avgSeed" && !snapshot.format.allTeamsQualify && (
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
                      if (chartMetric === "playoffPct") return [`${value.toFixed(1)}%`, "Playoff odds"]
                      if (chartMetric === "avgSeed") return [`#${value.toFixed(2)}`, "Avg seed"]
                      return [value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1), "Pts vs 1.5/GP pace"]
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey={chartMetric}
                    stroke={teamColor}
                    strokeWidth={2.25}
                    dot={{ r: 3, fill: teamColor, strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
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

          {hasTailProbes && (
            <p className="text-[10px] text-muted-foreground/80">
              Rows tagged <span className="font-medium">probe</span> use an isolated 1,000-run simulation so extreme
              win-out/lose-out outcomes stay visible without biasing main playoff odds.
            </p>
          )}
        </div>
      </div>

      {/* Team-specific rooting guide */}
      {teamRootingGames.length > 0 && (
        <div className="space-y-2 border-t border-border/50 pt-4">
          <h4 className="text-xs font-semibold text-foreground">
            Upcoming games that matter most for {team.name}
          </h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {teamRootingGames.map(({ game, impact }) => {
              const bestCell = impact.outcomes[impact.bestOutcome]
              const bestLabel = formatOutcomeLabel(impact.bestOutcome, game.awayName, game.homeName)
              return (
                <div
                  key={game.gameId}
                  className="rounded-md border border-border/50 bg-background/60 px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {formatShortDate(game.date)} · {game.time}
                    </span>
                    <span className="tabular-nums font-medium text-foreground">
                      {!snapshot.format.allTeamsQualify && impact.playoffSwing >= 0.3
                        ? `${impact.playoffSwing.toFixed(1)}% swing`
                        : `${impact.seedSwing.toFixed(2)} seed swing`}
                    </span>
                  </div>
                  <div className="mt-1 font-medium text-foreground">
                    {game.awayName} @ {game.homeName}
                  </div>
                  <div className="mt-1 text-[11px] text-emerald-700">
                    Root for: <span className="font-semibold">{bestLabel}</span>{" "}
                    <span className="tabular-nums">
                      (
                      {snapshot.format.allTeamsQualify || impact.playoffSwing < 0.3
                        ? `avg #${bestCell.avgSeed.toFixed(1)}`
                        : `${bestCell.playoffPct.toFixed(1)}%`}
                      )
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
