# PRD: Mid-Season Traded Player Support & Season Trade Log

> **Status**: Proposed (Phase 1 — PRD & Schema PR)  
> **Author**: Chris Torres & Antigravity  
> **Created**: 2026-10-16  
> **Target Release**: Fall 2026 (`bash-2026-2027`)  

---

## 1. Executive Summary

During an active BASH season, teams occasionally execute mid-season player trades (sometimes including future draft pick swaps for the following season). In Fall 2026 (`bash-2026-2027`), two trades occurred after Week 1 stats (`g129`, `g130`, `g131`) were finalized:
- **Trade #1:** Seals receive **Eddie Parsons** (`reign → seals`); Reign receives **Logan Truman** (`seals → reign`).
- **Trade #2:** Loons receive **Jonny Callan** & **Lee Jacobs** (`yetis → loons`); Yetis receive **Steph Tryphonas** & **Darrell Draper** (`loons → yetis`).

Currently, the database schema stores a player's season-level team assignment in `player_seasons (player_id, season_id, team_slug)`, while individual game stat rows (`player_game_stats` and `goalie_game_stats`) only store `(player_id, game_id, ...)` without recording which team the player represented in that game. Every read query across `/game/[id]`, `/team/[slug]`, and `/player/[slug]` infers the player's game-day team by joining against `player_seasons`.

This PRD defines the architecture, database schema changes, migration/backfill strategy, and phased implementation plan to:
1. Stamp `team_slug` directly onto `player_game_stats` and `goalie_game_stats` so historical box scores, team stat tables, and player game logs remain permanently tied to the team the player represented on game day.
2. Introduce a structured Season Trade Log (`season_trades` and `season_trade_items`) to record mid-season player swaps and future draft pick trades.
3. Unlock roster management during `active` seasons and provide a dedicated **"Record Trade"** workflow in `/admin/seasons/[id]`.

---

## 2. Problem Statement

### 2.1 Historical Box Score Corruption (`/game/[id]`)
`lib/fetch-game-detail.ts` determines which side of a regular/playoff game box score a player belongs on by checking:
```sql
EXISTS (
  SELECT 1 FROM player_seasons ps
  WHERE ps.player_id = p.id AND ps.season_id = ${seasonId} AND ps.team_slug = ${teamSlug}
)
```
If a player's `player_seasons.team_slug` is updated after a trade:
- **Case A (Traded to the opponent from a past game):** Darrell Draper (`148820`) played for the **Loons** in Week 1 `g130` (Loons @ Yetis) and was then traded to the **Yetis**. Updating his `player_seasons.team_slug` to `'yetis'` causes `fetchGameDetail('g130')` to move him off the Loons box score and onto the Yetis box score for a game he played *against* the Yetis.
- **Case B (Traded to a third team not in that past game):** If a player plays in `g129` (Reign @ Seals) and is later traded to the Loons, neither `home_team` (`seals`) nor `away_team` (`reign`) matches `ps.team_slug` (`loons`), causing the player to **disappear completely** from the `g129` box score.

### 2.2 Team Page Stat Misattribution (`/team/[slug]`)
`lib/fetch-team-detail.ts` joins `player_seasons` to `player_game_stats` by `player_id` and `season_id` without filtering by which team the player represented in each game. Updating `player_seasons.team_slug` transfers all of a player's prior-team stats to their new team and erases those stats from the team they actually scored them for.

### 2.3 Player Detail Page & Game Log Flip (`/player/[slug]`)
In `lib/fetch-player-detail.ts` and `app/api/bash/player/[slug]/route.ts`:
- **Per-Season Breakdown:** Groups by `ps.team_slug`, collapsing all games played in a season under the player's newest team instead of splitting rows per team played for.
- **Game Log `isHome` & `W/L` Flip:** Computes `const isHome = teamSlug ? r.home_team === teamSlug : true` using the player's *current* `player.team_slug`. For Darrell Draper in `g130` (Loons 2 @ Yetis 13), changing his current team to `yetis` flips his Week 1 game log from `@ Yetis, L 2–13` to `vs Loons, W 13–2`.

### 2.4 Post-Game Goalie Shot Corrections & Admin Game Editor (`lib/final-game-shots.ts`, `app/game/[id]/page.tsx`, `app/admin/games/[id]/edit/page.tsx`)
- `PATCH /api/bash/scorekeeper/[id]/state` and `finalShotUpdateSql` identify a saved goalie's side (`home` vs `away`) via `player_seasons.team_slug IN (g.home_team, g.away_team)`. If a goalie is traded mid-season, shot corrections on their earlier games fail or misidentify their side.
- `app/game/[id]/page.tsx` and `app/admin/games/[id]/edit/page.tsx` load `homeRoster` and `awayRoster` exclusively from `player_seasons`. After a player is traded, opening one of their earlier games in `AdminGameEditor` omits them from their game-day team's attendance and event dropdowns.

### 2.5 Locked Admin Roster UI & Missing Trade Workflow (`/admin/seasons/[id]`)
`components/admin/season-roster-tab.tsx` and `app/api/bash/admin/seasons/[id]/roster/route.ts` lock player additions and edits once `season.status` transitions from `"draft"` to `"active"`, and there is no UI or database table to record multi-player trades or future draft pick swaps.

---

## 3. Product Requirements & Desired Behavior

| Surface | Desired Behavior After a Mid-Season Trade |
|---|---|
| **Current Roster (`/admin/seasons/[id]`, Scorekeeper, Printable Scoresheets)** | `player_seasons.team_slug` reflects the player's **current** active team so upcoming games, scorekeeper attendance checklists, and printable scoresheets automatically list the player on their new team. |
| **Past Game Box Scores (`/game/[id]`) & Admin Game Editor** | Players and goalies remain permanently on the box score and `AdminGameEditor` roster of the team they actually played for on game day (`pgs.team_slug` / `ggs.team_slug`). |
| **Team Detail Pages (`/team/[slug]`)** | Displays all players currently on the team's roster (`ps.team_slug = slug`, showing `0 GP` until they play a game for that team) **plus** any former/traded players who logged non-sub stats *for that team* (`pgs.team_slug = slug`), summing only stats accumulated *for that team*. |
| **League Leaderboards (`/stats`) & Player Top Summary Card** | Combines all non-sub regular-season stats across all teams played for in the season so traded players are not penalized in league-wide point/goal rankings, while displaying their current team badge. |
| **Player Per-Season Table (`/player/[slug]`)** | Shows separate rows per `(season_id, team_slug)` when a player has logged games for multiple teams in the same season (e.g., `2026-2027 — Loons` and `2026-2027 — Yetis`). |
| **Player Game Logs (`/player/[slug]`)** | Uses the game-level `team_slug` (`COALESCE(pgs.team_slug, player.team_slug)`) to compute `isHome`, `opponent`, `teamScore`, `opponentScore`, and `W/L/OTW/OTL`. |
| **Admin Roster & Trade UI (`/admin/seasons/[id]`)** | Unlocks direct player add/edit during `active` seasons and adds a **"Record Trade"** modal supporting multi-player swaps between two teams, optional future draft pick swaps, and a visible **Season Trades** log. |

---

## 4. Database Schema Design (`lib/db/schema.ts`)

### 4.1 Game-Level Team Attribution (`player_game_stats` & `goalie_game_stats`)

Add a nullable `team_slug` foreign key referencing `teams.slug` to both `player_game_stats` and `goalie_game_stats`:

```ts
// In player_game_stats:
teamSlug: text("team_slug").references(() => teams.slug),
// Index:
index("idx_player_game_stats_team").on(t.teamSlug),

// In goalie_game_stats:
teamSlug: text("team_slug").references(() => teams.slug),
// Index:
index("idx_goalie_game_stats_team").on(t.teamSlug),
```

**Why nullable with `COALESCE` fallback?**
Making `team_slug` nullable allows zero-downtime deployment: existing rows continue to work via `COALESCE(pgs.team_slug, ...)` before and during backfill, and ad-hoc tryout games without standard franchise slugs remain compatible. All scorekeeper finalizations and Sportability boxscore syncs will populate `team_slug` going forward, and our backfill script will populate `team_slug` on all historical rows where the player's game-day team is known.

### 4.2 Season Trade Log Tables (`season_trades` & `season_trade_items`)

Add two new tables to record mid-season trades (both player swaps and future draft pick swaps):

```ts
export const seasonTrades = pgTable(
  "season_trades",
  {
    id: serial("id").primaryKey(),
    seasonId: text("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    teamASlug: text("team_a_slug")
      .notNull()
      .references(() => teams.slug),
    teamBSlug: text("team_b_slug")
      .notNull()
      .references(() => teams.slug),
    notes: text("notes"),
    tradedAt: timestamp("traded_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_season_trades_season").on(t.seasonId)]
)

export const seasonTradeItems = pgTable(
  "season_trade_items",
  {
    id: serial("id").primaryKey(),
    tradeId: integer("trade_id")
      .notNull()
      .references(() => seasonTrades.id, { onDelete: "cascade" }),
    itemType: text("item_type").notNull(), // 'player' | 'draft_pick'
    fromTeamSlug: text("from_team_slug")
      .notNull()
      .references(() => teams.slug),
    toTeamSlug: text("to_team_slug")
      .notNull()
      .references(() => teams.slug),
    // Populated when itemType === 'player'
    playerId: integer("player_id").references(() => players.id),
    // Populated when itemType === 'draft_pick'
    draftPickRound: integer("draft_pick_round"),
    draftPickOriginalTeamSlug: text("draft_pick_original_team_slug").references(() => teams.slug),
    draftPickTargetSeason: text("draft_pick_target_season"),
  },
  (t) => [
    index("idx_season_trade_items_trade").on(t.tradeId),
    index("idx_season_trade_items_player").on(t.playerId),
  ]
)
```

> [!NOTE]
> **Future Draft Wizard Integration:** Recording `draft_pick` items with `fromTeamSlug`, `toTeamSlug`, `draftPickRound`, `draftPickOriginalTeamSlug`, and `draftPickTargetSeason` captures the exact fields needed by `draft_trades` in the Draft system. In a future milestone, creating a new season's draft in the Draft Wizard can query `season_trade_items` for `draftPickTargetSeason` and offer a one-click import into pre-draft pick trades.

---

## 5. Technical Design & Query Specifications

### 5.1 Stat Write Paths & Duplicate Player Merging
1. **Scorekeeper Finalize (`app/api/bash/scorekeeper/[id]/finalize/route.ts`):**
   - Construct `const homeAttendanceSet = new Set(state.homeAttendance)`.
   - When upserting `player_game_stats`, set `teamSlug = homeAttendanceSet.has(playerId) ? homeSlug : awaySlug` in both `.values(...)` and `.onConflictDoUpdate({ set: ... })`.
   - In `computeTeamGoalieStats`, return `teamSlug` on each goalie stat entry and write `teamSlug: gs.teamSlug` when upserting `goalie_game_stats`.
2. **Sportability Boxscore Sync (`app/api/bash/sync/route.ts`):**
   - Pass `teamSlug: currentTeamSlug` when upserting `player_game_stats` and `goalie_game_stats`.
   - When ensuring a `player_seasons` entry exists in `syncBoxscore`, only insert into `player_seasons` if no `player_seasons` row already exists for `(playerId, seasonId)` (`WHERE NOT EXISTS (SELECT 1 FROM player_seasons WHERE player_id = ${playerId} AND season_id = ${seasonId})`) so syncing a past game never creates a duplicate `player_seasons` row after a mid-season trade.
   - In the boxscore completion check (`goalieCheck`), select `COALESCE(ggs.team_slug, (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = ggs.player_id AND ps.season_id = ${seasonId} LIMIT 1)) AS team_slug`.
3. **Final Game Shot Corrections (`lib/final-game-shots.ts` & `app/api/bash/scorekeeper/[id]/state/route.ts`):**
   - Resolve each goalie's `sides` array by checking `s.team_slug` first:
     ```sql
     CASE
       WHEN s.team_slug = g.home_team THEN jsonb_build_array('home')
       WHEN s.team_slug = g.away_team THEN jsonb_build_array('away')
       ELSE COALESCE(...)
     END
     ```
4. **Duplicate Player Merge (`lib/merge-duplicates.ts` & `app/api/bash/admin/players/merge-manual/route.ts`):**
   - Add `await rawSql(sql\`UPDATE season_trade_items SET player_id = \${canonicalId} WHERE player_id = \${dupeId}\`)` before deleting the duplicate player row in both automated (`lib/merge-duplicates.ts`) and manual (`app/api/bash/admin/players/merge-manual/route.ts`) merge flows so `season_trade_items.player_id` foreign keys are preserved during player merges.

### 5.2 Stat Read Queries (Single-Row Fallback & Roster Inclusion)
To prevent row fan-out if a legacy season has multiple `player_seasons` rows for the same `(player_id, season_id)`, all fallback lookups from a game stat row to `player_seasons` use a scalar subquery (`(SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = ... AND ps.season_id = ... LIMIT 1)`) rather than an unconstrained `LEFT JOIN player_seasons`.

1. **Game Detail Box Score (`lib/fetch-game-detail.ts`) & Admin Game Editor Rosters (`app/game/[id]/page.tsx`, `app/admin/games/[id]/edit/page.tsx`):**
   - In `lib/fetch-game-detail.ts`, match non-adhoc players/goalies to `teamSlug` (`home_team` or `away_team`) using:
     ```sql
     (
       pgs.team_slug = ${teamSlug}
       OR (
         pgs.team_slug IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM player_seasons ps
             WHERE ps.player_id = p.id AND ps.season_id = ${seasonId} AND ps.team_slug = ${teamSlug}
           )
           OR EXISTS (
             SELECT 1 FROM adhoc_game_rosters agr
             WHERE agr.game_id = ${gameId} AND agr.player_id = p.id AND agr.team_side = ${teamSide}
           )
         )
       )
     )
     ```
   - Apply the identical pattern (`ggs.team_slug = ${teamSlug} OR (ggs.team_slug IS NULL AND ...)`) to `getGoalieStats`.
   - In `app/game/[id]/page.tsx` and `app/admin/games/[id]/edit/page.tsx`, update `getRoster` for regular/playoff games to `UNION` current `player_seasons` for `(seasonId, teamSlug)` — excluding any player who recorded `player_game_stats` or `goalie_game_stats` for a *different* team in `${gameId}` (`NOT EXISTS (SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = ${gameId} AND pgs.player_id = p.id AND pgs.team_slug IS NOT NULL AND pgs.team_slug <> ${teamSlug})` and same for `goalie_game_stats`) — with any player who has `player_game_stats` or `goalie_game_stats` for `(game_id = ${gameId}, team_slug = ${teamSlug})`. This keeps traded players on their game-day team's roster without duplicating them onto the opposing team's roster in head-to-head games.
2. **Team Detail Page (`lib/fetch-team-detail.ts`):**
   - Anchor the skater query on players who either belong to `${slug}` on the current active roster (`ps_curr.team_slug = ${slug} AND NOT ps_curr.is_goalie`) **OR** have logged non-sub skater stats for `${slug}` in `seasonId`, then `LEFT JOIN` their non-sub regular/playoff/championship game stats for `${slug}`:
     ```sql
     WITH team_game_stats AS (
       SELECT pgs.*
       FROM player_game_stats pgs
       JOIN games g ON pgs.game_id = g.id
         AND NOT g.is_forfeit
         AND g.season_id = ${seasonId}
         AND g.game_type IN ('regular', 'playoff', 'championship')
       WHERE NOT pgs.is_sub
         AND COALESCE(
           pgs.team_slug,
           (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = pgs.player_id AND ps.season_id = ${seasonId} LIMIT 1)
         ) = ${slug}
     ), eligible_skaters AS (
       SELECT ps.player_id FROM player_seasons ps
       WHERE ps.season_id = ${seasonId} AND ps.team_slug = ${slug} AND NOT ps.is_goalie
       UNION
       SELECT tgs.player_id FROM team_game_stats tgs
     )
     SELECT
       p.id, p.name,
       COUNT(tgs.game_id)::int as gp,
       COALESCE(SUM(tgs.goals), 0)::int as goals,
       COALESCE(SUM(tgs.assists), 0)::int as assists,
       COALESCE(SUM(tgs.points), 0)::int as points,
       COALESCE(SUM(tgs.gwg), 0)::int as gwg,
       COALESCE(SUM(tgs.ppg), 0)::int as ppg,
       COALESCE(SUM(tgs.shg), 0)::int as shg,
       COALESCE(SUM(tgs.eng), 0)::int as eng,
       COALESCE(SUM(tgs.hat_tricks), 0)::int as hat_tricks,
       COALESCE(SUM(tgs.pen), 0)::int as pen,
       COALESCE(SUM(tgs.pim), 0)::int as pim
     FROM eligible_skaters es
     JOIN players p ON p.id = es.player_id
     LEFT JOIN team_game_stats tgs ON tgs.player_id = p.id
     GROUP BY p.id, p.name
     ORDER BY points DESC, goals DESC, p.name ASC
     ```
   - Apply the same CTE pattern (`team_goalie_stats` + `eligible_goalies` where `ps.is_goalie = true`) to the goalies query. This ensures newly acquired traded players appear immediately on their new team's page with `0 GP` while keeping prior-team game stats on their previous team's page.
3. **Player Detail Page (`lib/fetch-player-detail.ts` & `app/api/bash/player/[slug]/route.ts`):**
   - `fetchPlayerQueryGroup` (`lib/fetch-player-query-group.ts`) materializes `SELECT * FROM player_game_stats` and `SELECT * FROM goalie_game_stats`, automatically exposing `team_slug` on `player_stats` and `goalie_stats`.
   - **Per-Season Skater & Goalie Queries (Regular & Playoff):** Resolve each game's effective team via `COALESCE(pgs.team_slug, (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = pgs.player_id AND ps.season_id = g.season_id LIMIT 1))` (and `ggs.team_slug`), join `teams t` on that effective `team_slug`, and `GROUP BY` `g.season_id`, the effective `team_slug`, and `t.name`.
   - **Game Log Queries (Regular, Playoff, Exhibition — Skater & Goalie):** Select `pgs.team_slug AS player_team_slug` (and `ggs.team_slug AS player_team_slug`), and compute `const effectiveTeamSlug = r.player_team_slug ?? teamSlug` and `const isHome = effectiveTeamSlug ? r.home_team === effectiveTeamSlug : true` across all game-log `.map` blocks in both `lib/fetch-player-detail.ts` and `app/api/bash/player/[slug]/route.ts`.

### 5.3 Admin Roster & Season Trades API / UI
1. **Active-Season Roster Mutations (`app/api/bash/admin/seasons/[id]/roster/route.ts`):**
   - Allow `POST`, `PATCH`, and `DELETE` when `season.status === "draft" || season.status === "active"` (reject `"completed"` seasons with HTTP `400`).
   - In `POST`, explicitly check if the player already has a `player_seasons` row in `seasonId` (across any `teamSlug`) and return HTTP `400` (`"Player is already assigned to a team this season"`) so a player cannot be added to two teams simultaneously.
2. **Season Trades Endpoint (`app/api/bash/admin/seasons/[id]/trades/route.ts`):**
   - `GET`: Returns all trades and items for the season ordered by `traded_at DESC, id DESC`.
   - `POST`: Verifies `season.status === "draft" || season.status === "active"` (returning `404` if missing or `400` if `"completed"`), validates payload via `validateTradeInput` (`lib/trade-helpers.ts`, supporting draft pick rounds `1..20`), then sequentially inserts `season_trades`, inserts `season_trade_items`, and updates `player_seasons.team_slug` for each traded player.
3. **Admin Roster Tab UI (`components/admin/season-roster-tab.tsx`):**
   - Unlock row editing and **"Add Player"** when `seasonStatus === "draft" || seasonStatus === "active"`.
   - Add a **"Record Trade"** button and modal (Team A & Team B selectors, player checklists for each team, optional future draft pick swap rows with direction, round `1–20`, original owner, target season, and optional notes).
   - Render a **"Season Trades"** history section below the roster table.

---

## 6. Phased Implementation Plan

### Phase 1: PRD & Drizzle Schema Definitions (Current PR)
- [x] **Step 1.1:** Draft comprehensive PRD (`docs/prd-traded-player-support.md`) with technical design and phased implementation plan.
- [x] **Step 1.2:** Update `lib/db/schema.ts` to add `teamSlug` to `playerGameStats` and `goalieGameStats` and define `seasonTrades` and `seasonTradeItems` tables + exported types.

### Phase 2: Stat Write Paths & Read Queries (Follow-up PR)
- [ ] **Step 2.1:** Add `lib/trade-helpers.ts` (`validateTradeInput`) and unit tests in `tests/trade-helpers.test.ts`.
- [ ] **Step 2.2:** Update stat write paths (`app/api/bash/scorekeeper/[id]/finalize/route.ts`, `app/api/bash/sync/route.ts`, `lib/final-game-shots.ts`, `app/api/bash/scorekeeper/[id]/state/route.ts`, `lib/merge-duplicates.ts`, `app/api/bash/admin/players/merge-manual/route.ts`) to stamp and preserve `team_slug` / `season_trade_items`, and update `tests/scorekeeper-finalize.test.ts` + `tests/final-game-shots.test.ts`.
- [ ] **Step 2.3:** Update stat read queries (`lib/fetch-game-detail.ts`, `lib/fetch-team-detail.ts`, `lib/fetch-player-detail.ts`, `app/api/bash/player/[slug]/route.ts`, `app/game/[id]/page.tsx`, `app/admin/games/[id]/edit/page.tsx`) and add unit tests in `tests/traded-player-stats.test.ts`.

### Phase 3: Admin Trade API & Roster UI
- [ ] **Step 3.1:** Unlock `active` season mutations in `app/api/bash/admin/seasons/[id]/roster/route.ts`, implement `GET`/`POST /api/bash/admin/seasons/[id]/trades`, and add unit tests in `tests/admin-season-trades.test.ts`.
- [ ] **Step 3.2:** Update `components/admin/season-roster-tab.tsx` with active-season editing, the **"Record Trade"** modal, and the **"Season Trades"** log, plus UI tests in `tests/season-roster-trade-ui.test.tsx`.

### Phase 4: Database Migration, Historical Backfill & Week 1 Trades Execution
- [ ] **Step 4.1:** Create `scripts/deploy-trades-schema.ts` to apply `ALTER TABLE` / `CREATE TABLE` DDL and backfill `player_game_stats.team_slug` and `goalie_game_stats.team_slug` across all existing games using priority order (every rule guarantees `team_slug IN (games.home_team, games.away_team)`):
  1. `game_live.state->'homeAttendance'` / `'awayAttendance'` matching `games.home_team` / `games.away_team`.
  2. `adhoc_game_rosters.team_side` (`'home' → games.home_team`, `'away' → games.away_team`).
  3. `player_seasons.team_slug` where `player_seasons.season_id = games.season_id` and `player_seasons.team_slug IN (games.home_team, games.away_team)` (when unambiguous).
- [ ] **Step 4.2:** Update `scripts/export-prod-db.ts` to include `team_slug` when copying `player_game_stats` and `goalie_game_stats`, and to copy `season_trades` and `season_trade_items`.
- [ ] **Step 4.3:** Run `scripts/deploy-trades-schema.ts` to backfill `team_slug` **before** mutating any Week 1 rosters (ensuring Darrell Draper's Week 1 game `g130` is permanently stamped with `team_slug = 'loons'`).
- [ ] **Step 4.4:** Record Week 1 Trade #1 (Eddie Parsons ↔ Logan Truman) and Trade #2 (Jonny Callan & Lee Jacobs ↔ Steph Tryphonas & Darrell Draper) via the Admin UI or `scripts/apply-fall-2026-week1-trades.ts`.
