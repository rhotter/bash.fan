# Deep Research Report: Sports Club Stats Methodology, Linked Statistical Literature, Blog Evolution, & BASH Empirical Calibration

> **Status**: Completed Research Baseline  
> **Branch**: `sports_club_stats_rebuild`  
> **Date**: 2026-11-22  
> **Scope**: Primary-source reconstruction of Sports Club Stats (`sportsclubstats.com`), full audit of all linked statistical methods and Ken Roberts's engineering blog (`blog.sportsclubstats.com`), synthesis of prior BASH / Project Oberth hockey analytics research, and empirical calibration + historical validation against 2,126 BASH regular-season games.

---

## 1. Executive Summary

This report documents the empirical and theoretical foundation for rebuilding a first-class **Playoff Odds Predictor** inside the Bay Area Street Hockey (BASH) website, modeled after Ken Roberts's beloved **Sports Club Stats** (`sportsclubstats.com`, now defunct and preserved via archive.org) and calibrated specifically to BASH's outdoor street hockey environment.

Key findings from primary sources and empirical BASH testing:

1. **Exact Reconstruction of Sports Club Stats**: From Wayback Machine captures of `WhatIsThis.html`, Ken Roberts's 35 KB Google Doc DSL specification (`1-UneDNk6tkOrc_B-WBnGnc5KGiy2kttXC2fW8dR7QzM`), `NHL.txt`, `NLL.txt`, the archived **2018–2019 BASH Sports Club Stats page** (`BayAreaStreetHockey.html`, updated Feb 18, 2019), all 37 archived blog posts (2007–2013), and **108 direct Ken Roberts Q&A replies** on his Feedback page, we recovered Ken's exact simulation architecture—including his exact C# piecewise-linear regression-to-the-mean function (`p225`, Mar 2, 2009), his Nov 2009 single-pass conditional Big Games algorithm (`#10964`), and his separate win-out/lose-out tail probing fix (`#10674`).
2. **Exact Reproduction of Archived 2018–2019 BASH Probabilities**: Running our reconstruction of Ken Roberts's `PercentOfPointsWon` + `p225` regression model on the 2018–2019 BASH database snapshot as of Feb 9, 2019 reproduced Ken's published team strengths to **three decimal places** (`Kings .737`, `Red Army .624`, `Landsharks .415`, `Seals .263`, `Haze .218`) and playoff odds within **0.1 percentage points** (`Landsharks 96.6% vs 96.5%`, `Seals 3.0% vs 3.0%`, `Haze 0.4% vs 0.5%`).
3. **Why NHL Defaults Fail on BASH — and What Beats Them**: Across **2,126 non-forfeit BASH regular-season games** (1,573 Fall, 553 Summer):
   - **Home-ice advantage is zero** (single outdoor venue, James Lick Middle School: Fall Home Win% = `49.32%`, Summer = `49.45%`). Set `HFA = 0.50`.
   - **Overtime/shootout rate is half the NHL's**: Fall `12.97%` all-time (`11.69%` modern 2018+), Summer `10.49%` all-time (`8.72%` modern 2018+)—not NHL's `~24.4%`.
   - **BASH team goal scoring is ~1.6× overdispersed** (`var/mean = 1.633` Fall, `1.604` Summer), mirroring the skater-level overdispersion (`var/mean = 1.98`) discovered in earlier BASH player analytics research. As Alan Ryder's *Win Probabilities* predicts, higher scoring variance compresses the optimal PythagenPuck power `P`: NHL's `P = 0.458` severely overfits BASH Fall (`R² = 0.692`, out-of-sample Brier `0.2719`—worse than coin-flipping!).
   - **Empirical Winner**: **BASH-Calibrated PythagenPuck (`P = 0.22` Fall / `P = 0.37` Summer) + Empirical Bayes shrinkage (`C = 10` Fall / `C = 6` Summer) + Bill James Log5** achieves the best out-of-sample game prediction Brier score (`0.2369` Fall, `0.2264` Summer) and LogLoss (`0.6660` Fall, `0.6443` Summer)—outperforming 50/50 coin flips, NHL PythagenPuck, Ryder Competing Poisson, and Ken's `PercentOfPointsWon`.
4. **Performance**: A 100,000-iteration Monte Carlo simulation of a 7-team BASH season with exact Rule 213 multi-way tiebreakers executes in **~85–135 ms** in single-threaded TypeScript/Node—enabling near-real-time recalculation immediately after games are scored without heavy batch infrastructure.

---

## 2. Synthesis of Prior BASH & Project Oberth Hockey Analytics Research

Before designing a team-level playoff odds engine, we reviewed prior BASH analytics research (`hockey_analytics_report.md`, Project Oberth reviews, `research.md`, and the Oct/Nov 2026 empirical studies) to ensure methodological coherence across player evaluation and team projection:

| Prior Research Finding | Quantitative Evidence in BASH | Direct Implication for Playoff Odds Modeling |
|---|---|---|
| **Heavy Goal/Point Overdispersion** | Skater scoring variance-to-mean ratio `var/mean = 1.98` (nearly 2× pure Poisson). | Team goals are also overdispersed (`var/mean ≈ 1.60–1.63`). Uncalibrated Poisson or NHL PythagenPuck (`P = 0.458`) systematically exaggerates win probabilities; compressed PythagenPuck exponents (`P = 0.22` Fall, `0.37` Summer) + shrinkage are mandatory. |
| **Low & Variable Attendance** | Mean player attendance `53.4%` (`CustomQ1 r = 0.1174`); rosters fluctuate game to game. | True team strength exhibits game-to-game noise well above pro hockey. Aggressive Empirical Bayes shrinkage (`C = 10` Fall, `C = 6` Summer) prevents 3–5 game early-season streaks from producing 95%+ false certainty. |
| **Fall (5v5) vs. Summer (4v4) Structural Split** | Fall: 5v5, 60 min, 12–18 GP, `~7.0–7.5` total G/GP. Summer: 4v4, 45 min, 8–10 GP, `~12.2–13.4` total G/GP. | Separate calibration profiles (`P`, shrinkage `C`, OT/SO rate, playoff qualification rules) are required for Fall and Summer seasons. |
| **Empirical Bayes Shrinkage Beats Raw Rates** | `n / (n + C)` pooling consistently outperformed unshrunk rates and arbitrary cutoffs in out-of-sample tests. | Replace ad-hoc fixed-floor regression with Bayesian-justified shrinkage `w = GP / (GP + C)` toward `.500` (while offering Ken's exact `p225` / `Pts%` formula for historical comparison). |
| **Fall 2026 Cycle 1 Shot & Luck Signals (`SF%`, `PDO`)** | Early-season `Sh% + Sv%` (`PDO`) swings dramatically across 5–6 games while shot-share (`SF%`) stabilizes faster. | In Phase 1 (universal across all historical seasons with or without boxscores), goals-based PythagenPuck already outperforms raw `PTS%` by stripping out 1-goal/OT luck. In Phase 2 (for modern live-scored seasons with shots), `SF%` and `PDO` can be surfaced as luck diagnostics alongside PythagenPuck vs. `PTS%`. |
| **Corrections to Earlier May 2026 Draft PRD (`project_oberth/docs/prd-playoff-probabilities.md`)** | Four technical inaccuracies were identified during primary-source verification: (1) misread archived 2018–19 BASH rows by one line (claimed 4 spots / Rink-Rats 96.5% instead of **5 spots / Landsharks 96.5%**), (2) used NHL `P = 0.458` directly as an exponent, (3) proposed Ken's obsolete 2008 O(G×N) separate re-runs for Big Games instead of his Nov 2009 O(N) single-pass conditional tallying, and (4) omitted BASH Rule 213 `ROW` and multi-way `H2H` tiebreakers. | All four bugs are corrected in the new PRD and TDD. |

---

## 3. Primary-Source Reconstruction of Sports Club Stats

### 3.1 Architecture & League DSL (`WhatIsThis.html`, `scs_gdoc.txt`, `NLL.txt`, `NHL.txt`)

Ken Roberts built Sports Club Stats in C# running continuously on a home quad-core Q6600 Windows PC (roughly ~6,000 NHL seasons/sec per core, accumulating 1M–100M+ iterations per league before publishing static HTML tables via FTP).

Every league (including BASH, submitted by league admins via Ken's Google Doc format) was defined in a plain-text DSL file (`<League>.txt`) containing:
- **Metadata & Scoring**: `PointsForWin`, `PointsForOvertimeWin`, `PointsForShootoutWin`, `PointsForTie`, `PointsForOvertimeLoss`, `PointsForShootoutLoss`, `PointsForLoss`.
- **Simulation Weighting (`WeightType`)**:
  - `PercentOfPointsWon` (default for user-submitted leagues when `WeightType` was omitted—**this is what BASH's 2018–2019 file used**).
  - `Pythagorean` (`WeightExponent` fixed, e.g., `2.0`).
  - `Pythagenpat` / `PythagenpatIgnoreShootOutWinningGoals` (`WeightExponent = 0.458` in `NHL.txt`, applying Alan Ryder's PythagenPuck formula `E = (GF/G + GA/G)^P`).
- **Overtime & Home Field**: `HomeFieldAdvantage` (`0.54`–`0.56` in NHL), `PercentOfGamesThatEndInOvertimeWin` (`0.1202` in NHL), `PercentOfGamesThatEndInShootoutWin` (`0.1236` in NHL), `PercentOfGamesThatEndInTie`.
- **Exact Tiebreaker Pipeline (`SortBegin ... SortEnd`)**: Sequential list of rules (e.g., `Points`, `RegulationPlusOvertimeWins`, `HeadToHead`, `GoalDifferential`, `GoalsScored`, `DrawLots`), evaluated recursively on tied subsets.
- **Playoff Qualification (`RulesBegin ... RulesEnd`)**: Top-N / divisional / wild-card cutoffs plus bracket structure.
- **Dual Modes**: Every league generated two parallel pages:
  - **Weighted** (`BayAreaStreetHockey.html`) — default since Feb 24, 2009 (`p216`).
  - **50/50** (`BayAreaStreetHockey2.html`) — unbiased 50% coin-flip win probability per remaining game, keeping OT/SO frequencies and tiebreakers intact.

### 3.2 Ken Roberts's Exact C# Regression-to-Mean Formula (`blog p225`, Mar 2, 2009)

In blog post `p225` (*"How I calculate team strength"*), Ken published the exact C# code used to shrink raw team ratings toward `.500` as a function of season completion fraction $f = \text{GP} / (\text{GP} + \text{Remaining})$:

```csharp
double percentOfGamesPlayed = final / (double)(final + needToPlay);
double regressPercentage = (percentOfGamesPlayed < 0.5)
    ? (-1.5 * percentOfGamesPlayed) + 1.0
    : (-0.5 * percentOfGamesPlayed) + 0.5;
double regressMin = 0.1;
regressPercentage += regressMin * percentOfGamesPlayed;
strength = rawRating - ((rawRating - 0.5) * regressPercentage);
```

Properties of Ken's regression curve:
- At $f = 0$ (0 games played): `regressPercentage = 1.00` → every team starts at `.500`.
- At $f = 0.5$ (halfway through season): `regressPercentage = 0.30` (70% observed rating, 30% `.500`).
- At $f = 1.0$ (end of season): `regressPercentage = 0.10` (`regressMin` floor → 90% observed, 10% `.500`).

### 3.3 Archived 2018–2019 BASH Page Anatomy (`scs_bash.html`, updated Mon Feb 18, 2019)

Wayback capture `20190227120431/http://www.sportsclubstats.com/USA/BayAreaStreetHockey.html` preserved BASH's actual Sports Club Stats page after the Feb 9, 2019 matchday (39 games final, 24 remaining, 7 teams, **5 playoff spots**):

- **Main Table Columns**:
  1. `Team`
  2. `Last Game` (e.g., `W Seals 12-3`)
  3. `Pts`, `GIH` (Games in Hand relative to league-max GP)
  4. `Record` (`W - OTW - L - OTL`)
  5. `GD` (`GF - GA`)
  6. **Chance to Make Playoffs**: `%` (or `In` / `Out`) + `Change` (delta vs. prior snapshot)
  7. **Chance to Finish Regular Season at Seed**: Columns `1` through `7`, visually separated by the playoff cut line between Seeds 5 and 6
  8. `Avg Seed` + `Change`
  9. `RPI` rank (`0.25*WP + 0.50*OWP + 0.25*OOWP`, displayed "for kicks" per `#9677` and never fed into the sim)
  10. `Strength` (regressed winning-percentage rating, e.g., `.737`)
  11. `Next Game` (e.g., `at Kings`)
- **Big Games Table ("Who should we root for?")**:
  - Listed every upcoming week's game sorted by total playoff-odds swing across all teams:
    1. `Haze vs Seals` — explicitly listed **Landsharks** (a non-playing team!) alongside Seals and Haze because Landsharks' playoff odds shifted from `98.1%` (Haze Reg Win) down to `95.3%` (Seals Reg Win).
    2. `Red-Army vs Rink-Rats` — impacted 2nd/3rd/4th seeding (`Avg Seed 2.6 → 3.3`).
    3. `Kings vs Yetis` — impacted the 1st-seed race.
  - Columns for all 6 outcomes (`Home`, `Home OT`, `Home SO`, `Away SO`, `Away OT`, `Away`) showing both conditional Playoff % and conditional Avg Seed, with `*` marking rare outcomes with small sample sizes.
- **Team Detail Pages** (verified via archived Carolina Hurricanes 2008 & 2019 pages):
  - Plain-English headline summary (playoff %, change, average seed, best/worst possible seed).
  - Historical **Playoff % over time** and **Points Above .500** charts.
  - **"What If" ("How They Need to Finish") table**: Every achievable final record (`W-L-OTL`), exact `Pts`, `Playoff %`, `Seed 1..N %`, and simulation `Count`—supplemented by forced win-out/lose-out tail probes so extreme records show realistic probabilities.

---

## 4. Deep Mathematical Review of All Methods Linked by Ken Roberts

Ken Roberts's `WhatIsThis.html` linked three foundational statistical articles that shaped Sports Club Stats. Every source was retrieved and read in full:

### 4.1 Alan Ryder (2004), *Win Probabilities* (`Win_Probabilities.pdf`, 18 pp.)

Ryder tested nine methods for converting Goals For per game ($\text{GFg}$) and Goals Against per game ($\text{GAg}$) into expected hockey winning percentage across NHL seasons:

| Method | Formula | NHL $R^2$ | Notes |
|---|---|---|---|
| Static Linear | $0.5 + k(\text{GFg} - \text{GAg})$ | 0.934 | Breaks down at extreme goal differentials. |
| Classic Pythagoras | $\frac{\text{GFg}^2}{\text{GFg}^2 + \text{GAg}^2}$ | 0.935 | Bill James baseball formula ($E=2$). |
| Generalized Pythagoras | $\frac{\text{GFg}^{1.86}}{\text{GFg}^{1.86} + \text{GAg}^{1.86}}$ | 0.935 | Best fixed exponent for 1998–2004 NHL. |
| Davenport Pythagenport | $E = 1.5 \log_{10}(\text{GFg} + \text{GAg}) + 0.45$ | 0.941 | Adapts exponent to scoring environment. |
| **PythagenPuck** (Smyth / Ryder) | $E = (\text{GFg} + \text{GAg})^P,\; P = 0.458$ | **0.941** | Adopted by Ken Roberts in `NHL.txt` (`WeightExponent = 0.458`). |
| Ryder 1 | $E = (\text{GFg} \cdot \text{GAg})^{0.285}$ | 0.941 | Geometric mean scoring context. |
| Basic Competing Poisson | Skellam distribution with $\mu = \text{GFg},\, \nu = \text{GAg}$ | 0.941 | Provides theoretical derivation of Generalized Pythagoras. |
| Extended Competing Poisson | Adds OT/empty-net/game-state adjustments | 0.943 | Marginal +0.002 $R^2$ gain for substantially higher complexity. |

**Crucial Theoretical Insight from Ryder**:
- Ryder proved mathematically that Generalized Pythagoras emerges directly from two competing Poisson processes: conditioned on absolute goal margin $|z|$, $\Pr(\text{Win} \mid |z|) = \frac{\text{GFg}^z}{\text{GFg}^z + \text{GAg}^z}$.
- Crucially, **higher scoring environments raise $E$** (more scoring events = less randomness), whereas **higher scoring variance (overdispersion) lowers the exponent $P$** (baseball uses $P \approx 0.287$ because multi-run innings create overdispersion, whereas NHL hockey is closer to independent 1-goal Poisson events at $P \approx 0.458$).
- In BASH, outdoor street hockey exhibits **~1.6× goal overdispersion** due to variable 53% attendance, blowout runs, and goalie variance—directly explaining why BASH requires a lower $P$ than the NHL!

### 4.2 Alan Ryder (2004), *Poisson Toolbox* (`Poisson_Toolbox.pdf`, 37 pp.)

Ryder extended the competing Poisson framework into a complete game-simulation toolkit:
- **Closed-form Skellam margin probability** via Modified Bessel function of the first kind $I_{|z|}$:
  $$\Pr(\text{Home wins by } z) = e^{-(\mu + \nu)} \left(\frac{\mu}{\nu}\right)^{z/2} I_{|z|}\!\left(2\sqrt{\mu\nu}\right)$$
- **Head-to-head matchup intensities**:
  $$\mu = \frac{\text{GFg}_A \cdot \text{GAg}_B}{\text{GFg}_{\text{league}}}, \qquad \nu = \frac{\text{GAg}_A \cdot \text{GFg}_B}{\text{GFg}_{\text{league}}}$$
- **Sudden-death overtime**: Conditional on regulation tie ($z=0$), team $A$ wins OT with probability $\frac{\mu}{\mu + \nu}$ (or converges toward 50/50 in shootouts).
- **Empty-net endgame effect**: Pulling the goalie in 1-goal deficits artificially widens winning margins from 1 goal to 2+ goals—a minor factor we avoid overfitting by using PythagenPuck rather than raw goal-margin simulation.
- **Validation on BASH**: Remarkably, Ryder's Competing Poisson predicted a BASH Fall regulation tie (OT/SO) rate of **13.57%** vs. the observed **13.58%** (on matched non-blowout games)—confirming the Poisson tie structure works, even while overdispersion compresses the win-probability slope.

### 4.3 Tom Tippett (2002), *Playoff Odds* (`playoff2002.htm`, Diamond Mind Baseball)

Linked directly by Ken Roberts for head-to-head matchup conversion:
- **Bill James's Log5 Formula**: Given two teams' neutral-site strength ratings $A, B \in (0, 1)$ (expected winning percentage against an average `.500` opponent):
  $$P(A \text{ beats } B) = \frac{A(1 - B)}{A(1 - B) + B(1 - A)} = \frac{A - AB}{A + B - 2AB}$$
- **Empirical Verification**: Cited Tom Ruane's 1901–1997 Retrosheet validation confirming Log5 matches observed win rates across extreme mismatches without requiring full team-vs-team historical matrices.
- **Home-Field Advantage**: Tippett applied additive home-field adjustment (`+0.042` in MLB; Ken used `HomeFieldAdvantage` centered at `.500` via Log5 chaining or additive offset). Because BASH plays all games at a single venue (James Lick Middle School), `HFA = 0.50` (zero adjustment).
- **Caveats Noted by Tippett**: Assumes team strength is stationary (ignores mid-season trades/injuries) and outcomes are independent across games—caveats we explicitly document in our Methodology disclosure.

---

## 5. Deep Review of Ken Roberts's Blog (`blog.sportsclubstats.com`, 2007–2013)

We archived and read all **37 preserved blog posts (`p57`–`p493`)** plus **108 direct Q&A replies from Ken Roberts** on his Feedback page (`page6`). The engineering lessons directly shape our BASH implementation:

| Post / Comment | Date | Key Engineering Lesson & How BASH Applies It |
|---|---|---|
| `p59`, `p61`, `p62` | Feb–Mar 2007 | Early performance bottlenecks led Ken to rewrite his simulator in tight array-based C# loops (~6,000 NHL seasons/sec). **BASH application**: Pre-indexed `Int16Array`/`Float64Array` typed-array kernel runs 100k BASH seasons in ~100 ms. |
| `p73`, `p76`, `p243`, `#10400` | 2007–2009 | **What-If record tables** become noisy when `Count` is tiny; Ken unbucketed tables when `< 80` distinct records existed and flagged low-count rows. He also noted NHL's 3-point OT games created positive skew. **BASH advantage**: In BASH's **3-2-1** scoring system, *every* non-forfeit game awards exactly **3 total points** (zero 3-point OT skew!). |
| `p77`, `#9064` | 2007–2009 | **"Points Above .500" trend chart** (`+1 W, 0 OTL, -1 L` in NHL). **BASH equivalent**: `PTS - 1.5 × GP` (points above 1.5 pts/GP `.500` pace). |
| `p86`, `p328` | 2007, 2010 | Historical chart glitches occurred when Sports Club Stats had to rely on daily saved snapshots that broke whenever schedule edits or formula tweaks occurred. **BASH improvement**: Deterministic seeded replay of completed matchdays reconstructs exact matchday-over-matchday `Change` deltas and season timelines on demand with zero stale-history drift. |
| `p216`, `p225` | Feb–Mar 2009 | Switched default site view from 50/50 to **Weighted** (keeping 50/50 as secondary toggle) and published exact regression-to-mean C# code. **BASH application**: Default to **Weighted (BASH Calibrated)** with one-click toggle to **50/50** (and **SCS Classic** `Pts%` comparison). |
| `p270` | Mar 2009 | *"Are the Senators eliminated?"* — Monte Carlo uncovered a 3-in-50,000,000 multi-way tiebreaker path every sports journalist missed! Demonstrated both (a) the necessity of exact multi-way H2H tiebreakers and (b) that `0.0%` in finite MC is not strict mathematical elimination. **BASH improvement**: Implement exact Rule 213 multi-way H2H tiebreakers AND pair MC with deterministic clinch/elimination bounds so `In` / `Out` badges are mathematically verified, never Monte Carlo rounding artifacts (`>99.9%` / `<0.1%` used otherwise). |
| `#7019`, `#10872`, `#10964` (`GroupBigGames.html`) | 2008–Nov 2009 | **Breakthrough on Big Games**: Originally Ken re-ran the full simulation 3× per game and re-weighted team strengths—which caused a bug where *both* outcomes of a game looked negative due to cross-conference strength drift! In **Nov 2009 (`#10964`)**, he switched to **single-pass conditional tallying**: during the single main MC run, bucket every iteration's final playoff/seed results by the outcome of each upcoming game. Result: **4× faster, mathematically consistent, zero strength-drift artifacts**. |
| `#7023`, `#9432`, `GroupBigGames.html` | 2008–2009 | **Big Games Ranking & Noise Hygiene**: Sort games by $\sum_{\text{teams}} (\max_o P(\text{in}\mid o) - \min_o P(\text{in}\mid o))$; suppress noise swings `< 0.3%`; star (`*`) outcomes with too few MC hits; remind users that swings from multiple games on the same day are **non-additive**. |
| `#2145`, `#9680`, `#10662`, `#10674` | 2008–2009 | **Forced Win-Out / Lose-Out Tail Probing (`sidereal` fix)**: Forcing each team to win out or lose out in 1,000 runs populates extreme "What If" rows, *but* mixing those forced runs into the main tally biases probabilities (especially in a small 7-team league!). **BASH application**: Keep forced tail-probing runs strictly isolated from the main probability pool. |
| `#11120` | 2010 | **Probability Conservation Invariant**: $\sum_{\text{teams}} P(\text{make playoffs}) = \text{playoffSpots} \times 100\%$ and every seed column sums to `100.0%`. Enforced in our Vitest suite. |
| `p483`, `p493` | Apr 2013 | Final blog posts before site entered maintenance mode; highlighted user love for the "Who should we root for?" table and simple color-coded seed tables above all other features. |

---

## 6. BASH Empirical Calibration (2,126 Games) & 2018–2019 Historical Validation

We ran two read-only empirical calibration scripts across all non-forfeit BASH regular-season games in the Neon Postgres database (**1,573 Fall games** and **553 Summer games**):

### 6.1 League Structural Parameters

| Parameter | BASH Fall (5v5, 60 min) | BASH Summer (4v4, 45 min) | NHL Reference |
|---|---|---|---|
| **Home-Ice Advantage** | **49.32%** ($z = -0.53$, none) → `0.50` | **49.45%** ($z = -0.26$, none) → `0.50` | `0.54–0.56` |
| **Total Goals / Game** | **7.454** all-time (`6.998` modern 2018+) | **12.174** all-time (`13.372` modern 2018+) | `~5.5–6.2` |
| **Goal Overdispersion (`var/mean`)** | **1.633** (median `1.500`) | **1.604** (median `1.501`) | `~1.05–1.15` |
| **OT + Shootout Rate** | **12.97%** all-time (**11.69%** 2018+) | **10.49%** all-time (**8.72%** 2018+) | `~24.4%` (`12.0%` OT + `12.4%` SO) |
| **OT vs. Shootout Split (calibrated)** | **~7.5% OT / ~4.5% SO** (`12.0%` total) | **~5.5% OT / ~3.5% SO** (`9.0%` total) | `50/50` split |
| **Optimal PythagenPuck Power $P$ (LOSO CV)** | **$P = 0.22$** (with $m = 4$ goal prior) | **$P = 0.458$** (with $m = 4$ goal prior) | $P = 0.458$ ($E \approx 2.15$) |
| **Optimal EB Shrinkage Prior ($m, C$)** | **$m = 4$ goal prior, $C = 4$ EB games** (or $C = 10$ with $m = 0$) | **$m = 4$ goal prior, $C = 4$ EB games** (or $C = 8\text{–}10$ with $m = 0$) | Ken `p225` piecewise |
| **Bayesian Strength Concentration $k$** | **$k = 2$** (`80.3%` / `89.4%` interval coverage) | **$k = 3$** (`82.7%` / `92.0%` interval coverage) | Plug-in ($k = 0$) |

> **Why NHL `P = 0.458` fails on BASH Fall**: With 7.45 goals/game, $7.45^{0.458} \approx 2.51$—far too steep for an overdispersed league with `var/mean = 1.63`, causing $R^2$ vs. actual points% to collapse to `0.6922` (worse than fixed $E = 2.0$ at `0.8108`) and out-of-sample game Brier score to degrade to `0.2719` (worse than a coin flip!). Compressing to $P = 0.22$ yields $E = 7.45^{0.22} \approx 1.56$ and jumps $R^2$ to `0.8617`.

### 6.2 Nested Season-Blocked LOSO Cross-Validation (`minGp >= 1`, 2,107 Games, 54 Seasons)

To eliminate in-sample selection bias, we ran strict **season-blocked Leave-One-Season-Out (LOSO)** cross-validation across all 27 Fall seasons (`1,561` games) and 27 Summer seasons (`546` games) with SOWG stripped, evaluating 4-outcome Ranked Probability Score (RPS), 3-2-1 expected-points RMSE, binary Brier, and LogLoss under the decompressed + normalized extra-time model:

| Model (Nested LOSO Out-of-Sample) | Fall RPS | Fall Pts RMSE | Fall Brier | Summer RPS | Summer Pts RMSE | Summer Brier |
|---|---:|---:|---:|---:|---:|---:|
| **BASH Weighted Decompressed (`P, C, m` nested)** | **0.23515** | **1.3690** | **0.23832** | **0.23598** | **1.3941** | **0.23593** |
| BASH Weighted Decompressed (`m = 0` post-ratio only) | 0.23536 | 1.3697 | 0.23853 | 0.23649 | 1.3957 | 0.23645 |
| BASH Weighted Compressed (`m = 0`) | 0.23545 | 1.3700 | 0.23858 | 0.23654 | 1.3959 | 0.23660 |
| BASH EB Shrunk `Pts%` (nested `C`) | 0.23660 | 1.3737 | 0.23956 | 0.24074 | 1.4095 | 0.24119 |
| SCS Classic (Ken `p225` regression) | 0.23951 | 1.3826 | 0.24239 | 0.25636 | 1.4582 | 0.25521 |
| 50/50 Coin Flip | 0.24703 | 1.4078 | 0.25000 | 0.24857 | 1.4343 | 0.25000 |

- **Paired Season-Block Bootstrap (2,000 resamples)**: BASH Weighted beats `50/50` (`100.0%` Fall, `99.0%` Summer) and `SCS Classic` (`97.9%` Fall, `100.0%` Summer) at 95% confidence, and beats `EB Pts%` significantly in Summer (`97.7%`) while edging it out in Fall (`84.7%`).
- **Pre-Ratio Gamma-Poisson Shrinkage (`m = 4, C = 4`)**: Shrinking goals for/against toward the empirical league mean (`3.73` Fall, `6.13` Summer) before PythagenPuck improves all four metrics over post-ratio-only shrinkage in both Fall (`P = 0.22`) and Summer (`P = 0.458`) while cleanly eliminating shutout singularities.
- **Bayesian Strength Concentration (`strengthConcentration`)**: Without per-iteration Beta draws (`k = 0`), Fall remaining-season points% 80%/90% intervals severely under-cover (`71.2%` / `83.2%`). Calibrating `k = 2` (Fall) yields near-exact `80.3%` / `89.4%` coverage, and `k = 3` (Summer) yields `82.7%` / `92.0%`.
- **Empirical Regulation Margins**: Fall (`n = 1,357`) `regMarginCdf = [0.2174, 0.4149, 0.5976, 0.7406, 0.8305, 1.0]`, mean loser goals `2.04`; Summer (`n = 488`) `regMarginCdf = [0.2152, 0.3914, 0.5451, 0.6701, 0.7766, 1.0]`, mean loser goals `4.24`.

### 6.2b Original Sequential Backtest Reference (Both Teams $\ge 3$ GP)

Every model was evaluated strictly sequentially (predicting each game using *only* games played prior to that date):

| Model | Fall Brier ($N=1,281$) | Fall LogLoss | Fall Acc | Summer Brier ($N=347$) | Summer LogLoss | Summer Acc |
|---|---:|---:|---:|---:|---:|---:|
| **BASH Calibrated PythagenPuck + EB Shrinkage + Log5** (`P=0.22, C=10` / `P=0.37, C=6`) | **0.2369** | **0.6660** | **59.6%** | **0.2264** | **0.6443** | **62.5%** |
| BASH EB Shrunk `Pts%` + Log5 (`C=10` / `C=6`) | 0.2389 | 0.6704 | 58.5% | 0.2298 | 0.6510 | 61.1% |
| Ken Roberts Regressed `Pts%` (`p225`) + Log5 | 0.2415 | 0.6775 | 58.4% | 0.2314 | 0.6552 | 61.1% |
| Ryder Shrunk Competing Poisson (Skellam) | 0.2438 | 0.6857 | 59.3% | 0.2281 | 0.6479 | 62.0% |
| Ken Roberts Regressed PythagenPuck (`P=0.458 + p225`) | 0.2445 | 0.6890 | 59.1% | 0.2339 | 0.6615 | 61.7% |
| 50/50 Coin Flip | 0.2500 | 0.6931 | 49.4% | 0.2500 | 0.6931 | 49.4% |
| Ken Raw PythagenPuck (`P=0.458`, unregressed) | 0.2719 | 0.8048 | 59.3% | 0.2491 | 0.7224 | 61.4% |

### 6.3 Historical Validation: 2018–2019 BASH Snapshot (Feb 9, 2019; 39 Final, 24 Remaining)

Comparing our TypeScript engine (100,000 iterations) directly against the archived `BayAreaStreetHockey.html` capture from Wayback Machine:

| Team | Archived SCS (`Pts% + p225`) | Our SCS Replica (`Pts% + p225`, 83.5 ms) | BASH Calibrated (`Pyth P=0.22 + EB C=10`, 132.0 ms) | 50/50 Mode (130.3 ms) |
|---|---:|---:|---:|---:|
| **Kings** | `In` (Avg 1.4, Str `.737`) | `100.0%` (Avg 1.3, Str `.737`) | `100.0%` (Avg 1.3, Str `.672`) | `100.0%` (Avg 1.6) |
| **Yetis**\* | `100.0%` (Avg 2.2, Str `.669`) | `100.0%` (Avg 2.6, Str `.647`) | `100.0%` (Avg 2.6, Str `.580`) | `100.0%` (Avg 2.5) |
| **Red Army** | `100.0%` (Avg 2.9, Str `.624`) | `100.0%` (Avg 2.9, Str `.624`) | `100.0%` (Avg 3.0, Str `.562`) | `99.9%` (Avg 2.9) |
| **Rink Rats**\* | `100.0%` (Avg 3.5, Str `.579`) | `100.0%` (Avg 3.3, Str `.602`) | `100.0%` (Avg 3.1, Str `.583`) | `99.8%` (Avg 3.1) |
| **Landsharks** | **96.5%** (Avg 5.0, Str `.415`) | **96.6%** (Avg 5.0, Str `.415`) | **89.6%** (Avg 5.1, Str `.385`) | **85.7%** (Avg 5.0) |
| **Seals** | **3.0%** (Avg 6.2, Str `.263`) | **3.0%** (Avg 6.2, Str `.263`) | **7.2%** (Avg 6.3, Str `.351`) | **10.3%** (Avg 6.2) |
| **Haze** | **0.5%** (Avg 6.7, Str `.218`) | **0.4%** (Avg 6.7, Str `.218`) | **3.2%** (Avg 6.6, Str `.363`) | **4.3%** (Avg 6.6) |

*\*Note: On the Feb 9, 2019 Yetis vs. Rink-Rats 3–2 game, archived SCS recorded a regulation win (Yetis 24 pts / Rink-Rats 20 pts) whereas BASH's DB recorded OT (Yetis 23 pts / Rink-Rats 21 pts), accounting for the exact 1-point swap between Yetis and Rink-Rats. Every other team's Strength matches to 3 decimal places and Playoff % matches within 0.1%.*

Notice also the subtle intelligence of **BASH Calibrated (`PythagenPuck + EB`)** on that snapshot:
- Haze (`4 pts, GD -24`) had a meaningfully better goal differential than Seals (`6 pts, GD -36`), so BASH Calibrated rates Haze slightly stronger (`Str .363` vs `.351`) and gives both bubble chasers slightly more realistic upside (`7.2%` / `3.2%`) instead of overconfident tail collapse—and rates Rink-Rats (`GD +16`) ahead of Red Army (`GD +13`) in underlying strength (`.583` vs `.562`).

---

## 7. Official BASH Rules Captured for Exact Simulation Fidelity

From `public/bash_rulebook_current.md`:
1. **Scoring System (Rule 213)**: Regulation Win = `3 pts`, Overtime/Shootout Win = `2 pts`, Overtime/Shootout Loss = `1 pt`, Regulation Loss = `0 pts`. Forfeit win = `3 pts` (`5–0`); double forfeit = `0 pts` each (`0–5`).
2. **Tiebreaker Order (Rule 213)**:
   1. **Points (`PTS`)**
   2. **ROW**: Regulation + Overtime Wins (**Shootout wins explicitly excluded!**)
   3. **Head-to-Head (`H2H`)**: Percentage of available points earned in games played *among the tied clubs* (handles 2-way and 3+-way ties; if subset narrows, re-evaluates remaining tied clubs)
   4. **Goal Differential (`GD = GF - GA`)**
   5. **Goals For (`GF`)** → **Coin Flip / Draw Lots** (deterministic tiebreak per simulation iteration)
3. **Playoff Formats (Rules 412 & 219)**:
   - **7-Team Fall** (e.g., active `bash-2026-2027`, `playoffTeams = 5`): Top 5 qualify — **Seeds 1–3 earn a direct bye to the Semifinals**, while **Seeds 4 & 5 play a single Play-In game** for the 4th semifinal spot.
   - **6-Team Fall**: Top 4 qualify directly to Semifinals (`1v4`, `2v3`).
   - **Summer (Rule 219)**: All teams qualify for playoffs; the predictor focuses on **Seed 1–N distribution**, **Avg Seed**, and **Big Games for seeding/byes**.
