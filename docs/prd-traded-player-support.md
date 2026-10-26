# PRD: Mid-Season Traded Player Support & Season Trade Log

> **Status**: Implemented  
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
| **League Leaderboards (`/stats`) & Player Top Summary Card** | On `/stats` (`All Teams` view) and the player top summary card, combines all non-sub regular-season stats across all teams played for in the season so traded players are not penalized in league-wide rankings, while displaying their current team badge. When filtering `/stats` by a **specific team**, displays any player who logged $\ge 1\text{ GP}$ for that team (`COALESCE(pgs.team_slug, ps.team_slug) = teamFilter`) with **only the stats accumulated for that team**. |
| **Player Per-Season Table (`/player/[slug]`)** | Shows separate rows per `(season_id, team_slug)` when a player has logged games for multiple teams in the same season (e.g., `2026-2027 — Loons` and `2026-2027 — Yetis`). |
| **Player Game Logs (`/player/[slug]`)** | Uses the game-level `team_slug` (`COALESCE(pgs.team_slug, player.team_slug)`) to compute `isHome`, `opponent`, `teamScore`, `opponentScore`, and `W/L/OTW/OTL`. |
| **Admin Roster & Trade UI (`/admin/seasons/[id]`)** | Unlocks direct player add/edit during `active` seasons, caps the Roster Management table to ~25 visible rows with a sticky header and a `↔ N Trades ↓` jump badge, and provides a **"Record Trade"** modal + **Season Trades** table supporting 2-team and $N$-team trades, separate **Players Sent** and **Picks Sent** columns, per-team subrows, provenance tracking for re-traded picks, and automatic pre-population into the next **Fall** season's draft. |

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

Add two new tables to record mid-season trades (supporting 2-team, 3-team circular, or $N$-team player swaps and future draft pick swaps):

```ts
export const seasonTrades = pgTable(
  "season_trades",
  {
    id: serial("id").primaryKey(),
    seasonId: text("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    teamSlugs: text("team_slugs").array().notNull(), // Participating teams (2+ teams)
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
> **$N$-Team Circular Trade Support & Automatic Fall Draft Pick Integration:**
> - Storing `teamSlugs` (`text[]`) on `season_trades` alongside per-item `fromTeamSlug` and `toTeamSlug` edges on `season_trade_items` natively models 2-team, 3-team circular (`A → B → C → A`), and $N$-team trades without requiring fixed `team_a_slug` / `team_b_slug` header columns.
> - Mid-season draft pick trades always apply to the **next Fall season** (computed via `getNextFallSeasonId(seasonId)` in `lib/trade-helpers.ts`, e.g., `bash-2026-2027 → 2027-2028`), never to a Summer season.
> - When creating (`POST /api/bash/admin/seasons/[id]/draft`) or starting (`POST /api/bash/admin/seasons/[id]/draft/[draftId]/start`) a **Fall** draft (`seasonType === "fall"`), the server automatically queries `season_trade_items` (`item_type = 'draft_pick'`) matching `getTargetFallSeasonCandidates(seasonId)` and seeds `draft_trades` / `draft_trade_items` so traded picks are automatically reflected on the Fall draft board (while never applying Fall trades to Summer drafts).

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
       JOIN games g ON pgs.game_id = g.id AND NOT g.is_forfeit
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
   - Apply the same CTE pattern (`team_goalie_stats` + `eligible_goalies` where `ps.is_goalie = true`, keeping `JOIN games g ON ggs.game_id = g.id AND NOT g.is_forfeit` on a single line) to the goalies query, using `COUNT(tgs.game_id)::int as gp` and wrapping `SUM(tgs.goals_against)`, `SUM(tgs.saves)`, `SUM(tgs.shots_against)`, `SUM(tgs.seconds)`, `SUM(tgs.shutouts)`, and `SUM(tgs.goalie_assists)` in `COALESCE(..., 0)::int`. This ensures newly acquired traded skaters and goalies appear immediately on their new team's page with `0 GP` and non-null `0` totals while keeping prior-team game stats on their previous team's page.
3. **Player Detail Page (`lib/fetch-player-detail.ts` & `app/api/bash/player/[slug]/route.ts`):**
   - `fetchPlayerQueryGroup` (`lib/fetch-player-query-group.ts`) materializes `SELECT * FROM player_game_stats` and `SELECT * FROM goalie_game_stats`, automatically exposing `team_slug` on `player_stats` and `goalie_stats`.
   - **Per-Season Skater & Goalie Queries (Regular & Playoff):** Resolve each game's effective team via `COALESCE(pgs.team_slug, (SELECT ps.team_slug FROM player_seasons ps WHERE ps.player_id = pgs.player_id AND ps.season_id = g.season_id LIMIT 1))` (and `ggs.team_slug`), join `teams t` on that effective `team_slug`, and `GROUP BY` `g.season_id`, the effective `team_slug`, and `t.name`.
   - **Game Log Queries (Regular, Playoff, Exhibition — Skater & Goalie):** Select `pgs.team_slug AS player_team_slug` (and `ggs.team_slug AS player_team_slug`), and compute `const effectiveTeamSlug = r.player_team_slug ?? teamSlug` and `const isHome = effectiveTeamSlug ? r.home_team === effectiveTeamSlug : true` across all game-log `.map` blocks in both `lib/fetch-player-detail.ts` and `app/api/bash/player/[slug]/route.ts`.
4. **Season Leaderboard & Team-Filtered Split Stats (`lib/fetch-player-stats.ts`, `components/stats-tab.tsx`, `lib/hockey-data.ts`):**
   - For single-season queries (`!isAllTime && !statsOnly`), `fetchPlayerStats` groups `player_game_stats` and `goalie_game_stats` by `(p.id, p.name, COALESCE(pgs.team_slug, ps.team_slug), ...)` in a single query wave (maintaining the 2-query-per-request budget).
   - `skatersByTeam` and `goaliesByTeam` map directly from those per-team rows so each `(player, team_slug)` pair with $\ge 1\text{ GP}$ has its exact per-team stat row.
   - `skaters` and `goalies` roll up all rows by `p.id` in memory (attaching the player's current `player_seasons.team_slug` badge and recomputing `ptsPg`, `savePercentage`, and `gaa` from the summed totals).
   - In `StatsTab` (`components/stats-tab.tsx`), selecting **All Teams** renders the combined `skaters` / `goalies` arrays, while selecting a specific team tab filters `skatersByTeam` / `goaliesByTeam` by `teamSlug === teamFilter`.

### 5.3 Admin Roster & Season Trades API / UI
1. **Active-Season Roster Mutations (`app/api/bash/admin/seasons/[id]/roster/route.ts`):**
   - Allow `POST`, `PATCH`, and `DELETE` when `season.status === "draft" || season.status === "active"` (reject `"completed"` seasons with HTTP `400`).
   - In `POST`, explicitly check if the player already has a `player_seasons` row in `seasonId` (across any `teamSlug`) and return HTTP `400` (`"Player is already assigned to a team this season"`) so a player cannot be added to two teams simultaneously.
2. **Season Trades Endpoint (`app/api/bash/admin/seasons/[id]/trades/route.ts`):**
   - `GET`: Returns all trades and items for the season ordered by `traded_at DESC, id DESC`.
   - `POST`: Verifies `season.status === "draft" || season.status === "active"` (returning `404` if missing or `400` if `"completed"`), validates payload via `validateTradeInput` (`lib/trade-helpers.ts`, supporting 2+ participating `teamSlugs`, directed player moves `{ playerId, fromTeamSlug, toTeamSlug }`, and draft pick rounds `1..20`), and then executes the entire trade atomically in a **single-statement data-modifying CTE** via `rawSql` (following the pattern in `lib/final-game-shots.ts` since `drizzle-orm/neon-http` does not support multi-statement `db.transaction()`):
     - `trade_player_moves`: Unpacks directed player moves from `jsonb_to_recordset(${playerMovesJson}::jsonb) AS m("playerId" int, "fromTeamSlug" text, "toTeamSlug" text)`.
     - `locked_season`: Locks and verifies `seasons.id = ${seasonId}` has `status IN ('draft', 'active')`.
     - `locked_rosters`: Locks (`FOR UPDATE`) the `player_seasons` rows in `season_id` joining `trade_player_moves m ON ps.player_id = m."playerId" AND ps.team_slug = m."fromTeamSlug"` to verify every traded player currently belongs to their expected `fromTeamSlug`.
     - `guard`: Requires `locked_season` to exist, verifies all participating `teamSlugs` belong to `season_teams` for `seasonId` (`(SELECT count(*) FROM season_teams WHERE season_id = ${seasonId} AND team_slug = ANY(${teamSlugsArray}::text[])) = ${teamSlugs.length}`), and requires the count of matched `locked_rosters` rows to equal `playerMoves.length`. If any precondition fails, `guard` returns 0 rows and the statement performs 0 writes.
     - `updated_rosters`: Updates `player_seasons ps SET team_slug = m."toTeamSlug" FROM trade_player_moves m, guard WHERE ps.season_id = ${seasonId} AND ps.player_id = m."playerId" AND ps.team_slug = m."fromTeamSlug"` (preventing partial player swaps across 2, 3, or $N$ teams).
     - `inserted_trade`: Inserts the `season_trades (season_id, team_slugs, notes)` header row gated on `FROM guard WHERE (SELECT count(*) FROM updated_rosters) = ${expectedPlayerCount} RETURNING id, traded_at`.
     - `inserted_items`: Inserts all `season_trade_items` rows (`player` and `draft_pick` items) from `jsonb_to_recordset` joined against `inserted_trade`.
     - Because Postgres executes a single SQL statement with data-modifying CTEs inside an implicit server transaction, **either the trade record, all trade items, and all player roster updates succeed together, or the entire statement rolls back with zero partial state**.
   - `DELETE` (Undo Latest Trade): Allows undoing **only the most recent trade** (`ORDER BY traded_at DESC, id DESC LIMIT 1`) when `season.status === "draft" || season.status === "active"` and **before any traded player has played a game for their new team**:
     - Verifies `tradeId` matches the latest trade in `seasonId` (returning HTTP `409` if an older trade is targeted).
     - Verifies every player moved in that trade is still assigned to `to_team_slug` in `player_seasons` and has **zero** `player_game_stats` or `goalie_game_stats` rows for `to_team_slug` in `seasonId` since the trade (returning HTTP `409` with an actionable message if a player has already played a game for their new team).
     - Executes the undo atomically in a single-statement data-modifying CTE (`locked_season`, `latest_trade`, `player_items`, `locked_rosters`, `post_trade_games`, `guard`, `reverted_rosters`, `deleted_trade`) that reverts `player_seasons.team_slug` back to `from_team_slug` and deletes the `season_trades` row (cascading to `season_trade_items`).
3. **Admin Roster Tab UI (`components/admin/season-roster-tab.tsx`):**
   - Unlock row editing and **"Add Player"** when `seasonStatus === "draft" || seasonStatus === "active"`.
   - Cap the **Roster Management** table at ~25 visible rows (`max-h-[1060px] overflow-y-auto`) with a sticky header (`sticky top-0 z-10 bg-background`) and an interactive `↔ N Trades ↓` jump pill in the header that smoothly scrolls to the **Season Trades** section.
   - Place the **"Record Trade"** button in the **Season Trades** card header. The modal uses a two-step flow:
     - **Step 1 (Configure Trade):** Per-team trade cards (`Team A`, `Team B`, `+ Add Team to Trade`) with `<TeamLogo>` badges inside each team selector, subsection header (`[Logo] <Team> Players to Trade`, `[Logo] <Team> Draft Picks to Trade`), and destination indicator (`→ [Logo] <Destination Team>`). When a draft pick round (`Round 1`–`Round 15`, target season locked to `getNextFallSeasonId(seasonId)`) is chosen, `getAcquiredPickOriginsForRound` inspects prior `season_trades` and only reveals the second selector (`Own Round X Pick` vs. `Acquired Round X Pick (from <Team>)`) when the sending team holds acquired pick(s) in that round. Clicking **"Review Trade"** validates the trade and advances to Step 2.
     - **Step 2 (Review Mid-Season Trade):** Renders a vertical confirmation summary table grouping each participating team (`[Logo] <Team>`) above stacked **Players Sent** and **Picks Sent** rows (each asset showing `→ [Logo] <Destination Team>` and acquired pick provenance), followed by a separate **Trade Notes** card below the table, with **Back** and **Execute Trade** actions.
   - Render the **Season Trades** log using per-team subrows (`rowSpan` on `Date`/`Trade #` and `Notes`) with separate **Team** (`[Logo] <Team>`), **Players Sent**, **Picks Sent** (with `(from <Team>, Trade #N)` provenance when re-traded), and **Notes** columns. In 3+ team trades, each asset shows `→ [Destination Team Logo]`, and every player/pick chip has a single styled `<Tooltip>` hover summary (`<Team A> sends <Player/Pick> to <Team B>`). On the most recent trade (`tradeIdx === 0`), render an **Undo** button with a confirmation `AlertDialog` that calls `DELETE /api/bash/admin/seasons/[id]/trades?tradeId=N`.
4. **Automatic Fall Draft Pre-Population (`app/api/bash/admin/seasons/[id]/draft/route.ts` & `.../start/route.ts`):**
   - When creating a draft (`POST /api/bash/admin/seasons/[id]/draft`) for a Fall season (`seasonType === "fall"`), if no explicit `preDraftTrades` array is supplied, the endpoint automatically queries `season_trade_items` (`item_type = 'draft_pick'`) where `draft_pick_target_season` matches `getTargetFallSeasonCandidates(seasonId)` (filtered to active `season_teams`) and inserts corresponding `draft_trades` and `draft_trade_items`.
   - When starting a Fall draft (`POST /api/bash/admin/seasons/[id]/draft/[draftId]/start`), if the draft instance has zero non-simulation `draft_trades`, it performs the same automatic sync before resolving `resolvePickOwnership`, ensuring mid-season pick trades made after draft creation are still applied. Summer drafts (`seasonType === "summer"`) never import Fall pick trades.

### 5.4 Historical Sportability Trade Backfill Design
In historical Sportability seasons (`1999-2000` through `2025-2026`), Sportability overwrote a traded player's season roster assignment with their **post-trade team**, and `Game.asp` dynamically grouped box score rows by that final team rather than the team the player represented on game day. For example, in Game `1549397` (`2018-11-03`, Rink Rats 1 at Kings 4), Sportability renders a third `Haze Players` table section for `Brendan Nichols` (`1G`, who scored Rink Rats' only goal), `Harry Zuzan` (`Rink Rats → Haze`), and `Harrison Hansen` (`Kings → Haze`).

Cross-referencing the verified 159-record historical trade dataset from [`kaylesworth/bash-scraper/extra/traded_players.json`](https://github.com/kaylesworth/bash-scraper/blob/main/extra/traded_players.json) (alongside `extra/name_merges.json` and Sportability `Rosters.asp` `TmID` values) against our database establishes 100% coverage across all 26 leagues (`159/159` players, `159/159` `previous_team_id` / `team_name` pairs) and resolves:
- **825 of 858 (`96.2%`)** unstamped skater box score rows (`player_game_stats.team_slug IS NULL`) and **28 of 40 (`70.0%`)** unstamped goalie box score rows (`goalie_game_stats.team_slug IS NULL`) where a player was later traded to a third team not participating in that earlier game.
- **167 pre-trade head-to-head games** (`{g.home_team, g.away_team} = {fromTeamSlug, toTeamSlug}`) where a player's original team played against their post-trade team *before* the trade took place, which were previously attributed to the post-trade team.

To backfill historical trade data cleanly:
1. **Vendor Canonical Historical Trade Dataset (`data/historical-traded-players.json`):**
   - Check in a normalized JSON artifact derived from `extra/traded_players.json`, `extra/name_merges.json`, and Sportability `TmID` mappings containing all 159 verified entries (`seasonId`, `leagueId`, `playerName`, `sportabilityPlayerId`, `fromTeamSlug`, `toTeamSlug`, and `gameDates`).
2. **Two-Pass Historical Backfill & Head-to-Head Correction Script:**
   - **Pass 1 (3rd-Team Orphan Box Score Rows):** For each `(seasonId, playerId, fromTeamSlug, toTeamSlug)` entry, update `player_game_stats` and `goalie_game_stats` rows in `seasonId` where `team_slug IS NULL` (or `team_slug NOT IN (g.home_team, g.away_team)`) and `fromTeamSlug IN (g.home_team, g.away_team)` to `team_slug = fromTeamSlug`.
   - **Pass 2 (Pre-Trade Head-to-Head Matchups):** Compute `maxFromDate` (latest game in `seasonId` where only `fromTeamSlug` participated) and `minToDate` (earliest game in `seasonId` where only `toTeamSlug` participated). For any head-to-head matchup (`{g.home_team, g.away_team} = {fromTeamSlug, toTeamSlug}`) with `g.date <= maxFromDate` and `g.date < minToDate`, set `team_slug = fromTeamSlug`. For the 56 head-to-head games falling inside the transition window between `maxFromDate` and `minToDate`, reconcile the player's side using box-score goal sums (`SUM(pgs.goals) = g.home_score / g.away_score`), goalie `result` / `goals_against`, or BASH Trade History sheet dates (`trade_parsing.py`).
3. **Seed Historical `season_trades` & `season_trade_items` Audit Records:**
   - Idempotently insert historical trade records into `season_trades` and `season_trade_items` (`item_type = 'player'`, `from_team_slug = fromTeamSlug`, `to_team_slug = toTeamSlug`, and `traded_at` derived from the transition window between `maxFromDate` and `minToDate`) so historical season pages and player profiles surface a complete trade log.

---

## 6. Phased Implementation Plan

### Phase 1: PRD, Drizzle Schema & Idempotent DB Migration Script
- [x] **Step 1.1:** Draft comprehensive PRD (`docs/prd-traded-player-support.md`) with technical design and phased implementation plan.
- [x] **Step 1.2:** Update `lib/db/schema.ts` to add `teamSlug` to `playerGameStats` and `goalieGameStats` and define `seasonTrades` and `seasonTradeItems` tables + exported types.
- [x] **Step 1.3:** Create `scripts/deploy-trades-schema.ts` to idempotently apply `ALTER TABLE` / `CREATE TABLE` DDL (`ADD COLUMN IF NOT EXISTS team_slug`, `CREATE TABLE IF NOT EXISTS season_trades`, `CREATE TABLE IF NOT EXISTS season_trade_items`, and indexes) and backfill `player_game_stats.team_slug` and `goalie_game_stats.team_slug` across all existing games using priority order (every rule guarantees `team_slug IN (games.home_team, games.away_team)` and is unambiguous):
  1. `game_live.state->'homeAttendance'` / `'awayAttendance'` matching `games.home_team` / `games.away_team` (with `COALESCE(..., false)` null-safe XOR).
  2. `adhoc_game_rosters.team_side` (`'home' → games.home_team`, `'away' → games.away_team`).
  3. `player_seasons.team_slug` where `player_seasons.season_id = games.season_id`, `games.game_type NOT IN ('exhibition', 'tryout')`, `player_seasons.team_slug IN (games.home_team, games.away_team)` (when unambiguous), and the player has no trade rows in `season_trade_items` for that season.
- [x] **Step 1.4 (Pre-Merge Deployment Gate):** Execute `npx tsx scripts/deploy-trades-schema.ts` against the target database(s) **before** merging PR #52 to `main`. Because Drizzle's `db.insert(schema.playerGameStats)` and `db.insert(schema.goalieGameStats)` enumerate all schema columns in generated `INSERT` statements, applying the additive `team_slug` columns and backfill first guarantees zero downtime or score-finalization failures when `lib/db/schema.ts` deploys.

### Phase 2: Stat Write Paths & Read Queries
- [x] **Step 2.1:** Add `lib/trade-helpers.ts` (`validateTradeInput`, `getNextFallSeasonId`, `getTargetFallSeasonCandidates`, `getAcquiredPickOriginsForRound`) and unit tests in `tests/trade-helpers.test.ts`.
- [x] **Step 2.2:** Update stat write paths (`app/api/bash/scorekeeper/[id]/finalize/route.ts`, `app/api/bash/sync/route.ts`, `lib/final-game-shots.ts`, `app/api/bash/scorekeeper/[id]/state/route.ts`, `lib/merge-duplicates.ts`, `app/api/bash/admin/players/merge-manual/route.ts`) to stamp and preserve `team_slug` / `season_trade_items`, and update `tests/scorekeeper-finalize.test.ts` + `tests/final-game-shots.test.ts`.
- [x] **Step 2.3:** Update stat read queries (`lib/fetch-game-detail.ts`, `lib/fetch-team-detail.ts`, `lib/fetch-player-detail.ts`, `lib/fetch-player-stats.ts`, `app/api/bash/player/[slug]/route.ts`, `app/game/[id]/page.tsx`, `app/admin/games/[id]/edit/page.tsx`, `components/stats-tab.tsx`) and add unit tests in `tests/traded-player-stats.test.ts`.

### Phase 3: Admin Trade API, Roster UI & Fall Draft Integration
- [x] **Step 3.1:** Unlock `active` season mutations in `app/api/bash/admin/seasons/[id]/roster/route.ts`, implement `GET`/`POST /api/bash/admin/seasons/[id]/trades` (using the atomic single-statement data-modifying CTE), wire Fall draft pre-population in `app/api/bash/admin/seasons/[id]/draft/route.ts` and `.../start/route.ts`, and add unit tests in `tests/admin-season-trades.test.ts`.
- [x] **Step 3.2:** Update `components/admin/season-roster-tab.tsx` with active-season editing, the per-team **"Record Trade"** modal, and the per-team subrow **"Season Trades"** table, plus UI tests in `tests/season-roster-trade-ui.test.tsx`.

### Phase 4: DB Export Sync & Week 1 Trades Execution
- [x] **Step 4.1:** Update `scripts/export-prod-db.ts` to include `team_slug` when copying `player_game_stats` and `goalie_game_stats`, and to copy `season_trades` and `season_trade_items`.
- [x] **Step 4.2:** Re-run `npx tsx scripts/deploy-trades-schema.ts` after Phase 2 write paths are deployed so any game finalized between Phase 1 and Phase 2 is stamped with `team_slug` (ensuring Darrell Draper's Week 1 game `g130` has `team_slug = 'loons'`).
- [x] **Step 4.3:** Record Week 1 Trade #1 (Eddie Parsons ↔ Logan Truman) and Trade #2 (Jonny Callan & Lee Jacobs ↔ Steph Tryphonas & Darrell Draper).

### Phase 5: Backfilling Historic Trade Data
- [ ] **Step 5.1 (Vendor Canonical Historical Trade Dataset):** Add `data/historical-traded-players.json` normalizing the 159 verified historical trade records from `kaylesworth/bash-scraper/extra/traded_players.json` (with `previous_team_id` and player/team aliases resolved to canonical `seasonId`, `fromTeamSlug`, and `toTeamSlug`).
- [ ] **Step 5.2 (Two-Pass Historical Game Stat Attribution Backfill):** Implement an idempotent backfill script (`scripts/backfill-historical-trades.ts`) that:
  1. Stamps `team_slug = fromTeamSlug` on the 825 skater rows (`player_game_stats`) and 28 goalie rows (`goalie_game_stats`) where `team_slug IS NULL` (3rd-team orphan games such as `1549397`).
  2. Corrects `team_slug = fromTeamSlug` on the 167 pre-trade head-to-head matchups (`{g.home_team, g.away_team} = {fromTeamSlug, toTeamSlug}`) played on or before `maxFromDate` (and reconciles the 56 transition-window head-to-head games via box-score goal tallies, goalie results, or trade sheet dates).
- [ ] **Step 5.3 (Seed Historical `season_trades` & `season_trade_items`):** Populate `season_trades` and `season_trade_items` (`item_type = 'player'`) for historical seasons from the verified dataset so historical season pages and player profiles include a complete trade audit trail.
