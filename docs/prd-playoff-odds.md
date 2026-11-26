# PRD: BASH Playoff Odds Predictor (Sports Club Stats Rebuild)

> **Status**: Implemented  
> **Author**: BASH Development Team  
> **Created**: 2026-11-22  
> **Branch**: `sports_club_stats_rebuild`  
> **Related Docs**:
> - [Deep Research Report](./research-sports-club-stats.md)
> - [Technical Design Document (Pipeline & Site/UX)](./tdd-playoff-odds.md)
> - [Attendance Impact & Full-Strength Design Doc](./superpowers/specs/2026-11-23-playoff-odds-attendance-design.md)
> - [Head-to-Head Standings PRD](./prd-head-to-head.md)

---

## 1. Executive Summary

For years, Bay Area Street Hockey (BASH) players and captains tracked the late-season playoff race on **Sports Club Stats** (`sportsclubstats.com`), checking two signature views every week:
1. **"Chance to Make Playoffs / Chance to Finish Regular Season at Seed"** — a clean probability matrix showing each team's playoff odds, seed-by-seed odds, average seed, and week-over-week movement.
2. **"Big Games (Who Should We Root For?)"** — showing exactly how every team's playoff odds and projected seed shift depending on who wins each game in the upcoming matchday/week (including third-party teams affected by scoreboard watching!).

Now that Sports Club Stats is offline, this PRD defines a native, modern **Playoff Odds Predictor** built directly into the BASH website—faithfully preserving what made Sports Club Stats fun and intuitive while upgrading the underlying math for BASH's exact 3-2-1 scoring system, official Rule 213 tiebreakers, and empirically calibrated street hockey probabilities.

---

## 2. Goals & Non-Goals

### 2.1 Goals
1. **Playoff & Seed Probability Table**: Display every team's Playoff Qualification %, exact clinch/elimination status (`In` / `Out`), week-over-week delta (`Change`), full Seed `1..N` probability distribution with clear playoff & direct-bye cut lines, `Avg Seed`, `Att`, `Strength`, `Full Str`, and `RPI`.
2. **Big Games ("Who Should We Root For?")**: Automatically rank upcoming games by total playoff impact and show per-outcome conditional Playoff % and Avg Seed across regulation and OT/SO results (`Away Reg`, `Away OT/SO`, `Home OT/SO`, `Home Reg`), surfacing both participating teams *and* any scoreboard-watching team whose regulation-anchored odds move meaningfully above Monte Carlo noise (`≥ 0.5 pp` playoff swing or `≥ 0.15` seed swing, `z ≥ 2.5`).
3. **Interactive Team Drill-Down**: Clicking any team opens a dedicated Team View showing:
   - **4 Key Scorecards** (`Projected Seed`, `Rating & Pace` including `Full Str`, `RPI`, `Attendance` with avg headcount, `Low`/`High` badge, and Wins vs. Losses splits) with tap/hover/focus tooltips explaining each metric.
   - **Season Trajectory Chart** across every completed matchday (plus a dashed `"What-If"` endpoint when outcomes are locked) with 3 hover-tooltipped views (`Playoff %`, `Avg seed`, `vs .500 pace`).
   - **Finish Scenarios Table** (`Reg wins`, `Final PTS`, `Playoff %`, `Seed range`, `Sims`, with a `With OTLs` toggle) bucketed by actual regulation wins (`1` win per row when `< 10` games remain, `2` wins per row for `10+` games, with isolated tail probing and `< 250` low-sample `*` flags).
   - **Team-Filtered Big Games** showing every upcoming matchup that moves that team's odds.
4. **Interactive "What-If" Game & Attendance Picker**: Let players toggle hypothetical winners (and per-game `What-If Attendance` bench overrides in goal-weighted modes) on the upcoming matchday's games and immediately see the entire Playoff Odds table and Seed matrix recalculate live in the browser!
5. **Mode Transparency & Calibration**: Default to **BASH Weighted**—calibrated via season-blocked Leave-One-Season-Out (LOSO) cross-validation across 2,107 non-forfeit BASH games—while letting users switch with one click to **BASH Full-Strength Adj** (goal-rate attendance-adjusted strength), **50/50** (pure schedule/coin-flip math, like Sports Club Stats's `2.html` view), or **SCS Classic** (`Pts% + p225` fixed-strength regression, for nostalgic exact parity).
6. **Zero-Friction Navigation & Mobile Polish**: Integrate seamlessly as a 3rd view inside `/standings` (`Standings` | `Head to Head` | `Playoff Odds` via `/standings?view=odds`) AND expose a clean direct route `/playoff-odds` for easy sharing in team chats and social links.

### 2.2 Non-Goals
- **Playoff Bracket Win / Championship Odds**: Focuses exclusively on regular-season playoff qualification and regular-season seeding (1st through $N$th). Postseason series odds can be layered on later.
- **Individual RSVP / Player-Level Projections & Shot Metrics**: Team-level bench attendance is now modeled via `Full Str`, the **BASH Full-Strength Adj** model, and Big Games **What-If Attendance** overrides; individual player/RSVP availability, shot-share (`SF%`), and `PDO` remain future work.
- **Modifying Official Standings Table (`StandingsTab`)**: The existing `Standings` tab remains untouched; official Rule 213 tiebreakers power the Playoff Odds simulator.

---

## 3. High-Level Statistical Methodology & Outcomes

*(Full empirical calibration and historical 2018–2019 validation are documented in [research-sports-club-stats.md](./research-sports-club-stats.md).)*

### 3.1 Simulation Model & Modes

Every season snapshot is generated by running **100,000 deterministic Monte Carlo simulations** of all remaining regular-season games (seeded deterministically from the exact set of completed scores so results never jitter on refresh):

| Mode | Team Strength Estimator | Shrinkage & Uncertainty | Purpose |
|---|---|---|---|
| **BASH Weighted (Default)** | **Pre-ratio Gamma-Poisson + PythagenPuck**: shrinks GF/GA (shootout winning goals stripped) toward league mean (`m = 4` prior games), then $S_{\text{raw}} = \frac{\text{GFg}^E}{\text{GFg}^E + \text{GAg}^E}$ where $E = (\text{GFg} + \text{GAg})^P$ (`P = 0.22` Fall, `P = 0.458` Summer) | Post-ratio EB shrinkage (`C = 4` games toward `.500`) + per-iteration **Bayesian Beta strength draws** (`k = 1.5` Fall, `k = 3` Summer) | Highest out-of-sample LOSO CV accuracy across 54 BASH seasons (`RPS 0.23515` Fall, `0.23598` Summer); calibrates early-season uncertainty (`84.9%`/`91.9%` Fall coverage, ideal `0.0833` PIT variance) and eliminates shutout singularities. |
| **BASH Full-Strength Adj** | **Goal-Rate De-Attended PythagenPuck**: symmetrically adjusts each played game's GF/GA back to even headcounts (`goalDiffSlope = 3.882` Fall / `2.747` Summer on `ln(teamAtt / oppAtt)`) before entering the exact same Gamma-Poisson + PythagenPuck pipeline | Same EB shrinkage (`C = 4`) + per-iteration Beta strength draws | Separates talent from bench turnout (*"are they struggling or just short-benched?"*) across both active simulations and completed-season trajectory replays. |
| **50/50 (Coin Flip)** | Every team rated `0.500` | N/A (fixed `0.500`) | Pure schedule/standings math baseline (classic Sports Club Stats `2.html` view). Answers *"What are our odds if every remaining game is a coin flip?"* |
| **SCS Classic** | `PercentOfPointsWon` = $\frac{\text{PTS}}{3 \times \text{GP}}$ | Ken Roberts's exact `p225` piecewise regression (10% floor), fixed strengths (no Beta sampling) | Faithful historical parity with Sports Club Stats's 2018–2019 BASH page. |

### 3.2 Game Outcome Model

For every remaining regular-season game between Away team $A$ and Home team $H$:
1. **Win Probability (Log5, zero home-ice advantage)**:
   $$P(H \text{ wins}) = \frac{S_H (1 - S_A)}{S_H (1 - S_A) + S_A (1 - S_H)}$$
   Empirical BASH Home Win% is `49.3%` (single outdoor venue at James Lick Middle School), so `HFA = 0.50`.
2. **Normalized Extra-Time Rate + 3-2-1 Decompression (6-Outcome System)**:
   - Calibrated extra-time rate: **12.0% Fall** (`7.5%` OT + `4.5%` SO), **9.0% Summer** (`5.5%` OT + `3.5%` SO), scaled by matchup closeness and **normalized across the season's matchups** (using a fast 100-draw pre-loop expectation under Beta strength sampling to prevent concave Jensen's-inequality drift) so the simulated league-average extra-time rate hits the calibrated target.
   - **3-2-1 Points Decompression**: Converts Log5 `pHome` into regulation propensity `q` so expected 3-2-1 points share matches Log5 without double compression.
   - **Points awarded**: Regulation win = `3 / 0`; OT win = `2 / 1` (+1 `ROW` to winner); SO win = `2 / 1` (0 `ROW` to winner, per Rule 213). Historical non-forfeit ties (`hScore === aScore`) award `1` pt each (`0` ROW, `resultLabel: "T"`).
   - **Simulated goal margin**: Drawn from empirical BASH Fall/Summer regulation margin distributions (`1..6+` goals; regulation loser goals `2` Fall / `4` Summer; OT/SO loser goals `3` Fall / `5` Summer, winner `+1`) so `GD` and `GF` tiebreakers resolve realistically.

### 3.3 Official BASH Tiebreakers (Rule 213) & Qualification Formats (Rules 412 & 219)

At the end of every simulated season, teams are ranked by official **BASH Rule 213**:
1. **Points (`PTS`)**
2. **ROW** (Regulation + Overtime Wins — shootout wins excluded)
3. **Head-to-Head (`H2H`)**: Percentage of available points earned in games among the tied teams (supports both 2-way and connected 3+-way ties; iteratively re-evaluates narrowed subgroups; falls through to GD if the H2H graph is disconnected)
4. **Goal Differential (`GD`)**
5. **Goals For (`GF`)** *(standings-table fallback beyond official Rule 213(iv))* → **Draw Lots** (per-iteration random tiebreak)

Qualification spots resolve automatically per season configuration and rulebook:
- **7-Team Fall** (e.g., `bash-2026-2027`, `playoffTeams = 5`): **Top 5 make playoffs** — Seeds `1–3` earn a **Direct Semifinal Bye**; Seeds `4–5` play the **4v5 Play-In** game.
- **6-Team Fall**: **Top 4 make playoffs** directly to Semifinals.
- **Summer (Rule 219)**: **All teams qualify** — the UI automatically adapts its copy and column framing to emphasize **Seed 1–N probabilities** and top-seed/bye races instead of showing trivial `100%` qualification alarms.

### 3.4 Exact Clinch / Elimination Guardrail

Following Ken Roberts's famous 2009 Senators lesson (`p270`), finite Monte Carlo `100.0%` or `0.0%` is **never** labeled `In` or `Out` unless verified mathematically via **exact remaining-schedule max-flow** (Edmonds–Karp) over points and ROW bounds (treating H2H/GD conservatively so neither label is ever awarded falsely):
- **Mathematically Clinched (`In`)**: Verified that in every valid completion of remaining games (even if the team loses out in regulation), at most `playoffSpots - 1` rivals can simultaneously reach its point total (respecting shared games between rivals and ROW bounds).
- **Mathematically Eliminated (`Out`)**: Verified that in every valid completion of remaining games (even if the team wins out in regulation), at least `playoffSpots` rivals finish ahead.
- **Unverified Extremes**: Displayed honestly as `>99.9%` (not yet clinched) or `<0.1%` (still mathematically alive!).

### 3.5 Big Games Single-Pass Conditional Accounting

During the exact same 100,000-iteration simulation pass (Ken Roberts's Nov 2009 `#10964` breakthrough), every upcoming game in the active window (default: **Next Matchday**, toggleable to **Next 2 Weeks**) accumulates conditional counts across 4 scoring-distinct outcomes:
- **Away Reg (`3–0`)**
- **Away OT/SO (`2–1`)**
- **Home OT/SO (`1–2`)**
- **Home Reg (`0–3`)**

*(Note: Internally the simulator tracks OT vs. SO separately for exact `ROW` tiebreakers, while presenting the 4 points-distinct columns cleanly in the UI so users aren't overwhelmed by near-identical OT and SO columns—with a tooltip explaining that OT wins count toward `ROW` while SO wins do not!)*

For each game $g$:
- **Regulation-Anchored League Impact (`League Playoff impact`, in `pp`)**: $\sum_{t} |P(\text{playoffs}_t \mid \text{Away Reg}) - P(\text{playoffs}_t \mid \text{Home Reg})|$, avoiding upward bias from noisy low-count OT/SO cells.
- **Tiebreak / All-In Fallback Ranking (`League seed impact`)** (Summer or late-season clinched games): Sorted by total regulation-anchored **Avg Seed Swing**.
- **Affected Teams Displayed**: Always include both participating teams, PLUS any third-party team passing the Monte Carlo noise filter (`≥ 0.5 pp` playoff swing or `≥ 0.15` avg seed swing AND `z ≥ 2.5`).
- **Sample-Size Flag (`*`)**: If any outcome occurred in fewer than **500** iterations, prefix its conditional value with `*` and footnote low-sample uncertainty.

### 3.6 "What If" ("How They Need to Finish") & Unbiased Tail Probing

To answer *"What does our team need to do down the stretch to make playoffs?"*, each team's detail view displays a `Finish scenarios` table bucketed by actual regulation wins (`1` win per row when `< 10` games remain; `2` wins per row for `10+` games) showing `Reg wins`, `Final PTS`, `Playoff %`, `Seed range`, and `Sims` (requiring at least `25` simulated seasons to display naturally, and flagging `< 250` simulated seasons with `*`).

Crucially, honoring the `sidereal` `#10674` fix from Ken Roberts's blog, extreme win-out and lose-out scenarios are simulated in a **separate isolated tail-probing pass** (~1,000 runs per extreme per team) so they populate rare tail rows cleanly **without ever biasing the main playoff probabilities**.

---

## 4. UX & Interaction Design

### 4.1 Information Architecture & Entry Points

1. **Primary Surface — `/standings?view=odds`**:
   - Adds a 3rd top-level pill tab alongside `Standings` and `Head to Head` in `StandingsContent`:
     `Standings` | `Head to Head` | `Playoff Odds`
   - Uses shallow URL state synchronization (`window.history.replaceState`) preserving `?season=<id>&view=odds&mode=weighted|full_strength|50_50|classic&team=<slug>` with zero unnecessary Server Component round-trips.
2. **Direct Shareable Route — `/playoff-odds`**:
   - Dedicated App Router page (`app/playoff-odds/page.tsx`) with SEO metadata and `loading.tsx`, rendering the exact same Playoff Odds experience (highlighted under `Standings` in `SiteHeader` so the 4-item header stays uncluttered).
   - Allows captains to share `https://.../playoff-odds` directly in group chats.

### 4.2 Visual Hierarchy & BASH Style Guide Compliance

Strict adherence to `AGENTS.md` and `modern-web-guidance` (`content-first-noise-reduction`, `responsive-table`, `tabs`):
- **Neutral Theme Tokens First**: Use `bg-background`, `bg-card`, `bg-muted`, `border-border`, `text-foreground`, and `text-muted-foreground` for tables, headers, and controls. Reserve `text-primary` (BASH orange) for primary CTAs (e.g., active Interactive What-If banner / Reset button).
- **No All-Caps Titles**: Section headings use clean sentence/title case (`Playoff odds & seed projections`, `This week's games`); only compact tabular column abbreviations (`GP`, `PTS`, `GD`, `RPI`, `GIH`) use small uppercase labels matching `StandingsTab`.
- **Semantic Probability & Delta Accents**:
  - Soft, accessible probability heat tints in the Seed `1..N` columns (neutral muted shading scaling with probability intensity, zero neon clutter).
  - Subtle semantic delta colors (`emerald-700` for positive playoff swing / rooting upside, `rose-700` for negative swing) with explicit `+`/`-` signs so color is never the sole indicator (WCAG AA contrast on light surface).
  - Clean vertical **Playoff Cut Line** (and subtle dashed **Direct Bye Cut Line** between Seeds 3 & 4 in 7-team 5-spot Fall seasons!) separating qualifying seeds from eliminated seeds.

### 4.3 Page Layout & Sections

#### Section 1: Top-Level Team Selector & Season Header
- **Top-Level Team Filter Bar** (above all content, zero metadata clutter above it): `All teams` + one button per team (compact `<select>` on mobile) to switch cleanly between the league overview and any team's dedicated view.
- **Season Header**: `[Season name] playoff odds` (e.g., `Fall 2026-2027 playoff odds`), followed by *"We ran 100k simulations for 4 different models."* and the active `[Model]: [Model description]` line alongside the **Stats Model** selector (`BASH Weighted` | `BASH Full-Strength Adj` | `50/50` | `SCS Classic`).
- **Season Trend Charts (`PlayoffOddsLeagueCharts`)**: Franchise/team-colored line charts (`Points` and `Chance will make playoffs` / `Projected seed`) with interactive team highlight pills on desktop, a clean single-row team-logo selector bar on mobile (where the Playoff Odds chart stacks above the Points chart), and a dashed `"What-If"` endpoint when outcomes or bench overrides are active.
- If the user has locked hypothetical winners or set bench overrides in **What-If Mode**, a clean banner appears right above the table: *"What-If scenario active (2 games locked · 1 bench override) — Projected odds updated."* with a one-click **Reset What-If** CTA.

#### Section 2: Playoff Odds & Seed Distribution Table (Signature Deliverable #1)
- **Sorting**: Default sorted by `Playoff % (desc) → Avg Seed (asc) → PTS (desc) → Rule 213 tiebreak`, with sortable column headers (`Playoff %`, `PTS`, `Avg Seed`, `Strength`, `RPI`).
- **Columns**:
  - **Team** (sticky left column on mobile, matching `StandingsTab`): Rank `#`, `<TeamLogo size={28} />`, and team name (clicking the row opens that team's dedicated Team View).
  - **Record & Standings Context**: `PTS`, `GP` (with `GIH` tooltip/subtext), `Record` (`W-OTW-OTL-L`, appending `-${ties}T` for historical seasons with ties), `GD` (`+/-`).
  - **Playoff %**: Prominent tabular figure (`In`, `Out`, `>99.9%`, `<0.1%`, or `89.6%`) with inline mini progress bar and **WoW `Change`** badge (noise-floored at `0.5 pp` server / `1.0 pp` What-If). *(In Summer seasons where all teams make playoffs, adapts to emphasize **#1 Seed / Top Seeds**.)*
  - **Seed 1 .. N Matrix** (grouped under spanning `<th colSpan={N}>Projected Finish Seed (%)</th>`): Each cell displays integer `%` (or `—` for `0%`, `<1` for `<0.5%`) with subtle proportional background fill and hover/focus tooltip showing honest 1-decimal precision + 95% MC margin (e.g., `36.1% ±0.3 · Seed #1`). Vertical divider between Seed 3 & Seed 4 (dashed, `Bye`) and thicker cut line after Seed `playoffSpots` (solid, `Playoff cut`).
  - **Avg Seed**: 1-decimal expected finish (e.g. `2.4`) + subtle delta vs. prior matchday (noise-floored at `0.05`).
  - **Att & Full Str** (in `Record & strength` group): `Att` displays mean dressed headcount with neutral `Low` / `High` badges only (omitting `Avg` while keeping it in tooltips, or `—` when boxscores are unavailable); `Full Str` (on `sm+`, inside the `Str` tooltip, and on `TeamOddsPanel`'s `Rating & Pace` scorecard) displays the attendance-neutral strength rating + delta vs. observed `Str` in `BASH Weighted` and `BASH Full-Strength Adj` modes.
  - **Strength** (hidden on `< md`, available in Team View): Mode-aware tooltip (`BASH Weighted`, `BASH Full-Strength Adj`, `50/50`, `SCS Classic`) contrasting **PythagenPuck Expected Win%** vs. non-forfeit **Pts%**.
  - **RPI** (hidden on `< lg`, available in Team View): Competition-ranked `1..N` with tooltip showing raw RPI value.
- **Row Interaction**: Clicking a team row opens the dedicated **Team View** for that team.

#### Section 3: Big Games — "Who Should We Root For?" (Signature Deliverable #2)
- **Header**: Title `This week's games & What-If Scenarios`, next matchday date badge, and contextual subtitle (`Ranked by largest playoff picture impact...` in league view or `Ranked by playoff swing for <Team>...` in team view).
- **Locked What-If Picks Strip**: Appears when 1+ games are locked, showing a summary byline (`All playoff odds, charts, and tables on this page reflect your What-If picks.`), a `Current:` vs. `What-if:` comparison block in team view, and quick outcome pickers for each locked game.
- **Per-Game Cards / Compact Matrix** (ordered by highest regulation-anchored league impact):
  - **Game Header Bar**:
    - Matchup with logos (`Seals @ Loons`), pre-game win probability (`(42%)` / `(58%)`), `IntentLink` to `/game/[id]`, and tap/hover/focus impact badge (`League Playoff impact: 14.8pp`, or `<X>% swing for <Team>` in team view) on the left.
    - **Interactive What-If Picker Strip (`OutcomeQuickPicker`) & What-If Attendance**: Two equal-width `[Reg | OT]` segmented controls (`Away` on left, `Home` on right; prefixed with `What-If Outcome:` on desktop)—clicking any outcome locks that game result (simulating realistic margins and OT-vs-SO ROW credit) and immediately re-simulates the entire page in ~25 ms! Clicking again unlocks it. In `BASH Weighted` and `BASH Full-Strength Adj` modes, unlocked cards also provide a collapsible **`What-If Attendance`** control (`Low` / `Avg` / `High` for Away and Home) to simulate short- or full-bench matchups.
  - **4-Outcome Conditional Impact Table** (`table-fixed` for equal outcome column widths):
    - Rows: Each affected team (both playing teams first, then any third-party scoreboard-watching teams passing the noise filter, tagged subtly as `Watching`).
    - Columns: `Team` | `Current` | `Away Reg (3-0)` | `Away OT/SO (2-1)` | `Home OT/SO (1-2)` | `Home Reg (0-3)`.
    - Cells: Conditional Playoff % (and subtle `+/-` delta vs. current; in clinched/Summer matchups, displays Conditional Avg Seed prominently!). The best outcome for each team is subtly highlighted (`emerald` tint + subtle ring) so players see at a glance *"Who do I root for?"*.
- **Footer Note**: *"Highlighted = best outcome · Swings compare reg wins (not additive)."*

#### Section 4: Dedicated Team View (`TeamOddsPanel`)
When a user selects a team from the top selector, table row, or URL (`?team=<slug>`):
1. **Header & 4 Key Scorecards**: Clickable team logo linking to `/team/[slug]?season=<seasonId>`, `Team Name (W-OTW-OTL-L, PTS)`, `% to make playoffs` + `% top-3 bye, % play-in` bylines, and 4 scorecards (`Projected Seed`, `Rating & Pace` including `Full Str`, `RPI`, `Attendance` showing avg dressed players, `Low`/`High`-only badge, and avg attendance in wins vs. losses), each with an interactive tap/hover/focus tooltip explaining the stat.
2. **Season Trajectory Chart** (`Recharts` responsive line chart) with 3 hover-tooltipped metric tabs (`Playoff %`, `Avg seed`, and `vs .500 pace`) and a dashed `"What-If"` endpoint when outcomes are locked.
3. **Finish Scenarios Table**: Lists non-overlapping regulation-win buckets (`1` win per row when `< 10` games remain, `2` wins per row for `10+` games) with `Final PTS`, `Playoff %`, `Seed range`, and `Sims` (flagging `< 250` simulated seasons with `*`, and using isolated 1,000-run tail probes for `Win out` / `Lose out` rows).
4. **Team-Specific Upcoming Schedule & Rooting Guide**: Upcoming games ranked by how strongly they move *this specific team's* odds.

#### Section 5: Methodology & Rules Disclosure + Full Methodology Guide
- Native HTML `<details>` disclosure block at the bottom of the page (`How playoff odds are calculated`), keeping the main viewport clean and uncluttered (`content-first-noise-reduction`) while providing full transparency:
  - Opens by crediting Ken Roberts and `www.sportsclubstats.com` (now defunct) before explaining BASH's iteration.
  - Lists the 4 simulation modes (**BASH Weighted**, **BASH Full-Strength Adj**, **50/50**, **SCS Classic**) with inline Wikipedia / origin links (`PythagenPuck`, `Empirical Bayes`, `Bill James Log5`, `LOSO cross-validation`, `Ken Roberts's p225 curve`, `max-flow`, `Beta posterior`) plus an **Attendance impact & full-strength rating** subsection explaining the Fall/Summer percentiles, `ln(att)` curve, goal-rate de-attending, and observational caveats.
  - Places **Bayesian strength uncertainty** and Big Games / What-If footnotes in the bottom notes block, ending with a **"See our full methodology here"** link to `/about/playoff-odd-calculations`.
- **Dedicated Blog-Style Methodology Page (`/about/playoff-odd-calculations`)**: Accessible only via the disclosure link (not the main nav menu), documenting the full 6-step workflow, stacked-fraction equations, LOSO cross-validation & Bayesian coverage tables, and verified Internet Archive / paper references so readers can reproduce the simulator end to end.

---

## 5. Edge Cases & Seasonal States

| State | Expected Product Behavior |
|---|---|
| **Pre-season / 0 games played** | Every team starts at `.500` strength; BASH Weighted and 50/50 produce identical symmetric odds (`~playoffSpots / N`), Big Games shows Opening Day matchups, Timeline shows initial pre-season baseline. |
| **Early season (1–4 GP)** | Pre-ratio Gamma-Poisson goal shrinkage (`m = 4`) + post-ratio Empirical Bayes shrinkage (`C = 4`) + per-iteration Bayesian Beta draws (`k = 1.5` Fall / `3` Summer) keep early-season odds well-calibrated instead of falsely projecting `2-0` teams at `99%`. |
| **Mid-season active (`bash-2026-2027`, 15/63 final)** | Full experience: live Playoff %, Seed 1–7 matrix, Play-In cut line, WoW `Change`, Big Games for upcoming Saturday, season trend charts, What-If picker. |
| **Completed historical season (e.g., `2018-2019`, `2025-2026`)** | Displays a subtle **`Final regular season`** pill badge alongside the season title, keeps the league trajectory charts, final odds/seed table (`In`/`Out`), and Team View (scorecards + full-width trajectory chart) intact as a historical replay, and hides both `BigGamesSection` and the Team What-If finish table. |
| **Truncated / cancelled season (`2019-2020`, 60/63 played, `status = completed`)** | Recognizes `status === "completed"` and displays the `Final regular season` badge plus `"Season ended early."` alongside final recorded standings and season trajectory charts, hiding Big Games and Team What-If. |
| **Summer season (`playoffSpots === teamCount`)** | Switches primary highlight from qualification % to **Seed 1–N & #1 Seed / Bye odds**; Big Games ranks by Avg Seed swing so every game remains meaningful. |
| **Forfeits & Double Forfeits** | Properly applies Rule 208 (`5–0` 3-pt win for single forfeit; `0–5` 0-pt loss for both teams on double forfeit) in standings, tiebreakers, and goal differential (excluding forfeits from PythagenPuck scoring efficiency if desired, or keeping consistent with official GF/GA—documented clearly in TDD). |
| **All-Time Season Selector (`?season=all`)** | Displays the same clear message as Standings (*"Playoff odds require a specific season"*). |

---

## 6. Verification & Success Criteria

1. **Mathematical Accuracy**:
   - $\sum_t P(\text{playoffs}_t) = \text{playoffSpots} \times 100\%$ (within floating-point rounding) and $\sum_t P(\text{seed}_{t,k}) = 100\%$ for every seed $k$.
   - Exact reproduction of archived 2018–2019 Sports Club Stats BASH snapshot (`±0.5%`) in `SCS Classic` mode.
   - Exact Rule 213 tiebreaker behavior verified on unit tests covering `ROW` (excluding SO wins) and 2-way / 3-way `H2H` percentage ties.
2. **Performance**:
   - Server computation of 100,000 iterations completes in `< 250 ms` on cold cache and `< 30 ms` on cache hit (`unstable_cache`).
   - Client-side Interactive What-If re-simulation (20,000 iterations) completes in `< 50 ms` for instant UI feedback.
3. **Usability & Accessibility**:
   - Clean, readable layout verified on both Desktop (`1280px`) and Mobile (`390px`) viewports without clipped text or broken sticky columns.
   - Keyboard-navigable tabs, sortable columns (`aria-sort`), semantic `<th scope>` headers, and native `<details>` methodology disclosure.
