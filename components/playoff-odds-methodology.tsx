"use client"

import Link from "next/link"
import { ArrowRight, ChevronDown } from "lucide-react"
import { BASH_CALIBRATION } from "@/lib/playoff-odds"
import type { PlayoffOddsSnapshot } from "@/lib/playoff-odds-types"

export function PlayoffOddsMethodology({ snapshot }: { snapshot: PlayoffOddsSnapshot }) {
  const { calibration, format, seasonType, iterations } = snapshot
  const extraPct = Math.round((calibration.otRate + calibration.soRate) * 1000) / 10
  const otPct = Math.round(calibration.otRate * 1000) / 10
  const soPct = Math.round(calibration.soRate * 1000) / 10
  const attCal =
    calibration.attendance ??
    BASH_CALIBRATION[seasonType === "summer" ? "summer" : "fall"].attendance
  const activeThresholds = `${attCal.lowP20} / ${attCal.medianP50} / ${attCal.highP80}`

  return (
    <details className="group rounded-lg border border-border/60 bg-card/50 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-medium text-foreground select-none hover:bg-muted/40 transition-colors rounded-lg [&::-webkit-details-marker]:hidden">
        <span>How playoff odds are calculated</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
      </summary>

      <div className="space-y-4 border-t border-border/50 px-4 py-4 leading-relaxed">
        <p>
          Credit where credit is due: Our methodology is an evolution of the previous{" "}
          <span className="font-medium text-foreground">www.sportsclubstats.com</span> (now defunct), built by Ken
          Roberts. Our league previously used this site to produce playoff statistics, but now we have our BASH-specific
          iteration. The simulator plays out the remaining BASH schedule{" "}
          <span className="font-medium text-foreground tabular-nums">{iterations.toLocaleString()}</span> times using a
          deterministic simulation keyed to current results, and our BASH weighted model is calibrated empirically
          across our history of 2,126 non-forfeit BASH regular-season games.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <h3 className="font-semibold text-foreground">Simulation modes</h3>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                <span className="font-medium text-foreground">BASH Weighted (Default):</span> Shrinks per-game goals
                for and against (excluding shootout winning goals) toward the league mean (
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                  m = {calibration.goalPriorGames ?? 0}
                </code>{" "}
                prior games), applies BASH-calibrated{" "}
                <a
                  href="https://web.archive.org/web/20240411005554/http://www.hockeyanalytics.com/Research_files/Win_Probabilities.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary"
                >
                  PythagenPuck
                </a>{" "}
                (power{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">P = {calibration.pythagenPuckPower}</code>{" "}
                for {seasonType === "summer" ? "Summer 4v4" : "Fall 5v5"}), shrinks toward{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">.500</code> with{" "}
                <a
                  href="https://en.wikipedia.org/wiki/Empirical_Bayes_method"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary"
                >
                  Empirical Bayes
                </a>{" "}
                prior{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">C = {calibration.ebShrinkageGames}</code>{" "}
                games, and pairs teams via{" "}
                <a
                  href="https://en.wikipedia.org/wiki/Log5"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary"
                >
                  Bill James Log5
                </a>
                . Outperforms 50/50 coin flips and SCS Classic in out-of-sample{" "}
                <a
                  href="https://en.wikipedia.org/wiki/Cross-validation_(statistics)"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary"
                >
                  LOSO cross-validation
                </a>{" "}
                across both Fall and Summer BASH seasons.
              </li>
              <li>
                <span className="font-medium text-foreground">BASH Full-Strength Adj:</span> Uses the same PythagenPuck +
                Empirical Bayes pipeline as BASH Weighted, but symmetrically de-attends each played game&apos;s goals for
                and against back to even headcounts before computing team strength.
              </li>
              <li>
                <span className="font-medium text-foreground">50/50:</span> Treats every remaining game as an unbiased
                coin flip (same overtime/shootout rates and tiebreakers) to isolate pure schedule and standings math.
              </li>
              <li>
                <span className="font-medium text-foreground">SCS Classic:</span> Uses points percentage{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">PTS / (3 × GP)</code> with{" "}
                <a
                  href="https://web.archive.org/web/20150405212459/http://blog.sportsclubstats.com/?p=225"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary"
                >
                  Ken Roberts&apos;s original piecewise-linear regression curve
                </a>{" "}
                (10% floor), matching historical Sports Club Stats BASH pages.
              </li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <h3 className="font-semibold text-foreground">BASH rules &amp; calibration</h3>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                <span className="font-medium text-foreground">3-2-1 Scoring &amp; Extra Time:</span> Regulation win = 3
                pts, OT/SO win = 2 pts, OT/SO loss = 1 pt, regulation loss = 0 pts. Extra-time probabilities are
                normalized across matchups to preserve the calibrated league average of{" "}
                <span className="tabular-nums">{extraPct}%</span> ({otPct}% OT, {soPct}% shootout), decompressed so
                expected 3-2-1 points share matches Log5, with zero home-ice advantage (
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">50%</code>, single outdoor rink).
              </li>
              <li>
                <span className="font-medium text-foreground">Official Rule 213 Tiebreakers:</span> Points &rarr; ROW
                (regulation + OT wins, excluding shootout wins) &rarr; head-to-head % of available points among tied
                teams (recursive on connected multi-way ties) &rarr; goal differential &rarr; goals for (standings-table
                fallback beyond Rule 213(iv)) &rarr; draw lots.
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
                <span className="font-medium text-foreground">Out</span> appear only when mathematically verified via
                exact remaining-schedule{" "}
                <a
                  href="https://en.wikipedia.org/wiki/Edmonds%E2%80%93Karp_algorithm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary"
                >
                  max-flow
                </a>{" "}
                over points and ROW; unverified extremes display as{" "}
                <span className="tabular-nums">&gt;99.9%</span> or <span className="tabular-nums">&lt;0.1%</span>.
              </li>
            </ul>
          </div>
        </div>

        <div className="space-y-1.5 border-t border-border/40 pt-3">
          <h3 className="font-semibold text-foreground">Attendance impact &amp; full-strength rating</h3>
          <p>
            Dressed headcount is measured from complete boxscores as the distinct{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">player_id</code> union across skaters and
            goalies. Across BASH history, the 20th / 50th / 80th percentile headcounts are{" "}
            <span className="font-medium text-foreground tabular-nums">9 / 11 / 13</span> for Fall (5v5) and{" "}
            <span className="font-medium text-foreground tabular-nums">7 / 9 / 11</span> for Summer (4v4) — this{" "}
            {seasonType === "summer" ? "Summer" : "Fall"} season uses{" "}
            <span className="font-medium text-foreground tabular-nums">{activeThresholds}</span> (
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              goalDiffSlope = {attCal.goalDiffSlope}
            </code>
            ,{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              logOddsSlope = {attCal.logOddsSlope}
            </code>
            ).
          </p>
          <p>
            Bench size follows a diminishing-returns{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">ln(att)</code> curve: dropping from 9 to 6
            players costs far more than adding a 14th skater.{" "}
            <span className="font-medium text-foreground">Full Str</span> symmetrically de-attends each played
            game&apos;s goals for and against (preserving total game goals) before feeding them into PythagenPuck +
            Empirical Bayes shrinkage. Default BASH Weighted odds stay anchored to Observed{" "}
            <span className="font-medium text-foreground">Str</span>, while the{" "}
            <span className="font-medium text-foreground">BASH Full-Strength Adj</span> model simulates the season
            using <span className="font-medium text-foreground">Full Str</span> and Big Games{" "}
            <span className="font-medium text-foreground">What-If Attendance</span> controls let you override individual
            matchup benches in both goal-weighted models.
          </p>
          <p className="text-[11px] text-muted-foreground/85">
            <span className="font-medium text-foreground">Observational caveats:</span> Fitted slopes reflect
            observational boxscores and can partially capture confounders such as late-season morale or elimination,
            absent top scorers or starting goalies, and substitute players (
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">is_sub</code>). Treat{" "}
            <span className="font-medium text-foreground">Full Str</span> as a diagnostic estimate at even headcounts
            rather than a purely causal treatment effect.
          </p>
        </div>

        <div className="space-y-2 border-t border-border/40 pt-3 text-[11px] text-muted-foreground/80">
          <p>
            <span className="font-medium text-foreground">Bayesian strength uncertainty:</span> In BASH Weighted and BASH
            Full-Strength Adj modes, each simulated season draws team strength from a{" "}
            <a
              href="https://en.wikipedia.org/wiki/Beta_distribution"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary"
            >
              Beta posterior
            </a>{" "}
            centered on its estimated rating (narrowing as games played grows), preventing overconfident early-season
            probabilities. Ratings do not adjust for opponent Strength of Schedule prior to a full round-robin cycle.
          </p>
          <p>
            Big Games impacts are tallied in a single pass during the main simulation using regulation-anchored swings
            with Monte Carlo noise filtering (<span className="font-medium text-foreground">*</span> marks outcomes with
            &lt; 500 simulated seasons). Team &ldquo;What If&rdquo; finish rows with &lt; 250 simulated seasons are marked{" "}
            <span className="font-medium text-foreground">*</span>, and win-out/lose-out tail rows use an isolated
            1,000-run tail probe so extreme scenarios never distort main playoff probabilities. Methodology inspired by
            Ken Roberts (Sports Club Stats), Alan Ryder (<em>Win Probabilities</em> / PythagenPuck), and Tom Tippett
            (Log5).
          </p>
          <p className="pt-1">
            <Link
              href="/about/playoff-odd-calculations"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-4 hover:no-underline"
            >
              See our full methodology here
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </p>
        </div>
      </div>
    </details>
  )
}
