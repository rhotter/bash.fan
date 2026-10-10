# Schedule Management PRD & Implementation Plan

> **Status**: Implementation Complete
> **Parent PRD**: [prd-admin-page.md](./prd-admin-page.md)

## Goal Description
The objective is to build a robust Schedule Management module for the BASH Admin Dashboard to replace the legacy Sportability interface. This module will allow admins to view, filter, edit, and manage games for the current/active season. It will mirror the functionality provided by Sportability (game types, scores, special flags, and summaries) while modernizing the UI/UX and optimizing the underlying data model.

## Functionality Analysis: Sportability vs BASH

Based on the provided screenshots, the Sportability schedule system includes three major features:

### 1. Manual Schedule Management
*   **Schedule List View**: A table displaying Date, Time, Away, Home, Location, and Type. Includes filtering by Team or Location.
*   **Add/Edit Game Form**: Date, Time, Away Team, Home Team, Location, Game Type, Reschedule/Cancel Options, Special Flags, and Summaries. An "Add Game" view provides a blank state of the edit form.

### 2. Round Robin Wizard
A robust generator that builds a full season schedule mathematically with guaranteed equity:
*   **Step 1 (Parameters & Start Date)**: Games per Week (handles odd teams by assigning byes vs double-headers), Schedule Length (run for X cycles or approx X games per team), Start Date, and **Bye-Week Selector** (odd-team-count only — see below).
*   **Step 2 (Dates & Holidays)**: Allows admins to exclude specific weeks (e.g., holidays). The wizard pushes all subsequent games out automatically.
*   **Step 3 (Game Times and Locations)**: Sets a default Time and Location for each generic slot across all weeks. Uses smart league-size defaults (e.g. 8:00, 10:00, 12:00, 2:00 for 4 games/day; 9:00, 11:00, 1:00 for 3 games/day; 10:00, 12:00 for 2 games/day).
*   **Step 4 (Review, Equity Audit & Save)**: Displays the finalized schedule and a **Schedule Fairness & Equity Audit** table displaying each team's Home/Away count (guaranteed 50/50 split), intra-day time slot distribution (`Game 1`, `Game 2`, `Game 3`, `Game 4`...), byes, and max streaks.
*   **Stand-alone Rebalance Tool (`scripts/rebalance-season.ts`)**: Safe backend CLI utility for rebalancing an existing season schedule with Week 1 pinned.

#### Schedule Equity & Fairness Engine (`lib/schedule-utils.ts`)
*   **50/50 Home & Away**: Strict balance (e.g. 9 Home / 9 Away for 18 games), head-to-head alternation (2-1 or 1-2 across 3 meetings), and minimal consecutive streaks (≤ 2–3).
*   **Intra-day Slot Rotation**: Teams rotate equally between Game 1, Game 2, Game 3, Game 4... across the season via simulated annealing.
*   **Pinned Slots**: Preserves completed or announced game weeks (e.g. Week 1) while optimizing remaining weeks around them.
*   **Simulated Annealing Optimizer**: Probabilistic optimization algorithm that balances multiple competing constraints (intra-day slot balance, streak minimization, head-to-head fairness) with zero runtime dependencies.
*   **Upcoming Game Rebalancing (`rebalanceUpcomingGames()`)**: Rebalances unplayed regular-season matchups while strictly preserving completed/final games, retaining balanced H2H meetings, and optimizing time slot equity.

#### Bye-Week Selector (Odd Team Count)

When the league has an odd number of core teams (excluding exhibition/tryout teams), one team must sit out each week as a BYE. The wizard provides a dropdown next to the Start Date field:

- **Random** (default): A random team receives the first BYE; subsequent BYEs follow the Berger table rotation algorithm.
- **Specific team**: The admin selects which team gets the first BYE from the dropdown. The rest of the schedule follows the standard rotation.

The bye-week selector appears inline alongside the Start Date picker with a compact description: "First bye goes to…". The Step 3 preview shows BYE assignments with team names visible via tooltip on hover.

> [!NOTE]
> Exhibition and tryout teams (identified by `gameType` on their assigned games) are filtered out of the "core" team count used for bye-week calculation and Berger table generation. This ensures bye logic only applies to teams competing in regular-season standings.

### 3. Playoff Bracket Wizard
A robust 4-step generator to build a playoff bracket with configurable series formats, automatic bracket progression, and optional play-in games.

#### BASH Playoff Formats

BASH supports 4–8 team brackets using standard bracket seeding. Common seasonal configurations:

| | Fall Season (5 teams) | Summer Season (4 teams) | Expanded (6–8 teams) |
|---|---|---|---|
| Quarterfinals | N/A | N/A | Single game or Best-of-3 |
| Play-in | #4 vs #5, single game | N/A | Auto for odd team counts |
| Semi-finals | Best-of-3 series | Single game | Single game or Best-of-3 |
| Finals | Best-of-3 series | Single game | Single game or Best-of-3 |
| Scheduling | Multi-week | Single day | Multi-week |

Standard bracket seeding (8-team example):
*   **A-side**: QF-A (#1 vs #8), QF-B (#4 vs #5) → SF-A
*   **B-side**: QF-C (#2 vs #7), QF-D (#3 vs #6) → SF-B
*   **Final**: Winner SF-A vs Winner SF-B

For fewer than 8 teams, top seeds receive byes:
*   **6 teams**: #1 and #2 bye to semis; QF matchups are #4 vs #5 and #3 vs #6.
*   **7 teams**: Play-in (#6 vs #7) feeds into QF-D; #1 gets bye to SF-A.
*   **5 teams**: Play-in (#4 vs #5) feeds into SF-A; #2 and #3 direct to SF-B.
*   **4 teams**: No quarterfinals; direct to SF (#1 vs #4, #2 vs #3).

These are the typical configurations, but the wizard should support full customization:
*   **Play-in game**: Auto-enabled for odd team counts. Can be toggled off.
*   **Series length per round**: 1-game (single elimination) or 3-game (best-of-3). Configurable independently for quarterfinals, semi-finals, and finals.
*   **Auto-advancement**: When a series is decided (team wins ⌈seriesLength/2⌉ games), the winner is pushed to the downstream round. For best-of-3, this means winning 2 games.

#### Wizard Steps

*   **Step 1 (Format & Teams)**: Select 4–8 playoff teams (defaults to 4). Play-in auto-enables for odd counts. Choose series length independently for quarterfinals (shown when ≥6 teams), semi-finals, and finals (1 or 3). Toggle placeholder mode for early bracket creation.
*   **Step 2 (Assign Seeds)**: Shows a dynamic seeding list with reorder controls. Bracket preview auto-generates from the seed assignments showing all series matchups (play-in, QF, SF, Final) with proper labels.
*   **Step 3 (Enter Game Details)**: Assign Dates, Times, and Locations to all games in the bracket, grouped by round. For best-of-3 series, all potential games (1, 2, 3) are scheduled upfront — Game 3 can be cancelled later if unnecessary (2-0 sweep). Later round games show opponents as "Winner SF-A" etc.
*   **Step 4 (Review & Save)**: Displays the finalized bracket grouped by round with linked game references. An in-app `AlertDialog` confirms overwriting any existing playoff tournament. Saving automatically tags all generated games with `gameType = "playoff"`.

### 4. Schedule Export & Calendar Integration
Allows players, captains, and spectators to export games directly into external calendar applications (Apple Calendar, Google Calendar, Outlook) via standard iCalendar (`.ics`) files generated client-side:

*   **Format & Timezone**: RFC 5545 compliant `.ics` output with an embedded `VTIMEZONE` definition for `America/Los_Angeles`, covering standard US Daylight Saving Time transition rules.
*   **Dynamic Event Duration**: The event duration is calculated dynamically as **$\text{season.game\_length} \times 2$** (in minutes) based on `schema.seasons.gameLength` (default 60 minutes $\rightarrow$ 120 minutes / 2 hours). This accurately reflects the typical 2-hour rink slot allocated for warmups, games, and post-game handshakes.
*   **Rollover Precision**: End times are computed using UTC epoch arithmetic (`Date.UTC(y, m - 1, d, h, min + durationMinutes)`), avoiding timezone shifts or truncation across midnight, month-end, leap day, and year-end boundaries.
*   **Location Hierarchy**: Prioritizes `seasonLocation` (e.g., "The Lick") with automatic fallback to `game.location`. Throws a clear error if neither is defined.
*   **TBD / All-Day Handling**: Games with time listed as `"TBD"` generate all-day calendar events (`DTSTART;VALUE=DATE:...` with next-day exclusive `DTEND`).
*   **Touchpoints**:
    *   **Per-Game**: "ADD TO CAL" button in the game header on `/game/[id]` ([`components/game-detail.tsx`](file:///Users/christorres/Desktop/bash/components/game-detail.tsx)).
    *   **Team Schedule**: "ADD TO CAL" button on `/team/[slug]` ([`components/team-page-content.tsx`](file:///Users/christorres/Desktop/bash/components/team-page-content.tsx)) to download the full seasonal fixture list.
*   **Data Pipelines**: `fetchGameDetail` and `fetchTeamDetail` query `gameLength` from `schema.seasons` and forward it to client components.

---

## Decisions Made

The following decisions have been finalized after design review:

1.  **Placeholder Architecture → Option A (Clean Schema).** We will update the database schema (adding `homePlaceholder`/`awayPlaceholder` columns) rather than creating dummy teams in the `teams` table. This replaces the previous `seed-1`, `seed-2` auto-generation logic which has been removed from the season creation API. The `teams` table will contain only real teams going forward.

2.  **Round Robin Wizard → Sportability-style placeholders.** The wizard will use generic "Team 1 vs Team 4" placeholders throughout generation, assigning real team names only at save time (Step 4). This mirrors Sportability's approach and allows admins to build a schedule before team rosters/assignments are finalized.

3.  **Playoff Wizard → Support early bracket creation.** Admins can save a bracket with placeholder team names (e.g., "Seed 1", "Seed 2") early in the season. They can revisit the bracket later to replace placeholders with real teams once standings are finalized.

4.  **Playoff Series → Configurable series length.** The wizard supports both single-game elimination and best-of-3 series, configurable per round (quarterfinals, semi-finals, and finals independently). Play-in games are always single-game. For best-of-3 series, all potential games are pre-scheduled. Auto-advancement triggers when a team clinches the series (wins 2 games).

5.  **Playoff Bracket → Up to 8 teams.** The bracket uses standard seeding (#1 vs #8, #4 vs #5 on A-side; #2 vs #7, #3 vs #6 on B-side) with byes for team counts under 8 and auto play-in for odd counts. Default is 4 teams.

6.  **Topological Insertion Order.** Because playoff games reference downstream games via the `nextGameId` soft reference (application-enforced, not a DB-level FK), we insert them using a topological sort. Child games (like Finals) are inserted before parent games (like Semi-finals) to ensure referential correctness and enable future FK enforcement if needed.

7.  **Sequential ID Generation.** To preserve uniform Sportability-compatible formatting (`g1`, `g2`, ...) and prevent primary key collisions across seasons, schedule generation (both Round Robin and Playoff) generates IDs using a Postgres sequence (`games_gen_seq`) synchronized with `MAX(CAST(SUBSTRING(id FROM 2) AS bigint))` of existing games.

8.  **TBD Sentinel Upserts.** The `tbd` sentinel team is automatically upserted before playoff and round-robin scheduling to satisfy foreign-key constraints on `homeTeam` and `awayTeam` when utilizing Placeholder Mode.


---

## Current BASH Data Model (`games` table)

Currently, we store: `id`, `seasonId`, `date`, `time`, `homeTeam`, `awayTeam`, `homeScore`, `awayScore`, `status` (upcoming/completed), `isOvertime`, `isPlayoff`, `isForfeit`, `location`, `hasBoxscore`, and a single `notes` string.

Key constraints:
*   `homeTeam` and `awayTeam` are `NOT NULL` with foreign keys to `teams.slug`.
*   `isPlayoff` is a boolean on both `games` and `playerSeasonStats` (where it is part of the **composite primary key**).
*   The `games` table is referenced by `playerGameStats`, `goalieGameStats`, `gameOfficials`, and `gameLive` — none of which have cascade deletes.

## Proposed Data Model Updates

All changes are **additive** — no existing columns are modified or removed, and no existing queries need to change.

1.  **Add `gameType` (text, default `"regular"`)**
    *   Admin/display label: "regular", "playoff", "practice", "exhibition", "championship", "jamboree".
    *   **`isPlayoff` stays permanently.** It is the correct abstraction for the stats system, which only ever asks a binary question: "is this a playoff game or not?" All 60+ existing consumer queries (`fetch-player-detail.ts`, `fetch-player-stats.ts`, `computeStandings()`, etc.) continue to use `isPlayoff` unchanged. Zero stats queries need to change, zero latency impact, zero risk to the `playerSeasonStats` composite primary key.
    *   The relationship is enforced at the API layer: when `gameType = "playoff"`, set `isPlayoff = true`. For all other types, `isPlayoff = false`.
    *   A one-time backfill sets `gameType = "playoff"` for existing rows where `isPlayoff = true`.

2.  **Add `hasShootout` (boolean, default `false`)**

3.  **Add `awayNotes` and `homeNotes` (text, nullable)**

4.  **Add `homePlaceholder` and `awayPlaceholder` (text, nullable)**
    *   Display-only text for unresolved teams (e.g., "Seed 1", "Winner #2").
    *   `homeTeam`/`awayTeam` remain `NOT NULL`. For games with unresolved teams, they will reference a sentinel `"tbd"` team slug (which already exists in our system and is filtered out of standings by `computeStandings()`).

5.  **Add `nextGameId` (text, nullable, soft self-reference)**
    *   Links playoff games in a bracket tree. When a game is completed, the winner is pushed to the downstream game.
    *   This is an application-enforced reference (not a DB-level FK) to simplify deletion workflows. The topological insertion sort ensures correctness.

6.  **Add `nextGameSlot` (text, nullable)**
    *   Values: `"home"` or `"away"`. Indicates which slot of the `nextGameId` game the winner of this game feeds into.

7.  **Add `bracketRound` (text, nullable)**
    *   Identifies the playoff round: `"play-in"`, `"quarterfinal"`, `"semifinal"`, `"final"`. Used for display grouping and series advancement logic.

8.  **Add `seriesId` (text, nullable)**
    *   Groups games belonging to the same matchup/series (e.g., `"qf-a"`, `"qf-b"`, `"qf-c"`, `"qf-d"`, `"sf-a"`, `"sf-b"`, `"final"`, `"play-in"`). For single-game rounds, the series has one game. For best-of-3, it has up to three.

9.  **Add `seriesGameNumber` (integer, nullable)**
    *   Which game within the series: 1, 2, or 3. Used for display ("Game 1 of 3") and to determine series clinch.

> [!TIP]
> We don't need Sportability's "New Date" and "New Location" fields. If a game is rescheduled, the admin simply changes the *actual* Date and Time fields.

---

## Proposed Changes

### 1. Database Schema (`lib/db/schema.ts`)

#### Games table additions:
```
gameType:         text("game_type").notNull().default("regular")
hasShootout:      boolean("has_shootout").notNull().default(false)
awayNotes:        text("away_notes")
homeNotes:        text("home_notes")
homePlaceholder:  text("home_placeholder")
awayPlaceholder:  text("away_placeholder")
nextGameId:         text("next_game_id")       // self-referential FK to games.id
nextGameSlot:       text("next_game_slot")     // "home" | "away"
bracketRound:       text("bracket_round")      // "play-in" | "semifinal" | "final"
seriesId:           text("series_id")          // groups games in same matchup/series
seriesGameNumber:   integer("series_game_number") // 1, 2, or 3 within a series
```

#### Cleanup:
*   Remove the `seed-1`, `seed-2`, etc. auto-generation logic from season creation (already done).
*   Clean up any existing `seed-*` team records from the `teams` and `season_teams` tables via a one-time migration script.
*   Ensure a `"tbd"` team slug exists in the `teams` table as a sentinel for unresolved playoff matchups.

#### Backfill migration:
```sql
UPDATE games SET game_type = 'playoff' WHERE is_playoff = true;
UPDATE games SET game_type = 'regular' WHERE is_playoff = false;
```

### 2. API Routes

*   **[NEW]** `GET /api/bash/admin/seasons/[id]/schedule` — Fetch all games for the season, joined with team names. Returns `homePlaceholder`/`awayPlaceholder` for display when `homeTeam = "tbd"`.
*   **[NEW]** `POST /api/bash/admin/seasons/[id]/schedule` — Create a single game (the "Add Game" form).
*   **[NEW]** `PATCH /api/bash/admin/seasons/[id]/schedule/[gameId]` — Update a game. For playoff games with a `seriesId`, checks if completing this game clinches the series (team wins ⌈seriesLength/2⌉ games in the series). If the series is decided and the game has a `nextGameId`, automatically advances the series winner to the downstream game's `homeTeam` or `awayTeam` (based on `nextGameSlot`).
*   **[NEW]** `DELETE /api/bash/admin/seasons/[id]/schedule/[gameId]` — Delete a game. Must first delete child records from `playerGameStats`, `goalieGameStats`, `gameOfficials`, and `gameLive` (no cascade defined). Should refuse deletion if the game has `status = "final"` with boxscore data, unless force-confirmed.
*   **[NEW]** `POST /api/bash/admin/seasons/[id]/schedule/generate` — Bulk insert for the Round Robin Wizard. Supports two modes:
    *   **Overwrite**: Deletes existing games (only those with `status != "final"` unless force-confirmed) and inserts the new schedule. Supports `preserveWeek1: boolean` option to retain existing Week 1 games (and games on/before the new schedule's start date) untouched while populating Weeks 2..N.
    *   **Append**: Inserts new games alongside existing ones.
    *   Generated game IDs use a Postgres sequence `games_gen_seq` to generate sequential Sportability-compatible `g[n]` IDs without collision.
    *   Automatically upserts the `tbd` sentinel team to satisfy foreign key constraints for Placeholder Mode.
*   **[NEW]** `POST /api/bash/admin/seasons/[id]/schedule/playoffs` — Bulk insert for the Playoff Wizard. Creates linked games with `nextGameId`/`nextGameSlot`/`seriesId`/`bracketRound` references. Applies topological sorting prior to bulk DB insertion to ensure child games (Finals) are inserted before parent games (Semi-finals). Supports 4–8 teams with standard bracket seeding, configurable series length per round (quarterfinals, semi-finals, finals: 1 or 3), and auto play-in for odd team counts.
*   **[NEW]** `POST /api/bash/admin/seasons/[id]/schedule/resolve-seeds` — Replaces placeholder teams (e.g., "Seed 1") with actual team IDs throughout the bracket based on a provided mapping payload.

### 3. Frontend Components

*   **`components/admin/season-schedule-tab.tsx`** — List View with "Add Game" button and "Generate Schedule" / "Playoff Bracket" wizard launchers.
    *   View Mode Toggle (Card View vs Condensed Table View) for improved navigational efficiency and data density.
    *   Filter by Team and Filter by Location dropdowns.
    *   Table columns: Date, Time, Away, Home, Location, Type, Status.
    *   Games with `homeTeam = "tbd"` display the `homePlaceholder` text instead.
*   **`components/admin/edit-game-modal.tsx`** — Reusable form for Adding/Editing games.
    *   Two-column layout for Away Team (Select + Score) vs Home Team (Select + Score).
    *   Dropdowns for Game Type and Status.
    *   Toggles for Overtime, Shootout, and Forfeit.
    *   Tabbed notes area (League Summary | Away Notes | Home Notes).
*   **`components/admin/round-robin-wizard.tsx`** — 4-step round robin generator.
    *   Uses a Berger tables algorithm combined with simulated annealing equity optimization:
        *   Guarantees 50/50 Home/Away balance across all teams.
        *   Evenly distributes intra-day game slots (`Game 1`, `Game 2`, `Game 3`, `Game 4`...) across teams.
        *   Supports dynamic default start times based on games per day (4 games: 8:00, 10:00, 12:00, 2:00; 3 games: 9:00, 11:00, 1:00; 2 games: 10:00, 12:00).
    *   Manages state internally; sends final payload to server at save.
*   **`components/admin/playoff-wizard.tsx`** — 4-step bracket generator.
    *   Supports 4–8 teams (default 4) with standard bracket seeding and auto play-in for odd counts.
    *   Per-round series configuration: quarterfinals (≥6 teams), semi-finals, and finals.
    *   Dynamic bracket preview auto-generated from seed assignments.
    *   Visual bracket rendered via CSS/SVG for the review step.
*   **`app/admin/scoresheet/[gameId]/page.tsx`** — Printable game scoresheet.
    *   Server Component fetches game info (date, time, teams, location), team rosters (`player_seasons` + `players`), and assigned officials (`game_officials`).
    *   Renders a print-optimized HTML page matching the legacy Sportability scoresheet layout: per-team roster, scoring table (11 blank rows), penalty table (10 blank rows), goalie table (4 blank rows), shot tracking grids (Per 1-3 + OT, numbers 01-24), timeouts, officials/signatures box, scoring/shots summary grids, notes box, and a "Game Stars" table (Star #1/2/3).
    *   Styled with `@page { size: letter }` and `@media print` CSS to fit exactly on one printed page.
    *   Accessed via a `Printer` icon button on each game row in the schedule tab; opens in a new tab and auto-triggers `window.print()`.
*   **`app/admin/scoresheet/season/[id]/page.tsx`** — Printable batch scoresheets.
    *   Server Component fetches all remaining unplayed games (`status != 'final'`) in chronological order (`date ASC, time ASC`) with rosters and officials.
    *   Enforces strict 1-page-per-game print formatting via CSS page breaks (`break-after: page; page-break-after: always; break-inside: avoid;`).
    *   Auto-triggers `window.print()` on mount and includes an on-screen toolbar with print button and back link.
*   **`components/admin/game-scoresheet.tsx`** — Shared, reusable scoresheet component used by both single and batch scoresheet routes, ensuring visual and structural fidelity.
*   **`components/admin/season-schedule-tab.tsx`** — Top-level "Print Remaining Scoresheets" button.
    *   Placed in schedule tab header alongside wizard launchers. Opens batch scoresheet route in new tab; automatically disables with tooltip if all games are final.
*   **`lib/calendar-export.ts`** — Client-side RFC 5545 iCalendar generation.
    *   Generates `.ics` calendar events in `America/Los_Angeles` timezone with embedded `VTIMEZONE`.
    *   Calculates end time dynamically based on $\text{season.game\_length} \times 2$ (default 120 minutes / 2 hours).
    *   Handles UTC rollover arithmetic, location hierarchy fallback, and all-day TBD events.
*   **`components/game-detail.tsx` & `components/team-page-content.tsx`** — User-facing "ADD TO CAL" buttons.
    *   Game detail view triggers download for individual games (`game-[id].ics`).
    *   Team detail view triggers download for all games in the team's schedule (`[slug]-schedule.ics`).

### 4. Public Site Integration

*   **Public Schedule & Calendar Export**: ✅ **Complete**. Public scoreboard (`/`), game details (`/game/[id]`), and team pages (`/team/[slug]`) display scheduled games and provide one-click iCalendar export buttons.
*   **Public Bracket Display**: ⏳ **Deferred**. Public-facing visual tournament bracket view is deferred to a follow-up phase once the admin playoff workflow is battle-tested.

---

## Verification Plan

### Automated Tests
*   `npx tsc --noEmit` — Type safety after all schema and consumer changes.
*   `npm run db:push` — Apply schema updates locally.
*   Regression test for `computeStandings()` — Verify standings computation still works correctly with games that have `homeTeam = "tbd"` (they should be filtered out, as they already are).
*   Backfill test — Verify `gameType` is correctly populated from `isPlayoff` on existing data.

### Manual Verification
*   Filter schedule by Team → only shows games where team is Home OR Away.
*   Update a game from "upcoming" to "completed" → saves scores and notes.
*   Edit an existing game → updates row without creating a duplicate.
*   Complete a playoff game with `nextGameId` → verify the downstream game's team slot is automatically updated.
*   Delete a game that has child records → verify clean deletion with no orphans.
*   Run the Round Robin Wizard in overwrite mode on a season with completed games → verify warning/refusal.
*   Save a playoff bracket with placeholder teams → verify `"tbd"` sentinel is used and placeholders display correctly.
