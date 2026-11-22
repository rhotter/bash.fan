"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { IntentLink as Link } from "@/components/intent-link"
import { TeamLogo } from "@/components/team-logo"
import { cn } from "@/lib/utils"
import type { PlayoffOddsSnapshot, TeamOddsRow } from "@/lib/playoff-odds-types"

type SortKey = "playoffPct" | "pts" | "avgSeed" | "strength" | "rpiRank" | "gd"

function formatPlayoffDisplay(row: TeamOddsRow): { text: string; kind: "in" | "out" | "pct" } {
  if (row.clinched) return { text: "In", kind: "in" }
  if (row.eliminated) return { text: "Out", kind: "out" }
  if (row.playoffPct >= 100) return { text: ">99.9%", kind: "pct" }
  if (row.playoffPct <= 0) return { text: "<0.1%", kind: "pct" }
  return { text: `${row.playoffPct.toFixed(1)}%`, kind: "pct" }
}

function formatSeedCell(pct: number): string {
  if (pct <= 0) return "—"
  if (pct < 0.5) return "<1"
  return String(Math.round(pct))
}

function getSeedCellStyle(pct: number, isQualifying: boolean, isDirectBye: boolean): React.CSSProperties | undefined {
  if (pct <= 0) return undefined
  const alpha = Math.min(0.32, 0.04 + (pct / 100) * 0.28)
  if (!isQualifying) {
    return { backgroundColor: `rgb(225 29 72 / ${(alpha * 0.65).toFixed(3)})` }
  }
  if (isDirectBye) {
    return { backgroundColor: `rgb(16 185 129 / ${alpha.toFixed(3)})` }
  }
  return { backgroundColor: `rgb(14 165 233 / ${(alpha * 0.85).toFixed(3)})` }
}

function formatDelta(delta: number | null, suffix = "", invertSign = false): { label: string; tone: "pos" | "neg" | "flat" } | null {
  if (delta === null || Math.abs(delta) < 0.05) return null
  const isPositiveOutcome = invertSign ? delta < 0 : delta > 0
  const sign = delta > 0 ? "+" : ""
  return {
    label: `${sign}${delta.toFixed(1)}${suffix}`,
    tone: isPositiveOutcome ? "pos" : "neg",
  }
}

export function PlayoffOddsTable({
  snapshot,
  baselineTeamsBySlug,
  selectedTeamSlug,
  onSelectTeam,
}: {
  snapshot: PlayoffOddsSnapshot
  baselineTeamsBySlug?: Map<string, TeamOddsRow>
  selectedTeamSlug: string | null
  onSelectTeam: (slug: string | null) => void
}) {
  const { format, teams } = snapshot
  const [sortKey, setSortKey] = useState<SortKey>(
    format.allTeamsQualify ? "avgSeed" : "playoffPct"
  )
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    format.allTeamsQualify ? "asc" : "desc"
  )
  const [mobileGroup, setMobileGroup] = useState<"seeds" | "details">("seeds")

  const toggleSort = (key: SortKey, defaultDir: "asc" | "desc" = "desc") => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    } else {
      setSortKey(key)
      setSortDir(defaultDir)
    }
  }

  const sortedTeams = useMemo(() => {
    return [...teams].sort((a, b) => {
      let diff = 0
      switch (sortKey) {
        case "playoffPct":
          diff = a.playoffPct - b.playoffPct || b.avgSeed - a.avgSeed || b.currentRank - a.currentRank
          break
        case "pts":
          diff = a.pts - b.pts || a.gd - b.gd
          break
        case "gd":
          diff = a.gd - b.gd || a.pts - b.pts
          break
        case "avgSeed":
          diff = a.avgSeed - b.avgSeed || b.playoffPct - a.playoffPct
          break
        case "strength":
          diff = a.strength - b.strength
          break
        case "rpiRank":
          diff = a.rpiRank - b.rpiRank
          break
      }
      return sortDir === "desc" ? -diff : diff
    })
  }, [teams, sortKey, sortDir])

  const isDefaultOrder =
    (sortKey === "playoffPct" && sortDir === "desc") ||
    (format.allTeamsQualify && sortKey === "avgSeed" && sortDir === "asc")

  const isWhatIf = Boolean(baselineTeamsBySlug && baselineTeamsBySlug.size > 0)
  const seedNumbers = Array.from({ length: format.teamCount }, (_, i) => i + 1)

  const renderSortButton = (
    label: string,
    key: SortKey,
    defaultDir: "asc" | "desc" = "desc",
    title?: string
  ) => {
    const active = sortKey === key
    return (
      <button
        type="button"
        onClick={() => toggleSort(key, defaultDir)}
        title={title}
        className={cn(
          "inline-flex items-center justify-end gap-0.5 hover:text-foreground transition-colors cursor-pointer",
          active ? "text-foreground font-semibold" : "text-muted-foreground/75"
        )}
      >
        <span>{label}</span>
        {active &&
          (sortDir === "desc" ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronUp className="h-3 w-3 shrink-0" />
          ))}
      </button>
    )
  }

  const ariaSortFor = (key: SortKey): "ascending" | "descending" | "none" => {
    if (sortKey !== key) return "none"
    return sortDir === "asc" ? "ascending" : "descending"
  }

  return (
    <section aria-label="Playoff odds and seed distribution" className="space-y-3">
      {/* Section Header + Mobile Column Switch */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {format.allTeamsQualify
              ? "Projected regular-season seed odds"
              : "Chance to make playoffs & finish at each seed"}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Click any team row for its season trajectory, What-If finish table, and rooting guide.
          </p>
        </div>

        {/* Mobile column-group switcher */}
        <div
          role="tablist"
          aria-label="Mobile table columns"
          className="inline-flex rounded-md border border-border/60 bg-muted/40 p-0.5 text-[11px] sm:hidden"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mobileGroup === "seeds"}
            onClick={() => setMobileGroup("seeds")}
            className={cn(
              "rounded px-2.5 py-1 font-medium transition-colors cursor-pointer",
              mobileGroup === "seeds" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"
            )}
          >
            Seed odds
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileGroup === "details"}
            onClick={() => setMobileGroup("details")}
            className={cn(
              "rounded px-2.5 py-1 font-medium transition-colors cursor-pointer",
              mobileGroup === "details" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"
            )}
          >
            Record &amp; strength
          </button>
        </div>
      </div>

      {/* Main Responsive Table */}
      <div
        tabIndex={0}
        role="region"
        aria-label={
          format.allTeamsQualify
            ? "Projected regular-season seed odds table"
            : "Playoff odds and projected finish seeds table"
        }
        className="overflow-x-auto -mx-4 sm:mx-0 rounded-none sm:rounded-lg border-y sm:border border-border/60 bg-card focus-visible:outline-2 focus-visible:outline-ring"
      >
        <table className="w-full text-[11px] border-collapse">
          <thead>
            {/* Group Header Row */}
            <tr className="border-b border-border/50 bg-muted/40 text-[10px] text-muted-foreground">
              <th
                scope="col"
                className="sticky left-0 z-20 bg-muted/95 backdrop-blur-xs pl-4 sm:pl-3 pr-2 py-1.5 text-left font-medium min-w-[155px] sm:min-w-[175px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-3 after:bg-gradient-to-r after:from-black/[0.04] after:to-transparent after:pointer-events-none"
              >
                Team
              </th>
              <th
                scope="colgroup"
                colSpan={3}
                className={cn(
                  "px-2 py-1.5 text-center font-medium border-r border-border/50",
                  mobileGroup === "details" ? "table-cell" : "hidden sm:table-cell"
                )}
              >
                Current
              </th>
              <th
                scope="colgroup"
                colSpan={1}
                className="px-2 py-1.5 text-center font-medium border-r border-border/50"
              >
                {format.allTeamsQualify ? "#1 Seed" : "Playoffs"}
              </th>
              <th
                scope="colgroup"
                colSpan={format.teamCount}
                className={cn(
                  "px-2 py-1.5 text-center font-medium border-r border-border/50",
                  mobileGroup === "seeds" ? "table-cell" : "hidden sm:table-cell"
                )}
              >
                <span>Chance to finish at seed (%)</span>
                {format.hasPlayIn && (
                  <span className="ml-2 font-normal text-muted-foreground/75">
                    (1–{format.directByeSpots} bye · 4–5 play-in)
                  </span>
                )}
              </th>
              <th
                scope="colgroup"
                colSpan={3}
                className={cn(
                  "px-2 py-1.5 text-center font-medium",
                  mobileGroup === "details" ? "table-cell" : "hidden md:table-cell"
                )}
              >
                Summary
              </th>
            </tr>

            {/* Column Header Row */}
            <tr className="border-b border-border/60 bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground/75">
              <th
                scope="col"
                className="sticky left-0 z-20 bg-card pl-4 sm:pl-3 pr-2 py-2 text-left font-medium after:absolute after:right-0 after:top-0 after:bottom-0 after:w-3 after:bg-gradient-to-r after:from-black/[0.04] after:to-transparent after:pointer-events-none"
              >
                Rank &amp; Club
              </th>
              <th
                scope="col"
                aria-sort={ariaSortFor("pts")}
                className={cn(
                  "px-2 py-2 text-right font-medium",
                  mobileGroup === "details" ? "table-cell" : "hidden sm:table-cell"
                )}
              >
                {renderSortButton("PTS", "pts", "desc", "Regular-season points (3-2-1)")}
              </th>
              <th
                scope="col"
                className={cn(
                  "px-2 py-2 text-right font-medium whitespace-nowrap",
                  mobileGroup === "details" ? "table-cell" : "hidden sm:table-cell"
                )}
                title="W-OTW/SOW-OTL-L (Games Played)"
              >
                REC
              </th>
              <th
                scope="col"
                aria-sort={ariaSortFor("gd")}
                className={cn(
                  "px-2 py-2 text-right font-medium border-r border-border/50",
                  mobileGroup === "details" ? "table-cell" : "hidden sm:table-cell"
                )}
              >
                {renderSortButton("+/-", "gd", "desc", "Goal differential")}
              </th>

              <th
                scope="col"
                aria-sort={ariaSortFor(format.allTeamsQualify ? "avgSeed" : "playoffPct")}
                className="px-2.5 py-2 text-right font-medium border-r border-border/50 min-w-[92px]"
              >
                {format.allTeamsQualify
                  ? renderSortButton("#1 %", "avgSeed", "asc", "Probability of finishing 1st overall")
                  : renderSortButton("Make %", "playoffPct", "desc", "Probability of qualifying for playoffs")}
              </th>

              {seedNumbers.map((seedNum) => {
                const isByeBoundary = format.hasPlayIn && seedNum === format.directByeSpots
                const isCutBoundary = !format.allTeamsQualify && seedNum === format.playoffSpots
                const isLastSeed = seedNum === format.teamCount
                return (
                  <th
                    key={seedNum}
                    scope="col"
                    className={cn(
                      "px-1.5 py-2 text-center font-medium tabular-nums min-w-[34px]",
                      mobileGroup === "seeds" ? "table-cell" : "hidden sm:table-cell",
                      isByeBoundary && "border-r border-dashed border-emerald-600/40",
                      isCutBoundary && "border-r-2 border-foreground/30",
                      isLastSeed && "border-r border-border/50"
                    )}
                    title={
                      isByeBoundary
                        ? `Seed ${seedNum} (Direct Semifinal Bye cutoff)`
                        : isCutBoundary
                          ? `Seed ${seedNum} (Playoff qualification cutoff)`
                          : `Chance to finish regular season at Seed ${seedNum}`
                    }
                  >
                    {seedNum}
                  </th>
                )
              })}

              <th
                scope="col"
                aria-sort={ariaSortFor("avgSeed")}
                className={cn(
                  "px-2 py-2 text-right font-medium whitespace-nowrap",
                  mobileGroup === "details" ? "table-cell" : "hidden md:table-cell"
                )}
              >
                {renderSortButton("Avg", "avgSeed", "asc", "Projected average regular-season seed")}
              </th>
              <th
                scope="col"
                aria-sort={ariaSortFor("strength")}
                className={cn(
                  "px-2 py-2 text-right font-medium",
                  mobileGroup === "details" ? "table-cell" : "hidden md:table-cell"
                )}
              >
                {renderSortButton("Str", "strength", "desc", "Regressed team strength rating (0.000–1.000)")}
              </th>
              <th
                scope="col"
                aria-sort={ariaSortFor("rpiRank")}
                className={cn(
                  "px-2.5 py-2 text-right font-medium",
                  mobileGroup === "details" ? "table-cell" : "hidden md:table-cell"
                )}
              >
                {renderSortButton("RPI", "rpiRank", "asc", "Ratings Percentage Index rank (informational)")}
              </th>
            </tr>
          </thead>

          <tbody>
            {sortedTeams.map((row, idx) => {
              const isSelected = selectedTeamSlug === row.slug
              const display = formatPlayoffDisplay(row)
              const baseline = baselineTeamsBySlug?.get(row.slug)
              const deltaVal = isWhatIf && baseline
                ? Math.round((row.playoffPct - baseline.playoffPct) * 10) / 10
                : row.playoffDelta
              const deltaBadge = formatDelta(deltaVal, "%")
              const seedDeltaVal = isWhatIf && baseline
                ? Math.round((row.avgSeed - baseline.avgSeed) * 10) / 10
                : row.avgSeedDelta
              const seedDeltaBadge = formatDelta(seedDeltaVal, "", true)
              const showHorizontalCut =
                isDefaultOrder &&
                !format.allTeamsQualify &&
                idx === format.playoffSpots - 1 &&
                idx < sortedTeams.length - 1
              const showByeRowCut =
                isDefaultOrder &&
                format.hasPlayIn &&
                idx === format.directByeSpots - 1

              const strengthTooltip = `Strength: .${Math.round(row.strength * 1000).toString().padStart(3, "0")} | Raw PythagenPuck: ${(row.rawPythPct * 100).toFixed(1)}% | Actual Pts%: ${(row.actualPtsPct * 100).toFixed(1)}% | Luck: ${row.luckDelta >= 0 ? "+" : ""}${(row.luckDelta * 100).toFixed(1)}%`

              return (
                <tr
                  key={row.slug}
                  onClick={() => onSelectTeam(isSelected ? null : row.slug)}
                  className={cn(
                    "group cursor-pointer transition-colors hover:bg-muted/45",
                    isSelected ? "bg-muted/60" : idx % 2 === 1 ? "bg-muted/[0.12]" : "bg-card",
                    showHorizontalCut
                      ? "border-b-2 border-foreground/30"
                      : showByeRowCut
                        ? "border-b border-dashed border-emerald-600/35"
                        : "border-b border-border/35"
                  )}
                >
                  {/* Sticky Team Cell */}
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 pl-4 sm:pl-3 pr-2 py-2.5 text-left font-normal transition-colors after:absolute after:right-0 after:top-0 after:bottom-0 after:w-3 after:bg-gradient-to-r after:from-black/[0.04] after:to-transparent after:pointer-events-none",
                      isSelected
                        ? "bg-muted/95 shadow-[inset_3px_0_0_var(--primary)]"
                        : "bg-card group-hover:bg-muted/75"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-3.5 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/60">
                        {idx + 1}
                      </span>
                      <TeamLogo slug={row.slug} name={row.name} size={24} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 min-w-0">
                          <Link
                            href={`/team/${row.slug}?season=${snapshot.seasonId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="truncate text-xs font-semibold text-foreground hover:text-primary transition-colors"
                          >
                            {row.name}
                          </Link>
                        </div>
                        {row.gamesInHand > 0 && (
                          <div className="text-[10px] text-muted-foreground/75 tabular-nums">
                            {row.gamesInHand} GIH
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-expanded={isSelected}
                        aria-label={`${isSelected ? "Hide" : "Show"} ${row.name} breakdown`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectTeam(isSelected ? null : row.slug)
                        }}
                        className="shrink-0 rounded p-0.5 text-muted-foreground/60 group-hover:text-foreground transition-colors cursor-pointer"
                      >
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform duration-150",
                            isSelected && "rotate-180 text-foreground"
                          )}
                        />
                      </button>
                    </div>
                  </th>

                  {/* Current Record Columns */}
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right font-semibold tabular-nums text-foreground",
                      mobileGroup === "details" ? "table-cell" : "hidden sm:table-cell"
                    )}
                  >
                    {row.pts}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right tabular-nums text-muted-foreground whitespace-nowrap",
                      mobileGroup === "details" ? "table-cell" : "hidden sm:table-cell"
                    )}
                    title={`${row.gp} GP · ROW ${row.row}`}
                  >
                    {row.w}-{row.otw + row.sow}-{row.otl}-{row.l}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right tabular-nums border-r border-border/50",
                      row.gd > 0
                        ? "text-emerald-700"
                        : row.gd < 0
                          ? "text-rose-700"
                          : "text-muted-foreground",
                      mobileGroup === "details" ? "table-cell" : "hidden sm:table-cell"
                    )}
                  >
                    {row.gd > 0 ? `+${row.gd}` : row.gd}
                  </td>

                  {/* Playoff % (or #1 Seed % in Summer all-in) */}
                  <td className="px-2.5 py-2 border-r border-border/50">
                    {format.allTeamsQualify ? (
                      <div className="flex flex-col items-end">
                        <span className="font-semibold tabular-nums text-foreground">
                          {(row.seedPcts[0] ?? 0).toFixed(1)}%
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          avg #{row.avgSeed.toFixed(1)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-baseline gap-1.5">
                          {display.kind === "in" ? (
                            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                              In
                            </span>
                          ) : display.kind === "out" ? (
                            <span className="rounded bg-rose-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                              Out
                            </span>
                          ) : (
                            <span className="font-semibold tabular-nums text-foreground">
                              {display.text}
                            </span>
                          )}
                          {deltaBadge && (
                            <span
                              className={cn(
                                "text-[10px] font-medium tabular-nums",
                                deltaBadge.tone === "pos" ? "text-emerald-700" : "text-rose-700"
                              )}
                              title={isWhatIf ? "Change vs. real baseline" : "Change since prior matchday"}
                            >
                              {deltaBadge.label}
                            </span>
                          )}
                        </div>
                        <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              row.playoffPct >= 75
                                ? "bg-emerald-600/80"
                                : row.playoffPct >= 35
                                  ? "bg-sky-600/75"
                                  : "bg-muted-foreground/50"
                            )}
                            style={{ width: `${Math.min(100, Math.max(0, row.playoffPct))}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </td>

                  {/* Seed 1..N Matrix */}
                  {seedNumbers.map((seedNum, sIdx) => {
                    const pct = row.seedPcts[sIdx] ?? 0
                    const isQualifying = seedNum <= format.playoffSpots
                    const isDirectBye = format.hasPlayIn ? seedNum <= format.directByeSpots : isQualifying
                    const isByeBoundary = format.hasPlayIn && seedNum === format.directByeSpots
                    const isCutBoundary = !format.allTeamsQualify && seedNum === format.playoffSpots
                    const isLastSeed = seedNum === format.teamCount

                    return (
                      <td
                        key={seedNum}
                        style={getSeedCellStyle(pct, isQualifying, isDirectBye)}
                        className={cn(
                          "px-1.5 py-2.5 text-center tabular-nums",
                          pct > 0 ? "font-medium text-foreground" : "text-muted-foreground/35",
                          mobileGroup === "seeds" ? "table-cell" : "hidden sm:table-cell",
                          isByeBoundary && "border-r border-dashed border-emerald-600/40",
                          isCutBoundary && "border-r-2 border-foreground/30",
                          isLastSeed && "border-r border-border/50"
                        )}
                      >
                        {formatSeedCell(pct)}
                      </td>
                    )
                  })}

                  {/* Summary Columns: Avg Seed, Strength, RPI */}
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right tabular-nums whitespace-nowrap",
                      mobileGroup === "details" ? "table-cell" : "hidden md:table-cell"
                    )}
                  >
                    <span className="font-semibold text-foreground">{row.avgSeed.toFixed(1)}</span>
                    {seedDeltaBadge && (
                      <span
                        className={cn(
                          "ml-1 text-[10px]",
                          seedDeltaBadge.tone === "pos" ? "text-emerald-700" : "text-rose-700"
                        )}
                      >
                        {seedDeltaBadge.label}
                      </span>
                    )}
                  </td>
                  <td
                    title={strengthTooltip}
                    className={cn(
                      "px-2 py-2.5 text-right tabular-nums text-muted-foreground",
                      mobileGroup === "details" ? "table-cell" : "hidden md:table-cell"
                    )}
                  >
                    .{Math.round(row.strength * 1000).toString().padStart(3, "0")}
                  </td>
                  <td
                    title={`RPI value: ${row.rpi.toFixed(3)}`}
                    className={cn(
                      "px-2.5 py-2.5 text-right tabular-nums text-muted-foreground",
                      mobileGroup === "details" ? "table-cell" : "hidden md:table-cell"
                    )}
                  >
                    {row.rpiRank}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Table Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {format.hasPlayIn && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-emerald-500/30 border border-emerald-600/30" />
                Seeds 1–{format.directByeSpots}: Direct semifinal bye
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-sky-500/25 border border-sky-600/30" />
                Seeds 4–5: Play-In game
              </span>
            </>
          )}
          {!format.allTeamsQualify && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-rose-500/20 border border-rose-600/25" />
              Seeds {format.playoffSpots + 1}–{format.teamCount}: Miss playoffs
            </span>
          )}
        </div>
        <span className="tabular-nums text-muted-foreground/80">
          {isWhatIf
            ? "Deltas compare live What-If scenario vs. baseline."
            : "Deltas show change since previous matchday."}
        </span>
      </div>
    </section>
  )
}
