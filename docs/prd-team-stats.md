# PRD: Team Stats View & Aggregated Team Leaderboards

> **Status**: Approved / In Development  
> **Author**: BASH Development Team  
> **Created**: 2026-10-27  
> **Target Release**: Active Season (`/stats?view=teams`)  

---

## 1. Executive Summary

The Bay Area Street Hockey (BASH) stats hub (`/stats`) historically provided leaderboards for individual players across two primary views: **Skaters** and **Goalies**. While individual player leaderboards showcase scoring titles and goaltending excellence, league managers, captains, and spectators frequently seek comprehensive league-wide team benchmarks: Which team generated the most total goals or power-play production? Which team boasted the stingiest team save percentage or lowest team GAA across the season?

This document defines the product requirements, user experience, statistical aggregation logic, and technical architecture for introducing a first-class **Teams** view directly on the `/stats` route of the BASH website.

---

## 2. Background & Goals

### 2.1 Product Goals
1. **Holistic Team Performance**: Display aggregated skater production and aggregated goaltending performance on a single surface, allowing fans and captains to evaluate team strengths and weaknesses across all offensive and defensive categories.
2. **Seamless Navigation & Zero Round-Trips**: Integrate `Teams` alongside `Skaters` and `Goalies` in the top-level view selector on `/stats`. Switching between views preserves active season context and updates the browser address bar (`?view=teams`) via shallow URL synchronization (`window.history.replaceState`) without triggering unnecessary Next.js Server Component round-trips.
3. **Statistical Integrity & Distinct Team GP (`TGP` & `PGP`)**: Ensure team games played (`TGP`) represents the count of distinct completed games played by that team (preventing player double-counting) alongside total player game appearances (`PGP`), correctly attribute games played by substitute players and mid-season traded players, and accurately compute team points per game (`PTS/G`), team save percentage (`SV%`), team goals against average (`GAA`), and shots against per game (`SA/G`).
4. **All-Time Historical Benchmarking, Championships & Franchises**: When viewing All-Time stats (`season === "all"`), aggregate stats by `(team, season)` so historical single-season team performances can be compared across league history, respecting Game Type (`regular`, `playoffs`, `all`), Season Type (`fall`, `summer`, `all`), Finish (`all`, `champions`, `finalists`), Franchise (`season_teams.franchise_slug`), and `Min TGP` (`12` Fall/All, `8` Summer, `2` Playoffs) filters, and displaying an amber `<Crown />` badge next to season champions.

---

## 3. UX & Navigation Design

### 3.1 Top-Level View Toggle
On `/stats`, the top-level pill toggle row provides three primary view options:
- **`Skaters`**: Individual skater leaderboards (points, goals, assists, etc.). Query state: `/stats` or `/stats?season=[id]`.
- **`Goalies`**: Individual goalie leaderboards (SV%, GAA, wins, shutouts, etc.). Query state: `?view=goalies`.
- **`Teams`**: Stacked team-level skater and goalie aggregated tables. Query state: `?view=teams`.

Visual styling matches existing design system tokens:
- Active pill: `bg-card text-foreground font-bold uppercase tracking-[0.1em] text-[11px] rounded-md px-3 py-1.5 min-h-[44px] sm:min-h-0`.
- Inactive pill: `text-muted-foreground/60 hover:text-muted-foreground font-bold uppercase tracking-[0.1em] text-[11px] rounded-md px-3 py-1.5 min-h-[44px] sm:min-h-0`.
- Right border rule: Subtle divider line (`h-px flex-1 bg-border/40 ml-2`) completing the header bar.

### 3.2 Shallow URL State Synchronization & Browser Navigation
Clicking `Teams` updates the browser URL to `?view=teams` using `window.history.replaceState`:
- Switching back to `Skaters` removes the `view` parameter.
- Switching to `Goalies` sets `view=goalies`.
- Preserves all other active query parameters (such as `season=[id]`, `seasonType`, `gameType`).
- Executes instantly from client cache with zero full-page refreshes.
- Changes made to All-Time dropdown filters (`Game Type`, `Season Type`) or header season selection (`SeasonSelector`) explicitly retain the active `?view=teams` state rather than defaulting back to `Skaters`.
- Listens to browser `popstate` events to ensure browser Back and Forward navigation reliably synchronizes the active tab state with the browser address bar.

### 3.3 Filter Bar Visibility & Contextual Controls
The filter bar behaves contextually depending on whether a single season or All-Time mode is selected:
- **Single-Season Mode (`season !== "all"`)**:
  - Team filter pills/dropdowns and search input are hidden on the Teams view since every team in the season is already displayed. When playoffs exist (`hasPlayoffs || playoff`), the filter bar displays the `Game Type` dropdown (`Regular Season` / `Playoffs`) rather than placing toggle buttons in the top-level view row.
- **All-Time Mode (`season === "all"`)**:
  - The filter control bar is rendered with All-Time controls:
    - **Game Type Filter**: Dropdown with `Regular Season`, `Playoffs`, `All`.
    - **Season Type Filter**: Dropdown with `Fall`, `Summer`, `All`.
    - **Team Search Filter**: Text search input with `placeholder="Search teams or seasons..."` allowing instant filtering by team name, team slug (including hyphenated slugs like `no-regretzkys`), formatted season name (with hyphen/en-dash normalization), or season ID (e.g. `2024-summer`). Search inputs with leading or trailing whitespace are trimmed automatically to prevent zero-result false negatives.
    - **Finish Filter**: Dropdown (`All`, `Champions`, `Champs + Finalists`) filtering All-Time team-season rows to championship winners (`isChampion`) or championship game participants (`isChampion || isFinalist`).
    - **Franchise Filter**: Dropdown (`All`, plus all active franchises from `season_teams.franchise_slug` $\rightarrow$ `franchises`) filtering All-Time team-season rows by `franchiseSlug`.
    - **Min TGP Filter**: Numeric input (`Min TGP`) defaulting to `12` games for Fall/All seasons, `8` games when Summer (`seasonType === "summer"`) is selected, and `2` games when Playoffs (`gameType === "playoffs"`) is selected, filtering All-Time team-season rows by `gp >= minTeamGames`.
    - **Omitted Filters**: The single-season Team filter and individual player `Min Games` filter are omitted on the Teams view.

---

## 4. Stat Columns & Table Specifications

On `/stats?view=teams`, two independent sortable tables are stacked vertically:

```
┌───────────────────────────────────────────────────────────────────────┐
│ SKATER STATS                                                          │
│ Team  [Season]  TGP PGP  G   A  PTS  PTS/G  GWG PPG SHG ENG HAT  PIM  │
├───────────────────────────────────────────────────────────────────────┤
│ GOALIE STATS                                                          │
│ Team  [Season]  TGP PGP SV%  GAA   SO   SV   GA  SA  SA/G   A         │
└───────────────────────────────────────────────────────────────────────┘
```

### 4.1 Skater Stats Table (Top)
Aggregates all skater scoring and penalty statistics recorded by the team:

| Column | Header | Description & Format |
|---|---|---|
| **Team** | `Team` | Sticky column (`w-[168px]`): rank number, team logo, team name (with amber `Crown` icon next to season champions in All-Time mode). Wrapped in `IntentLink` to `/team/[slug]?season=[seasonId]`. |
| **Season** | `Season` | Rendered only when `season === "all"`. Compact season format (`F 14-15` or `S '14`) on mobile (`w-14`) and full season name (`Fall 2014–15` or `Summer 2014`) on desktop (`sm:w-28`), wrapped in `IntentLink` to `/stats?season=[seasonId]&view=teams`. Sortable. |
| **Team Games Played** | `TGP` | Distinct count of completed games played by the team with skater stats. |
| **Player Games Played** | `PGP` | Sum of individual skater game appearances (`COUNT(*)` or `SUM(pss.gp)`) across the team. |
| **Goals** | `G` | Total goals scored by team skaters. |
| **Assists** | `A` | Total assists recorded by team skaters. |
| **Points** | `PTS` | Total points (`G + A`). Bold font weight. Default sort column (descending). |
| **Points / Game** | `PTS/G` | Team scoring pace: `(points / gp).toFixed(2)` (e.g. `11.25`). Sortable numerically. |
| **Game-Winning Goals** | `GWG` | Total game-winning goals credited to team skaters. |
| **Power-Play Goals** | `PPG` | Total power-play goals scored. |
| **Shorthanded Goals** | `SHG` | Total shorthanded goals scored. |
| **Empty-Net Goals** | `ENG` | Total empty-net goals scored. |
| **Hat Tricks** | `HAT` | Total 3+ goal performances by team skaters. |
| **Penalty Minutes** | `PIM` | Total penalty minutes accrued by team skaters. |

- **Default Sort**: `PTS` descending. Secondary tie-breakers: `G` descending $\rightarrow$ team name ascending.
- **Default Active Teams**: Every active non-legacy team in the selected season appears exactly once. Teams with 0 completed games display `0` across counting metrics and `"0.00"` for `PTS/G`.

### 4.2 Goalie Stats Table (Bottom)
Aggregates all goaltending decisions and shot/save totals for the team:

| Column | Header | Description & Format |
|---|---|---|
| **Team** | `Team` | Sticky column (`w-[168px]`): rank number, team logo, team name (with amber `Crown` icon next to season champions in All-Time mode). Wrapped in `IntentLink` to `/team/[slug]?season=[seasonId]`. |
| **Season** | `Season` | Rendered only when `season === "all"`. Compact season format (`F 14-15` or `S '14`) on mobile (`w-14`) and full season name (`Fall 2014–15` or `Summer 2014`) on desktop (`sm:w-28`), wrapped in `IntentLink` to `/stats?season=[seasonId]&view=teams`. Sortable. |
| **Team Games Played** | `TGP` | Distinct count of completed games played by the team with goaltender stats. |
| **Player Games Played** | `PGP` | Sum of individual goaltender game appearances (`COUNT(*)`) across the team. |
| **Save Percentage** | `SV%` | Aggregated team save percentage: `saves / shotsAgainst` formatted to 3 decimal places (e.g. `0.937`). Bold font weight. Default sort column (descending). |
| **Goals Against Avg** | `GAA` | Aggregated team goals against average: `(goalsAgainst / seconds) * (gameLength * 60)` formatted to 2 decimal places (e.g. `1.33`). Defaults to ascending sort when clicked. |
| **Shutouts** | `SO` | Total team shutouts recorded. |
| **Saves** | `SV` | Total saves made by team goaltenders. |
| **Goals Against** | `GA` | Total goals allowed by team goaltenders. |
| **Shots Against** | `SA` | Total shots faced by team goaltenders (`saves + goalsAgainst`). |
| **Shots Against / Game** | `SA/G` | Shots against per team game played: `(shotsAgainst / gp).toFixed(2)`. Sortable numerically. |
| **Assists** | `A` | Total assists recorded by team goaltenders (`goalieAssists`). |

- **Default Sort**: `SV%` descending. Secondary tie-breakers: `GAA` ascending $\rightarrow$ team name ascending.
- **Inclusion Criterion**: Teams with recorded goalie game statistics in the selected scope are displayed.

---

## 5. Team-Level Stat Aggregation Rules

### 5.1 Distinct Team Games Played (`TGP`), Player Games Played (`PGP`), `PTS/G` & `SA/G`
Because multiple skaters (and occasionally multiple goalies) participate in a single game, summing individual player `gp` would inflate team games played. Both metrics are surfaced transparently:
- **Skater Team GP (`TGP`)**: Computed as `COUNT(DISTINCT pgs.game_id)` across all eligible games for that team (or `MAX(pss.gp)` for historical `stats_only` seasons).
- **Skater Player GP (`PGP`)**: Computed as `COUNT(*)` across skater game rows (or `SUM(pss.gp)` for historical `stats_only` seasons).
- **Goalie Team GP (`TGP`)**: Computed as `COUNT(DISTINCT ggs.game_id)` across all eligible games for that team.
- **Goalie Player GP (`PGP`)**: Computed as `COUNT(*)` across goalie game rows.
- **Pace Calculations**:
  - `PTS/G` is computed as `(team points / team skater TGP).toFixed(2)` (or `"0.00"` when `gp === 0`).
  - `SA/G` is computed as `(team shotsAgainst / team goalie TGP).toFixed(2)` (or `"0.00"` when `gp === 0`).

### 5.2 Substitute & Trade Attribution
Individual player leaderboards on BASH deliberately exclude substitute players (`WHERE NOT is_sub`) to prevent ringers from claiming individual scoring titles. In contrast, team statistics must accurately reflect everything that happened on behalf of the team:
- **Substitute Players (`is_sub = true`)**: Stats recorded by substitute skaters and substitute goalies are fully included in the team's totals for the games in which they played.
- **Traded Players**: When a player is traded mid-season from Team A to Team B, stats from games played while wearing Team A's jersey are attributed to Team A, and stats from games played for Team B are attributed to Team B (`COALESCE(pgs.team_slug, ps.team_slug)`).

### 5.3 Forfeit Exclusion
In accordance with league statistical rules and standings integrity, games marked as forfeits (`g.is_forfeit = true`) are strictly excluded from both skater and goalie team stat aggregations (`AND NOT g.is_forfeit`).

### 5.4 All-Time Mode, Championships/Finalists, Franchises & Historical Seasons
In All-Time mode (`season === "all"`):
- Aggregates by `(team, season)` so single-season team performances are ranked against each other across league history.
- Evaluates `game_type` (`regular`, `playoffs`, `all`) and `season_type` (`fall`, `summer`, `all`).
- Incorporates historical `stats_only` pre-Sportability seasons (stored in `player_season_stats`) for the Skater stats table, computing team `TGP` from `MAX(pss.gp)` and `PGP` from `SUM(pss.gp)`.
- Resolves each completed season's playoff champion (`isChampion: true`) and runner-up (`isFinalist: true`) from the final playoff game in `games`, displaying an amber `Crown` icon next to champion teams and powering the `Finish` filter (`All`, `Champions`, `Champs + Finalists`).
- Joins `season_teams.franchise_slug` $\rightarrow$ `franchises` (`Black`, `Blue`, `Green`, `Orange`, `Purple`, `Red`, `White`, `Yellow`) to attach `franchiseSlug` and `franchiseName` to each team-season row and power the All-Seasons `Franchise` filter.

---

## 6. Architecture & Data Flow

1. **Server Fetching**: `fetchStatsPageData()` in `lib/cached-page-data.ts` coordinates parallel fetching of `fetchPlayerStats()` and `fetchTeamStats()` via `Promise.all()`, caching the combined snapshot under `stats-page-data-v8` with a 30s TTL.
2. **REST API**: `GET /api/bash/players` resolves both player leaderboards and team aggregated stats in parallel, delivering `teamSkaters` and `teamGoalies` in a single response.
3. **Client SWR Hook**: `usePlayerStats()` returns `{ skaters, goalies, teamSkaters, teamGoalies, teams, ... }` with `fallbackData` hydration. Switching to `tab === "teams"` accesses already-hydrated client memory with 0ms latency.
4. **Navigation**: Team names and logos link to `/team/[slug]?season=[seasonId]` and the All-Time `Season` column links to `/stats?season=[seasonId]&view=teams` using `IntentLink` for full RSC speculative prefetching on hover and touch.

---

## 7. Verification & Acceptance Criteria

- [x] Selecting `Teams` on `/stats` sets `?view=teams` via shallow URL update without a full server round-trip.
- [x] In single-season mode, the filter bar shows the `Game Type` dropdown (`Regular Season` / `Playoffs`) when playoffs exist while omitting the Team filter and player search input.
- [x] In All-Time mode, the filter bar displays `Game Type`, `Season Type`, `Finish` (`All`, `Champions`, `Champs + Finalists`), `Franchise`, `Min TGP` (`12` Fall/All, `8` Summer, `2` Playoffs), and the search input.
- [x] Skater stats table renders above Goalie stats table, with `TGP` and `PGP` columns in both tables and `SA/G` in the Goalie table (with `W` and `L` omitted).
- [x] Distinct team `TGP` (`COUNT(DISTINCT game_id)`) and `PGP` (`COUNT(*)`) are computed accurately.
- [x] `PTS/G` equals `(points / gp).toFixed(2)` and `SA/G` equals `(shotsAgainst / gp).toFixed(2)`.
- [x] `SV%` equals `(saves / shotsAgainst)` formatted to 3 decimals.
- [x] `GAA` equals `(goalsAgainst / seconds) * (gameLength * 60)` formatted to 2 decimals, sorting ascending when clicked.
- [x] Substitute players and traded players are attributed to the correct team.
- [x] Forfeits are excluded.
- [x] All team rows link to `/team/[slug]?season=[seasonId]` using `IntentLink`, and All-Time `Season` cells link to `/stats?season=[seasonId]&view=teams` using compact labels on mobile (`F 14-15` / `S '14`) and full season names on desktop.
- [x] Automated test suite in `tests/` passes with 100% success rate.
