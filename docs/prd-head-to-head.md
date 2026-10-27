# PRD: Head-to-Head Standings View & Matchup Series Breakdown

> **Status**: Approved / In Development  
> **Author**: BASH Development Team  
> **Created**: 2026-10-27  
> **Target Release**: Fall 2026 / Active Season (`/standings`)  

---

## 1. Executive Summary

The Bay Area Street Hockey (BASH) league historically relied on Sportability for schedule, standings, and statistics tracking. One of Sportability's most popular league overview surfaces was the Head-to-Head breakdown (`HeadtoHead.asp?LgID=49644`), which allowed players and team captains to inspect how a given team fared against every other opponent in the league across the season.

This document defines the product requirements, user experience, computation logic, and architecture for modernizing this capability into a first-class **Head to Head** view directly on the `/standings` route of the BASH website.

---

## 2. Background & Sportability Parity

### 2.1 Legacy Sportability Behavior (`HeadtoHead.asp`)
In legacy Sportability:
1. Users navigated to `HeadtoHead.asp?LgID=49644`.
2. A list of all teams in the division was presented.
3. Selecting a team updated the table in-place to display that team's head-to-head record against each opponent in the league.
4. For each opponent, the table reported:
   - `Opponent`: Name of the opposing team.
   - `Record`: Wins and losses (or ties in older formats).
   - `Pt Differential`: Goal differential (`GF - GA`).

### 2.2 Modern BASH Enhancements
While Sportability provided basic records and goal differential, BASH modernizes and significantly elevates the experience:
1. **3-Point System Integration**: BASH uses a regulation win (3 pts), overtime win (2 pts), overtime loss (1 pt), regulation loss (0 pts) system. The Head to Head table reflects this with full `W-OTW-OTL-L` record tracking and explicit `PTS` earned against each opponent.
2. **Summary Totals Footer**: Aggregates the selected team's overall regular-season totals across all opponents, providing a direct mathematical check against the main standings table.
3. **Expandable Opponent Rows & Season Series Breakdown**: Clicking an opponent row expands to reveal the full season series game-by-game breakdown (scores, home `vs` / away `@` indicator, result badges, overtime/forfeit tags, `IntentLink` navigation to `/game/[id]`, plus any upcoming scheduled matchups with date, time, and location).
4. **Fast Client-Side Navigation**: Responsive top-level pill toggles (`Standings` / `Head to Head`) and team selector pills matching the design system on `/stats`, with zero unnecessary Server Component round-trips via shallow URL synchronization.

---

## 3. UX & Navigation Design

### 3.1 Top-Level View Toggle
On `/standings`, a top-level pill toggle provides seamless switching between the two views:
- **`Standings`**: The standard overall league standings table sorted by Points $\rightarrow$ Goal Differential $\rightarrow$ Goals For.
- **`Head to Head`**: The opponent-by-opponent breakdown relative to a single selected team.

Visual styling matches the `Skaters` / `Goalies` toggle on `/stats`:
- Active pill: `bg-card text-foreground font-bold uppercase tracking-[0.1em] text-[11px] rounded-md px-3 py-1.5`.
- Inactive pill: `text-muted-foreground/60 hover:text-muted-foreground font-bold uppercase tracking-[0.1em] text-[11px] rounded-md px-3 py-1.5`.
- Right border rule: Subtle divider line (`h-px flex-1 bg-border/40 ml-2`) completing the header bar.

### 3.2 Shallow URL State Synchronization
All view and team selections update the browser address bar via `window.history.replaceState` without triggering a Next.js Server Component re-fetch:
- `view=h2h`: Sets Head-to-Head mode. When switching back to Standings, `view` and `team` are stripped from query parameters.
- `team=<slug>`: Records the active team perspective (e.g., `team=seals`).
- `season=<id>`: Preserves any active season filter (e.g., `/standings?season=bash-2026-2027&view=h2h&team=seals`).
- **Default Selection**: If switching to `view=h2h` without a `team` parameter, the default is the first alphabetical team in the season.

### 3.3 Team Selector Bar (Mobile Dropdown + Desktop Pill Row)
When `Head to Head` is active, a `TEAM` selector card (`border border-border/10 rounded-lg p-3 bg-card/45`) displays all active teams in the season in **alphabetical order** (matching `/stats` and legacy Sportability):
- Unlike `/stats`, there is **no "All Teams" option** because head-to-head statistics are fundamentally defined from the perspective of a single team.
- **Mobile (`sm:hidden`)**: Renders a compact `<select>` dropdown (`rounded-md bg-card border border-border/40 px-2 py-1.5 text-[11px] font-semibold`) matching the mobile team selector on `/stats`.
- **Desktop (`hidden sm:flex`)**: Renders text-only pills (`shrink-0 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors`), or a `<select>` if more than 8 teams exist in the season.
- Active team pill is highlighted (`bg-card text-foreground font-semibold`), while inactive pills use `text-muted-foreground/60 hover:text-muted-foreground hover:bg-card/40`.

---

## 4. Stat Columns & Table Specifications

The Head to Head table displays the selected team's performance against every other team in the division:

| Column | Header | Description & Format |
|---|---|---|
| **Opponent** | `Opponent` | Team logo, team name, and expandable row indicator chevron. Links to `/team/[slug]`. |
| **Games Played** | `GP` | Total completed regular-season games played against this opponent. |
| **Record** | `Record` | Compact 4-number record formatted as `W-OTW-OTL-L` (e.g., `2-1-0-1`). |
| **Points** | `PTS` | Head-to-head points earned ($3 \times \text{W} + 2 \times \text{OTW} + 1 \times \text{OTL}$). Bold font weight. |
| **Goals For** | `GF` | Total goals scored by the selected team against this opponent. |
| **Goals Against** | `GA` | Total goals scored by the opponent against the selected team. |
| **Goal Differential** | `+/-` | Goal differential (`GF - GA`), formatted with a `+` prefix for positive values (e.g., `+4`, `0`, `-3`). |

### 4.1 Inverse Symmetry Rule
All head-to-head statistics must satisfy strict inverse symmetry between any pair of teams (Team A and Team B):
- $\text{GP}(A \text{ vs } B) = \text{GP}(B \text{ vs } A)$
- $\text{W}(A \text{ vs } B) = \text{L}(B \text{ vs } A)$
- $\text{OTW}(A \text{ vs } B) = \text{OTL}(B \text{ vs } A)$
- $\text{OTL}(A \text{ vs } B) = \text{OTW}(B \text{ vs } A)$
- $\text{L}(A \text{ vs } B) = \text{W}(B \text{ vs } A)$
- $\text{GF}(A \text{ vs } B) = \text{GA}(B \text{ vs } A)$
- $\text{GA}(A \text{ vs } B) = \text{GF}(B \text{ vs } A)$
- $\text{GD}(A \text{ vs } B) = -\text{GD}(B \text{ vs } A)$
- $\text{PTS}(A \text{ vs } B) + \text{PTS}(B \text{ vs } A) = 3 \times \text{GP}$ (every completed game awards exactly 3 total points)

### 4.2 Summary Totals Footer
The table includes a summary footer row (`<tfoot>`):
- Displays the selected team's aggregate regular-season totals across all opponents.
- The footer values (`GP`, `Record`, `PTS`, `GF`, `GA`, `+/-`) exactly equal the team's standing row in the main league standings table.

---

## 5. Expandable Opponent Rows & Season Series Breakdown

Clicking an opponent row expands an inline table-row list displaying all games between the two teams in the current season:
1. **Minimal Table-Row UX**:
   - Games are rendered as clean horizontal rows (`divide-y divide-border/15 border-t border-border/15`) rather than boxed cards.
   - Each row is wrapped in an `IntentLink` to `/game/[id]` with full RSC speculative prefetching on hover/touch.
2. **Completed Games**:
   - Date column (`Oct 12`), home/away indicator (`vs` or `@`), opponent name, and `OT` / `SO` / `Forfeit` status indicator on the left.
   - Inline result label (`W` / `OTW` in emerald, `OTL` in amber, `L` in rose) and tabular score (`5 - 3`) on the right.
3. **Live Games**:
   - Red pulsing `LIVE` badge.
   - Current in-progress score.
4. **Upcoming Games**:
   - Scheduled date and home/away indicator (`vs` or `@`) on the left, with `-` (`text-muted-foreground/40`) in the score column on the right.
5. **Zero Games Edge Case**:
   - If two teams have not yet played and have no scheduled games, displays "No games scheduled or played this season."

---

## 6. Architecture & Data Flow

1. **No Additional Database Endpoints**: `/standings` already fetches `BashApiData` (containing `games: BashGame[]` and `standings: Standing[]`) via `useBashData(season, initialData)`. The `games` array contains all regular-season games for the active season.
2. **Pure Computation Module (`lib/head-to-head.ts`)**:
   - Filters to regular season games (`game.gameType === "regular" && !game.isPlayoff`).
   - Excludes legacy placeholder team slugs (`isLegacyTeamSlug`).
   - Chronologically orders games using robust date/time comparison.
   - Derives all opponent records, streaks, and season totals in a single $O(N)$ pass over season games.
3. **Accessibility & Keyboard Navigation**:
   - Opponent rows can be toggled via click or keyboard `Enter` / `Space`.
   - Links to `/team/[slug]` and `/game/[id]` retain proper anchor semantics and keyboard accessibility without conflicting with row toggle events.

---

## 7. Verification Plan

| Test Area | Target / Command | Success Criteria |
|---|---|---|
| **Unit Tests** | `tests/head-to-head.test.ts` | Verification of regulation W/L, overtime W/L, 3-pt points, goal differential symmetry, streak calculation, 0-GP opponents, upcoming games, and summary totals matching standings. |
| **Component Tests** | `tests/standings-head-to-head.test.tsx` | View toggling (`Standings` $\leftrightarrow$ `Head to Head`), team selector switching, shallow URL state sync, row expansion, and `IntentLink` navigation. |
| **Repository Hygiene** | `pnpm test:run` & `pnpm lint` | All test suites pass with 0 errors; linter passes with 0 warnings. Uncommitted changes only in working tree. |
