"use client"

import { ChevronDown } from "lucide-react"
import { useCallback, useState } from "react"
import { IntentLink } from "@/components/intent-link"
import { TeamLogo } from "@/components/team-logo"
import { ProvisionalBadge } from "@/components/fantasy/week-row"
import { playerSlug } from "@/lib/player-slug"
import { weekLabel } from "@/lib/fantasy/week"
import { cn } from "@/lib/utils"
import type { PublicSelection, StandingsWeek } from "@/lib/fantasy/standings"
import type { FantasyPageData } from "@/lib/fetch-fantasy"

const SKATER_STATS = ["G", "A", "PPG", "SHG", "PIM"]
const GOALIE_STATS = ["SV", "GA", "W", "SO"]

/** One total per stat across the Week's games. */
function statTotals({ games }: PublicSelection) {
  const totals: Record<string, number> = {}
  for (const { stats } of games) {
    for (const { label, value } of stats) totals[label] = (totals[label] ?? 0) + value
  }
  return totals
}

/** A line under the name, for a Backup who came in or a starter without stats. */
function selectionNote({ outcome, isBackup }: PublicSelection) {
  if (outcome === "absent") return "Absent"
  if (outcome === "pending") return "Not scored yet"
  return isBackup ? "Backup, came in" : null
}

function StatTable({ title, columns, selections }: { title: string; columns: string[]; selections: PublicSelection[] }) {
  if (selections.length === 0) return null
  // Both tables get as many stat slots as the skaters', so their columns line up.
  const spacer = columns.length < SKATER_STATS.length
  return (
    <table className="w-full table-fixed text-sm tabular-nums">
      <thead>
        <tr className="border-b border-foreground/20 text-xs text-muted-foreground">
          <th scope="col" className="py-1 text-left font-medium">{title}</th>
          {spacer && <td className="w-8 sm:w-12" />}
          {columns.map((column) => (
            <th key={column} scope="col" className="w-8 text-right font-medium sm:w-12">{column}</th>
          ))}
          <th scope="col" className="w-11 text-right font-semibold text-foreground sm:w-14">Pts</th>
        </tr>
      </thead>
      <tbody>
        {selections.map((selection) => {
          const totals = statTotals(selection)
          const played = selection.outcome === "played"
          const note = selectionNote(selection)
          return (
            <tr key={`${selection.kind}-${selection.playerId}`} className="border-b border-border last:border-0">
              <th scope="row" className="py-1.5 text-left font-normal">
                <span className="flex items-center gap-1.5">
                  {/* A traded Player has a badge for each team. */}
                  {selection.teams.map(({ slug, name }) => (
                    <TeamLogo key={slug} slug={slug} name={name} size={20} className="max-sm:hidden" />
                  ))}
                  <IntentLink
                    href={`/player/${playerSlug(selection.playerName)}`}
                    className={cn("truncate font-medium hover:underline", !played && "text-muted-foreground")}
                  >
                    {selection.playerName}
                  </IntentLink>
                </span>
                {note && <span className="block text-xs text-muted-foreground">{note}</span>}
              </th>
              {spacer && <td />}
              {columns.map((column) => (
                <td key={column} className={cn("text-right", !totals[column] && "text-muted-foreground/60")}>
                  {played ? (totals[column] ?? 0) : ""}
                </td>
              ))}
              <td className="text-right font-bold">{selection.points}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** A Week's Selections with a column per stat. A Backup only shows once it has come in. */
export function LineupStats({ selections }: { selections: PublicSelection[] }) {
  const shown = selections.filter((s) => !s.isBackup || s.outcome === "played")
  return (
    <div className="space-y-3">
      <StatTable title="Skaters" columns={SKATER_STATS} selections={shown.filter((s) => s.kind === "skater")} />
      <StatTable title="Goalie" columns={GOALIE_STATS} selections={shown.filter((s) => s.kind === "goalie")} />
    </div>
  )
}

/** An opened season row: the Manager's score each Week, and the stats for the one chosen. */
function SeasonDetail({ managerId, weeks }: { managerId: number; weeks: StandingsWeek[] }) {
  const mine = weeks.map(({ id, rows }) => ({ id, row: rows.find((row) => row.managerId === managerId) }))
  const [weekId, setWeekId] = useState(() => mine.findLast(({ row }) => row)?.id)
  const row = mine.find(({ id }) => id === weekId)?.row

  // Weeks run oldest first, so late in a season the chosen one would start out of sight.
  const showChosen = useCallback((strip: HTMLDivElement | null) => {
    const chosen = strip?.querySelector<HTMLElement>("[aria-pressed=true]")
    if (strip && chosen) strip.scrollLeft = chosen.offsetLeft + chosen.offsetWidth - strip.clientWidth
  }, [])

  if (!row) return <p className="text-sm text-muted-foreground">No Lineups yet.</p>
  return (
    <div className="space-y-3">
      <div ref={showChosen} role="group" aria-label="Week" className="relative flex overflow-x-auto rounded-md border border-border bg-card">
        {mine.map(({ id, row: scored }) => (
          <button
            key={id}
            type="button"
            disabled={!scored}
            onClick={() => setWeekId(id)}
            aria-pressed={id === weekId}
            className="min-w-16 flex-1 border-r border-border px-2 py-1 text-center last:border-0 disabled:opacity-40 aria-pressed:bg-foreground aria-pressed:text-background"
          >
            <span className="block text-[11px]">{weekLabel(id)}</span>
            <span className="block text-sm font-bold tabular-nums">{scored?.points ?? "–"}</span>
          </button>
        ))}
      </div>
      <LineupStats selections={row.selections} />
    </div>
  )
}

export type StandingsScope = { range: "season" } | { range: "weekly"; weekId: string | null }

/** The season's or one Week's Fantasy standings as a table. Opening a Manager shows their Players' stats. */
export function FantasyStandingsTable({
  weeks,
  season,
  scope,
  onSeason,
  onWeek,
}: {
  weeks: StandingsWeek[]
  season: FantasyPageData["season"]
  scope: StandingsScope
  onSeason: () => void
  onWeek: (weekId: string) => void
}) {
  const [open, setOpen] = useState<number | null>(null)
  const weekly = scope.range === "weekly"
  const week = weekly ? weeks.find(({ id }) => id === scope.weekId) : undefined
  const rows = weekly ? (week?.rows ?? []) : season.rows
  const value = weekly ? (scope.weekId ?? "season") : "season"
  // The Week taking picks can be chosen above before it has standings, so it still needs an option here.
  const optionIds = [...new Set([...weeks.map(({ id }) => id), ...(value === "season" ? [] : [value])])].sort().reverse()
  const emptyMessage = !weekly
    ? "No Managers yet."
    : week
      ? "No Lineups were submitted this Week."
      : "Standings appear after this Week closes."

  return (
    <section aria-label={weekly ? "Weekly standings" : "Season standings"} className="mx-auto max-w-3xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Standings</h2>
        <div className="flex items-center gap-2">
          {(weekly ? week : season)?.provisional && <ProvisionalBadge />}
          <select
            aria-label="Standings for"
            value={value}
            onChange={(event) => (event.target.value === "season" ? onSeason() : onWeek(event.target.value))}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm font-semibold"
          >
            <option value="season">Full season</option>
            {optionIds.map((id) => (
              <option key={id} value={id}>Week of {weekLabel(id)}</option>
            ))}
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="border-t-2 border-foreground">
          <div aria-hidden className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-xs text-muted-foreground">
            <span className="w-7">Rank</span>
            <span className="flex-1">Team</span>
            <span>Pts</span>
            <span className="w-4" />
          </div>
          <ol>
            {rows.map(({ managerId, rank, teamName, points }) => {
              const isOpen = open === managerId
              return (
                <li key={managerId} className={cn("border-b border-border", isOpen && "bg-muted/60")}>
                  <div className="relative flex items-center gap-2 px-2 py-2.5 text-sm tabular-nums hover:bg-muted/60">
                    {/* Covers the row, so everywhere but the Team Name opens it. */}
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`Lineup for ${teamName}`}
                      onClick={() => setOpen(isOpen ? null : managerId)}
                      className="absolute inset-0 w-full cursor-pointer"
                    />
                    <span className="w-7 font-semibold">{rank}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {/* Links by id, because Team Names can be renamed. */}
                      <IntentLink href={`/fantasy/manager/${managerId}`} className="relative font-semibold hover:underline">
                        {teamName}
                      </IntentLink>
                    </span>
                    <span className="text-base font-bold">{points}</span>
                    <ChevronDown aria-hidden className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                  </div>
                  {isOpen && (
                    <div className="px-2 pb-4 pt-1 sm:pl-11 sm:pr-8">
                      {week ? (
                        <LineupStats selections={week.rows.find((row) => row.managerId === managerId)!.selections} />
                      ) : (
                        <SeasonDetail managerId={managerId} weeks={weeks} />
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}
