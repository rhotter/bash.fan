# Attendance Impact Model & Full-Strength Playoff Odds Implementation Plan

> **Status: Implemented (with post-plan UX & model promotions).**
> After completing Tasks 1–4, the feature was refined per user review:
> - **Full-Strength promoted to a 4th Stats Model** (`mode = "full_strength"`, labeled **`BASH Full-Strength Adj`**) instead of a filter-bar toggle; dead `useFullStrength` option removed so `mode: "full_strength"` is the sole Full-Strength simulation path (with server-cached snapshots + full historical timeline replay).
> - **Big Games attendance picker renamed to `What-If Attendance`**, placed inline beside `What-If Outcome` on desktop (`sm+`), right-aligned on the playoff-swing row on mobile (`< sm`), and simplified on mobile (team names and descriptive caption hidden). Net-neutral selections (`Avg` alone or equal tiers `Low`/`Low`, `High`/`High`) are treated as no-ops.
> - **`Low`/`High`-only tier badges**: Omitted the redundant `Avg` badge from `PlayoffOddsTable` and `TeamOddsPanel` (retained in tooltips).
> - **Team View `Attendance` scorecard**: Replaced the 4th scorecard (`Schedule`) in `TeamOddsPanel` with `Attendance` (avg dressed headcount, `Low`/`High`-only badge, and Wins vs. Losses avg attendance), and surfaced `Full Str` in `Rating & Pace` for mobile visibility.
> - See the updated spec in [docs/superpowers/specs/2026-11-23-playoff-odds-attendance-design.md](../specs/2026-11-23-playoff-odds-attendance-design.md) for the exact landed design.

**Goal:** Add an empirically calibrated Fall/Summer attendance model to Playoff Odds that computes each team's `avgAttendance`, `attendanceTier`, and `fullStrength` rating via goal-rate de-attending, plus client-side Full-Strength and per-game `Bench What-If` controls in `weighted` mode.

**Architecture:** `lib/fetch-playoff-odds.ts` fetches distinct-player dressed counts (`player_game_stats ∪ goalie_game_stats`) in its existing `Promise.all` wave and attaches `awayAttendance`/`homeAttendance` to `PlayoffSimGame`. `lib/playoff-odds.ts` computes `fullStrength` by symmetrically de-attending each played game's `GF`/`GA` and passing them through `computeWeightedStrength()`, and supports additive `useFullStrength` + `gameAttendanceOverrides` What-If simulation using precomputed `Float64Array` odds multipliers in the Monte Carlo hot loop. The UI surfaces `Att` and `Full Str` in `PlayoffOddsTable`, adds a "Full-Strength What-If" toggle and collapsible Big Games `"Bench What-If"` pickers in `weighted` mode, and documents the methodology.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Drizzle ORM (`neon-http` + `rawSql`), Tailwind CSS v4, Vitest + React Testing Library.

**Spec:** [docs/superpowers/specs/2026-11-23-playoff-odds-attendance-design.md](../specs/2026-11-23-playoff-odds-attendance-design.md)

## Global Constraints

- Baseline playoff odds MUST remain anchored to Observed Strength (`strength`) and bit-identical (`stateHash` must NOT include raw `awayAttendance`/`homeAttendance`).
- Fall calibration: `lowP20 = 9`, `medianP50 = 11`, `highP80 = 13`, `presetHeadcounts = { low: 8.3, avg: 11.0, high: 13.8 }`, `logOddsSlope = 1.703`, `goalDiffSlope = 3.882`.
- Summer calibration: `lowP20 = 7`, `medianP50 = 9`, `highP80 = 11`, `presetHeadcounts = { low: 6.0, avg: 9.0, high: 11.8 }`, `logOddsSlope = 1.276`, `goalDiffSlope = 2.747`.
- Dressed headcount = distinct `player_id` union of `player_game_stats` and `goalie_game_stats` per `(game_id, team_slug)` where `team_slug IS NOT NULL` (populated only when `skaters > 0`; never cap goalies at 1).
- Zero extra `neon-http` DB round-trips in `fetchPlayoffOdds()` (parallel `Promise.all` wave only).
- Zero `Math.log`/`Math.exp` calls inside the 20,000-iteration `fillAllGameCdfs()` hot loop.
- Attendance What-Ifs (`useFullStrength` and `gameAttendanceOverrides`) apply ONLY in `weighted` mode; neutral theme tokens (`text-foreground`, `text-muted-foreground`, `bg-muted`, `border-border`) for informational UI per `AGENTS.md`.
- Do NOT commit automatically unless explicitly requested by the user (global rule overrides plan commit reminders; stage or leave uncommitted for review unless told otherwise).

## Review Focus

1. **One-sided or missing boxscore games (`awayAttendance > 0` while `homeAttendance === null`):** `avgAttendance` includes the side that has a boxscore, while `fullStrength` leaves that game's `GF`/`GA` unadjusted (requires both sides `> 0`) and never produces `NaN`/`Infinity`. (Pinned in Task 1)
2. **Baseline `stateHash` invariance when boxscore attendance is backfilled:** Identical schedules with `awayAttendance`/`homeAttendance` populated vs. omitted must produce the exact same `stateHash` and `playoffPct`. (Pinned in Task 1)
3. **Mode switching while attendance What-Ifs are active:** Enabling `useFullStrength` or a game attendance override in `weighted` mode and switching to `50_50` or `classic` must not run What-If simulation or show the What-If banner. (Pinned in Task 4)
4. **Locking an outcome on a game that already has an attendance override:** Locking the game clears its attendance override and disables the `"Bench What-If"` control so the UI never displays a no-op override. (Pinned in Task 4)
5. **Displayed `TeamOddsRow.strength` while `useFullStrength` is active:** `TeamOddsRow.strength` must still report Observed Strength (never overwritten by `fullStrength`) so `Str` vs. `Full Str` remains distinguishable. (Pinned in Task 1)

---

### Task 1: Attendance Types, Calibration, `fullStrength` & What-If Engine

**Files:**
- Modify: `lib/playoff-odds-types.ts:1-65,102-145`
- Modify: `lib/playoff-odds.ts:38-70,1391-1577,2388-2590`
- Test: `lib/__tests__/playoff-odds.test.ts`

**Interfaces:**
- Produces in `lib/playoff-odds-types.ts`:
  - `export type AttendanceTier = "low" | "avg" | "high"`
  - `export interface AttendanceCalibration { lowP20: number; medianP50: number; highP80: number; presetHeadcounts: Record<AttendanceTier, number>; logOddsSlope: number; goalDiffSlope: number }`
  - `export interface GameAttendanceOverride { away?: AttendanceTier; home?: AttendanceTier }`
  - `CalibrationProfile.attendance: AttendanceCalibration`
  - `PlayoffSimGame.awayAttendance?: number | null`, `PlayoffSimGame.homeAttendance?: number | null`
  - `TeamOddsRow.avgAttendance: number | null`, `TeamOddsRow.attendanceTier: AttendanceTier | null`, `TeamOddsRow.fullStrength: number`, `TeamOddsRow.attendanceDelta: number`
- Produces in `lib/playoff-odds.ts`:
  - `ComputePlayoffOddsOptions.useFullStrength?: boolean`
  - `ComputePlayoffOddsOptions.gameAttendanceOverrides?: Record<string, GameAttendanceOverride>`
  - `BASH_CALIBRATION.fall.attendance` and `BASH_CALIBRATION.summer.attendance`

- [x] **Step 1: Write failing unit tests in `lib/__tests__/playoff-odds.test.ts`**

Add a `describe("Attendance Impact & Full-Strength Rating", ...)` block testing:
1. Short-benched team (`awayAttendance = 8`, `homeAttendance = 13` in Fall) gets `avgAttendance = 8`, `attendanceTier = "low"`, `fullStrength > strength`, `attendanceDelta > 0`, and opponent gets `fullStrength < strength`.
2. Missing boxscores (`undefined`/`null`) and one-sided boxscores (`awayAttendance = 9`, `homeAttendance = null`) produce no `NaN`, keep `fullStrength === strength` when no two-sided boxscore exists, and still compute `avgAttendance = 9` for the side that had data.
3. Baseline `stateHash` and `playoffPct` are bit-identical whether `awayAttendance`/`homeAttendance` are populated or omitted.
4. Summer season uses Summer thresholds (`7 / 9 / 11` -> `avgAttendance = 7` is `"low"`, `11` is `"high"`) and Summer slopes (`2.747` / `1.276`).
5. `useFullStrength: true` in `weighted` mode shifts `playoffPct` for short-benched teams while keeping `TeamOddsRow.strength` equal to Observed Strength (not overwritten by `fullStrength`), and changes `stateHash`.
6. `gameAttendanceOverrides: { [gid]: { away: "low", home: "high" } }` increases home team's `playoffPct` in `weighted` mode, composes additively with `useFullStrength: true`, and is completely ignored (identical `playoffPct` and `stateHash`) in `50_50` and `classic` modes.

- [x] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/playoff-odds-update && pnpm vitest run lib/__tests__/playoff-odds.test.ts`
Expected: FAIL (missing `avgAttendance`, `fullStrength`, `useFullStrength`, `gameAttendanceOverrides`).

- [x] **Step 3: Add attendance types to `lib/playoff-odds-types.ts`**

Add `AttendanceTier`, `AttendanceCalibration`, `GameAttendanceOverride`, `CalibrationProfile.attendance`, `PlayoffSimGame.awayAttendance`/`homeAttendance`, and `TeamOddsRow.avgAttendance`/`attendanceTier`/`fullStrength`/`attendanceDelta`.

- [x] **Step 4: Implement calibration, `fullStrength`, and hot-loop What-Ifs in `lib/playoff-odds.ts`**

- Add `attendance` blocks to `BASH_CALIBRATION.fall` and `BASH_CALIBRATION.summer` with the exact Global Constraints values.
- In `parseSeasonState()` (or a helper `computeTeamAttendanceMetrics(strengthState, calibration)`), for each team across real played non-forfeit games:
  - Track `attSum` and `attCount` from each game where that team's own attendance `> 0` (`avgAttendance = attCount > 0 ? round1(attSum / attCount) : null`; classify `attendanceTier` via `<= lowP20` -> `"low"`, `>= highP80` -> `"high"`, else `"avg"`).
  - Track `adjGfPlayed` and `adjGaPlayed`: when both `teamAtt > 0 && oppAtt > 0`, compute `attGd = calibration.attendance.goalDiffSlope * Math.log(teamAtt / oppAtt)`, `adjGf = Math.max(0, gf - 0.5 * attGd)`, `adjGa = Math.max(0, ga + 0.5 * attGd)`; otherwise use raw `gf`/`ga`.
  - Compute `fullStrength = computeWeightedStrength(adjGfPlayed, adjGaPlayed, gpPlayed, calibration).strength` and `attendanceDelta = round3(fullStrength - observedStrength)`.
- In `computePlayoffOdds()`:
  - Gate `effectiveUseFullStrength = mode === "weighted" && Boolean(useFullStrength)` and `effectiveAttOverrides = mode === "weighted" ? gameAttendanceOverrides : undefined`.
  - Append `useFullStrength` and sorted active `gameAttendanceOverrides` entries (only for remaining non-locked games) to `sigParts` for `stateHash`; do NOT include `g.awayAttendance`/`g.homeAttendance`.
- In `runCoreSimulation()`:
  - Keep `observedStrengths` for `TeamOddsRow.strength`; use `simStrengths = effectiveUseFullStrength ? fullStrengths : observedStrengths` for `computeExtraTimeNorm`, `preGames`, and `drawIterationStrengths`.
  - Precompute `const gameAttMult = new Float64Array(G).fill(1)` before the loop: for each remaining game `g` with an override in `effectiveAttOverrides`, set `gameAttMult[g] = Math.exp(logOddsSlope * Math.log(homePreset / awayPreset))`.
  - Inside `fillAllGameCdfs()`, compute `let p = log5(teamStrength[game.homeIdx], teamStrength[game.awayIdx])`; if `gameAttMult[g] !== 1`, set `const m = gameAttMult[g]; p = (p * m) / (p * m + (1 - p))`. Apply the same shift when computing `preGames[g].homeWinProb`.

- [x] **Step 5: Run tests to verify they pass**

Run: `cd .worktrees/playoff-odds-update && pnpm vitest run lib/__tests__/playoff-odds.test.ts`
Expected: PASS (all existing + new attendance tests green).

---

### Task 2: Parallel Boxscore Attendance Query in `lib/fetch-playoff-odds.ts`

**Files:**
- Modify: `lib/fetch-playoff-odds.ts:45-136`
- Test: `tests/fetch-playoff-odds-attendance.test.ts` (Create)

**Interfaces:**
- Consumes: `PlayoffSimGame.awayAttendance`, `PlayoffSimGame.homeAttendance` (Task 1)
- Produces: `fetchPlayoffOdds()` populating `awayAttendance` and `homeAttendance` on final regular-season `PlayoffSimGame` records in the existing `Promise.all` wave.

- [x] **Step 1: Write failing test in `tests/fetch-playoff-odds-attendance.test.ts`**

Mock `@/lib/db` (`rawSql`) and `@/lib/seasons` to verify:
1. `fetchPlayoffOdds()` issues all DB reads in one parallel `Promise.all` wave (3 `rawSql` calls total: schedule, teamColors, attendance).
2. Final regular-season games receive `awayAttendance` / `homeAttendance` from the attendance query when `skaters > 0`, and `null` when missing or `skaters === 0`; upcoming games have `awayAttendance: null, homeAttendance: null`.
3. Returned `snapshot.teams` reflects computed `avgAttendance`, `attendanceTier`, and `fullStrength`.

- [x] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/playoff-odds-update && pnpm vitest run tests/fetch-playoff-odds-attendance.test.ts`
Expected: FAIL (`rawSql` called 2 times instead of 3; `awayAttendance` undefined).

- [x] **Step 3: Add 3rd parallel query to `fetchPlayoffOdds()` in `lib/fetch-playoff-odds.ts`**

Inside the existing `Promise.all([...])`, add a `rawSql` query joining `games g` (`WHERE g.season_id = ${season.id} AND g.status = 'final' AND g.id NOT LIKE 'test-%' AND COALESCE(g.game_type, 'regular') = 'regular' AND NOT g.is_playoff`) that computes:
- `skaters`: `COUNT(DISTINCT player_id)` from `player_game_stats` where `team_slug IS NOT NULL`
- `dressed`: `COUNT(*)` from the `UNION` of `(game_id, team_slug, player_id)` across `player_game_stats` and `goalie_game_stats` where `team_slug IS NOT NULL`
Build a `Map<string, number>` keyed by `${game_id}|${team_slug}` (only inserting when `Number(skaters) > 0`), and set `awayAttendance` / `homeAttendance` (or `null`) on each `PlayoffSimGame`.

- [x] **Step 4: Run test to verify it passes**

Run: `cd .worktrees/playoff-odds-update && pnpm vitest run tests/fetch-playoff-odds-attendance.test.ts`
Expected: PASS.

---

### Task 3: Table Diagnostics (`Att` & `Full Str`) and Methodology Docs

**Files:**
- Modify: `components/playoff-odds-table.tsx:10,130-150,390-460,655-685`
- Modify: `components/playoff-odds-methodology.tsx:30-140`
- Test: `tests/playoff-odds-ui.test.tsx`

**Interfaces:**
- Consumes: `TeamOddsRow.avgAttendance`, `TeamOddsRow.attendanceTier`, `TeamOddsRow.fullStrength`, `TeamOddsRow.attendanceDelta`, `CalibrationProfile.attendance` (Task 1)
- Produces: Sortable `Att` and `Full Str` columns in `PlayoffOddsTable` (`Record & strength` group) and the Attendance Impact section in `PlayoffOddsMethodology`.

- [x] **Step 1: Write failing UI tests in `tests/playoff-odds-ui.test.tsx`**

Add tests asserting:
1. In `Record & strength` view, `PlayoffOddsTable` renders `Att` (e.g. `8.3` with `Low` indicator, or `—` when `avgAttendance === null`) and `Full Str` (e.g. `.542` with `+0.042` delta tooltip: `"Full-Strength Rating: projected strength at even headcounts (team = opponent)."`).
2. `PlayoffOddsMethodology` renders the `"Attendance impact & full-strength rating"` section displaying the season's 20th/50th/80th thresholds (`9 / 11 / 13` for Fall, `7 / 9 / 11` for Summer) and observational caveats.

- [x] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/playoff-odds-update && pnpm vitest run tests/playoff-odds-ui.test.tsx`
Expected: FAIL (missing `Att` / `Full Str` columns and methodology copy).

- [x] **Step 3: Update `components/playoff-odds-table.tsx` and `components/playoff-odds-methodology.tsx`**

- In `PlayoffOddsTable`:
  - Extend `SortKey` with `"avgAttendance" | "fullStrength"`.
  - In the `Record & strength` column group, add `Att` (formatted `row.avgAttendance.toFixed(1)` + subtle neutral `Low`/`Avg`/`High` badge, or `—` when `null`) and `Full Str` (`.xxx` with neutral delta badge/tooltip; hide `Full Str` column on `< sm` mobile viewports while including `Full Str` in the `Str` tooltip so mobile stays uncluttered).
- In `PlayoffOddsMethodology`:
  - Add an `"Attendance impact & full-strength rating"` subsection explaining Fall (`9 / 11 / 13`) vs. Summer (`7 / 9 / 11`) 20th/50th/80th percentiles, the diminishing-returns `ln(att)` curve, goal-rate de-attending into PythagenPuck, and observational caveats (morale/elimination, player quality, subs).

- [x] **Step 4: Run tests to verify they pass**

Run: `cd .worktrees/playoff-odds-update && pnpm vitest run tests/playoff-odds-ui.test.tsx`
Expected: PASS.

---

### Task 4: What-If Controls (`Full-Strength` Toggle & Big Games `Bench What-If`)

**Files:**
- Modify: `components/playoff-odds-filter-bar.tsx:38-138`
- Modify: `components/big-games-section.tsx:56-250`
- Modify: `components/playoff-odds-view.tsx:34-340`
- Test: `tests/playoff-odds-ui.test.tsx`

**Interfaces:**
- Consumes: `ComputePlayoffOddsOptions.useFullStrength`, `ComputePlayoffOddsOptions.gameAttendanceOverrides`, `AttendanceTier`, `GameAttendanceOverride` (Task 1)
- Produces:
  - `PlayoffOddsFilterBar` optional props: `showFullStrengthToggle?: boolean`, `useFullStrength?: boolean`, `onToggleFullStrength?: () => void`
  - `BigGamesSection` optional props: `showAttendanceWhatIf?: boolean`, `attendanceOverrides?: Record<string, GameAttendanceOverride>`, `onChangeAttendanceOverride?: (gameId: string, side: "away" | "home", tier: AttendanceTier | null) => void`

- [x] **Step 1: Write failing UI tests in `tests/playoff-odds-ui.test.tsx`**

Add tests verifying:
1. Clicking `"Full-Strength What-If"` in `weighted` mode activates the What-If banner, triggers client-side re-simulation, and resets cleanly when clicking `"Reset What-If"` or switching seasons.
2. Expanding `"Bench What-If"` on an unlocked Big Game card and picking `Low` / `High` activates the What-If banner and shifts odds; locking that game's outcome clears its attendance override and disables the `"Bench What-If"` control.
3. Switching from `weighted` to `50_50` or `classic` while `useFullStrength` or an attendance override is active hides the controls and does NOT show the What-If banner or run a What-If simulation.

- [x] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/playoff-odds-update && pnpm vitest run tests/playoff-odds-ui.test.tsx`
Expected: FAIL (controls not rendered).

- [x] **Step 3: Implement What-If controls in `PlayoffOddsFilterBar`, `BigGamesSection`, and `PlayoffOddsView`**

- `PlayoffOddsFilterBar`: When `showFullStrengthToggle` is true (`mode === "weighted" && gamesRemaining > 0`), render a compact `"Full-Strength What-If"` toggle button (`aria-pressed={useFullStrength}`).
- `BigGamesSection`: When `showAttendanceWhatIf` is true, render a compact `"Bench What-If"` expandable toggle on each Big Game card (disabled/dimmed when that game has a locked outcome). When expanded, show Away and Home `[Low | Avg | High]` segmented buttons (clicking the active tier clears it back to default).
- `PlayoffOddsView`:
  - Add `useFullStrength` and `attendanceOverrides` state; clear both on season switch (`useEffect([season])`) and in `handleClearWhatIf`.
  - In `handleToggleOutcome(gameId, outcome)`, delete any `attendanceOverrides[gameId]` when locking a game.
  - Gate strictly on `mode === "weighted"`: compute `effectiveUseFullStrength`, `effectiveAttendanceOverrides` (pruned to upcoming non-locked game IDs), and `hasWhatIf = lockedCount > 0 || effectiveUseFullStrength || Object.keys(effectiveAttendanceOverrides).length > 0`.
  - Use `hasWhatIf` consistently in `activeSnapshot`, `baselineTeamsBySlug`, and the What-If banner (showing counts of locked games, Full-Strength status, and bench overrides).

- [x] **Step 4: Run full verification suite**

Run:
- `cd .worktrees/playoff-odds-update && pnpm test:run`
- `cd .worktrees/playoff-odds-update && pnpm lint`
- `cd .worktrees/playoff-odds-update && pnpm build`
Expected: All tests pass, zero lint errors, production build succeeds.
