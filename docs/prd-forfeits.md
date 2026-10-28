# BASH - Forfeited Game Management

**Mini-PRD**

**Status:** Approved (Decisions: Q1 = Option A, Q2 = Option A, Q3 = Option B, Q4 = Option A)  
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

- **Goal:** Automatically credit `+1 GP` to rostered players on the non-forfeiting (winning) team whenever a single-team forfeit is recorded.
- **Goal:** Ensure all counting statistics (`G`, `A`, `PTS`, `PIM`, `SHG`, `GWG`, `SOG`, `GA`, `SV`) remain `0` for forfeited games (*"No statistics will count for a forfeited game"*).
  - **Sub-Goal:** Protect season-long player averages (`GAA`, `SV%`, and `PTS/G`) from changing. Denominators using total GP will use actual played GP, not counting forfeited games.
- **Goal:** Preserve accurate team attribution if a player is traded mid-season before or after a forfeit.
- **Goal:** Manage `GP` and stat tracking accurately in the case of a double forfeit.
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
| **Skater `PTS/G`** | `points ÷ non_forfeit_gp` | **Zero impact.** `GP` column displays total `GP` (including forfeits), while `PTS/G` divides points by actual games played on the floor (`non_forfeit_gp`). | **Q1 Option A:** Protect `PTS/G` using `points ÷ non_forfeit_gp`. |
| **Goalie `GAA`** | `(goals_against ÷ seconds_played) × (game_length × 60)` | **Zero impact.** `GAA` is computed strictly from actual floor time (`seconds_played`), **not** `GP`. A forfeit row with `0 seconds` and `0 GA` leaves `GAA` 100% unchanged. | Record forfeit goalie rows with `seconds = 0` and `goals_against = 0`. |
| **Goalie `SV%`** | `saves ÷ shots_against` | **Zero impact.** Calculated strictly from total saves divided by total shots faced. | Record forfeit goalie rows with `saves = 0` and `shots_against = 0`. |
| **Goalie `SO` (Shutouts)** | `SUM(shutouts)` | **Zero impact.** Even though the standings score is recorded as `5–0`, the goalie did not play a shutout on the floor. | Record `shutouts = 0` on all forfeit rows. |
| **Goalie `W` (Wins)** | `COUNT(*) WHERE result = 'W' AND NOT g.is_forfeit` | **Zero impact on personal `W`/`L`.** Setting `result = NULL` increments goalie `GP` without adding a personal goalie win. | **Q2 Option A:** `+1 GP` only (`result = NULL`). |
| **Playoff Eligibility** | Season & team `GP` count | **Positive (Intended).** Automatically credits `+1 GP` toward the player's playoff qualification threshold. | Included in season and team `GP` totals. |

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
3. **Stamp `0`-Stat Attendance Rows for the Winning Team (`syncForfeitRosterStats`):**
   - For any single-team forfeit (pre-game unplayed or retroactive overturned forfeit per **Q3 Option B**), the server looks up all active rostered players (`player_seasons`) on the winning team for that season and upserts `0`-stat rows into `player_game_stats` (for skaters) and `goalie_game_stats` (for the rostered goalie, with `seconds = 0` and `result = NULL`), stamped with `team_slug = winningTeamSlug` and `is_sub = false`.
   - **Mid-Season Trade Compatibility:** Stamping actual rows with `team_slug` at the time the forfeit is recorded ensures that if a player is later traded to another team, their forfeit `GP` remains permanently attributed to the team they were on when the forfeit occurred.
4. **Un-Marking a Forfeit:**
   - If an admin unchecks `isForfeit` on an unplayed game (`!hasBoxscore`), the auto-generated `0`-stat rows for that forfeit are automatically removed and the game returns to `upcoming` with `null` scores.

### 4.2 Query Behavior for Forfeited Games

Across `/stats`, `/team/[slug]`, `/player/[slug]`, and `/api/bash/draft/player-stats/[playerId]`:

- Rows from `g.is_forfeit = true` games are included **only where `team_slug` matches the winning team of the forfeit** (and `NOT is_sub`).
- `GP` (`COUNT(DISTINCT game_id)`) includes those winning-team forfeit rows.
- `PTS/G` (and team `PTS/G` / `SA/G`) uses `non_forfeit_gp` (`COUNT(DISTINCT game_id) FILTER (WHERE NOT g.is_forfeit)`) as the denominator.
- All counting stat aggregations (`goals`, `assists`, `points`, `pim`, `gwg`, `ppg`, `shg`, `eng`, `hat_tricks`, `saves`, `goals_against`, `shots_against`, `shutouts`, `goalie_assists`, `seconds`, `wins`, `losses`) evaluate to `0` when `g.is_forfeit = true`, guaranteeing compliance with Rule 208(d) even for games that were played on the floor and later overturned as a forfeit.
- On `/player/[slug]`, forfeited games appear in the player's Game Log table with a `Forfeit` badge and `0` counting stats (**Q4 Option A**).

---

## 5. Product Decisions Summary

1. **Question 1 (Skater `PTS/G`):** **Option A (Chosen — Protect `PTS/G`)** — Display total `GP` (including forfeits) in the `GP` column, but calculate `PTS/G` using actual games played on the floor (`points ÷ non_forfeit_gp`).
2. **Question 2 (Goalie `+1 W`):** **Option A (Chosen — `+1 GP` Only)** — Credit the rostered goalie on the non-forfeiting team with `+1 GP` (`result = NULL`), leaving `W/L` unchanged.
3. **Question 3 (Retroactive Forfeits):** **Option B (Chosen — Full Roster Always)** — Credit the entire active roster of the winning team with `+1 GP` on any single-team forfeit, even if the game was played on the floor and later overturned.
4. **Question 4 (Player Game Log):** **Option A (Chosen — Show with a `Forfeit` Badge)** — Include the game in the player's Game Log table on `/player/[slug]` marked with a `Forfeit` badge and `0` stats.
