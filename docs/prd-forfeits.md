# BASH - Forfeited Game Management

**Mini-PRD**

**Status:** Approved (Decisions: Q1 = Option A, Q2 = Option A, Q3 = Option 2, Q4 = Option A)  
**Date:** October 26, 2026  
**Audience:** BASH Commissioners & Captains

---

## 1. Executive Summary & Problem Statement

In Bay Area Street Hockey (BASH), when one team forfeits a scheduled regular-season game, the following things should happen:

- Non-forfeiting (winning) team is awarded a `5–0` victory in the standings ([Rule 208(e)](https://bash.fan/rules)).
- No player/goalie statistics count for this game ([Rule 208(d)](https://bash.fan/rules)).
- Double-forfeit — results in BOTH teams getting a `5–0` loss (`0–5`) for goal differential and in the standings.
- League rules state that playoff game requirements "drops by 1" ([Rule 208(h)](https://bash.fan/rules) and [Rule 209(c)](https://bash.fan/rules)) for all the winning team rostered members.

### Feature Goals & Non-Goals

- **Goal:** Automatically credit `+1 GP` to the non-forfeiting (winning) team whenever a single-team forfeit is recorded—both for pre-game unplayed forfeits (full active roster) and for already-played games that are later invalidated as a forfeit in Admin.
- **Goal:** Never delete or overwrite recorded boxscore statistics in the database when a played game is invalidated as a forfeit. Instead, ignore counting statistics from forfeited games at query time in SQL (`FILTER (WHERE NOT g.is_forfeit)`) so marking or unmarking a played game as a forfeit in Admin is 100% non-destructive and reversible.
- **Goal:** Ensure all counting statistics (`G`, `A`, `PTS`, `PIM`, `SHG`, `GWG`, `SOG`, `GA`, `SV`, `SO`, `W`/`L`) evaluate to `0` for forfeited games (*"No statistics will count for a forfeited game"*).
  - **Sub-Goal:** Protect season-long player and team averages (`GAA`, `SV%`, `PTS/G`, and `SA/G`) from changing. Denominators using total GP use actual played GP (`FILTER (WHERE NOT g.is_forfeit)`), not counting forfeited games.
- **Goal:** Preserve accurate team attribution if a player is traded mid-season before or after a forfeit.
- **Goal:** Manage `GP` and stat tracking accurately in the case of a double forfeit (`+0 GP` for both teams).
- **Goal:** Automate score entry in the Admin Schedule modal when marking a game as a forfeit so commissioners only need to select which team forfeited (`Away Team`, `Home Team`, or `Both Teams`).

---

## 2. How Forfeits Work in the Site Today

Before this update, a game could become a forfeit in two ways:

1. **Pre-Game / Unplayed Forfeit (Most Common):** A team notifies the league ahead of time (or fails to reach the minimum 4 skaters + 1 goalie at game time). A commissioner opens **Admin → Seasons → Schedule**, edits the game, sets the score to `5–0` for the non-forfeiting team, and checks the **Forfeit** box. Because the scorekeeper tool was never opened, no player attendance or stat rows existed in the database for that game.
2. **Retroactive / Overturned Forfeit (e.g., Illegal Roster/Sub):** A game is played and finalized via the scorekeeper tool (with goals, assists, saves, and attendance recorded), and is later ruled a forfeit by commissioners under Rule 208(b) or Rule 206(c). Checking the **Forfeit** box kept the database rows intact for audit history, while all public stat pages hid the game via `AND NOT g.is_forfeit`.

Because both scenarios filtered out `is_forfeit = true` games at query time, neither scenario awarded `+1 GP` to the winning team, and neither scenario counted stats on team/player stat pages.

---

## 3. Impact on Season-Long Metrics & Averages

Below is the audit of how every season-long metric is calculated in the BASH codebase and how a forfeit `+1 GP` interacts with it:

| Metric | Current Formula in Codebase | Impact of Forfeit `+1 GP` (with `0` stats) | Approved Handling |
| --- | --- | --- | --- |
| **Counting Stats (`G`, `A`, `PTS`, `PIM`, `GA`, `SV`, `SA`, `SO`)** | `COALESCE(SUM(stat) FILTER (WHERE NOT g.is_forfeit), 0)` | **Zero impact.** Even if a game was played on the floor with recorded stats and later marked a forfeit, SQL aggregation ignores all counting stats from forfeited games without deleting database rows. | Ignore counting stats in SQL via `FILTER (WHERE NOT g.is_forfeit)` (and `CASE WHEN g.is_forfeit THEN 0 ...` in game logs). |
| **Skater `PTS/G`** | `points ÷ non_forfeit_gp` | **Zero impact.** `GP` column displays total `GP` (including forfeits), while `PTS/G` divides points by actual games played on the floor (`non_forfeit_gp`). | **Q1 Option A:** Protect `PTS/G` using `points ÷ non_forfeit_gp`. |
| **Goalie `GAA`** | `(goals_against ÷ seconds_played) × (game_length × 60)` | **Zero impact.** `GAA` is computed strictly from actual floor time (`SUM(seconds) FILTER (WHERE NOT g.is_forfeit)`), **not** `GP`. | Filter `seconds` and `goals_against` by `WHERE NOT g.is_forfeit` (and record unplayed forfeit goalie rows with `seconds = 0, goals_against = 0`). |
| **Goalie `SV%`** | `saves ÷ shots_against` | **Zero impact.** Calculated strictly from non-forfeit saves divided by non-forfeit shots faced. | Filter `saves` and `shots_against` by `WHERE NOT g.is_forfeit`. |
| **Goalie `SO` (Shutouts)** | `SUM(shutouts) FILTER (WHERE NOT g.is_forfeit)` | **Zero impact.** Even though the standings score is recorded as `5–0`, no shutout is credited on a forfeit. | Filter `shutouts` by `WHERE NOT g.is_forfeit` (and record `shutouts = 0` on unplayed forfeit rows). |
| **Goalie `W` / `L`** | `COUNT(*) WHERE result = 'W'/'L' AND NOT g.is_forfeit` | **Zero impact on personal `W`/`L`.** Forfeits increment winning-team goalie `GP` without adding a personal goalie win or loss. | **Q2 Option A:** `+1 GP` only (`result = NULL` on unplayed forfeits; `AND NOT g.is_forfeit` on `W`/`L` counts). |
| **Playoff Eligibility** | Season & team `GP` count | **Positive (Intended).** Automatically credits `+1 GP` to the winning team toward the playoff qualification threshold. | Included in season and team `GP` totals for the winning team only. |

---

## 4. Technical Design

### 4.1 Automated Score Entry & Roster Stamping When Marking a Forfeit

When an admin marks a game as a forfeit in **Admin → Seasons → Schedule** (`EditGameModal`):

1. **Forfeiting Team Selector in Admin UI:**
   - Toggling **Forfeit** ON displays a selector for **Forfeiting Team**:
     - **Away Team forfeited:** Automatically sets `status = "final"`, `homeScore = 5`, `awayScore = 0`, `isOvertime = false`, `hasShootout = false`.
     - **Home Team forfeited:** Automatically sets `status = "final"`, `awayScore = 5`, `homeScore = 0`, `isOvertime = false`, `hasShootout = false`.
     - **Both Teams (Double Forfeit):** Automatically sets `status = "final"`, `homeScore = 0`, `awayScore = 0`, `isOvertime = false`, `hasShootout = false`.
2. **Determine the Winning (Non-Forfeiting) Team:**
   - If `homeScore > awayScore`, the winning team is `home_team`.
   - If `awayScore > homeScore`, the winning team is `away_team`.
   - If `homeScore == awayScore` (e.g., `0–0` double forfeit), neither team is credited with player `GP`, and both teams receive a `0–5` loss in standings/head-to-head.
3. **Stamp `0`-Stat Attendance Rows via `ON CONFLICT DO NOTHING` & Never Delete Recorded Stats (`syncForfeitRosterStats`):**
   - For any single-team forfeit, `syncForfeitRosterStats` runs a single purely additive `INSERT ... ON CONFLICT (player_id, game_id) DO NOTHING` statement to ensure `0`-stat rows exist in `player_game_stats` (for skaters) and `goalie_game_stats` (for the rostered goalie, with `seconds = 0` and `result = NULL`) for all active rostered players (`player_seasons` as of `g.date`) on the winning team, stamped with `team_slug = winningTeamSlug` and `is_sub = false`.
   - **Zero Stat Deletion or Overwriting (Option 2):** `syncForfeitRosterStats` contains **no `DELETE` statements and no `ON CONFLICT DO UPDATE` statements**. If a game was already played and has recorded boxscore rows in `player_game_stats` or `goalie_game_stats`, `ON CONFLICT DO NOTHING` leaves every recorded row 100% untouched. Instead, all stat-generation queries ignore counting stats (`FILTER (WHERE NOT g.is_forfeit)`) and exclude losing-team and substitute rows (`forfeitEligibleGamePredicate`) at read time while still crediting `+1 GP` to the winning team.
   - **Mid-Season Trade Compatibility:** Stamping rows with `team_slug` (reconstructed as of `g.date` via `season_trades` / `season_trade_items`) ensures that if a player is traded before or after a forfeit, their forfeit `GP` remains attributed to the team they were on when the forfeit occurred.
4. **Un-Marking, Switching Sides, or Double-Forfeiting a Game:**
   - Because `forfeitEligibleGamePredicate` in SQL only includes forfeit rows when `g.is_forfeit AND g.status = 'final'` and the row's team matches the winning team (`home_score > away_score` or `away_score > home_score`), switching the forfeiting team, marking a double forfeit (`0–0`), or reverting an unplayed game to `upcoming` is handled automatically by the SQL read queries without needing to delete database rows.
   - If an admin unchecks `isForfeit` on a played game (`hasBoxscore`), all original boxscore stats and `GP` immediately reappear because no rows were deleted or overwritten.

### 4.2 Query Behavior for Forfeited Games (Option 2: SQL Filtering Without Stat Deletion)

Across `/stats`, `/team/[slug]`, `/player/[slug]`, `/game/[id]`, and `/api/bash/draft/player-stats/[playerId]`:

- **Winning-Team-Only Eligibility (`forfeitEligibleGamePredicate` in `lib/forfeit-sql.ts`):** Stat queries join `games` using `forfeitEligibleGamePredicate(teamSlugExpr)`, which includes all non-forfeit games (`NOT g.is_forfeit`) plus finalized single-team forfeits (`g.is_forfeit AND g.status = 'final'`) where the row's effective team matches the winning team (`home_score > away_score` for home or `away_score > home_score` for away). Losing-team rows, substitutes (`NOT is_sub`), and double forfeits (`0–0`) are excluded on forfeits (`+0 GP`).
- **`+1 GP` for Winning Team:** `GP` (`COUNT(DISTINCT game_id)` / `COUNT(*)`) includes those winning-team rows on both pre-game (unplayed) forfeits and played games retroactively marked as forfeits.
- **Zeroed Counting Stats in SQL (`FILTER (WHERE NOT g.is_forfeit)`):** All counting stat aggregations (`goals`, `assists`, `points`, `gwg`, `ppg`, `shg`, `eng`, `hat_tricks`, `pen`, `pim`, `seconds`, `goals_against`, `shots_against`, `saves`, `shutouts`, `goalie_assists`, and goalie `W`/`L`) use `FILTER (WHERE NOT g.is_forfeit)` so any recorded stats from a played game that was later marked a forfeit are ignored (`0`) in SQL without deleting the underlying database rows.
- **Protected Season Averages (`played_gp`):** `PTS/G` (and team `PTS/G` / `SA/G`) uses `played_gp` (`COUNT(*) FILTER (WHERE NOT g.is_forfeit)`) as the denominator so season averages reflect actual floor games played.
- **Player Game Log & Game Detail View:** On `/player/[slug]`, forfeited games appear in the winning-team player's Game Log table with a `Forfeit` badge and `0` counting stats (`CASE WHEN g.is_forfeit THEN 0 ...`, **Q4 Option A**). On `/game/[id]`, finalized forfeits display only the winning team's non-sub roster with `0` stats while keeping the raw database rows intact.

---

## 5. Product Decisions Summary

1. **Question 1 (Skater `PTS/G`):** **Option A (Chosen — Protect `PTS/G`)** — Display total `GP` (including forfeits) in the `GP` column, but calculate `PTS/G` using actual games played on the floor (`points ÷ non_forfeit_gp`).
2. **Question 2 (Goalie `+1 W`):** **Option A (Chosen — `+1 GP` Only)** — Credit the rostered goalie on the non-forfeiting team with `+1 GP` (`result = NULL` / `AND NOT g.is_forfeit` on `W`/`L`), leaving `W/L` unchanged.
3. **Question 3 (Played / Retroactive Forfeits & Stat Deletion Safety):** **Option 2 (Chosen — Never Delete Recorded Stats; Zero Out Stats in SQL & Keep `+1 GP` for Winner)** — On unplayed single-team forfeits, stamp `0`-stat rows for the winning team's active roster. When an already-played game is invalidated as a forfeit in Admin, **never delete or overwrite** its recorded `player_game_stats` or `goalie_game_stats` rows in the database; instead, SQL stat queries (`forfeitEligibleGamePredicate` + `FILTER (WHERE NOT g.is_forfeit)`) ignore all counting stats and losing-team rows at read time while still crediting `+1 GP` to the winning team, and unchecking `Forfeit` in Admin immediately restores the original game stats.
4. **Question 4 (Player Game Log):** **Option A (Chosen — Show with a `Forfeit` Badge)** — Include the game in the winning-team player's Game Log table on `/player/[slug]` marked with a `Forfeit` badge and `0` stats.
