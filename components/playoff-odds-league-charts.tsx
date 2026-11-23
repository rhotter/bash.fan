"use client"

import { useMemo, useRef } from "react"
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
import { TeamLogo } from "@/components/team-logo"
import { getTeamChartColor } from "@/lib/chart-colors"
import { cn } from "@/lib/utils"
import type { PlayoffOddsSnapshot } from "@/lib/playoff-odds-types"

type LeagueMetric = "pts" | "playoffPct" | "avgSeed"

interface ChartTeam {
  slug: string
  name: string
  /** Exact franchise/team color */
  color: string
  /** Darker outline for very light team colors (white/gray/yellow); null otherwise */
  outline: string | null
}

/**
 * Sports Club Stats–style league overview: side-by-side "Points" and
 * "Chance will make playoffs" (or "Projected seed" when every team qualifies)
 * multi-team line charts with synchronized team highlighting.
 */
export function PlayoffOddsLeagueCharts({
  snapshot,
  highlightedSlug,
  onHighlight,
  isWhatIfActive,
}: {
  snapshot: PlayoffOddsSnapshot
  highlightedSlug: string | null
  onHighlight: (slug: string | null) => void
  isWhatIfActive: boolean
}) {
  const allTeamsQualify = snapshot.format.allTeamsQualify
  const lastPointerType = useRef<string | null>(null)

  const chartTeams = useMemo<ChartTeam[]>(() => {
    // Order by current projection so the legend reads like the standings
    const ordered = [...snapshot.teams].sort(
      (a, b) => b.playoffPct - a.playoffPct || a.avgSeed - b.avgSeed || b.pts - a.pts
    )
    return ordered.map((t) => {
      const { stroke, outline } = getTeamChartColor(t.slug, snapshot.teamColors)
      return { slug: t.slug, name: t.name, color: stroke, outline }
    })
  }, [snapshot.teams, snapshot.teamColors])

  const chartData = useMemo(() => {
    const base = snapshot.timeline.map((pt) => {
      const row: Record<string, number | string> = { label: pt.label, date: pt.date }
      for (const t of chartTeams) {
        const entry = pt.teams[t.slug]
        row[`pts:${t.slug}`] = entry?.pts ?? 0
        row[`playoffPct:${t.slug}`] = entry?.playoffPct ?? 0
        row[`avgSeed:${t.slug}`] = entry?.avgSeed ?? snapshot.format.teamCount
      }
      return row
    })

    if (isWhatIfActive && base.length > 0) {
      const last = base[base.length - 1]
      const whatIfRow: Record<string, number | string> = { label: "What-If", date: "What-If" }
      const bySlug = new Map(snapshot.teams.map((t) => [t.slug, t]))
      for (const t of chartTeams) {
        const teamRow = bySlug.get(t.slug)
        if (!teamRow) continue
        last[`whatIf:pts:${t.slug}`] = last[`pts:${t.slug}`]
        last[`whatIf:playoffPct:${t.slug}`] = last[`playoffPct:${t.slug}`]
        last[`whatIf:avgSeed:${t.slug}`] = last[`avgSeed:${t.slug}`]
        whatIfRow[`whatIf:pts:${t.slug}`] = teamRow.pts
        whatIfRow[`whatIf:playoffPct:${t.slug}`] = teamRow.playoffPct
        whatIfRow[`whatIf:avgSeed:${t.slug}`] = teamRow.avgSeed
      }
      base.push(whatIfRow)
    }

    return base
  }, [snapshot.timeline, snapshot.teams, chartTeams, snapshot.format.teamCount, isWhatIfActive])

  const hasHistory = chartData.length >= 2
  const secondMetric: LeagueMetric = allTeamsQualify ? "avgSeed" : "playoffPct"

  return (
    <section aria-label="League points and playoff odds trends" className="space-y-3">
      <p className="text-[11px] text-muted-foreground/80">
        <span className="sm:hidden">Tap a team logo to highlight it on both charts.</span>
        <span className="hidden sm:inline">Hover a line or team to highlight it on both charts.</span>
        {isWhatIfActive && " Dashed segment shows active What-If scenario."}
      </p>

      {hasHistory ? (
        <div className="grid gap-3 md:grid-cols-2">
          <LeagueChart
            title="Points"
            metric="pts"
            data={chartData}
            teams={chartTeams}
            highlightedSlug={highlightedSlug}
            onHighlight={onHighlight}
            teamCount={snapshot.format.teamCount}
            playoffSpots={snapshot.format.playoffSpots}
            allTeamsQualify={allTeamsQualify}
            isWhatIfActive={isWhatIfActive}
            className="order-2 md:order-1"
          />
          <LeagueChart
            title={allTeamsQualify ? "Projected seed" : "Chance will make playoffs"}
            metric={secondMetric}
            data={chartData}
            teams={chartTeams}
            highlightedSlug={highlightedSlug}
            onHighlight={onHighlight}
            teamCount={snapshot.format.teamCount}
            playoffSpots={snapshot.format.playoffSpots}
            allTeamsQualify={allTeamsQualify}
            isWhatIfActive={isWhatIfActive}
            className="order-1 md:order-2"
          />
        </div>
      ) : (
        <div className="flex h-[140px] items-center justify-center rounded-lg border border-border/60 bg-muted/20 text-xs text-muted-foreground">
          Trend charts build as matchdays are completed.
        </div>
      )}

      {/* Shared legend — mouse hover highlights; tap/Enter toggles (touch + keyboard).
          Mobile: a single row of team logos. Desktop: line swatch + logo + name chips. */}
      {hasHistory && (
        <ul
          className="flex flex-nowrap items-center justify-between gap-1 overflow-x-auto sm:flex-wrap sm:justify-start sm:gap-1.5 sm:overflow-visible"
          aria-label="Chart legend"
        >
          {chartTeams.map((t) => {
            const active = highlightedSlug === t.slug
            const dimmed = highlightedSlug !== null && !active
            return (
              <li key={t.slug} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={`Highlight ${t.name}`}
                  title={t.name}
                  onPointerDown={(e) => {
                    lastPointerType.current = e.pointerType
                  }}
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse") onHighlight(t.slug)
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === "mouse") onHighlight(null)
                  }}
                  onClick={() => {
                    // Mouse users already highlight on hover; taps and keyboard toggle
                    if (lastPointerType.current === "mouse") onHighlight(t.slug)
                    else onHighlight(active ? null : t.slug)
                    lastPointerType.current = null
                  }}
                  className={cn(
                    "inline-flex cursor-pointer items-center justify-center rounded-full p-1.5 transition-[opacity,box-shadow,background-color]",
                    "sm:gap-1.5 sm:rounded-md sm:border sm:px-2 sm:py-1 sm:text-[11px] sm:font-medium",
                    active
                      ? "bg-muted sm:border-foreground/40 sm:bg-card sm:text-foreground"
                      : "sm:border-border/60 sm:bg-card/60 sm:text-muted-foreground sm:hover:text-foreground",
                    dimmed && "opacity-40 sm:opacity-60"
                  )}
                  style={active ? { boxShadow: `inset 0 0 0 2px ${t.outline ?? t.color}` } : undefined}
                >
                  <span
                    className="hidden h-1 w-3.5 rounded-full sm:inline-block"
                    style={{
                      backgroundColor: t.color,
                      boxShadow: t.outline ? `0 0 0 1px ${t.outline}` : undefined,
                    }}
                    aria-hidden="true"
                  />
                  <span className="sm:hidden">
                    <TeamLogo slug={t.slug} name={t.name} size={28} className="shrink-0" />
                  </span>
                  <span className="hidden sm:inline-flex">
                    <TeamLogo slug={t.slug} name={t.name} size={14} className="shrink-0" />
                  </span>
                  <span className="hidden sm:inline">{t.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function LeagueChart({
  title,
  metric,
  data,
  teams,
  highlightedSlug,
  onHighlight,
  teamCount,
  playoffSpots,
  allTeamsQualify,
  isWhatIfActive,
  className,
}: {
  title: string
  metric: LeagueMetric
  data: Array<Record<string, number | string>>
  teams: ChartTeam[]
  highlightedSlug: string | null
  onHighlight: (slug: string | null) => void
  teamCount: number
  playoffSpots: number
  allTeamsQualify: boolean
  isWhatIfActive: boolean
  className?: string
}) {
  const formatValue = (v: number) =>
    metric === "playoffPct" ? `${v.toFixed(1)}%` : metric === "avgSeed" ? `#${v.toFixed(1)}` : `${v}`

  return (
    <figure
      className={cn("rounded-lg border border-border/60 bg-card p-3", className)}
      aria-label={`${title} by matchday`}
    >
      <figcaption className="mb-1.5 text-center text-[11px] font-medium text-muted-foreground">{title}</figcaption>
      <div className="h-[200px] sm:h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 6, right: 10, left: -14, bottom: 0 }}
            onMouseLeave={() => onHighlight(null)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={12}
            />
            <YAxis
              domain={metric === "playoffPct" ? [0, 100] : metric === "avgSeed" ? [1, teamCount] : [0, "auto"]}
              reversed={metric === "avgSeed"}
              allowDecimals={false}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => (metric === "playoffPct" ? `${v}%` : metric === "avgSeed" ? `#${v}` : `${v}`)}
            />
            {metric === "avgSeed" && !allTeamsQualify && (
              <ReferenceLine y={playoffSpots + 0.5} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeOpacity={0.6} />
            )}
            <Tooltip
              content={({ active, label, payload }) => {
                if (!active || !payload || payload.length === 0) return null
                // Deduplicate bridge point where both `<metric>:<slug>` and `whatIf:<metric>:<slug>` exist
                const byTeam = new Map<string, (typeof payload)[number]>()
                for (const item of payload) {
                  if (
                    item.value === undefined ||
                    item.value === null ||
                    item.tooltipType === "none" ||
                    !item.name ||
                    String(item.name) === String(item.dataKey)
                  ) {
                    continue
                  }
                  const key = String(item.dataKey ?? "")
                  const teamName = String(item.name)
                  if (!byTeam.has(teamName) || !key.startsWith("whatIf:")) {
                    byTeam.set(teamName, item)
                  }
                }
                if (byTeam.size === 0) return null
                const items = Array.from(byTeam.values()).sort((a, b) => {
                  const av = Number(a.value ?? 0)
                  const bv = Number(b.value ?? 0)
                  return metric === "avgSeed" ? av - bv : bv - av
                })
                return (
                  <div className="rounded-md border border-border bg-popover px-2 py-1.5 text-[11px] shadow-md">
                    <div className="mb-1 font-medium text-popover-foreground">{label}</div>
                    <div className="space-y-0.5">
                      {items.map((item) => (
                        <div key={String(item.name)} className="flex items-center justify-between gap-3">
                          <span className="truncate" style={{ color: item.color }}>
                            {item.name}
                          </span>
                          <span className="font-medium tabular-nums text-popover-foreground">
                            {formatValue(Number(item.value ?? 0))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              }}
            />
            {/* Outline underlays keep very light team colors (e.g., white/yellow) visible on white */}
            {teams
              .filter((t) => t.outline)
              .map((t) => {
                const active = highlightedSlug === t.slug
                const dimmed = highlightedSlug !== null && !active
                return (
                  <Line
                    key={`outline-${t.slug}`}
                    type="monotone"
                    dataKey={`${metric}:${t.slug}`}
                    stroke={t.outline!}
                    strokeWidth={active ? 5.5 : 3.5}
                    strokeOpacity={dimmed ? 0.12 : 0.9}
                    dot={false}
                    activeDot={false}
                    legendType="none"
                    tooltipType="none"
                    isAnimationActive={false}
                  />
                )
              })}
            {teams.map((t) => {
              const active = highlightedSlug === t.slug
              const dimmed = highlightedSlug !== null && !active
              return (
                <Line
                  key={t.slug}
                  type="monotone"
                  dataKey={`${metric}:${t.slug}`}
                  name={t.name}
                  stroke={t.color}
                  strokeWidth={active ? 3.5 : 2}
                  strokeOpacity={dimmed ? 0.18 : 1}
                  dot={false}
                  activeDot={
                    dimmed
                      ? false
                      : { r: 3.5, fill: t.color, stroke: t.outline ?? t.color, strokeWidth: t.outline ? 1.5 : 0 }
                  }
                  isAnimationActive={false}
                  onMouseEnter={() => onHighlight(t.slug)}
                />
              )
            })}
            {isWhatIfActive &&
              teams
                .filter((t) => t.outline)
                .map((t) => {
                  const active = highlightedSlug === t.slug
                  const dimmed = highlightedSlug !== null && !active
                  return (
                    <Line
                      key={`whatif-outline-${t.slug}`}
                      type="linear"
                      dataKey={`whatIf:${metric}:${t.slug}`}
                      stroke={t.outline!}
                      strokeWidth={active ? 5.5 : 3.5}
                      strokeDasharray="4 4"
                      strokeOpacity={dimmed ? 0.12 : 0.9}
                      dot={false}
                      activeDot={false}
                      legendType="none"
                      tooltipType="none"
                      isAnimationActive={false}
                    />
                  )
                })}
            {isWhatIfActive &&
              teams.map((t) => {
                const active = highlightedSlug === t.slug
                const dimmed = highlightedSlug !== null && !active
                return (
                  <Line
                    key={`whatif-${t.slug}`}
                    type="linear"
                    dataKey={`whatIf:${metric}:${t.slug}`}
                    name={t.name}
                    stroke={t.color}
                    strokeWidth={active ? 3.5 : 2}
                    strokeDasharray="4 4"
                    strokeOpacity={dimmed ? 0.18 : 1}
                    dot={false}
                    activeDot={
                      dimmed
                        ? false
                        : { r: 3.5, fill: t.color, stroke: t.outline ?? t.color, strokeWidth: t.outline ? 1.5 : 0 }
                    }
                    isAnimationActive={false}
                    onMouseEnter={() => onHighlight(t.slug)}
                  />
                )
              })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
