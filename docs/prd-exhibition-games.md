# PRD: Exhibition & Tryout Games

> **Status**: Approved
> **Author**: Chris Torres
> **Created**: 2026-05-12
> **Updated**: 2026-05-13
> **Decision**: Option B (Exhibition Rosters Table)

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

- Allow admins to create exhibition and tryout games under the current season with custom team names and ad-hoc rosters.
- Ensure exhibition and tryout games are **completely excluded** from standings, player stats leaderboards, and all-time stat aggregations
- Ensure these games are **visible** on the public scores page with clear "Exhibition" or "Tryout" labeling
- Ensure the **scorekeeper app** and **live game tracking** work for these games (rink-side scoring + remote spectator view)
- Allow the scorekeeper to **search for existing players or create new ones** inline during exhibition and tryout games — critical for walk-up rookies at tryouts
- Ensure the **game detail page** correctly renders boxscores for these games, and labels them as "Exhibition" or "Tryout" games
- Track **tryout attendance** via roster participation — the roster IS the attendance record for rookie eligibility
- Keep the implementation minimal — this is for ~2–5 games per year, not a full parallel scheduling system. We assume these games will be added one by one by an admin. 

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

### Option B: Exhibition Rosters Table ✅ Selected

Use `game_type = 'exhibition'` for the game itself (same as Option A), but introduce a lightweight **exhibition roster** table to decouple exhibition team assignments from `player_seasons`. Create real team rows for the exhibition teams so existing rendering code works without special-casing.

**Roster approach**: A new `exhibition_rosters` table links `game_id` + `player_id` + `team_side` (`home` or `away`). The scorekeeper, game detail page, and boxscore rendering conditionally read from this table when `game_type = 'exhibition'`.

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
| Scorekeeper compatibility | Works (via `player_seasons`) | Works (via `exhibition_rosters`) | Works (via `player_seasons`) |
| Admin UX | Use existing modal | Small roster UI addition | Full existing season tools |
| Front end changes | Badge + query patches | Badge + query patches + game detail | Scores page multi-season merge |
| Implementation time | ~3 hours | ~1 day | ~2-3 days |
| Future-proofing | Low | High | Medium |

---

## 5. Proposed Approach — Option B

### 5.1 Data Model

#### New table: `exhibition_rosters`

Links players to exhibition game teams without touching `player_seasons`.

```sql
CREATE TABLE exhibition_rosters (
  game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id  INTEGER NOT NULL REFERENCES players(id),
  team_side  TEXT NOT NULL CHECK (team_side IN ('home', 'away')),
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX idx_exhibition_rosters_game ON exhibition_rosters(game_id);
```

**Drizzle schema** (`lib/db/schema.ts`):

```typescript
export const exhibitionRosters = pgTable(
  "exhibition_rosters",
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
    index("idx_exhibition_rosters_game").on(t.gameId),
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

#### No changes to `games` table

The existing `game_type` column with value `'exhibition'` is sufficient. No new columns needed.

### 5.2 Stats Query Patches

Exhibition games must be excluded from all stat computations. The following queries currently filter only on `is_playoff` and need an additional `AND g.game_type = 'regular'` clause:

**`lib/fetch-player-stats.ts`** (4 queries):

| Query | Line | Current Filter | Add |
|---|---|---|---|
| All-time skater stats (game_stats CTE) | ~87 | `NOT g.is_playoff` | `AND g.game_type = 'regular'` |
| All-time goalie stats | ~158-160 | Joins `games g` + `seasons s` | `AND g.game_type = 'regular'` |
| Season skater stats | ~215 | `${playoffFragment}` | `AND g.game_type = 'regular'` |
| Season goalie stats | ~245 | `${playoffFragment}` | `AND g.game_type = 'regular'` |

**`lib/fetch-player-detail.ts`** (~12 queries):

All queries that join `player_game_stats` or `goalie_game_stats` with `games` and filter on `is_playoff` need the same `AND g.game_type = 'regular'` addition. This affects regular-season stats, all-time stats, per-season breakdowns, and game logs for both skaters and goalies.

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

**Change**: When `game_type = 'exhibition'`, query `exhibition_rosters WHERE game_id = X AND team_side = 'home'|'away'` instead.

```typescript
// Pseudocode for the conditional
async function getRoster(gameId: string, teamSlug: string, seasonId: string, gameType: string): Promise<RosterPlayer[]> {
  if (gameType === 'exhibition') {
    const rows = await rawSql(sql`
      SELECT p.id, p.name
      FROM exhibition_rosters er
      JOIN players p ON er.player_id = p.id
      WHERE er.game_id = ${gameId} AND er.team_side = ${side}
      ORDER BY p.name ASC
    `)
    return rows.map((r) => ({ id: r.id, name: r.name }))
  }
  // ... existing player_seasons query
}
```

#### 5.3.2 Game detail boxscore (`app/api/bash/game/[id]/route.ts`)

**Current**: `getPlayerStats()` and `getGoalieStats()` join `player_seasons` to split players into home/away.

**Change**: When `game_type = 'exhibition'`, join `exhibition_rosters` (by `team_side`) instead of `player_seasons` (by `team_slug`).

```typescript
// Exhibition boxscore query
async function getExhibitionPlayerStats(gameId: string, teamSide: string): Promise<PlayerBoxScore[]> {
  const rows = await rawSql(sql`
    SELECT p.id, p.name,
      pgs.goals, pgs.assists, pgs.points,
      pgs.gwg, pgs.ppg, pgs.shg, pgs.eng, pgs.hat_tricks, pgs.pen, pgs.pim
    FROM player_game_stats pgs
    JOIN players p ON pgs.player_id = p.id
    JOIN exhibition_rosters er ON er.player_id = p.id AND er.game_id = ${gameId}
    WHERE pgs.game_id = ${gameId} AND er.team_side = ${teamSide}
    ORDER BY pgs.points DESC, pgs.goals DESC, p.name ASC
  `)
  return rows.map(/* ... */)
}
```

#### 5.3.3 Scorekeeper start — default goalie (`app/api/bash/scorekeeper/[id]/start/route.ts`)

**Current**: Auto-selects default goalie from `goalie_game_stats JOIN player_seasons`.

**Change**: Skip auto-detection for exhibition games. The scorekeeper will manually select the goalie, which is already a supported flow. No code change required beyond wrapping the existing query in `if (gameType !== 'exhibition')`.

### 5.4 Scores Tab — Exhibition Badge

When rendering game cards on the public scores page, display an "Exhibition" badge for `gameType !== "regular"` games. The scores tab already renders all games from the season query — no filtering change needed.

Visual treatment: A small pill badge (e.g., `⭐ Exhibition` or `⭐ Tryout`) next to the game time/status, similar to how playoff games are labeled. Use a distinct color (e.g., amber/gold) to differentiate from the blue playoff badge.

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
   - **Position** (optional — defaults to "Forward")
3. **Insert + Assign**: The new player is inserted into the `players` table and immediately added to the `exhibition_rosters` table (for exhibition games) or a temporary roster context (for tryout games). The scorekeeper can now attribute goals/assists/penalties to them.
4. **No `player_seasons` created**: The newly created player is NOT added to `player_seasons` — they only exist in the `exhibition_rosters` (or tryout equivalent) and the global `players` table.

#### Scope

This inline creation is **only available** when `game_type` is one of:
- `exhibition`
- `tryout`

For `regular`, `playoff`, and `championship` game types, the scorekeeper continues to use the fixed roster from `player_seasons` — no ad-hoc additions.

#### Player slug generation

Newly created players must get a valid slug via `lib/player-slug.ts` (same as the CSV import flow). Duplicate name handling follows the existing pattern: append a numeric suffix if the slug already exists.

#### Tryout game roster behavior

For tryout games, rosters also need to be decoupled from `player_seasons` since tryout players may not be on any team yet. Tryout games should use the same `exhibition_rosters` table — the table name is slightly misleading, but the schema is identical: `game_id + player_id + team_side`. The `exhibition_rosters` table should be renamed or aliased conceptually as **"ad-hoc game rosters"** — it serves any game type that doesn't use `player_seasons` for roster composition.

---

## 6. API Routes

### New Endpoints

- **`GET /api/bash/admin/seasons/[id]/exhibition/[gameId]/roster`**
  Returns the current exhibition roster for a game, split by `team_side`.

- **`PUT /api/bash/admin/seasons/[id]/exhibition/[gameId]/roster`**
  Replaces the full exhibition roster for a game. Accepts `{ home: [playerId, ...], away: [playerId, ...] }`. Deletes existing rows and inserts new ones (idempotent).

- **`POST /api/bash/admin/seasons/[id]/exhibition/[gameId]/roster/player`**
  Add a single player to the exhibition roster. Accepts `{ playerId, teamSide }`.

- **`DELETE /api/bash/admin/seasons/[id]/exhibition/[gameId]/roster/player/[playerId]`**
  Remove a single player from the exhibition roster.

- **`POST /api/bash/scorekeeper/[id]/player`** (New)
  Inline player creation from the scorekeeper. Only allowed when `game_type IN ('exhibition', 'tryout')`. Accepts `{ firstName, lastName, position?, teamSide }`. Creates the player in the `players` table (with auto-generated slug), inserts into `exhibition_rosters` for the game, and returns the new player record. Returns `403` if the game type doesn't support inline creation.

### Modified Endpoints

- **`GET /api/bash/game/[id]`** — Add conditional: when `game_type = 'exhibition'`, use `exhibition_rosters` for boxscore player splitting instead of `player_seasons`.

- **Scorekeeper page** (`app/scorekeeper/[id]/page.tsx`) — Add conditional roster loading (server component, not an API route).

---

## 7. Frontend Components

### 7.1 Exhibition Roster Editor (New)

A new section within the Edit Game modal or a dedicated modal, shown only when `gameType = 'exhibition'` or `gameType = 'tryout'`:

- **Player search**: Autocomplete search across the full `players` table (not limited to season roster)
- **Two-column roster**: Home team players on the left, Away team players on the right
- **Add/remove**: Click to add from search results, click X to remove from roster
- **Persistence**: Saves to `exhibition_rosters` via the API above

### 7.4 Scorekeeper Inline Player Creation (New)

A lightweight player creation flow within the scorekeeper app, available only for exhibition and tryout game types:

- **Trigger**: When attributing a goal/assist/penalty, the player search shows a "+ Add New Player" option at the bottom of the search results (always visible, pinned)
- **Inline form**: A compact modal/sheet with First Name, Last Name, and an optional Position select, default to skater. Team side is auto-determined from the context (which team is being scored for)
- **Search-first UX**: The search field queries the full `players` table. Results show name and any previous team affiliations to help the scorekeeper identify returning alumni vs. true new players
- **Confirmation**: After creation, the player is immediately available in the scorekeeper's roster dropdown for the rest of the game
- **Visual indicator**: Newly added players show a small "NEW" badge in the roster list so the scorekeeper can distinguish them from pre-loaded roster players

This can be implemented as:
- A new tab in the existing `EditGameModal` (simplest, but modal is already dense)
- A separate "Manage Roster" button on the schedule tab that opens a dedicated modal (recommended — cleaner UX)
- Reminder: please evaluate this when you implement to ensure a good UX. 

### 7.2 Scores Tab Badge

Add exhibition or tryout badge rendering to the game card component. Minimal change — a conditional `<Badge>` element.

### 7.3 Game Detail Exhibition Header

Show "Exhibition" or "Tryout" label in the game detail header when `gameType === 'exhibition'` or `gameType === 'tryout'`.

---

## 8. Decisions Made

1. **Option B selected** — Exhibition rosters table for clean data separation. `player_seasons` is not used for exhibition team assignments.

2. **Real team rows with branding** — Exhibition teams (`team-usa`, `team-canada`, `alumni-east`, `alumni-west`) are created as real `teams` table rows with custom colors. Team logos will be added via `lib/team-logos.ts`. This avoids special-casing in all rendering code that resolves team names from slugs.

3. **Stats exclusion via `game_type` filter** — All stats queries will be patched to include `AND g.game_type = 'regular'` alongside existing `is_playoff` filters. This is the same pattern used by `computeStandings()` and `fetch-team-detail.ts`.

4. **Scorekeeper works** — Exhibition games use the same scorekeeper infrastructure. The only difference is the roster source (exhibition_rosters vs player_seasons). Live game state (`game_live`), sync manager, finalize flow, and the public live-score view are all game-type agnostic.

5. **No separate exhibition season** — Exhibition games live under the current fall season. This avoids multi-season merge complexity and keeps the season picker clean for end users.

6. **Game detail boxscore** — Exhibition boxscores join `exhibition_rosters` by `team_side` instead of `player_seasons` by `team_slug`. The rendering is otherwise identical.

7. **Exhibition games in player game logs** — Yes, with an "Exhibition" label. These are real games the player participated in and should be visible in their history, even though the stats don't count toward season/career totals.

8. **No dedicated exhibition page** — Exhibition games appear on the regular scores page under the current season. A dedicated `/exhibition` or `/events` page is not needed for 2 games.

9. **Any ad-hoc matchup supported** — The system is not limited to Alumni and USA vs Canada. Any exhibition team can be created (All-Star, charity, sponsor teams, etc.) and any ad-hoc matchup can be scheduled by the admin.

10. **Scorekeeper inline player creation** — For exhibition and tryout games only, the scorekeeper can search for existing players across the full `players` table and create brand new players on the spot. This handles walk-up alumni, guests, and tryout players who arrive on game day without prior registration. Regular/playoff/championship games continue to use fixed `player_seasons` rosters with no ad-hoc additions.

---

## 9. Implementation Plan

| Step | Area | Description | Effort |
|---|---|---|---|
| 1 | Schema | Add `exhibition_rosters` table to `lib/db/schema.ts` and run migration | 15 min |
| 2 | Data | Insert exhibition teams into `teams` + `season_teams` for current season | 15 min |
| 3 | Stats | Add `AND g.game_type = 'regular'` to ~16 queries across `fetch-player-stats.ts` and `fetch-player-detail.ts` | 1 hr |
| 4 | Scorekeeper | Conditional roster loading in `app/scorekeeper/[id]/page.tsx` for exhibition games | 30 min |
| 5 | Game Detail API | Conditional boxscore splitting in `app/api/bash/game/[id]/route.ts` | 30 min |
| 6 | Scorekeeper Start | Skip default goalie auto-detection for exhibition games | 10 min |
| 7 | API | New exhibition roster CRUD endpoints | 1 hr |
| 8 | Scores Tab | Add exhibition badge rendering | 20 min |
| 9 | Admin UI | Exhibition roster editor (player search + two-column assignment) | 2-3 hrs |
| 10 | API | Scorekeeper inline player creation endpoint (`POST /api/bash/scorekeeper/[id]/player`) | 45 min |
| 11 | Scorekeeper UI | Inline player search + create flow (search existing → create new → add to roster) | 2 hrs |
| 12 | Scorekeeper | Enable exhibition_rosters for tryout game types (same roster decoupling) | 15 min |
| | | **Total** | **~1.5 days** |

---

## 10. Verification Plan

### Automated

- `npx tsc --noEmit` — Type safety after schema and query changes
- Verify `computeStandings()` still excludes exhibition games (already does)

### Manual

- Create an exhibition game via admin Edit Game modal → verify it appears on scores page with "Exhibition" badge
- Assign players (including non-season players) to exhibition roster → verify they appear in scorekeeper roster
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

---

## 11. Open Questions

- [x] ~~Should exhibition games appear in the player's game log on their detail page?~~ **Resolved: Yes** — with an "Exhibition" label. The game happened, it's part of their history.
- [x] ~~Should exhibition teams have custom colors/logos?~~ **Resolved: Yes** — exhibition teams will have custom colors (stored on `season_teams.color` or the team row) and logos via `lib/team-logos.ts`.
- [x] ~~Should there be a dedicated `/exhibition` or `/events` public page?~~ **Resolved: No** — exhibition games appear on the regular scores page. No dedicated page needed.
- [x] ~~Are there additional exhibition game formats beyond Alumni and USA vs Canada?~~ **Resolved: Yes** — the system should handle any ad-hoc matchup (All-Star, charity, sponsor teams, etc.). Exhibition teams are just regular team rows that happen to only play in exhibition games.
- [x] ~~Should the scorekeeper support adding new players during games?~~ **Resolved: Yes** — for exhibition and tryout game types only. Scorekeeper can search existing players or create new ones inline. Regular/playoff games use fixed rosters.

---

## 12. Success Metrics

- Admins can create exhibition games and assign ad-hoc rosters entirely from the browser
- Scorekeeper works for exhibition games with correct rosters
- Exhibition game scores are visible to the public in real time
- Zero impact on season standings, player stats, or all-time leaderboards
- Player detail pages do not show confusing dual-team affiliations
- Scorekeeper can add walk-up players to exhibition/tryout games without leaving the app
- Newly created players exist in the system for future seasons (persistent `players` record)
