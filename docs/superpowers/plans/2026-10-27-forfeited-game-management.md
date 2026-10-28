# Forfeited Game Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically award `5–0` (or `0–0` double forfeit with `0–5` losses in standings), credit `+1 GP` (`0` counting stats) to the winning team's full active roster, protect `PTS/G` and goalie rate stats, and display a `Forfeit` badge in player Game Logs.

**Architecture:** A shared forfeit sync module (`lib/forfeit-sync.ts`) stamps `0`-stat attendance rows (`team_slug = winningTeamSlug`, `is_sub = false`, `result = NULL`) into `player_game_stats` and `goalie_game_stats` whenever a single-team forfeit is saved via Admin Schedule or Sportability sync, and cleans up auto-stamped rows on double forfeits or when `isForfeit` is unchecked. All stat queries across `/stats`, `/team/[slug]`, `/player/[slug]`, `/game/[id]`, and `/api/bash/draft/player-stats/[playerId]` include winning-team forfeit rows for `GP` while zeroing counting stats and dividing `PTS/G` (and team `PTS/G` / `SA/G`) by non-forfeit games played (`played_gp`).

**Tech Stack:** Next.js 16 (App Router), React 19, Drizzle ORM (`drizzle-orm/neon-http`) + `rawSql()`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-27-forfeited-game-management-design.md` (and `docs/prd-forfeits.md`)

## Global Constraints

- **No Automatic Commits:** Per user global rules, never run `git commit` unless explicitly instructed by the user. Leave changes uncommitted in the working tree or staging index.
- **No `db.transaction()`:** `drizzle-orm/neon-http` does not support interactive transactions; all database writes must be idempotent sequential queries or single-statement SQL.
- **Style Guide:** Prefer neutral theme tokens (`text-foreground`, `text-muted-foreground`, `bg-muted`, `border-border`) over brand/accent colors for ambient/informational UI.

## Review Focus

- **Skater with ONLY forfeit GP (`gp = 1, played_gp = 0`):** Division for `PTS/G` (`points / played_gp`) must not divide by zero or return `NaN`/`Infinity`; it must return `"0.00"`.
- **Traded skater who has a forfeit GP on Team A and played games on Team B:** Combined season row on `/stats` must sum `gp` (including the forfeit) AND sum `played_gp` (excluding the forfeit) so combined `PTS/G` divides total points by total `played_gp`, not total `gp`.
- **Retroactive / overturned forfeit (played game with goals, penalties, goalie `W`/`L`, and subs later marked `isForfeit = true`):** Counting stats and goalie `W`/`L` must evaluate to `0` / `NULL`, losing-team players and subs must receive `0 GP` for that game, and winning-team absent rostered players must still receive `+1 GP` (Q3 = Option B).
- **Double forfeit (`isForfeit = true`, `homeScore = 0`, `awayScore = 0`, `status = 'final'`):** Both teams must receive `+1 GP`, `+1 L`, `+0 GF`, `+5 GA` (`-5 GD`), `0 PTS` in `computeStandings`, `computeHeadToHead`, and `fetchTeamDetail`, and neither team's players receive `GP`.
- **Switching forfeit winner in Admin Schedule (e.g., changing from Away forfeited `5–0` to Home forfeited `0–5` or unchecking `isForfeit`):** Stale auto-generated `0`-stat rows for the previous winning team must be deleted so both teams don't keep `+1 GP`.

---

### Task 1: Forfeit Roster Stamping & Admin Schedule / Sync Endpoints

**Files:**
- Create: `lib/forfeit-sync.ts`
- Modify: `app/api/bash/admin/seasons/[id]/schedule/[gameId]/route.ts`
- Modify: `app/api/bash/admin/seasons/[id]/schedule/route.ts`
- Modify: `app/api/bash/sync/route.ts`
- Test: `tests/forfeit-sync.test.ts`

**Interfaces:**
- Produces:
  - `resolveForfeitOutcome(input: { isForfeit: boolean; status: string; homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null }): { kind: "not_forfeit" } | { kind: "double_forfeit" } | { kind: "single_forfeit"; winnerTeamSlug: string; loserTeamSlug: string }`
  - `applyForfeitPreset(forfeitingSide: "away" | "home" | "both"): { isForfeit: true; status: "final"; homeScore: number; awayScore: number; isOvertime: false; hasShootout: false }`
  - `syncForfeitRosterStats(gameId: string): Promise<void>`

- [ ] **Step 1: Write failing unit tests in `tests/forfeit-sync.test.ts`** covering `resolveForfeitOutcome`, `applyForfeitPreset`, `syncForfeitRosterStats` (single-team unplayed forfeit, retroactive played forfeit preserving audit rows while adding missing winning-team roster rows, switching winner, double forfeit cleanup, unchecking forfeit cleanup), and playoff series advancement on a single-team forfeit in `PATCH /api/bash/admin/seasons/[id]/schedule/[gameId]`.
- [ ] **Step 2: Run `pnpm vitest run tests/forfeit-sync.test.ts` to verify RED.**
- [ ] **Step 3: Implement `lib/forfeit-sync.ts` and wire `syncForfeitRosterStats` into `app/api/bash/admin/seasons/[id]/schedule/[gameId]/route.ts`, `app/api/bash/admin/seasons/[id]/schedule/route.ts`, and `app/api/bash/sync/route.ts`.** Also update series clinching in `schedule/[gameId]/route.ts` so finalized single-team forfeits (`homeScore !== awayScore`) count toward `winCounts`.
- [ ] **Step 4: Run `pnpm vitest run tests/forfeit-sync.test.ts` to verify GREEN.**

---

### Task 2: Admin Edit Game Modal Forfeiting Team Selector

**Files:**
- Modify: `components/admin/edit-game-modal.tsx`
- Test: `tests/edit-game-modal-forfeit.test.tsx`

**Interfaces:**
- Consumes: `applyForfeitPreset` from `lib/forfeit-sync.ts`

- [ ] **Step 1: Write failing component tests in `tests/edit-game-modal-forfeit.test.tsx`** verifying that toggling **Forfeit** ON reveals the **Forfeiting Team** selector (`Away Team`, `Home Team`, `Both Teams (Double Forfeit)`), automatically sets `status = "final"`, `isOvertime = false`, `hasShootout = false`, and the official score (`5–0` when Away forfeits, `0–5` when Home forfeits, `0–0` when Both forfeit), and toggling **Forfeit** OFF on an unplayed game resets status to `upcoming` and scores to `null`.
- [ ] **Step 2: Run `pnpm vitest run tests/edit-game-modal-forfeit.test.tsx` to verify RED.**
- [ ] **Step 3: Update `components/admin/edit-game-modal.tsx` to render the Forfeiting Team selector and auto-populate scores/status when toggled.**
- [ ] **Step 4: Run `pnpm vitest run tests/edit-game-modal-forfeit.test.tsx` to verify GREEN.**

---

### Task 3: Double Forfeit Standings, Head-to-Head & Team Detail Record

**Files:**
- Modify: `lib/standings.ts`
- Modify: `lib/head-to-head.ts`
- Modify: `lib/fetch-team-detail.ts`
- Test: `tests/standings-head-to-head.test.tsx`

**Interfaces:**
- Consumes: `BashGame` (`isForfeit`, `homeScore`, `awayScore`, `status`)

- [ ] **Step 1: Add failing tests in `tests/standings-head-to-head.test.tsx`** verifying that a finalized double forfeit (`isForfeit: true, homeScore: 0, awayScore: 0, status: "final"`) gives both teams `+1 GP`, `+1 L`, `+0 GF`, `+5 GA`, `-5 GD`, `0 PTS` in `computeStandings`, `computeHeadToHead`, and `fetchTeamDetail`.
- [ ] **Step 2: Run `pnpm vitest run tests/standings-head-to-head.test.tsx` to verify RED.**
- [ ] **Step 3: Update `lib/standings.ts`, `lib/head-to-head.ts`, and `lib/fetch-team-detail.ts` (both JS record loop and `allTeamResults` SQL ranking query) to handle double forfeits (`is_forfeit AND home_score = away_score`) as `0–5` regulation losses for both teams.**
- [ ] **Step 4: Run `pnpm vitest run tests/standings-head-to-head.test.tsx` to verify GREEN.**

---

### Task 4: Stat Queries, Rate Protection & Game Log Forfeit Badge

**Files:**
- Create: `lib/forfeit-sql.ts`
- Modify: `lib/fetch-player-stats.ts`
- Modify: `lib/fetch-team-detail.ts`
- Modify: `lib/fetch-team-stats.ts`
- Modify: `lib/fetch-player-detail.ts`
- Modify: `app/api/bash/player/[slug]/route.ts`
- Modify: `app/api/bash/draft/player-stats/[playerId]/route.ts`
- Modify: `lib/fetch-game-detail.ts`
- Modify: `components/player-page-content.tsx`
- Test: `tests/forfeit-stats.test.ts`
- Test: `tests/team-stats-aggregation.test.ts`
- Test: `tests/traded-player-integration.test.ts`
- Test: `tests/traded-player-read-edge-cases.test.ts`
- Test: `tests/traded-player-stats.test.ts`

**Interfaces:**
- Produces:
  - `forfeitEligibleGamePredicate(teamSlugExpr: SQL): SQL` in `lib/forfeit-sql.ts`
  - `isForfeit?: boolean` on `SkaterGameLog` and `GoalieGameLog` in `lib/fetch-player-detail.ts` and `components/player-page-content.tsx`

- [ ] **Step 1: Update `tests/forfeit-stats.test.ts` (and related SQL assertion tests) with failing tests** covering:
  - Winning-team forfeit rows included in `GP` across `fetchPlayerStats`, `fetchTeamDetail`, `fetchTeamStats`, `fetchPlayerDetail`, `GET /api/bash/player/[slug]`, and `GET /api/bash/draft/player-stats/[playerId]`.
  - Losing-team and double-forfeit rows excluded from `GP`.
  - Counting stats (`goals`, `assists`, `points`, `pim`, `gwg`, `ppg`, `shg`, `eng`, `hat_tricks`, `seconds`, `goals_against`, `shots_against`, `saves`, `shutouts`, `goalie_assists`, `wins`, `losses`) zeroed out when `g.is_forfeit` is true.
  - Skater `PTS/G` (including traded multi-team players and `0` non-forfeit GP players) and Team `PTS/G` / `SA/G` dividing by `played_gp` (`COUNT(DISTINCT game_id) FILTER (WHERE NOT g.is_forfeit)`).
  - Player Game Log returning `isForfeit: true` with `0` stats and `PlayerPageContent` rendering the `Forfeit` badge.
- [ ] **Step 2: Run `pnpm vitest run tests/forfeit-stats.test.ts` to verify RED.**
- [ ] **Step 3: Implement `lib/forfeit-sql.ts` and update `lib/fetch-player-stats.ts`, `lib/fetch-team-detail.ts`, `lib/fetch-team-stats.ts`, `lib/fetch-player-detail.ts`, `app/api/bash/player/[slug]/route.ts`, `app/api/bash/draft/player-stats/[playerId]/route.ts`, `lib/fetch-game-detail.ts`, and `components/player-page-content.tsx`.**
- [ ] **Step 4: Run `pnpm test:run`, `pnpm lint`, and `pnpm build` to verify the full suite, linter, and production build pass.**
