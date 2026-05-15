# PRD: Exhibition & Tryout Games

> **Status**: Implementation Complete
> **Author**: Chris Torres
> **Created**: 2026-05-12
> **Updated**: 2026-05-14
> **Decision**: Option B (Ad-Hoc Game Rosters Table)

## 1. Problem Statement

BASH has two categories of games that don't fit the current regular-season or playoff data model: **exhibition games** and **tryout games**. Both require ad-hoc rosters, stat isolation from season aggregations, and the ability to add new players on the spot — but they serve different purposes in the league calendar.

### Exhibition Games (End of Season)

BASH traditionally plays exhibition games at the end of the fall season after the championship is decided. These are special one-off matchups like an **Alumni Game** (open to all players past and present) and a **USA vs Canada** game (best players from each country in the league). Unique requirements:

- **Custom teams**: Team names like "Team USA", "Team Canada", "Alumni East", and "Alumni West" don't correspond to any existing franchise or seasonal team.
- **Mixed rosters**: Players may include alumni or guests who did not play in the current fall season and therefore have no `player_seasons` record.
- **No stat impact**: Exhibition game results must not affect season standings, player stat leaderboards, or any computed season-level aggregations.
- **Live scoring**: The scorekeeper app must work for these games so scores can be tracked at the rink and spectators can follow along remotely in real time.
- **Timing**: Exhibition games happen while the fall season is still technically the "current" season in the system.

### Tryout Games (Start of Season)

At the beginning of each fall season, BASH hosts **2–3 tryout games**. These are essentially pickup games where the focus is on evaluating new players, not competitive results:

- **Day-of teams**: Teams are decided on game day — typically "Team Light" vs "Team Dark" based on jersey colors. These are throwaway team names that don't map to any franchise.
- **Stats don't matter**: Goals, assists, and scores are tracked for fun and for the scorekeeper's workflow, but they have zero impact on fall season standings or player stat leaderboards.
- **Walk-up players**: Tryout games attract prospective rookies who have never played in BASH before. These players have no existing `players` record in the system and need to be created on the spot.
- **Attendance is critical**: In order to be eligible for the fall season, rookies must attend at least one tryout game. Tracking which players showed up and played is the single most important data point from tryouts — the roster serves as the attendance record.
- **Returning players too**: Tryout games aren't just for rookies. Returning veterans also play, so the roster is a mix of existing `players` records and brand-new entries.

### Shared Infrastructure Gap

Currently, there is no clean way to create a game where the teams and rosters are defined independently of the seasonal `season_teams` / `player_seasons` infrastructure, and several stats queries would inadvertently include non-regular-season game data. Both exhibition and tryout games need:

1. Ad-hoc team names not tied to franchises
2. Rosters decoupled from `player_seasons`
3. The ability to add/create players at game time (scorekeeper)
4. Full scorekeeper and live-scoring support
5. Complete stat isolation from season and all-time aggregations

## 2. Goals

- Allow admins to create exhibition and tryout games under the current season with custom team names, ad-hoc rosters, and optional custom game titles.
- Ensure exhibition and tryout games are **completely excluded** from standings, player stats leaderboards, and all-time stat aggregations
- Ensure these games are **visible** on the public scores page with clear "Exhibition" or "Tryout" labeling and custom titles if provided
- Ensure the **scorekeeper app** and **live game tracking** work for these games (rink-side scoring + remote spectator view)
- Allow the scorekeeper to **search for existing players or create new ones** inline during exhibition and tryout games — critical for walk-up rookies at tryouts
- Ensure the **game detail page** correctly renders boxscores for these games, and labels them as "Exhibition" or "Tryout" games
- Track **tryout attendance** via roster participation — the roster IS the attendance record for rookie eligibility
- Keep the implementation minimal — this is for ~2–5 games per year, not a full parallel scheduling system. Exhibition and tryout games are created via the existing "Add Game" button on the admin schedule tab, with game type selection triggering the ad-hoc roster workflow.
- Ensure the app functions independently of the Sportability sync — the admin pages and scorekeeper app are the primary data entry paths. Exhibition/tryout games have no Sportability game ID and are invisible to the sync process.

### Scorekeeper Persona

The scorekeeper is typically a volunteer who is a longtime member of the league. They use the app on their phone while standing rink-side. For exhibition and tryout games, roster setup happens in the **10+ minutes before the game starts** — the scorekeeper checks with both teams and settles rosters before puck drop. Mid-game player additions (e.g., a late arrival) happen during stoppages in play, not during active game action.

## 3. Current State

### What Already Works

| Capability | Status | Notes |
|---|---|---|
| `games.game_type` column | ✅ Exists | Values include `regular`, `playoff`, `exhibition`, `championship`, etc. |
| Edit Game modal has "Exhibition" option | ✅ In dropdown | `components/admin/edit-game-modal.tsx` line 201 |
| Standings computation filters correctly | ✅ Safe | `computeStandings()` in `fetch-bash-data.ts` line 11 filters on `gameType === "regular" && !isPlayoff` |

### What Needs Work

| Capability | Status | Notes |
|---|---|---|
| Stats queries don't filter by `game_type` | ⚠️ Leaks | `fetch-player-stats.ts` and `fetch-player-detail.ts` filter on `is_playoff` but not `game_type` — exhibition game stats would pollute season and all-time leaderboards |
| Team selector limited to `season_teams` | ❌ | Admin can't create games with ad-hoc team names like "Team Canada" without inserting them as real teams |
| Player rosters tied to `player_seasons` | ❌ | Can't assign non-season players (alumni, guests) to exhibition teams without creating confusing dual-team `player_seasons` records |
| Scorekeeper loads rosters from `player_seasons` | ⚠️ | `app/scorekeeper/[id]/page.tsx` queries `player_seasons` by `team_slug` + `season_id` — exhibition teams would return empty rosters |
| Game detail boxscore splits by `player_seasons.team_slug` | ⚠️ | `app/api/bash/game/[id]/route.ts` joins `player_seasons` to assign players to home/away — same empty-roster issue |
| Scorekeeper start auto-detects default goalie | ⚠️ | `app/api/bash/scorekeeper/[id]/start/route.ts` uses `player_seasons` join — minor, can gracefully fall back |

---

## 4. Implementation Options

Three approaches were evaluated. Each addresses stat isolation, ad-hoc team naming, roster composition, admin workflow, and scorekeeper compatibility.

### Option A: Minimal — Leverage Existing `game_type = 'exhibition'` ❌ Rejected

Use the existing `games.game_type` column with no schema changes. Create ad-hoc teams (`team-usa`, `team-canada`, `alumni-east`, `alumni-west`) as rows in the `teams` table, add them to `season_teams` for the fall season, and mark the games as `exhibition`. Patch stats queries to add `game_type = 'regular'` filters.

**Roster approach**: Insert `player_seasons` rows linking players to exhibition teams for the fall season.

| Pros | Cons |
|---|---|
| Zero schema changes — all columns exist | Ad-hoc teams appear in season team dropdowns, admin team lists, and stats page team filter |
| ~3 hours of work — mostly query filter patches + data entry | Players get dual `player_seasons` entries (e.g., "plays for Red Army and also Team Canada") — confusing on player detail pages |
| No new admin UI needed | Scorekeeper roster would work (loads from `player_seasons`) but at the cost of data model pollution |
| | No clean separation for future exhibition/charity/jamboree games |

> **Key risk**: The `player_seasons` primary key is `(player_id, season_id, team_slug)`, so a player *can* be on two teams in the same season. But this creates a confusing data model — their player detail page would show two "Current Season" team entries, and stats queries that join `player_seasons` may double-count or misattribute.

> **Rejection reason**: Data model pollution — players get confusing dual-team entries and no clean separation for future exhibition/charity events.

### Option B: Ad-Hoc Game Rosters Table ✅ Selected

Use `game_type = 'exhibition'` for the game itself (same as Option A), but introduce a lightweight **ad-hoc game rosters** table to decouple exhibition/tryout team assignments from `player_seasons`. Create real team rows for the exhibition teams so existing rendering code works without special-casing.

**Roster approach**: A new `adhoc_game_rosters` table links `game_id` + `player_id` + `team_side` (`home` or `away`). The scorekeeper, game detail page, and boxscore rendering conditionally read from this table when `game_type IN ('exhibition', 'tryout')`.

| Pros | Cons |
|---|---|
| Clean data separation — exhibition players don't pollute `player_seasons` | One small migration (1 table) |
| Players can be on a regular-season team AND play in the exhibition without conflicts | Small admin UI needed for roster assignment (~half day) |
| Scorekeeper, game detail, and boxscore all work via conditional roster source | Three queries need a conditional branch for exhibition games |
| Scales for future exhibitions, charity games, jamborees, etc. | |
| Exhibition teams as real `teams` rows means all existing rendering code works | |

### Option C: Dedicated Exhibition Season ❌ Rejected

Create a separate season (e.g., `2025-fall-exhibition`) for exhibition games. The front end would show both seasons' games when viewing the current fall season.

**Roster approach**: Standard `player_seasons` entries under the exhibition season.

| Pros | Cons |
|---|---|
| Total stat isolation — different `season_id` | Scores page needs multi-season merge (currently unsupported) |
| Uses 100% existing admin tooling | Season picker gains noise for end users |
| Exhibition stats could have their own stats page | Full season infrastructure for 2 games is overkill |
| | Player management still requires `player_seasons` entries (same data model issue as Option A) |

> **Rejection reason**: Overkill infrastructure for 2 games. Still has the `player_seasons` pollution problem. Would require unsupported multi-season merge on the scores page.

### Comparison Matrix

| Criteria | Option A (Minimal) | Option B (Recommended) | Option C (Exhibition Season) |
|---|---|---|---|
| Schema changes | None | 1 table | 1 season row + team/player data |
| Stat isolation | Requires query patches | Requires same query patches | Automatic |
| Roster flexibility | Limited (pollutes `player_seasons`) | Clean (dedicated table) | Limited (needs `player_seasons`) |
| Ad-hoc team names | Real team rows | Real team rows | Real team rows |
| Scorekeeper compatibility | Works (via `player_seasons`) | Works (via `adhoc_game_rosters`) | Works (via `player_seasons`) |
| Admin UX | Use existing modal | Small roster UI addition | Full existing season tools |
| Front end changes | Badge + query patches | Badge + query patches + game detail | Scores page multi-season merge |
| Implementation time | ~3 hours | ~1 day | ~2-3 days |
| Future-proofing | Low | High | Medium |

---

## 5. Proposed Approach — Option B

### 5.1 Data Model

#### New table: `adhoc_game_rosters`

Links players to exhibition/tryout game teams without touching `player_seasons`.

```sql
CREATE TABLE adhoc_game_rosters (
  game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id  INTEGER NOT NULL REFERENCES players(id),
  team_side  TEXT NOT NULL CHECK (team_side IN ('home', 'away')),
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX idx_adhoc_game_rosters_game ON adhoc_game_rosters(game_id);
```

**Drizzle schema** (`lib/db/schema.ts`):

```typescript
export const adhocGameRosters = pgTable(
  "adhoc_game_rosters",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    teamSide: text("team_side").notNull(), // "home" | "away"
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.playerId] }),
    index("idx_adhoc_game_rosters_game").on(t.gameId),
  ]
)
```

#### Team data (one-time inserts)

Create real team rows for exhibition teams. These are persistent — reusable across seasons. Each team should have a custom color for rendering on game cards, scorekeeper, and team pages. Logos will be added via `lib/team-logos.ts` (same pattern as franchise teams).

| slug | name | color |
|---|---|---|
| `team-usa` | Team USA | `#002868` (navy) |
| `team-canada` | Team Canada | `#FF0000` (red) |
| `alumni-east` | Alumni East | TBD |
| `alumni-west` | Alumni West | TBD |

These are the initial teams for the 2025 Fall season. The system should support creating **any ad-hoc exhibition team** — e.g., All-Stars, charity teams, sponsor teams — without code changes. Admins add new teams via existing team management or data inserts.

Add to `season_teams` for the active fall season so the admin schedule tab can reference them. Standings already filter on `gameType === "regular"`, so these teams never appear in standings rows.

#### Optional `title` column in `games` table

Exhibition and tryout games often have meaningful titles (e.g., "The Alumni Game", "USA vs Canada Game"). We've added an optional `title` column to the `games` table:

```sql
ALTER TABLE games ADD COLUMN title TEXT;
```

When provided, this title is displayed prominently on the public scores page, the game detail page, and used in page metadata.

#### No changes to `games.game_type`

The existing `game_type` column with value `'exhibition'` is sufficient. No new columns needed besides `title`.

### 5.2 Stats Query Patches

Exhibition and tryout games must be excluded from all stat computations. The following queries currently filter only on `is_playoff` and need an additional `AND g.game_type IN ('regular', 'playoff')` clause (or equivalently `AND g.game_type NOT IN ('exhibition', 'tryout')`):

**Safety invariant**: Exhibition/tryout games must **never** be aggregated into `player_season_stats` rows. The `player_season_stats` table contains pre-aggregated historical stats and is read by career stat queries. If a stat aggregation job is ever introduced, it must exclude `game_type IN ('exhibition', 'tryout')` games.

**`lib/fetch-player-stats.ts`** (4 queries):

| Query | Line | Current Filter | Add |
|---|---|---|---|
| All-time skater stats (game_stats CTE) | ~87 | `NOT g.is_playoff` | `AND g.game_type = 'regular'` |
| All-time goalie stats | ~158-160 | Joins `games g` + `seasons s` | `AND g.game_type = 'regular'` |
| Season skater stats | ~215 | `${playoffFragment}` | `AND g.game_type = 'regular'` |
| Season goalie stats | ~245 | `${playoffFragment}` | `AND g.game_type = 'regular'` |

**`lib/fetch-player-detail.ts`** (26 `is_playoff` references across ~21 queries):

All queries that join `player_game_stats` or `goalie_game_stats` with `games` and filter on `is_playoff` need the same `AND g.game_type = 'regular'` addition. Complete list:

| # | Query Description | Line | Current Filter | Fix |
|---|---|---|---|---|
| 1 | Skater season stats (regular) | ~107 | `NOT g.is_playoff` | Add `AND g.game_type = 'regular'` |
| 2 | Skater all-time stats — game_totals CTE | ~120 | `NOT g.is_playoff` | Add `AND g.game_type = 'regular'` |
| 3 | Skater all-time stats — hist_totals CTE | ~131 | `NOT is_playoff` (player_season_stats) | Already safe — no games join |
| 4 | Skater per-season — game_stats UNION | ~160 | `NOT g.is_playoff` | Add `AND g.game_type = 'regular'` |
| 5 | Skater per-season — hist_stats UNION | ~172 | `NOT pss.is_playoff` (player_season_stats) | Already safe — no games join |
| 6 | Skater game log (regular) | ~184 | `NOT g.is_playoff` | Add `AND g.game_type = 'regular'` |
| 7 | Goalie season stats (regular) | ~200 | `NOT g.is_playoff` | Add `AND g.game_type = 'regular'` |
| 8 | Goalie all-time stats (regular, fall) | ~213 | `NOT g.is_playoff` | Add `AND g.game_type = 'regular'` |
| 9 | Goalie per-season stats | ~228 | `NOT g.is_playoff` | Add `AND g.game_type = 'regular'` |
| 10 | Goalie game log (regular) | ~243 | `NOT g.is_playoff` | Add `AND g.game_type = 'regular'` |
| 11 | Playoff skater all-time — game_totals | ~259 | `g.is_playoff` | Add `AND g.game_type = 'playoff'` |
| 12 | Playoff skater all-time — hist_totals | ~270 | `is_playoff` (player_season_stats) | Already safe |
| 13 | Playoff skater per-season — game_stats | ~299 | `g.is_playoff` | Add `AND g.game_type = 'playoff'` |
| 14 | Playoff skater per-season — hist_stats | ~311 | `pss.is_playoff` (player_season_stats) | Already safe |
| 15 | Playoff skater game log | ~323 | `g.is_playoff` | Add `AND g.game_type = 'playoff'` |
| 16 | Playoff goalie all-time | ~339 | `g.is_playoff` | Add `AND g.game_type = 'playoff'` |
| 17 | Playoff goalie per-season | ~354 | `g.is_playoff` | Add `AND g.game_type = 'playoff'` |
| 18 | Playoff goalie game log | ~369 | `g.is_playoff` | Add `AND g.game_type = 'playoff'` |
| 19 | Championships query | ~380 | `g.is_playoff` | Safe — only final playoff games |
| 20 | Skater all-time ALL seasons — game_totals | ~412 | `NOT g.is_playoff` | Add `AND g.game_type = 'regular'` |
| 21 | Skater all-time ALL seasons — hist_totals | ~422 | `NOT is_playoff` (player_season_stats) | Already safe |
| 22 | Goalie all-time ALL seasons | ~448 | `NOT g.is_playoff` | Add `AND g.game_type = 'regular'` |
| 23 | Playoff skater all-time ALL seasons — game_totals | ~461 | `g.is_playoff` | Add `AND g.game_type = 'playoff'` |
| 24 | Playoff skater all-time ALL seasons — hist_totals | ~471 | `is_playoff` (player_season_stats) | Already safe |
| 25 | Playoff goalie all-time ALL seasons | ~497 | `g.is_playoff` | Add `AND g.game_type = 'playoff'` |

> **Summary**: 18 queries need `game_type` filter additions in `fetch-player-detail.ts`. 7 queries against `player_season_stats` are already safe since that table never contains exhibition/tryout data.

**`lib/fetch-team-detail.ts`** (2 queries):

| Query | Line | Current Filter | Add |
|---|---|---|---|
| Team regular season record | ~70 | `AND g.game_type = 'regular'` | ✅ Already filtered |
| Team standings computation | ~171 | `AND g.game_type = 'regular'` | ✅ Already filtered |

> **Note**: `fetch-team-detail.ts` already filters on `game_type = 'regular'` — no changes needed there. The `computeStandings()` function in `fetch-bash-data.ts` also already filters correctly.

### 5.3 Scorekeeper Compatibility

The scorekeeper is a critical path — these games need live scoring at the rink and remote spectator tracking. Three code paths need exhibition-awareness:

#### 5.3.1 Scorekeeper roster loading (`app/scorekeeper/[id]/page.tsx`)

**Current**: `getRoster()` queries `player_seasons WHERE season_id = X AND team_slug = Y`

**Change**: When `game_type IN ('exhibition', 'tryout')`, query `adhoc_game_rosters WHERE game_id = X AND team_side = 'home'|'away'` instead.

```typescript
// Pseudocode for the conditional
async function getRoster(gameId: string, teamSlug: string, seasonId: string, gameType: string): Promise<RosterPlayer[]> {
  if (gameType === 'exhibition' || gameType === 'tryout') {
    const rows = await rawSql(sql`
      SELECT p.id, p.name
      FROM adhoc_game_rosters agr
      JOIN players p ON agr.player_id = p.id
      WHERE agr.game_id = ${gameId} AND agr.team_side = ${side}
      ORDER BY p.name ASC
    `)
    return rows.map((r) => ({ id: r.id, name: r.name }))
  }
  // ... existing player_seasons query
}
```

#### 5.3.2 Game detail boxscore (`app/api/bash/game/[id]/route.ts`)

**Current**: `getPlayerStats()` and `getGoalieStats()` join `player_seasons` to split players into home/away.

**Change**: When `game_type IN ('exhibition', 'tryout')`, join `adhoc_game_rosters` (by `team_side`) instead of `player_seasons` (by `team_slug`).

```typescript
// Exhibition/tryout boxscore query
async function getAdhocPlayerStats(gameId: string, teamSide: string): Promise<PlayerBoxScore[]> {
  const rows = await rawSql(sql`
    SELECT p.id, p.name,
      pgs.goals, pgs.assists, pgs.points,
      pgs.gwg, pgs.ppg, pgs.shg, pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
    FROM player_game_stats pgs
    JOIN players p ON pgs.player_id = p.id
    JOIN adhoc_game_rosters agr ON agr.player_id = p.id AND agr.game_id = ${gameId}
    WHERE pgs.game_id = ${gameId} AND agr.team_side = ${teamSide}
    ORDER BY pgs.points DESC, pgs.goals DESC, p.name ASC
  `)
  return rows.map(/* ... */)
}
```

#### 5.3.3 Scorekeeper start — default goalie (`app/api/bash/scorekeeper/[id]/start/route.ts`)

**Current**: Auto-selects default goalie from `goalie_game_stats JOIN player_seasons`.

**Change**: Skip auto-detection for exhibition/tryout games. The scorekeeper will manually select the goalie, which is already a supported flow. No code change required beyond wrapping the existing query in `if (gameType !== 'exhibition' && gameType !== 'tryout')`.

### 5.4 Scores Tab — Exhibition Badge

When rendering game cards on the public scores page, display a badge for exhibition and tryout games. The scores tab already renders all games from the season query — no filtering change needed.

Badge logic: `gameType === 'exhibition' || gameType === 'tryout'` — not `gameType !== 'regular'`, which would incorrectly badge playoff and championship games.

Visual treatment: A small pill badge (e.g., `⭐ Exhibition` or `🏒 Tryout`) next to the game time/status, similar to how playoff games are labeled. Use **purple** (#7c3aed) for exhibition badges and **teal** (#0d9488) for tryout badges — both are in the existing design system palette and avoid conflicting with amber (overtime/warning) or blue (playoff).

### 5.5 Game Detail Page

The game detail page (`app/game/[id]/page.tsx`, `components/game-detail.tsx`) should:

- Display the game's `gameType` as "Exhibition" or "Tryout" in the game header
- Use the exhibition roster conditional described in §5.3.2 for boxscore rendering
- Otherwise render identically to a regular game (score, period breakdown, penalties, three stars, etc.)

### 5.6 Player Detail Page

Exhibition game appearances **will appear** in the player's game log with an "Exhibition" label — the game happened, it's part of their history. However, exhibition games must **not** be included in:

- Season stat totals
- All-time stat totals
- Per-season stat breakdowns
- Career stat summary

The query patches in §5.2 handle stat exclusion. The game log queries in `fetch-player-detail.ts` should **include** exhibition games but render them with a distinct visual indicator (e.g., `⭐ Exhibition` badge on the game row, muted styling to differentiate from regular-season entries).

### 5.7 Scorekeeper Inline Player Creation

For **exhibition** and **tryout** game types, the scorekeeper app must support adding players who are not yet in the system. This is critical because:

- **Exhibition games** attract alumni, guests, and walk-ups who may have no existing `players` record
- **Tryout games** have prospective players attending for the first time who haven't registered
- The scorekeeper at the rink needs to be able to add these players in real time without switching to the admin panel

#### Flow

When the scorekeeper is recording a goal, assist, or penalty for a player not on the pre-loaded roster:

1. **Search first**: Scorekeeper types the player's name into a search field that queries the full `players` table (not just the game roster). This catches alumni and past players who already exist in the system.
2. **Create if not found**: If no match is found, a "+ Add New Player" option appears. Tapping it opens a minimal creation form:
   - **First Name** (required)
   - **Last Name** (required)
   - **Position** (optional — defaults to "Skater")
3. **Insert + Assign + Sync state**: The new player is inserted into the `players` table and immediately added to the `adhoc_game_rosters` table for the game. **Additionally, the `game_live.state.[home|away]Attendance` array must be patched** to include the new player's ID so they appear in the scorekeeper's live roster and are included in the finalize flow's stat computation. The scorekeeper can now attribute goals/assists/penalties to them.
4. **No `player_seasons` created**: The newly created player is NOT added to `player_seasons` — they only exist in the `adhoc_game_rosters` and the global `players` table.

#### Scope

This inline creation is **only available** when `game_type` is one of:
- `exhibition`
- `tryout`

For `regular`, `playoff`, and `championship` game types, the scorekeeper continues to use the fixed roster from `player_seasons` — no ad-hoc additions.

#### Player slug generation

Newly created players must get a valid slug via `lib/player-slug.ts`. **Note**: The current `playerSlug()` function is a pure string transform — it does not check for collisions. The `POST /api/bash/scorekeeper/[id]/player` endpoint must implement a slug-check-and-retry loop: generate slug → check if a player with that name already exists → if duplicate name, the insert will fail on the `players.name` UNIQUE constraint, so use the existing player's ID instead of creating a new one. This handles the common case of a returning player whose name is already in the system.

> **Design note on slug uniqueness**: The `players` table has a UNIQUE constraint on `name` (not slug). Slugs are computed on-the-fly from names via `playerSlug()`. Two players with the same name would conflict on the `name` column. If genuine same-name players exist, they should be differentiated at creation time (e.g., "Mike Johnson" vs "Mike Johnson Jr.").

#### Tryout game roster behavior

For tryout games, rosters also need to be decoupled from `player_seasons` since tryout players may not be on any team yet. Tryout games use the same `adhoc_game_rosters` table — the table name reflects its generic purpose: any game type that doesn't use `player_seasons` for roster composition.

---

## 6. API Routes

### New Endpoints

- **`GET /api/bash/admin/seasons/[id]/adhoc/[gameId]/roster`**
  Returns the current ad-hoc roster for a game, split by `team_side`.

- **`PUT /api/bash/admin/seasons/[id]/adhoc/[gameId]/roster`**
  Replaces the full ad-hoc roster for a game. Accepts `{ home: [playerId, ...], away: [playerId, ...] }`. Deletes existing rows and inserts new ones (idempotent). Note: DELETE + INSERT without a transaction is accepted — partial failure (empty roster) is recoverable by retrying the full PUT.

- **`POST /api/bash/admin/seasons/[id]/adhoc/[gameId]/roster/player`**
  Add a single player to the ad-hoc roster. Accepts `{ playerId, teamSide }`.

- **`DELETE /api/bash/admin/seasons/[id]/adhoc/[gameId]/roster/player/[playerId]`**
  Remove a single player from the ad-hoc roster.

- **`POST /api/bash/scorekeeper/[id]/player`** (New)
  Inline player creation from the scorekeeper. Only allowed when `game_type IN ('exhibition', 'tryout')`. Accepts `{ firstName, lastName, position?, teamSide }`. Creates the player in the `players` table, inserts into `adhoc_game_rosters` for the game, **patches `game_live.state` to add the player to the correct attendance array**, and returns the new player record. Returns `403` if the game type doesn't support inline creation.

- **`GET /api/bash/admin/seasons/[id]/tryout-attendance`** (New)
  Returns a list of players who appeared in any `game_type = 'tryout'` game for the given season, with: player name, player ID, count of tryout games attended, and a boolean `is_new_player` flag (true if the player has no `player_seasons` records for any previous season). Used by the Tryout Attendance admin tab.

### Modified Endpoints

- **`GET /api/bash/game/[id]`** — Add conditional: when `game_type IN ('exhibition', 'tryout')`, use `adhoc_game_rosters` for boxscore player splitting instead of `player_seasons`.

- **Scorekeeper page** (`app/scorekeeper/[id]/page.tsx`) — Add conditional roster loading (server component, not an API route).

---

## 7. Frontend Components

### 7.1 Admin "Add Game" Workflow Update

The existing "Add Game" button on the admin schedule tab needs to be updated to support exhibition and tryout game creation:

- **Game type selector**: Add a game type dropdown (Regular, Playoff, Exhibition, Tryout) to the Add Game form. Defaults to "Regular".
- **Dynamic form**: When game type is changed to `exhibition` or `tryout`:
  - A new "Game Title (optional)" input field appears, allowing admins to set a custom title.
  - The team selectors expand beyond `season_teams`. The dropdown itself integrates options to select any team from the `teams` table, or create a new ad-hoc team inline via a special "Create new team..." option within the select menu. This avoids cluttering the form with extra buttons.
  - A roster assignment section appears below the team selectors, using the same player search + assignment UI as the Edit Game roster editor (§7.2).
  - For regular/playoff types, the form behaves exactly as it does today.

### 7.2 Ad-Hoc Roster Editor (New)

A new section within the Edit Game modal or a dedicated modal, shown only when `gameType = 'exhibition'` or `gameType = 'tryout'`:

- **Player search**: Autocomplete search across the full `players` table (not limited to season roster)
- **Tabbed single-column layout on mobile**: `[Home]` / `[Away]` tabs at the top (using the existing tab-active/tab-inactive pattern from DESIGN.md), with a full-width player search and list below. Each tab shows only one team's roster. On desktop, a two-column layout (home left, away right) is acceptable.
- **Add/remove**: Click to add from search results, click X to remove from roster
- **Persistence**: Saves to `adhoc_game_rosters` via the API above

### 7.3 Tryout Attendance Tab (New — Fall Seasons Only)

A new tab on the admin season detail page, visible **only for fall season types**:

- **Tab label**: "Tryout Attendance" (appears alongside Schedule, Teams, Draft tabs)
- **Data source**: `GET /api/bash/admin/seasons/[id]/tryout-attendance`
- **Table columns**: Player Name, Games Attended (count), New Player (badge)
- **Filters**:
  - "New players only" toggle — filters to players with `is_new_player = true` (no prior `player_seasons` records)
  - Search by name
- **Empty state**: "No tryout games found for this season. Create a game with type 'Tryout' from the Schedule tab."
- **Purpose**: Answers the critical business question: "Which rookies attended at least one tryout game this fall?" This is the primary eligibility check for new player draft inclusion.

### 7.4 Scorekeeper Inline Player Creation (New)

A lightweight player creation flow within the scorekeeper app, available only for exhibition and tryout game types:

- **Timing**: Roster setup happens **before the game starts** or during stoppages. The scorekeeper checks with both teams in the 10+ minutes before puck drop and settles rosters. Late arrivals are added during breaks in play, not during active game action.
- **Trigger**: When managing the roster before the game or during a stoppage, the player search shows a "+ Add New Player" option at the bottom of the search results (always visible, pinned)
- **Inline form**: A compact modal with First Name, Last Name, and an optional Position select (defaults to Skater). Team side is auto-determined from the context (which team is being managed)
- **Search-first UX**: The search field queries the full `players` table. Results show name and any previous team affiliations to help the scorekeeper identify returning alumni vs. true new players
- **Confirmation**: After creation, the player is immediately available in the scorekeeper's roster for the rest of the game
- **Visual indicator**: Newly added players show a small "NEW" badge in the roster list so the scorekeeper can distinguish them from pre-loaded roster players

This can be implemented as:
- A new tab in the existing `EditGameModal` (simplest, but modal is already dense)
- A separate "Manage Roster" button on the schedule tab that opens a dedicated modal (recommended — cleaner UX)
- Reminder: please evaluate this when you implement to ensure a good UX. 

### 7.2 Scores Tab Badge

Add exhibition or tryout badge rendering to the game card component. Minimal change — a conditional `<Badge>` element.

### 7.3 Game Detail Exhibition Header

Show "Exhibition" or "Tryout" label in the game detail header when `gameType === 'exhibition'` or `gameType === 'tryout'`. Also, if the game has a custom `title`, it should be displayed above the team matchup or alongside the game metadata (e.g., "⭐ The Alumni Game | Nov 12, 2025").

---

## 8. Decisions Made

1. **Option B selected** — Ad-hoc game rosters table for clean data separation. `player_seasons` is not used for exhibition or tryout team assignments.

2. **Real team rows with branding** — Exhibition teams (`team-usa`, `team-canada`, `alumni-east`, `alumni-west`) are created as real `teams` table rows with custom colors. Team logos will be added via `lib/team-logos.ts`. This avoids special-casing in all rendering code that resolves team names from slugs.

3. **Stats exclusion via `game_type` filter** — All stats queries will be patched to include `AND g.game_type = 'regular'` (or `'playoff'` for playoff queries) alongside existing `is_playoff` filters. This is the same pattern used by `computeStandings()` and `fetch-team-detail.ts`.

4. **Scorekeeper works** — Exhibition and tryout games use the same scorekeeper infrastructure. The only difference is the roster source (`adhoc_game_rosters` vs `player_seasons`). Live game state (`game_live`), sync manager, finalize flow, and the public live-score view are all game-type agnostic.

5. **No separate exhibition season** — Exhibition games live under the current fall season. This avoids multi-season merge complexity and keeps the season picker clean for end users.

6. **Game detail boxscore** — Exhibition/tryout boxscores join `adhoc_game_rosters` by `team_side` instead of `player_seasons` by `team_slug`. The rendering is otherwise identical.

7. **Exhibition games in player game logs** — Yes, with an "Exhibition" or "Tryout" label. These are real games the player participated in and should be visible in their history, even though the stats don't count toward season/career totals.

8. **No dedicated exhibition page** — Exhibition games appear on the regular scores page under the current season. A dedicated `/exhibition` or `/events` page is not needed for 2 games.

9. **Any ad-hoc matchup supported** — The system is not limited to Alumni and USA vs Canada. Any exhibition team can be created (All-Star, charity, sponsor teams, etc.) and any ad-hoc matchup can be scheduled by the admin.

10. **Scorekeeper inline player creation** — For exhibition and tryout games only, the scorekeeper can search for existing players across the full `players` table and create brand new players on the spot. This handles walk-up alumni, guests, and tryout players who arrive on game day without prior registration. Regular/playoff/championship games continue to use fixed `player_seasons` rosters with no ad-hoc additions.

11. **Game creation via Add Game button** — Exhibition and tryout games are created via the existing "Add Game" button on the admin schedule tab. The game type selector triggers the ad-hoc roster workflow. No separate admin UI path needed.

12. **Sportability independence** — The app functions correctly without Sportability sync. Exhibition/tryout games have no Sportability game ID and are invisible to the sync process. Admin pages and the scorekeeper app are the primary data entry paths.

13. **Table named `adhoc_game_rosters`** — More descriptive than `exhibition_rosters` since the table serves both exhibition and tryout game types.

14. **Player position defaults to Skater** — Forward/Defense distinction is assigned later by coaches, not at game-time creation.

15. **Badge colors: purple for exhibition, teal for tryout** — Avoids conflicting with amber (overtime/warning) and blue (playoff) semantics in the design system.

16. **Game Titles** — Games have an optional `title` field to allow meaningful names like "Alumni Game".

17. **Team Picker UI** — Creating teams or selecting from the database happens directly within the Team Select dropdown using special trigger values, rather than through separate off-canvas buttons.

---

## 9. Implementation Plan

| Step | Area | Description | Effort |
|---|---|---|---|
| 1 | Schema | Add `adhoc_game_rosters` table to `lib/db/schema.ts` and run migration | 15 min |
| 2 | Data | Insert exhibition teams into `teams` + `season_teams` for current season | 15 min |
| 3 | Stats | Add `AND g.game_type = 'regular'` (or `'playoff'`) to 22 queries across `fetch-player-stats.ts` and `fetch-player-detail.ts` | 1.5 hr |
| 4 | Scorekeeper | Conditional roster loading in `app/scorekeeper/[id]/page.tsx` for exhibition/tryout games | 30 min |
| 5 | Game Detail API | Conditional boxscore splitting in `app/api/bash/game/[id]/route.ts` | 30 min |
| 6 | Scorekeeper Start | Skip default goalie auto-detection for exhibition/tryout games | 10 min |
| 7 | API | New ad-hoc roster CRUD endpoints + tryout attendance endpoint | 1.5 hr |
| 8 | Scores Tab | Add exhibition/tryout badge rendering (purple/teal) | 20 min |
| 9 | Admin UI | Update Add Game form with game type selector + dynamic team/roster fields | 2 hrs |
| 10 | Admin UI | Ad-hoc roster editor (player search + tabbed assignment) | 2 hrs |
| 11 | Admin UI | Tryout Attendance tab (fall seasons only) | 1.5 hr |
| 12 | API | Scorekeeper inline player creation endpoint with game_live state sync | 1 hr |
| 13 | Scorekeeper UI | Inline player search + create flow (search existing → create new → add to roster) | 2 hrs |
| 14 | Scorekeeper | Enable adhoc_game_rosters for tryout game types (same roster decoupling) | 15 min |
| | | **Total** | **~2 days** |

---

## 10. Verification Plan

### Automated

- `npx tsc --noEmit` — Type safety after schema and query changes
- Verify `computeStandings()` still excludes exhibition games (already does)

### Manual

- Create an exhibition game via admin Add Game button (select game type = Exhibition) → verify it appears on scores page with purple "Exhibition" badge
- Create a tryout game via admin Add Game button (select game type = Tryout) → verify it appears on scores page with teal "Tryout" badge
- Assign players (including non-season players) to ad-hoc roster → verify they appear in scorekeeper roster
- Start scorekeeper for exhibition game → verify roster loads correctly, live scoring works, public live view works
- Finalize exhibition game with boxscore → verify game detail page renders boxscore correctly with home/away split
- Verify season stats page (`/stats`) does NOT include exhibition game stats
- Verify player detail page (`/player/[slug]`) does NOT include exhibition games in season/all-time stat totals
- Verify standings page does NOT show exhibition teams or include exhibition results
- Verify all-time stats (`/stats?season=all`) exclude exhibition game data
- Start scorekeeper for a **tryout** game → verify same ad-hoc roster behavior as exhibition
- Use scorekeeper inline player creation → search for an existing alumni player → verify they appear in search results and can be added
- Use scorekeeper inline player creation → create a brand new player → verify they get a valid slug, appear in the roster, and can receive goals/assists
- Verify newly created players do NOT get `player_seasons` entries
- Verify inline player creation is blocked (403) for regular/playoff/championship game types
- Verify inline player creation patches `game_live.state` attendance array → finalize includes the new player in stat rows
- Navigate to Tryout Attendance tab on a fall season → verify it lists players from tryout games with correct attendance counts
- Apply "New players only" filter on Tryout Attendance tab → verify only players with no prior seasons are shown
- Verify Tryout Attendance tab is NOT visible on summer season admin pages
- Verify the app functions correctly without any Sportability sync — create a game manually, score it via scorekeeper, finalize, and verify all stats pages render correctly

---

## 11. Open Questions

- [x] ~~Should exhibition games appear in the player's game log on their detail page?~~ **Resolved: Yes** — with an "Exhibition" label. The game happened, it's part of their history.
- [x] ~~Should exhibition teams have custom colors/logos?~~ **Resolved: Yes** — exhibition teams will have custom colors (stored on `season_teams.color` or the team row) and logos via `lib/team-logos.ts`.
- [x] ~~Should there be a dedicated `/exhibition` or `/events` public page?~~ **Resolved: No** — exhibition games appear on the regular scores page. No dedicated page needed.
- [x] ~~Are there additional exhibition game formats beyond Alumni and USA vs Canada?~~ **Resolved: Yes** — the system should handle any ad-hoc matchup (All-Star, charity, sponsor teams, etc.). Exhibition teams are just regular team rows that happen to only play in exhibition games.
- [x] ~~Should the scorekeeper support adding new players during games?~~ **Resolved: Yes** — for exhibition and tryout game types only. Scorekeeper can search existing players or create new ones inline. Regular/playoff games use fixed rosters.
- [x] ~~Where do exhibition/tryout games get created in the admin?~~ **Resolved**: Via the existing "Add Game" button on the schedule tab, with game type selector triggering the ad-hoc roster workflow.
- [x] ~~Does the app work without Sportability?~~ **Resolved: Yes** — the admin pages and scorekeeper are fully independent data entry paths. Sportability sync is optional and only operates on games with a matching `leagueId`.
- [x] ~~How do admins query tryout attendance?~~ **Resolved**: Via a dedicated "Tryout Attendance" tab on fall season admin pages, with filters for new players.
- [x] ~~What table name?~~ **Resolved**: `adhoc_game_rosters` — descriptive for both exhibition and tryout use cases.

---

## 12. Success Metrics

- Admins can create exhibition and tryout games via the Add Game button and assign ad-hoc rosters entirely from the browser
- Scorekeeper works for exhibition and tryout games with correct rosters
- Exhibition and tryout game scores are visible to the public in real time
- Zero impact on season standings, player stats, or all-time leaderboards
- Player detail pages do not show confusing dual-team affiliations
- Scorekeeper can add walk-up players to exhibition/tryout games without leaving the app
- Newly created players exist in the system for future seasons (persistent `players` record)
- Tryout Attendance tab on fall season admin pages shows which rookies attended at least one tryout game
- The app functions correctly without Sportability sync — all data can be entered via admin and scorekeeper
