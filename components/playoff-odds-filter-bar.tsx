"use client"

import { cn } from "@/lib/utils"
import type { PlayoffOddsMode } from "@/lib/playoff-odds-types"

const SELECT_CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`

const LABEL_CLASS = "pl-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50"

export const STATS_MODEL_OPTIONS: ReadonlyArray<{
  value: PlayoffOddsMode
  label: string
  hint: string
}> = [
  {
    value: "weighted",
    label: "BASH Weighted",
    hint: "Goal-based team strength calibrated on 2,100+ past BASH games — scoring, OT/SO rates, and no home-rink edge (recommended).",
  },
  {
    value: "full_strength",
    label: "BASH Full-Strength Adj",
    hint: "Uses the BASH Weighted goal-based team strength model, with an additional adjustment for game-by-game bench attendance to estimate how teams perform at even attendance.",
  },
  {
    value: "50_50",
    label: "50/50",
    hint: "Every remaining game is a coin flip — pure schedule math.",
  },
  {
    value: "classic",
    label: "SCS Classic",
    hint: "Original Sports Club Stats points-percentage formula.",
  },
]

/**
 * Filter bar matching the /stats page pattern:
 * - Teams: native select on mobile; "All teams" + per-team button row on desktop
 *   (select when the league has > 8 teams).
 * - Stats Model: compact select (the active model is explained in the page header below).
 */
export function PlayoffOddsFilterBar({
  teams,
  teamValue,
  onTeamChange,
  mode,
  onModeChange,
}: {
  teams: ReadonlyArray<{ slug: string; name: string }>
  teamValue: string | null
  onTeamChange: (slug: string | null) => void
  mode: PlayoffOddsMode
  onModeChange: (mode: PlayoffOddsMode) => void
}) {
  const currentTeam = teamValue ?? "all"
  const handleTeamSelect = (next: string) => onTeamChange(next === "all" ? null : next)

  const teamSelect = (className: string) => (
    <select
      aria-label="Team"
      value={currentTeam}
      onChange={(e) => handleTeamSelect(e.target.value)}
      className={className}
      style={{ backgroundImage: SELECT_CHEVRON }}
    >
      <option value="all">All teams</option>
      {teams.map((t) => (
        <option key={t.slug} value={t.slug}>
          {t.name}
        </option>
      ))}
    </select>
  )

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border/10 bg-card/45 p-3 sm:justify-between sm:gap-3">
        {/* Mobile: Teams select */}
        <div className="flex min-w-[140px] flex-1 flex-col gap-1.5 sm:hidden">
          <span className={LABEL_CLASS}>Teams</span>
          {teamSelect(
            "w-full min-h-[36px] cursor-pointer appearance-none rounded-md border border-border/40 bg-card bg-[length:10px] bg-[right_8px_center] bg-no-repeat px-2 py-1.5 pr-6 text-[11px] font-semibold text-foreground"
          )}
        </div>

        {/* Desktop: Teams button row (or select for large leagues) */}
        <div className="hidden min-w-0 sm:flex sm:flex-col sm:gap-1.5">
          <span className={LABEL_CLASS}>Teams</span>
          {teams.length > 8 ? (
            teamSelect(
              "w-48 cursor-pointer appearance-none rounded-md border border-border/40 bg-card bg-[length:12px] bg-[right_8px_center] bg-no-repeat px-2.5 py-1.5 pr-7 text-[11px] font-semibold text-foreground"
            )
          ) : (
            <div role="group" aria-label="Teams" className="flex gap-1.5 overflow-x-auto pb-1">
              {[{ slug: "all", name: "All teams" }, ...teams].map((t) => {
                const active = currentTeam === t.slug
                return (
                  <button
                    key={t.slug}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleTeamSelect(t.slug)}
                    className={cn(
                      "flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors",
                      active
                        ? "bg-card font-semibold text-foreground"
                        : "text-muted-foreground/60 hover:bg-card/40 hover:text-muted-foreground"
                    )}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Stats Model */}
        <div className="flex w-[176px] shrink-0 flex-col gap-1.5">
          <label htmlFor="playoff-odds-stats-model" className={LABEL_CLASS}>
            Stats Model
          </label>
          <select
            id="playoff-odds-stats-model"
            value={mode}
            onChange={(e) => onModeChange(e.target.value as PlayoffOddsMode)}
            aria-describedby="playoff-odds-stats-model-hint"
            className="w-full min-h-[36px] cursor-pointer appearance-none rounded-md border border-border/40 bg-card bg-[length:10px] bg-[right_8px_center] bg-no-repeat px-2 py-1.5 pr-6 text-[11px] font-semibold text-foreground sm:min-h-0"
            style={{ backgroundImage: SELECT_CHEVRON }}
          >
            {STATS_MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

    </div>
  )
}
