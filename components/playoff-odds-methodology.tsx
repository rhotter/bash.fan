"use client"

import { ChevronDown } from "lucide-react"
import type { PlayoffOddsSnapshot } from "@/lib/playoff-odds-types"

export function PlayoffOddsMethodology({ snapshot }: { snapshot: PlayoffOddsSnapshot }) {
  const { calibration, format, seasonType, iterations } = snapshot
  const extraPct = Math.round((calibration.otRate + calibration.soRate) * 1000) / 10
  const otPct = Math.round(calibration.otRate * 1000) / 10
  const soPct = Math.round(calibration.soRate * 1000) / 10

  return (
    <details className="group rounded-lg border border-border/60 bg-card/50 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-medium text-foreground select-none hover:bg-muted/40 transition-colors rounded-lg [&::-webkit-details-marker]:hidden">
        <span>How playoff odds are calculated</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
      </summary>

      <div className="space-y-4 border-t border-border/50 px-4 py-4 leading-relaxed">
        <p>
          Modeled after Ken Roberts&apos;s <span className="font-medium text-foreground">Sports Club Stats</span> and
          calibrated empirically across 2,126 non-forfeit BASH regular-season games, the simulator plays out the
          remaining schedule <span className="font-medium text-foreground tabular-nums">{iterations.toLocaleString()}</span>{" "}
          times using a deterministic seed keyed to current results (so numbers stay stable on refresh until a new game
          is finalized).
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <h3 className="font-semibold text-foreground">Simulation modes</h3>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                <span className="font-medium text-foreground">Weighted (Default):</span> Estimates team strength via
                BASH-calibrated <span className="font-medium">PythagenPuck</span> (power{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">P = {calibration.pythagenPuckPower}</code>{" "}
                for {seasonType === "summer" ? "Summer 4v4" : "Fall 5v5"}), shrunk toward{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">.500</code> with Empirical Bayes prior{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">C = {calibration.ebShrinkageGames}</code>{" "}
                games, then combined head-to-head via <span className="font-medium">Bill James Log5</span>. Outperforms
                raw points percentage and NHL defaults in out-of-sample BASH backtests by filtering out one-goal and
                small-sample variance.
              </li>
              <li>
                <span className="font-medium text-foreground">50/50:</span> Treats every remaining game as an unbiased
                coin flip (same overtime/shootout rates and tiebreakers) to isolate pure schedule and standings math.
              </li>
              <li>
                <span className="font-medium text-foreground">SCS Classic:</span> Uses points percentage{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">PTS / (3 × GP)</code> with Ken Roberts&apos;s
                original piecewise-linear regression curve (10% floor), matching historical Sports Club Stats BASH
                pages.
              </li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <h3 className="font-semibold text-foreground">BASH rules &amp; calibration</h3>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                <span className="font-medium text-foreground">3-2-1 Scoring &amp; Extra Time:</span> Regulation win = 3
                pts, OT/SO win = 2 pts, OT/SO loss = 1 pt, regulation loss = 0 pts. Extra-time rate is calibrated to{" "}
                <span className="tabular-nums">{extraPct}%</span> ({otPct}% OT, {soPct}% shootout) with zero home-ice
                advantage (<code className="rounded bg-muted px-1 py-0.5 text-[11px]">50%</code>, single outdoor rink).
              </li>
              <li>
                <span className="font-medium text-foreground">Official Rule 213 Tiebreakers:</span> Points &rarr; ROW
                (regulation + OT wins, excluding shootout wins) &rarr; head-to-head % of available points among tied
                teams (recursive on multi-way ties) &rarr; goal differential &rarr; goals for &rarr; draw lots.
              </li>
              <li>
                <span className="font-medium text-foreground">Playoff Format:</span>{" "}
                {format.allTeamsQualify
                  ? `All ${format.teamCount} teams qualify (Summer Rule 219); odds focus on seeding and top seeds.`
                  : format.hasPlayIn
                    ? `Top ${format.playoffSpots} of ${format.teamCount} teams qualify (Rule 412): Seeds 1–${format.directByeSpots} advance directly to the semifinals, while Seeds 4 & 5 meet in a single Play-In game.`
                    : `Top ${format.playoffSpots} of ${format.teamCount} teams qualify directly for the playoffs.`}
              </li>
              <li>
                <span className="font-medium text-foreground">Clinch / Elimination Guardrail:</span>{" "}
                <span className="font-medium text-foreground">In</span> and{" "}
                <span className="font-medium text-foreground">Out</span> appear only when mathematically verified;
                unverified extremes display as <span className="tabular-nums">&gt;99.9%</span> or{" "}
                <span className="tabular-nums">&lt;0.1%</span>.
              </li>
            </ul>
          </div>
        </div>

        <p className="border-t border-border/40 pt-3 text-[11px] text-muted-foreground/80">
          Big Games impacts are tallied in a single pass during the main simulation (no strength drift across outcomes).
          Team &ldquo;What If&rdquo; win-out and lose-out rows use an isolated 1,000-run tail probe so extreme scenarios
          never distort main playoff probabilities. Methodology inspired by Ken Roberts (Sports Club Stats), Alan Ryder
          (<em>Win Probabilities</em> / PythagenPuck), and Tom Tippett (Log5).
        </p>
      </div>
    </details>
  )
}
