# Forfeited Game Management Design

**Date:** 2026-10-27
**Status:** Draft for Approval
**Source PRD:** [BASH - Forfeited Game Management](https://docs.google.com/document/d/11JAqD4mB3_84uCfuzSMHEOEdffOytwVoOUQ9pN71iCU/edit?tab=t.0)

## 1. Intent & Why

In Bay Area Street Hockey (BASH), when one team forfeits a scheduled game:
1. The non-forfeiting (winning) team is awarded a `5–0` regulation victory in the standings ([Rule 208(e)](https://bash.fan/rules)).
2. In the rare case of a double forfeit (`homeScore = 0`, `awayScore = 0`, `isForfeit = true`), **both** teams receive a `0–5` regulation loss in the standings (`+1 GP`, `+1 L`, `+0 GF`, `+5 GA`, `-5 GD`, `0 PTS`), and neither team receives player/goalie `GP`.
3. No counting player or goalie statistics (`G`, `A`, `PTS`, `PIM`, `GWG`, `PPG`, `SHG`, `ENG`, `HAT`, `SA`, `SV`, `GA`, `SO`, `W`, `L`, `seconds`) count for a forfeited game ([Rule 208(d)](https://bash.fan/rules)).
4. Playoff eligibility requirements drop by 1 game for all rostered members of the non-forfeiting team ([Rule 208(h)](https://bash.fan/rules), [Rule 209(c)](https://bash.fan/rules)), which in the site is represented by automatically crediting `+1 GP` to every active rostered player (`player_seasons`) on the winning team.

## 2. Goals, Non-Goals & Constraints

### Goals
- **Automated Admin Forfeit Entry:** When a commissioner toggles **Forfeit** in the Admin Schedule modal (`EditGameModal`), provide a **Forfeiting Team** selector (`Away Team`, `Home Team`, or `Both Teams (Double Forfeit)`) that automatically sets `status = "final"`, `isOvertime = false`, `hasShootout = false`, and the official forfeit scores (`5–0`, `0–5`, or `0–0` for double forfeit).
- **Full Active Roster `+1 GP` on Winning Team (Decision Q3 = Option B):** Whenever a game is recorded as a single-team forfeit (whether pre-game unplayed or retroactively overturned after being played), every active rostered player (`player_seasons` for that season and winning team) receives `+1 GP` stamped with `team_slug = winningTeamSlug` and `is_sub = false`.
- **Zero Counting Stats & Protected Rate Stats (Decision Q1 = Option A, Q2 = Option A):**
  - All counting stats on forfeited games evaluate to `0`.
  - Skater `PTS/G` (and Team Skater `PTS/G` / Team Goalie `SA/G`) divides by **non-forfeit games played** (`non_forfeit_gp`) so a forfeit never dilutes a player's or team's per-game rate.
  - Winning-team rostered goalies receive `+1 GP` with `0` seconds, `0` SA/SV/GA/SO, and `result = NULL` (no personal `W` or `L`), leaving `GAA` and `SV%` completely unchanged.
- **Game Log Visibility (Decision Q4 = Option A):** Include winning-team forfeit games in the player's Game Log on `/player/[slug]` with a `Forfeit` badge and `0` counting stats so players and captains can see exactly which games make up their `GP` total.
- **Mid-Season Trade Attribution:** Stamping `player_game_stats` and `goalie_game_stats` rows with `team_slug = winningTeamSlug` ensures that if a player is later traded, their forfeit `GP` remains permanently attributed to the team they were on when the forfeit occurred.

### Non-Goals
- No database schema migrations are required (`games.is_forfeit`, `player_game_stats.team_slug`, and `goalie_game_stats.team_slug` already exist).
- Substitute players (`is_sub = true`) on a played game that is overturned as a forfeit do not receive `GP`.

### Constraints
- `drizzle-orm/neon-http` does not support interactive transactions (`db.transaction()`). All forfeit roster sync operations must be idempotent and safe to re-run.

## 3. Approaches Considered

1. **Selected — Roster Stamping on Write + Conditional Stat Zeroing in SQL (Approach 1):**
   - On write (Admin Schedule create/edit and Sportability sync), a shared helper `syncForfeitRosterStats` upserts `0`-stat attendance rows (`team_slug = winningTeamSlug`, `is_sub = false`, `result = NULL`) into `player_game_stats` (for rostered skaters) and `goalie_game_stats` (for rostered goalies) for the winning team, and removes any forfeit-generated or losing-team rows when a game is a double forfeit or when `isForfeit` is unchecked on an unplayed game.
   - On read, queries include `is_forfeit` rows **only** when the row's effective `team_slug` matches the winning team of the forfeit (`(NOT g.is_forfeit OR (g.status = 'final' AND ((g.home_score > g.away_score AND <team_slug> = g.home_team) OR (g.away_score > g.home_score AND <team_slug> = g.away_team))))`), compute `GP` across all eligible rows, compute `non_forfeit_gp` (`FILTER (WHERE NOT g.is_forfeit)`) for `PTS/G`, and apply `FILTER (WHERE NOT g.is_forfeit)` (or `CASE WHEN g.is_forfeit THEN 0 ...`) to all counting stats and goalie `W`/`L` counts.
   - *Why chosen:* Preserves exact point-in-time team attribution across mid-season trades, works uniformly for both unplayed forfeits and retroactive overturned forfeits, and keeps all 23 player detail CTEs and leaderboard queries fast.
2. **Virtual Join on Read (Approach 2 — Rejected):**
   - Synthesize forfeit `GP` at query time by joining `games WHERE is_forfeit` against `player_seasons`.
   - *Why rejected:* Overwrites historical team attribution when `player_seasons.team_slug` changes during a mid-season trade and complicates every stat query and game log.

## 4. Detailed Design

### 4.1 Admin Schedule UI (`components/admin/edit-game-modal.tsx`)
- When `formData.isForfeit` is toggled **ON**:
  - Display a **Forfeiting Team** selector directly inside the forfeit card with three options:
    - `away` — **Away Team forfeited** (`homeTeam` wins `5–0`): sets `status = "final"`, `homeScore = 5`, `awayScore = 0`, `isOvertime = false`, `hasShootout = false`.
    - `home` — **Home Team forfeited** (`awayTeam` wins `5–0`): sets `status = "final"`, `awayScore = 5`, `homeScore = 0`, `isOvertime = false`, `hasShootout = false`.
    - `both` — **Double Forfeit** (both teams lose `0–5` in standings, stored as `0–0` with `isForfeit = true`): sets `status = "final"`, `homeScore = 0`, `awayScore = 0`, `isOvertime = false`, `hasShootout = false`.
  - Default selection when toggling `isForfeit` ON:
    - If existing scores already indicate a winner (`homeScore > awayScore`), preselect `away` (Home won); if `awayScore > homeScore`, preselect `home` (Away won); if `homeScore === 0 && awayScore === 0 && status === "final"`, preselect `both`; otherwise default to `away` (Home team wins `5–0`).
- When `formData.isForfeit` is toggled **OFF**:
  - If the game has no boxscore (`!game?.hasBoxscore`), reset `status = "upcoming"`, `homeScore = null`, `awayScore = null`.

### 4.2 Server-Side Forfeit Roster Stamping (`lib/forfeit-Handling.ts` / `lib/forfeit-sync.ts`)
Create `syncForfeitRosterStats(gameId: string)` and call it from:
- `PATCH /api/bash/admin/seasons/[id]/schedule/[gameId]`
- `POST /api/bash/admin/seasons/[id]/schedule` (if created directly as a forfeit)
- `GET /api/bash/sync` (when Sportability sync marks a game as a forfeit)

Behavior of `syncForfeitRosterStats(gameId)`:
1. Fetch the game row (`id`, `season_id`, `home_team`, `away_team`, `home_score`, `away_score`, `status`, `is_forfeit`, `has_boxscore`).
2. **If `is_forfeit = true` and `status = 'final'`:**
   - **Single-team forfeit (`home_score !== away_score` and both non-null):**
     - `winningTeam = home_score > away_score ? home_team : away_team`
     - Look up all active roster entries in `player_seasons` for `(season_id, team_slug = winningTeam)`.
     - For each skater (`is_goalie = false`): upsert into `player_game_stats` (`player_id`, `game_id`, `team_slug = winningTeam`, `is_sub = false`, all counting stats `0`) using `ON CONFLICT (player_id, game_id) DO NOTHING` (so if the game was played and has existing audit stats, those rows remain intact in DB while queries zero them out; if `team_slug` was null, backfill `team_slug = winningTeam`).
     - For each goalie (`is_goalie = true`): upsert into `goalie_game_stats` (`player_id`, `game_id`, `team_slug = winningTeam`, `is_sub = false`, `seconds = 0`, `goals_against = 0`, `shots_against = 0`, `saves = 0`, `shutouts = 0`, `goalie_assists = 0`, `result = null`) using `ON CONFLICT (player_id, game_id) DO NOTHING`.
     - If `!has_boxscore`, delete any stale `player_game_stats` / `goalie_game_stats` rows for that game belonging to the losing team (`team_slug != winningTeam`).
   - **Double forfeit (`home_score === away_score`):**
     - If `!has_boxscore`, delete any auto-stamped `player_game_stats` and `goalie_game_stats` rows for `game_id` so neither team gets `GP`.
3. **If `is_forfeit = false`:**
   - If `!has_boxscore` (an unplayed game whose forfeit checkbox was unchecked), delete any auto-stamped `player_game_stats` and `goalie_game_stats` rows for `game_id`.
4. **Playoff Series Auto-Advancement (`app/api/bash/admin/seasons/[id]/schedule/[gameId]/route.ts`):**
   - Allow a finalized single-team forfeit in a playoff series (`sg.status === "final"` with `homeScore !== awayScore`) to count toward `winCounts` for series clinching.

### 4.3 Double Forfeit Standings & Head-to-Head (`lib/standings.ts`, `lib/head-to-head.ts`, `lib/fetch-team-detail.ts`)
Per Section 1 of the PRD (*"Double-forfeit - results in BOTH teams getting a 5-0 loss for goal differential and in the standings"*):
- When `game.isForfeit && game.status === "final" && game.homeScore === game.awayScore` (e.g., `0–0` double forfeit):
  - **`computeStandings` (`lib/standings.ts`):** Both `home` and `away` receive `gp += 1`, `l += 1`, `gf += 0`, `ga += 5` (`gd -= 5`), `pts += 0`.
  - **`computeHeadToHead` (`lib/head-to-head.ts`):** Both teams see the game as `result = "L"`, `teamScore = 0`, `opponentScore = 5` (or `gf += 0, ga += 5, l += 1`).
  - **`fetchTeamDetail` (`lib/fetch-team-detail.ts`):** Both teams get `result = "L"`, `record.gp += 1`, `record.l += 1`, `record.gf += 0`, `record.ga += 5` in `games` and `allTeamResults` ranking query.

### 4.4 Stat Queries Across the Site
Define the SQL eligibility & zeroing rules for any joined game `g` and stat table alias `s` (`pgs` or `ggs`) with effective team slug `eff_team_slug = COALESCE(s.team_slug, ps.team_slug)`:
- **Forfeit row eligibility:**
  ```sql
  (
    NOT g.is_forfeit
    OR (
      g.status = 'final'
      AND (
        (g.home_score > g.away_score AND eff_team_slug = g.home_team)
        OR (g.away_score > g.home_score AND eff_team_slug = g.away_team)
      )
    )
  )
  ```
- **Counting Stat Zeroing:**
  - All `SUM(...)` aggregations for skaters (`goals`, `assists`, `points`, `gwg`, `ppg`, `shg`, `eng`, `hat_tricks`, `pen`, `pim`) and goalies (`seconds`, `goals_against`, `shots_against`, `saves`, `shutouts`, `goalie_assists`) use `COALESCE(SUM(...) FILTER (WHERE NOT g.is_forfeit), 0)::int`.
  - Goalie `wins` and `losses` use `COUNT(...) FILTER (WHERE NOT g.is_forfeit AND result = 'W')::int` and `COUNT(...) FILTER (WHERE NOT g.is_forfeit AND result = 'L')::int`.
- **Rate Denominators (`PTS/G` and `SA/G`):**
  - Query returns `gp` (`COUNT(DISTINCT game_id)::int`) and `played_gp` (`COUNT(DISTINCT game_id) FILTER (WHERE NOT g.is_forfeit)::int`).
  - Skater `ptsPg`: `played_gp > 0 ? (points / played_gp).toFixed(2) : "0.00"` (for all-time stats combining `game_stats` and `hist_stats`, `played_gp = COALESCE(gs.played_gp, 0) + COALESCE(hs.gp, 0)`).
  - Team Skater `ptsPg` & Team Goalie `saPg` (`lib/fetch-team-stats.ts`): divide `points` and `shotsAgainst` by `played_gp` (`COUNT(DISTINCT game_id) FILTER (WHERE NOT g.is_forfeit)`), while `gp` (`TGP`) and `pgp` (`PGP`) include winning-team forfeits.
- **Endpoints & Fetchers Updated:**
  1. `lib/fetch-player-stats.ts` (Season & All-Time Skaters and Goalies, plus multi-team traded player merging in JS tracks `playedGp` alongside `gp`).
  2. `lib/fetch-team-detail.ts` (Team roster Skaters and Goalies).
  3. `lib/fetch-team-stats.ts` (Season & All-Time Team Skaters and Team Goalies).
  4. `lib/fetch-player-detail.ts` & `app/api/bash/player/[slug]/route.ts` (Season, All-Time Fall, All-Time All Seasons, Per-Season, Playoff, and Game Logs for Skaters and Goalies).
  5. `app/api/bash/draft/player-stats/[playerId]/route.ts` (Draft board player stats).
  6. `lib/fetch-game-detail.ts` (Game detail boxscore: zero out counting stats and goalie `result` when `game.is_forfeit` is true, and only show winning team's roster on a forfeit).

### 4.5 Player Game Log UI (`components/player-page-content.tsx`)
- Add `isForfeit?: boolean` to `SkaterGameLog` and `GoalieGameLog` in `lib/fetch-player-detail.ts`, `app/api/bash/player/[slug]/route.ts`, and `components/player-page-content.tsx`.
- In ` fetchPlayerDetail` and `app/api/bash/player/[slug]/route.ts` game log queries:
  - Select `g.is_forfeit` and zero out per-game counting stats (`CASE WHEN g.is_forfeit THEN 0 ELSE pgs.goals END`, etc., and `CASE WHEN g.is_forfeit THEN NULL ELSE ggs.result END` for goalie `DEC`).
- In `SkaterGameLogTable` and `GoalieGameLogTable` (`components/player-page-content.tsx`):
  - Render a neutral `Forfeit` badge (`<Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0 h-4 text-muted-foreground border-border">Forfeit</Badge>`) next to the score/result in the `Score` cell (or `Date` cell) when `g.isForfeit` is true.
