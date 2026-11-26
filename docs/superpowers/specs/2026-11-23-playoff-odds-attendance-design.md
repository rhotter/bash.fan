# PRD & Design Doc: Attendance Impact Model & Full-Strength Playoff Odds

**Date:** 2026-11-23  
**Branch:** `playoff-odds-update`  
**Status:** Implemented (Updated to promote Full-Strength to 4th Stats Model: `BASH Full-Strength Adj`)  

---

## 1. Intent & Why

In BASH, teams frequently play with short benches or unusually full benches, and players often wonder whether a team's record reflects its true talent or simply who showed up. Specifically:

1. **Quantify the attendance effect:** Measure across BASH's full regular-season history (split by Fall and Summer) how much roster attendance (distinct dressed players across skaters and goalies) impacts game outcomes after controlling for team strength.
2. **Separate talent from attendance:** Surface a **Full-Strength Rating** alongside each team's **Observed Strength (`Str`)** so users can tell whether a team is genuinely underperforming or simply short-benched (and conversely, spot teams boosted by big benches).
3. **Interactive What-Ifs:** Bring the calibrated attendance model into Playoff Odds What-If scenarios so users can test both season-wide full-strength projections and single-game short/full-bench matchups.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- Add empirically calibrated Fall and Summer attendance model parameters to `BASH_CALIBRATION` in `lib/playoff-odds.ts`.
- Fetch per-game dressed headcounts (distinct `player_id` union across `player_game_stats` and `goalie_game_stats`) in `lib/fetch-playoff-odds.ts` within the existing `Promise.all` database wave (zero extra round-trips).
- Compute and expose per-team `avgAttendance`, `attendanceTier` (`"low" | "avg" | "high"`), `fullStrength`, and `attendanceDelta` (`fullStrength - strength`) on `TeamOddsRow`.
- Add a 4th Stats Model **`BASH Full-Strength Adj`** (`mode = "full_strength"`, placed 2nd right after `BASH Weighted`) that simulates the season and full trajectory timeline using each team's `fullStrength` rating (supporting active and completed seasons + shareable `?mode=full_strength` URLs).
- Add per-game **`What-If Attendance`** attendance overrides (`Low / Avg / High`) on upcoming/Big Games in both `weighted` and `full_strength` modes inside the client-side 20,000-run Monte Carlo engine.
- Document the historical findings, percentiles, caveats, and formula in `components/playoff-odds-methodology.tsx`.

### Non-Goals
- **No change to baseline Playoff Odds:** Default playoff probabilities remain anchored to Observed Strength (`Str`), because a team's attendance habit tends to persist unless something changes.
- **No individual RSVP/roster prediction:** Future games do not attempt to predict which specific players will attend.
- **No attendance adjustments in `50_50` or `classic` modes:** `Full Str` projections and `What-If Attendance` overrides apply only in goal-weighted modes (`weighted` and `full_strength`, via `isGoalWeightedMode(mode)`); `avgAttendance` and `attendanceTier` are still displayed as informational stats.

### Anti-Goals
- Never leak attendance assumptions into default baseline odds by assuming short-benched teams automatically revert to league-average attendance.
- Never alter baseline `stateHash` PRNG seeds when historical boxscore attendance is backfilled or edited.
- Never apply Fall attendance thresholds (`9 / 11 / 13`) to Summer seasons (`7 / 9 / 11`).
- Never introduce sequential `neon-http` database queries in `lib/fetch-playoff-odds.ts` or `Math.log`/`Math.exp` calls inside the 20,000-iteration Monte Carlo hot loop.

---

## 3. Historical Data Findings & Model Evaluation

Analysis was performed across all final, non-forfeit, non-tie regular-season games with complete boxscores (`away_skaters > 0 AND home_skaters > 0`), counting dressed headcount as the **distinct `player_id` union** of `player_game_stats` and `goalie_game_stats` per `(game_id, team_slug)`. (Using the distinct union preserves multiple dressed goalies—since BASH teams with 2 goalies typically dress the second as a skater—while preventing double-counting a single player who appears in both tables as an emergency goalie.)

- **Fall:** 1,535 of 1,561 games (27 seasons)
- **Summer:** 498 of 546 games (24 seasons)

### 3.1 Attendance Percentiles & Bucket Outcomes (20th / 50th / 80th)

| Season | 20th (Low) | 50th (Avg) | 80th (High) | Overall Mean |
| :--- | :---: | :---: | :---: | :---: |
| **Fall** (`n = 3,071` team-games) | **9** | **11** | **13** | 11.16 |
| **Summer** (`n = 996` team-games) | **7** | **9** | **11** | 8.91 |

Using `≤ p20` (Low), `p20–p80` (Avg), and `≥ p80` (High):

- **Fall:**
  - **Low (`≤ 9`):** avg **8.30** players → **38.7%** win rate, **−1.33** goal diff (`n = 662`)
  - **Avg (`10–12`):** avg **11.01** players → **51.1%** win rate, **+0.25** goal diff (`n = 1,598`)
  - **High (`≥ 13`):** avg **13.80** players → **57.2%** win rate, **+0.59** goal diff (`n = 810`)
- **Summer:**
  - **Low (`≤ 7`):** avg **6.02** players → **38.8%** win rate, **−0.99** goal diff (`n = 242`)
  - **Avg (`8–10`):** avg **9.03** players → **52.3%** win rate, **+0.16** goal diff (`n = 533`)
  - **High (`≥ 11`):** avg **11.77** players → **56.6%** win rate, **+0.69** goal diff (`n = 221`)

### 3.2 Independent Predictive Signal (Controlling for Team Strength)

Comparing matchup headcount differential (`home_att − away_att`) against season win% differential shows a strong independent association even when teams are nearly evenly matched:
- **Fall:** Away `+3+` → Home wins **33.6%** (`−3.9%` strength diff) · Even → **49.8%** · Home `+3+` → **64.7%** (`+3.8%` strength diff).
- **Summer:** Away `+3+` → Home wins **32.4%** (`−7.1%` strength diff) · Even → **49.4%** · Home `+3+` → **66.3%** (`−0.1%` strength diff).

Exact-headcount residuals against strength-expected win% in Fall also reveal strong **diminishing returns**:
- **6 players** (`n=22`): 9.1% actual vs. 46.3% expected (**−37.2 pp**)
- **7 players** (`n=87`): 32.2% vs. 48.0% (**−15.9 pp**)
- **8 players** (`n=194`): 38.7% vs. 48.0% (**−9.3 pp**)
- **9 players** (`n=352`): 42.6% vs. 48.9% (**−6.3 pp**)
- **11 players** (`n=607`): 55.5% vs. 50.4% (**+5.1 pp**)
- **13–15 players**: plateaus around **+6.8 to +7.5 pp**

**Statistical caveats:** Because this is observational data, part of the fitted attendance slope can reflect unmodeled confounders—such as late-season morale/elimination (where slumping teams have lower turnout and lower effort), missing top scorers/starting goalies, and substitute players (`is_sub = true`) who may differ from rostered regulars. `fullStrength` is therefore framed as a diagnostic estimator of performance at even headcounts rather than a purely causal treatment effect.

### 3.3 Leave-One-Season-Out (LOSO) Cross-Validation & Fitted Slopes

Using **prior-to-game** rolling PythagenPuck strength (`ebShrinkageGames = 4`, `goalPriorGames = 4`) to avoid hindsight leakage:

| Season | Model | Log-Loss | Brier | Accuracy |
| :--- | :--- | :---: | :---: | :---: |
| **Fall** (`n=1,535`) | Baseline (no attendance) | 0.67178 | 0.23968 | 57.20% |
| **Fall** (`n=1,535`) | 3-Bucket (`≤9 / 10–12 / ≥13`) | 0.65670 | 0.23245 | 60.72% |
| **Fall** (`n=1,535`) | Linear (`home_att − away_att`) | 0.65344 | 0.23088 | 62.08% |
| **Fall** (`n=1,535`) | **Log (`ln(home_att) − ln(away_att)`)** | **0.65169** | **0.23012** | **62.15%** |
| **Summer** (`n=498`) | Baseline (no attendance) | 0.67039 | 0.23889 | 55.02% |
| **Summer** (`n=498`) | 3-Bucket (`≤7 / 8–10 / ≥11`) | 0.65362 | 0.23197 | 56.63% |
| **Summer** (`n=498`) | **Linear (`home_att − away_att`)** | **0.65083** | **0.23050** | **59.44%** |
| **Summer** (`n=498`) | Log (`ln(home_att) − ln(away_att)`) | 0.65189 | 0.23059 | 59.44% |

Fitted slopes on distinct-union headcounts (`ln(homeAtt / awayAtt)` controlling for prior-to-game `strDiff`):
- **Fall:** Logistic win-odds slope `logOddsSlope = 1.703`; OLS goal-differential slope `goalDiffSlope = 3.882` goals.
- **Summer:** Logistic win-odds slope `logOddsSlope = 1.276`; OLS goal-differential slope `goalDiffSlope = 2.747` goals.

The continuous `ln(att)` curve outperforms the 3-bucket model on every metric (+1.43 pp accuracy in Fall, +2.81 pp in Summer) and naturally captures the diminishing returns above 13 players in Fall.

---

## 4. Considered Approaches

### Approach A: Continuous `ln(att)` Model + Full-Strength Diagnostics, 4th Stats Model & Matchup What-Ifs *(Selected)*
- **Design:** Fit continuous `ln(home_att / away_att)` slopes in `BASH_CALIBRATION`, compute `fullStrength` via goal-rate de-attending fed through `computeWeightedStrength()`, expose **`BASH Full-Strength Adj`** (`mode = "full_strength"`, 2nd Stats Model option) for full-season simulation & timeline replays, and provide per-game **`What-If Attendance`** (`Low / Avg / High`) overrides on Big Games (mapped to empirical 20th/50th/80th bucket averages).
- **Tradeoff:** Slightly richer What-If state and UI, but captures diminishing returns accurately (e.g., 6 vs. 9 players) and answers both season-long and single-game questions in the existing client-side simulator.

### Approach B: 3-Bucket Model + Diagnostic Columns & Global Full-Strength Toggle *(Rejected)*
- **Design:** Fixed adjustments for `Low / Avg / High` buckets with only a global Full-Strength toggle.
- **Tradeoff:** Simpler UI, but coarser predictions (treats 6 players identically to 9 in Fall, losing 1.4–2.8 pp out-of-sample accuracy) and cannot test single-game attendance scenarios.

### Approach C: Continuous Model + Diagnostic Columns & Per-Game Picker Only *(Rejected)*
- **Design:** Continuous `ln(att)` model with `Full Str` diagnostics, but attendance overrides only on individual Big Games.
- **Tradeoff:** Good for single-game prep, but cannot answer the season-long question ("what are our playoff odds if we stop playing short-benched?").

---

## 5. Architecture & Technical Design

### 5.1 Types & Calibration (`lib/playoff-odds-types.ts`, `lib/playoff-odds.ts`)

1. **`PlayoffOddsMode` & Helpers**: `"weighted" | "full_strength" | "50_50" | "classic"` with `isValidPlayoffOddsMode()` and `isGoalWeightedMode(mode)` (`weighted` or `full_strength`).
2. **`AttendanceTier`**: `"low" | "avg" | "high"`
2. **`AttendanceCalibration`** on `CalibrationProfile`:
   - `lowP20: number` (Fall: `9`, Summer: `7`)
   - `medianP50: number` (Fall: `11`, Summer: `9`)
   - `highP80: number` (Fall: `13`, Summer: `11`)
   - `presetHeadcounts: Record<AttendanceTier, number>` (Fall: `{ low: 8.3, avg: 11.0, high: 13.8 }`; Summer: `{ low: 6.0, avg: 9.0, high: 11.8 }`)
   - `logOddsSlope: number` (Fall: `1.703`, Summer: `1.276`) — used for per-game What-If win-probability shifts
   - `goalDiffSlope: number` (Fall: `3.882`, Summer: `2.747`) — used for goal-rate de-attending in `fullStrength`
3. **`PlayoffSimGame`** additions:
   - `awayAttendance?: number | null`
   - `homeAttendance?: number | null`
4. **`TeamOddsRow`** additions:
   - `avgAttendance: number | null` (mean dressed players across played non-forfeit regular-season games with boxscores; `null` if none)
   - `attendanceTier: AttendanceTier | null` (`"low"` if `avgAttendance <= lowP20`, `"high"` if `>= highP80`, else `"avg"`; `null` if `avgAttendance === null`)
   - `fullStrength: number` (attendance-neutral team strength rating in `[0.05, 0.95]`, equal to `strength` when no boxscore attendance exists)
   - `attendanceDelta: number` (`fullStrength - strength`; positive = team was penalized by short benches)

### 5.2 Computing `fullStrength` via Goal-Rate De-Attending (`lib/playoff-odds.ts`)

To avoid any link-function or double-shrinkage scale mismatch with `computeWeightedStrength()`, `fullStrength` is computed in the **same PythagenPuck + Empirical Bayes estimator space** as `strength`:

- For each played, non-forfeit regular-season game of a team (using real completed games from `strengthState`, never What-If locked games):
  - If both `teamAtt > 0` and `oppAtt > 0`:
    - `attGd = calibration.attendance.goalDiffSlope * Math.log(teamAtt / oppAtt)`
    - Split symmetrically to preserve total game goals (`GF + GA`):
      - `adjGf = Math.max(0, gf - 0.5 * attGd)`
      - `adjGa = Math.max(0, ga + 0.5 * attGd)`
  - Otherwise (missing boxscore on either side): `adjGf = gf`, `adjGa = ga`.
- Sum `adjGf` and `adjGa` across all played non-forfeit games and pass `(adjGfPlayed, adjGaPlayed, gpPlayed, calibration)` into `computeWeightedStrength()`.
- Result: `fullStrength = weightedAdj.strength`, `attendanceDelta = fullStrength - strength`.
- When a team has `0` games with valid two-sided boxscores, `adjGfPlayed === gfPlayed` and `adjGaPlayed === gaPlayed`, guaranteeing `fullStrength === strength` and `attendanceDelta === 0`.

### 5.3 Data Fetching (`lib/fetch-playoff-odds.ts`)

Extend the existing `Promise.all` wave in `fetchPlayoffOdds()` with a 3rd parallel query (zero extra `neon-http` round-trips):
- Join `games g` on `g.season_id = ${season.id} AND g.status = 'final' AND g.id NOT LIKE 'test-%' AND COALESCE(g.game_type, 'regular') = 'regular' AND NOT g.is_playoff AND NOT g.is_forfeit`.
- Filter `team_slug IS NOT NULL` on both `player_game_stats` and `goalie_game_stats`.
- Count `skaters` from `player_game_stats` per `(game_id, team_slug)` and `dressed` via `UNION ALL` + `COUNT(DISTINCT player_id)` across `player_game_stats` and `goalie_game_stats`.
- Populate `awayAttendance` / `homeAttendance` with `dressed` whenever `skaters > 0` for that side; otherwise `null`.

### 5.4 Full-Strength Mode, What-If Simulation & Hot-Loop Performance (`lib/playoff-odds.ts`)

- **`mode: "full_strength"` (`BASH Full-Strength Adj`):** `runCoreSimulation` and `buildTimeline` use `fullStrengths` for `extraNorm` (100-draw pre-loop Beta expectation), `preGames`, and `drawIterationStrengths`, while `TeamOddsRow.strength` still reports real Observed Strength so `Str` vs. `Full Str` remains visible.
- **`gameAttendanceOverrides?: Record<string, GameAttendanceOverride>`** on `ComputePlayoffOddsOptions` — active in both `weighted` and `full_strength` modes (`isGoalWeightedMode(mode)`), composing additively with `full_strength`.
- **Hot-loop optimization (`fillAllGameCdfs`):** Precompute a flat `Float64Array(G)` of odds multipliers once before the 20,000-iteration loop:
  - For each remaining game `g`, resolve `away = ov.away ?? "avg"` and `home = ov.home ?? "avg"`; if `away !== home`, `m = Math.exp(logOddsSlope * Math.log(homePreset / awayPreset))`; else `m = 1`.
  - Inside `fillAllGameCdfs`, compute `p = log5(teamStrength[homeIdx], teamStrength[awayIdx])`; if `m !== 1`, apply `p = (p * m) / (p * m + (1 - p))`. Zero `Math.log`/`Math.exp` calls inside the hot loop.
- **`stateHash` determinism:** Never include raw `awayAttendance`/`homeAttendance` in the baseline `stateHash`. Canonicalize active remaining-game `gameAttendanceOverrides` (`away = ov.away ?? "avg"`, `home = ov.home ?? "avg"`), drop net-neutral entries (`away === home`), and append sorted `att:${gid}:${away}:${home}` entries to `sigParts` in `weighted`/`full_strength` modes.

### 5.5 UI & State Management (`components/playoff-odds-*.tsx`, `components/team-odds-panel.tsx`)

- **`PlayoffOddsView` What-If state invariants:**
  - Gate `What-If Attendance` overrides on `isGoalWeightedMode(effectiveMode)` (where `effectiveMode = baselineMatchesRequest ? mode : (baselineSnapshot?.mode ?? mode)`), clearing `attendanceOverrides` when switching to `50_50` or `classic`.
  - Separate visual pill state (`uiAttendanceOverrides`) from net non-neutral simulation overrides (`effectiveAttendanceOverrides`, where `(ov.away ?? "avg") !== (ov.home ?? "avg")`) so equal-tier / `Avg` clicks never trigger spurious 20k re-simulations or a misleading What-If banner.
  - Locking a game's outcome (`handleToggleOutcome`) clears any attendance override on that game; locked games disable/dim the `What-If Attendance` control.
  - Use `hasWhatIf = lockedCount > 0 || attendanceOverrideCount > 0` consistently across `activeSnapshot`, `baselineTeamsBySlug`, the What-If banner, season-switch reset, and `"Reset What-If"`.
- **`PlayoffOddsTable` (`Record & strength` group) & `TeamOddsPanel`:**
  - Show `Att` (`8.3` or `—`, rendering neutral `Low` / `High` badges only — omitting the redundant `Avg` badge while keeping it in tooltips) and `Full Str` (`.xxx` with delta vs. `Str`; non-sortable `"—"` in `50_50`/`classic`).
  - In `TeamOddsPanel`, replace the `Schedule` scorecard with an **`Attendance`** scorecard (average bench size, `Low`/`High`-only badge, and `Wins` vs. `Losses` average attendance splits) and display `Full Str` inside `Rating & Pace` so mobile users can inspect it directly.
  - Tooltip copy: `"Full-Strength Rating: projected strength at even headcounts (team = opponent)."`
- **`PlayoffOddsFilterBar` & `BigGamesSection`:**
  - Add **`BASH Full-Strength Adj`** (`mode = "full_strength"`) as the 2nd Stats Model option right after `BASH Weighted` (`BASH Weighted`, `BASH Full-Strength Adj`, `50/50`, `SCS Classic`).
  - On each upcoming Big Game card (in `weighted` or `full_strength` mode, when unlocked), place the expandable **`What-If Attendance`** button inline beside `What-If Outcome` on desktop (`sm+`) and right-aligned on the playoff-swing row on mobile (`< sm`); the expanded `[Low | Avg | High]` picker hides team names and descriptive text on mobile so each 3-button group aligns cleanly under the Away/Home `[Reg | OT]` controls above.
- **`PlayoffOddsMethodology` & `/about/playoff-odd-calculations`:**
  - Document the 4 simulation modes, Fall (`9 / 11 / 13`) and Summer (`7 / 9 / 11`) percentiles, diminishing-returns `ln(att)` curve, symmetric goal-rate de-attending, and observational caveats (morale/elimination, player quality, subs).

---

## 6. Verification Plan

1. **Unit & Fetch tests (`lib/__tests__/playoff-odds.test.ts`, `tests/fetch-playoff-odds-attendance.test.ts`):**
   - `fullStrength > strength` when a team plays short-benched (`teamAtt < oppAtt`), and `fullStrength < strength` when consistently outnumbering opponents, with total goals (`GF + GA`) preserved.
   - Missing or one-sided boxscores cleanly fall back to `fullStrength === strength` and `avgAttendance === null` (when 0 boxscores).
   - Baseline `stateHash` and baseline `playoffPct` are bit-identical with or without boxscore attendance populated; canonical/no-op overrides (`{ away: "low" }` vs `{ away: "low", home: "avg" }`, equal tiers) never perturb `stateHash`.
   - Fall vs. Summer thresholds (`9/11/13` vs `7/9/11`) and slopes are applied per `seasonType`.
   - `mode: "full_strength"` and `gameAttendanceOverrides` deterministically shift simulated playoff odds, compose additively, preserve displayed Observed `strength`, and overrides are ignored in `50_50` / `classic`.
   - `fetchPlayoffOdds()` runs 3 parallel `rawSql` queries in one `Promise.all` wave and populates `awayAttendance`/`homeAttendance` cleanly.
2. **UI & API tests (`tests/playoff-odds-ui.test.tsx`):**
   - `GET /api/bash/playoff-odds?mode=full_strength` returns 200 and passes `"full_strength"` to `fetchPlayoffOddsPageData`.
   - `PlayoffOddsTable` renders `Att` (`Low`/`High`-only badges) and `Full Str`, and `TeamOddsPanel` renders the `Attendance` scorecard (Wins/Losses splits + null fallback) and mobile-accessible `Full Str`.
   - Switching to `BASH Full-Strength Adj` and applying `What-If Attendance` overrides updates odds & banner, resets cleanly, disables overrides on locked games, ignores net-neutral overrides, and clears/hides controls when switching to `50_50` / `classic`.
3. **Regression checks:** `pnpm test:run --maxWorkers=4`, `pnpm lint`, and `pnpm build`.
