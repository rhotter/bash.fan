# PRD: Fantasy and Pick'em

> **Status**: Implemented, in beta testing (nav link hidden until an admin turns it on)
> **Author**: BASH Development Team
> **Created**: 2026-11-01
> **Updated**: 2026-11-02
> **Related**: [fantasy-cap-simulation.md](./fantasy-cap-simulation.md), [GLOSSARY.md](../GLOSSARY.md)

Terms are defined in [`GLOSSARY.md`](../GLOSSARY.md). Prior art: the old Fantasy BASH site (scrape at `bash-scraper/scrapes/www.3rdbase.com/bash/fb`).

## Goal

Bring back a fantasy game for the current season, built around the fact that BASH Players don't attend every game. Two separate games share one page and one Manager identity:

- **Fantasy**: a weekly Lineup scored from Player stats.
- **Pick'em**: weekly Predictions of final scores.

Bragging rights only: no fees or prizes.

## Rules

### Timing

- The Lock is Saturday at 8am Pacific local time, so PDT in summer.
- A Week runs from one Lock to the next. Games fall inside the Saturday and Sunday after a Lock, so midweek games need no special handling.
- At the Lock, that Week's Lineups and Predictions freeze and become public. Before it they are visible only through the owning Manager Link.
- Only regular-season games count: `game_type = 'regular'`, not playoff, not exhibition.
- A Week with no games shows "No games this Week" and takes no Lineups or Predictions. Games don't move once scheduled.
- The site shows the day and time rather than the word "Lock", for example "Lineups due Sat, Nov 7, 8am PST". Avoid "deadline" in site copy.
- The game starts at the first Lock after launch in the current season. Earlier games don't count.

### Fantasy

- A Lineup has 3 skaters, 1 goalie, 1 skater Backup and 1 goalie Backup.
- The 3 skaters and goalie are required to save, except that the goalie slot may stay empty once every default goalie is at the Usage Cap for that Manager or on a Bye. An empty slot scores 0. Backups are optional.
- A Manager can edit freely until the Lock.
- A Player can appear only once in a Lineup.
- Only Players rostered in the season can be selected.
- A Player on a Bye can't be selected, including as a Backup, and the server rejects them. A traded Player is on a Bye only if none of their teams play that Week. If a Week has no games, nobody is on a Bye.
- Any rostered Player can fill a goalie slot, under the goalie cap. The default goalies offered are Players who have played goal this season, or the whole pool until someone has. Skater slots exclude Players with the roster's goalie flag.
- **Usage Cap**: per Player, per Manager, per season, with separate caps and separate counts for skater and goalie slots. A Player can be used up to the skater cap in skater slots and up to the goalie cap in goalie slots. Values are still being tested; see Cap experiments.
  - A Player at the cap can't be selected, including as a Backup.
  - The cap is checked on save and never voids a saved Lineup, even if a later correction changes a count.
  - A starter in a locked Week still waiting on a boxscore holds a use at save time, handed back if they turn out absent.
  - The form shows remaining uses per Player.
- A Selection follows the Player. Every counting game they play in that Week scores, including after a trade, except games they play as a Sub, which score nothing.
- A Player has played if they have a non-Sub stats row for a game in that Week. Zero-stat attendance counts as played. A Player whose only game was as a Sub counts as absent.
- Absent starters score 0 and cost no use.
- Each Backup covers one absent starter of its own kind. If two skaters are absent, only one is covered. Which one doesn't matter, as the points are the same.
- A Backup who isn't needed scores nothing and costs no use.
- A Selection that scores costs one use for the Week, even across two games.

Scoring weights:

| Skater stat | Points | Goalie stat | Points |
| --- | --- | --- | --- |
| Goal | 10 | Save | 1 |
| Assist | 3 | Goal against | -3 |
| PPG | 2 | Win | 5 |
| SHG | 3 | Shutout | 10 |
| PIM (per minute) | 2 | | |

A Player in a goalie slot scores goalie stats only. If they only skated that Week, they count as absent: 0 points, no use, and the goalie Backup can cover them. In a skater slot, points come from everything the Player did.

Standings rank by total points, Weekly and season. Ties share a rank. There's no carry-over: a missed Week scores 0. Managers can join in any Week.

### Pick'em

- A Prediction is a final score for one game. The winner is implied, and tied scores are rejected.
- Predictions are optional per game and save separately from Lineups. Clearing one before the Lock skips that game again.
- Scores are limited to 0-30, which the server enforces.
- Standings rank by correct winners, then lowest total goal error, then shared rank, Weekly and season.
- A skipped game has no penalty. It just can't be a correct winner, and goal error counts only games a Manager predicted.
- Goal error is the sum of the absolute home and away differences.
- Season standings list Managers who have made a Prediction. Weekly standings list Managers with a Prediction that Week.
- Forfeited games are void and count for nobody.

### Provisional Weeks and corrections

- A final game without a boxscore is "not yet scored", not "everyone absent". Its Week shows as provisional.
- Standings and uses are derived from current stats, so late boxscores and stat corrections flow through automatically.
- A forfeited game has no Player scoring, and uses are refunded. `is_forfeit` is the only signal: cancelled games have no status of their own.

### Identity

- Registration collects a Team Name plus first and last name, then issues a Manager Link.
- Team Names are public and unique, ignoring case. Real names are admin-only and must never reach a public response.
- Registration takes effect immediately. Admins verify by reviewing after the fact and removing bad entries, so registration doesn't wait on approval.
- One person gets one Team Name. Admins see real-name duplicates flagged, but they aren't blocked automatically.
- A lost link is recovered through an admin, who reissues it. Reissuing invalidates the old link.
- There's no email on file and no password.

## Config

Each season holds its own config, read by the code rather than hardcoded:

- Lineup slots
- Usage Cap for skaters and for goalies
- Scoring weights
- Lock day, time and timezone

The config stays editable after Lineups exist, so it can be tuned during the beta. Changes re-score every Week straight away, and moving the Lock moves which Week each saved Lineup belongs to. The game types a Contest scores are part of the config. A season can run several Contests, each with its own config and Managers.

Skater and goalie slots are data, so the parked 8-slot format can be added later with eligibility rules for captain and rookie slots.

## Surfaces

### Public

- `/fantasy`: a shared Week overview (games, Bye team, results), then Fantasy and Pick'em tabs with Weekly and season standings, plus public Lineups and Predictions after the Lock. The tab and Week are in the URL.
- `/fantasy/manager/[id]`: one Manager's season totals and locked Weeks for both games. Never the open Week or a real name.
- Registration form.
- Manager Link page: the Week overview plus Lineup, Predictions and History tabs. Lineups and Predictions save separately.
- Player picker: searchable, grouped by Week game then team, showing uses left and Fantasy points per game this season. Players with no uses left are visible but disabled.

### Admin

- Toggle for the nav link. It only shows or hides the link; `/fantasy` stays reachable by direct URL so it can be tested.
- While hidden, `/fantasy` is marked not to be indexed.
- Manager list with real names, duplicate flags, rename, remove and reissue link.
- Removing a Manager deletes their Lineups and Predictions, which also clears test data before launch.

## Implementation notes

- Follow `AGENTS.md`: no `db.transaction()`, group independent reads in `Promise.all`, wrap fetchers in `React.cache()`, use `IntentLink` for detail navigation, and use the scripts-based schema deploy pattern.
- These are the first public anonymous writes for this feature, so the server must enforce the Lock, Usage Cap, slot rules and token checks itself.
- Rate-limit registration. `operator_auth_attempts` shows the existing throttling pattern.
- Store only a hash of the Manager Link token, so a database leak doesn't expose links. Reissue is therefore rotate-and-show, not lookup. The link is shown once at registration and on reissue.
- Mark Manager Link pages no-index with `Referrer-Policy: no-referrer`.
- Keep scoring and Lock calculation as pure, unit-tested functions.
- Week calculation must be tested across daylight-saving changes.

## Testing

Unit tests in vitest cover:

- Scoring weights, including goalies who skate
- Backup substitution and use counting
- Usage Cap at the limit
- Provisional Weeks
- Pick'em ranking, skipped games and void games
- Lock and Week boundaries

Route tests cover rejected writes after the Lock, invalid tokens, cap violations, and real names never appearing in public responses.

## Out of scope

- Real accounts
- 8-slot format
- Salary budgets
- Captain multipliers
- Contrarian bonuses
- Power-ups
- Head-to-head
- Three-stars modifier
- Playoffs

## Open checks before build

None for attendance: scorekeeper-run games aren't synced from Sportability, and scorekeeper finalization writes a stats row for every attendee, including zero-stat Players.

## Season sizing

Fall seasons are 7 teams at 18 games per team, or 6 teams at 20 games per team. Summer sizing is deferred.

Measured from a local copy of production on 2026-11-01:

| Season | Regular games | Saturdays | Rostered skaters | Rostered goalies |
| --- | --- | --- | --- | --- |
| 2025-2026 (7 teams) | 63 | 21 | 121 | 9 |
| bash-2026-2027 (7 teams, current) | 63 | 21, 17 left | 121 | 17 |

Every regular-season game is on a Saturday, 3 per Week, with the earliest at 9am. Roster counts are `player_seasons` rows, so traded Players may count twice. The current season's 17 goalies looks high and needs checking.

Rough attendance from boxscores is 61-62% for skaters and 67-73% for goalies in fall seasons.

Goalies are the constraint: the goalie cap times the number of regularly playing goalies must reach the Week count for a Manager to fill every goalie slot. 9 goalies at a cap of 3 gives 27 uses over 21 Weeks, but goalies who rarely play add little.

## Cap experiments

The caps aren't decided. Compare options before launch with a simulation over past fall seasons, using real stats and attendance:

- Skater caps: 2, 3, 4 and none
- Goalie caps: 3, 4, 5 and none
- 6-team and 7-team seasons. The local copy has only 7-team fall data, so 6-team seasons need `--seasons` on the export

For each pair, report:

- Weeks a full-season Manager is left with no goalie, or with only one option
- How many different Players a Manager has to use
- How far late-season scores fall against early-season scores
- How much the optimal Lineup's score beats a typical one

The simulation lives in `scripts/` and reuses the pure scoring functions. It needs a database with historical seasons. Live tests can also try different caps by editing the config.

Starting values, approved 2026-11-01: skaters 3, goalies 4. See [fantasy-cap-simulation.md](./fantasy-cap-simulation.md).

---

## Implementation history

The tickets that built this feature, kept as written when they were closed, including their owner decisions and known gaps. They were tracked in `.scratch/fantasy/issues/` (see `docs/agents/issue-tracker.md`).

The code has moved on since. Where a ticket and the code disagree, trust the code and the rules above. Known differences: the `fantasy_seasons.nav_visible` column from ticket 04 and the `pickem.skippedGameError` config key from tickets 02 and 05 are no longer in the code, and `reassignLineupPlayer` (tickets 03 and 04) no longer uses `Promise.all`.

| Ticket | Title | Status |
| --- | --- | --- |
| [01](#01-make-migrations-rebuild-the-full-schema) | Make migrations rebuild the full schema | wontfix |
| [02](#02-fantasy-rules-engine-and-cap-simulation) | Fantasy rules engine and cap simulation | done |
| [03](#03-register-and-set-a-lineup) | Register and set a Lineup | done |
| [04](#04-fantasy-standings-and-launch-toggle) | Fantasy standings and launch toggle | done |
| [05](#05-pickem) | Pick'em | done |
| [06](#06-subs-and-byes) | Subs and Byes | done |
| [07](#07-layout-prototype) | Layout prototype | done |
| [08](#08-fantasy-redesign) | Fantasy redesign | done |
| [09](#09-public-manager-page) | Public Manager page | done |

### 01: Make migrations rebuild the full schema

**What to build:** A developer can build a complete database from migrations alone, and production's real schema is known. Fantasy tables then ship as normal migrations instead of adding another one-off schema script. See this PRD.

**Blocked by:** None (can start immediately)

**Status:** wontfix

- [ ] Production's schema is compared with a freshly built local schema, and every difference is listed and resolved
- [ ] Migrations `0000`-`0002` cover all tables, plus the functions, triggers and sequences that currently come from one-off scripts
- [ ] The baseline is recorded as already applied on production and doesn't run there. That production step is left for a human to run
- [ ] `db:migrate` exists (done), and migrating an empty database gives the same schema as production (not yet checked against production)
- [ ] Local setup uses migrations instead of `drizzle-kit push` plus hand-applied SQL
- [ ] The new migration workflow is documented in `AGENTS.md`, replacing one-off schema scripts for future changes

#### Comments

Won't do (decided by the owner, 2026-11-01). Production has never run `db:migrate`, and adopting it needs a write to production to record existing migrations as applied. Production is working, so schema changes keep the existing pattern: `lib/db/schema.ts` plus an idempotent one-off deploy script with a dry run, such as `scripts/deploy-trades-schema.ts`. Local setup stays on `drizzle-kit push` plus hand-applied SQL. `drizzle/` is unchanged.

Fantasy tables ship through `scripts/deploy-fantasy-schema.ts`. Tickets 03 and 04 should assume that.

Kept from this work: a shared PGlite test harness, `tests/helpers/pglite-db.ts`.

Production schema compared on 2026-11-01 against one built from `schema.ts` plus the scripts: no missing tables, columns, functions, triggers or checks.

- 18 constraints and their 4 indexes have Postgres-style names (`*_fkey`, `*_pkey`, `*_key`) on production. Definitions are identical.
- `idx_site_banners_active_priority` is `DESC` on production and ascending in `schema.ts`.
- `video_cameras_recording_quality_check` is on production and absent from `schema.ts`, as is `games_gen_seq`, which `lib/db/game-id.ts` creates at runtime.

### 02: Fantasy rules engine and cap simulation

**What to build:** All Fantasy and Pick'em rules exist as tested logic with no UI, and a simulation over real past seasons shows which Usage Caps to launch with. See "Rules", "Season sizing" and "Cap experiments" in this PRD.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Lock and Week calculation is correct across daylight-saving changes
- [x] Lineup scoring covers the weights, goalies who skate, and Selections who play two games
- [x] Backup substitution works per kind, and only one absent starter is covered per Backup
- [x] Usage counting charges only Selections that score, and allows an empty goalie slot once every goalie is at the cap
- [x] Provisional Weeks and void games behave as the spec describes
- [x] Pick'em ranks by correct winners, then goal error, with skipped games counting as 20 goals
- [x] All rules read from a season config, with nothing hardcoded
- [x] A simulation reports each skater and goalie cap pair on the metrics listed in the spec, using real stats and attendance
- [x] The 17 rostered goalies in the current season are explained, and only regularly playing goalies count in the sizing
- [x] 6-team seasons are included, or the report says they couldn't be tested
- [x] Results are written up with a recommended cap pair for a human to approve

#### Comments

Both syncs strip "(Canceled)" and leave the game `upcoming`, so a cancelled game looks like one still to come and its Week stays provisional forever. The engine voids `status = 'cancelled'`, and writing that value is now on ticket 03.

Open question: `scorePickem` isn't provisional for a final game without a boxscore, as the score is all it needs, while Fantasy is for the same Week. The spec's provisional line doesn't separate the two games.

Engine is in `lib/fantasy/`, simulation in `.local/fantasy-cap-simulation/` (git-ignored), results in [fantasy-cap-simulation.md](./fantasy-cap-simulation.md). Approved 2026-11-01: skaters 3, goalies 4. Any rostered Player can fill the goalie slot, defaulting to those who have played goal.

### 03: Register and set a Lineup

**What to build:** A person registers with a Team Name and real name, receives a Manager Link, and uses it to set and edit a Lineup until the Lock. Admins can review and manage Managers. See "Fantasy", "Identity" and "Config" in this PRD.

**Blocked by:** 02 (rules engine)

**Status:** done

Assumes admins review registrations afterward, with no approval step. This hasn't been confirmed yet.

- [x] An admin can turn the game on for a season with a config, which freezes at the first Lineup
- [x] Registration requires a Team Name, unique ignoring case, plus first and last name, and is rate limited
- [x] The Manager Link is shown at registration and only a hash of its token is stored
- [x] The Lineup form shows rostered Players by kind and remaining uses
- [x] The server enforces the Lock, slot rules, duplicate Players and the Usage Cap
- [x] A Manager can edit until the Lock, and a Lineup is visible only through its Manager Link before then
- [x] Manager Link pages aren't indexed and send no referrer
- [x] Admins see real names and duplicate flags, and can rename, remove and reissue a link
- [x] Reissuing invalidates the old link, and removing a Manager deletes their entries
- [x] Deleting all Managers unfreezes the config
- [x] Route tests confirm real names never appear in a public response
- [x] Goalie slots accept any rostered Player. The form defaults to `goalieOptions` (Players who have played goal this season, otherwise the whole pool), and the server enforces the goalie cap

#### Comments

Built, uncommitted. Run `scripts/deploy-fantasy-schema.ts` on production before deploying the code, because player merges now touch `fantasy_lineups`. The pages haven't been run in a browser: no database was available in the implementing session.

Decided by the owner, 2026-11-01:

- Uses are counted separately by slot kind: a Player can be used up to the skater cap and up to the goalie cap. [fantasy-cap-simulation.md](./fantasy-cap-simulation.md) predates this and pooled the counts.
- A starter in a locked Week waiting on a boxscore holds a use at save time, and it's handed back if they were absent. A game that never gets a boxscore keeps holding it.

- Dropped the `cancelled` game status (owner, 2026-11-01). `is_forfeit` is the only thing that voids a game. A cancelled game stays `upcoming`, so its Week stays provisional and its absent starters keep holding a use.

Still open: the admin page has an editable JSON config, kept so live tests can try different caps. The spec said no editing UI was needed.

Known gap: a Lineup saved in the instant an admin saves the first config could race past the freeze.

### 04: Fantasy standings and launch toggle

**What to build:** Anyone can visit `/fantasy` to see Weekly and season Fantasy standings and public Lineups after the Lock. An admin decides when the nav link appears. See "Surfaces" in this PRD.

**Blocked by:** 03 (Lineups)

**Status:** done

- [x] Weekly and season standings rank by total points, and ties share a rank
- [x] Standings derive from current stats, so late boxscores and corrections flow through
- [x] Weeks waiting on a boxscore are marked provisional
- [x] Lineups become public at the Lock and show each Selection's points, including Backup substitutions
- [x] Standings show Team Names only
- [x] An admin toggle shows or hides the nav link, and `/fantasy` stays reachable by direct URL
- [x] `/fantasy` isn't indexed while the link is hidden
- [x] The page follows the repo's caching, loading and navigation conventions

#### Comments

Built, uncommitted. `scripts/deploy-fantasy-schema.ts` now also adds `fantasy_seasons.nav_visible`, so run it on production before deploying: the root layout reads that column. The layout falls back to hiding the link if the read fails. The page hasn't been run in a browser, including the header at phone width, where the nav now scrolls sideways once Fantasy shows.

Decided by the owner, 2026-11-01: Weekly tables list only Managers who submitted a Lineup, and the season table lists every Manager.

`/fantasy` defaults to the latest locked Week, with links back to earlier ones, so past Lineups stay public.

Known gaps:

- `/fantasy` returns 404 until the game is on for the current season.
- A locked Week with no counting games isn't listed, so its Lineups never show. They score 0 either way.
- `reassignLineupPlayer` from ticket 03 runs its updates in `Promise.all`. AGENTS.md asks for sequential writes.

Added at the owner's request, 2026-11-01:

- The Manager Link page lists that Manager's previous Weeks and season total.
- The admin page has a temporary Overview: points by Week, uses against the cap, and whether the open Week is in.
- `.local/seed-fantasy-fake-data.ts` (git-ignored) fills a local database with fake Managers for testing. It refuses any URL that isn't localhost, and `--reset` undoes it.

### 05: Pick'em

**What to build:** A Manager uses their Manager Link to predict final scores for a Week's games, and `/fantasy` shows Pick'em standings separately from Fantasy. See "Pick'em" in this PRD.

**Blocked by:** 03 (Manager Links), 04 (`/fantasy` page), 07 (chosen layout)

**Status:** done

- [x] A Predictions tab lists the Week's games with two score boxes each and one Save for the Week
- [x] Tied scores are rejected, and scores are limited to 0-30, on the server too
- [x] Predictions are optional per game, save separately from Lineups and can be edited or cleared until the Lock
- [x] The server rejects Predictions after the Lock
- [x] Predictions become public at the Lock
- [x] Weekly and season standings rank by correct winners, then lowest goal error, then shared rank
- [x] Skipped games have no penalty: goal error counts only predicted games, and forfeited games count for nobody
- [x] Season standings list Managers with a Prediction; Weekly standings list Managers with a Prediction that Week
- [x] Fantasy and Pick'em standings never affect each other
- [x] Removing a Manager removes their Predictions

#### Comments

Decided by the owner, 2026-11-01: the 20-goal skipped-game penalty is gone. Remove `pickem.skippedGameError` from `FantasyConfig` and `scorePickem`. The config schema is strict, so stored season configs holding that key need handling or they stop parsing.

### 06: Subs and Byes

**What to build:** Games played as a Sub score nothing in Fantasy, and Players on a Bye can't be selected. Re-run the cap simulation under the Sub rule. See "Fantasy" in this PRD.

**Blocked by:** 03 (Lineups)

**Status:** done

- [x] A game played as a Sub scores nothing and isn't attendance, for skater and goalie stats
- [x] A Player whose only game was as a Sub counts as absent, costs no use, and a Backup can cover them
- [x] A traded Player's games for their new team still score
- [x] The server rejects a Lineup holding a Player on a Bye, including as a Backup
- [x] A traded Player is on a Bye only if none of their teams play that Week
- [x] The form leaves Players on a Bye out, with no way to show them
- [x] The goalie slot may stay empty when every default goalie is at the cap or on a Bye
- [x] A Week with no games shows "No games this Week" and refuses Lineups
- [x] The cap simulation is re-run under the Sub rule and [fantasy-cap-simulation.md](./fantasy-cap-simulation.md) is updated

#### Comments

Built, uncommitted. No schema change. The pages haven't been run in a browser.

The cap re-run keeps skaters 3, goalies 4, but it only tests Byes: past fall seasons have no Sub data. See [fantasy-cap-simulation.md](./fantasy-cap-simulation.md).

Live scoring trusts `is_sub`, which is set when a scorekeeper adds a Sub to a game.

Known gap, for the owner: in the local copy, Darrell Draper (rostered on yetis) has an unflagged stats row for loons on 2026-10-10, with no ad hoc roster entry. If that was a Sub game, it would score. Treating a row on an off-roster team as a Sub would close this, but it would also stop an unrecorded trade from scoring.

### 07: Layout prototype

**What to build:** One throwaway page with a toggle at the top for each version, using the fake data and the existing theme, judged at phone width first.

**Blocked by:** 06 (Subs and Byes)

**Status:** done

- [x] `/fantasy` versions: Week first, Standings first, Week and standings side by side
- [x] Player picker versions: bottom sheet, one-page board
- [x] The owner chooses a version of each, recorded here, and the prototype is deleted

#### Decision

**`/fantasy`: Week and standings side by side.**
- Week overview on top: games with day and time (never the word "Lock"), the Bye team, and the Week picker.
- Below it, the Week table and the Season table in two columns, kept two columns at phone width.
- Container is `max-w-6xl`, matching the other pages. The Week overview games spread across it in 1, 2 then 3 columns.
- Games and Bye teams show the small `TeamLogo` badge (20px for games, 16px for Bye). The time never wraps.

**Player picker: bottom sheet.**
- Each slot is a row, and tapping it opens a sheet with search and Players grouped by Week game, then team.
- Bottom sheet below 768px, right-hand side panel (about 28rem) from 768px up. The first version was poor on desktop.
- Rows show uses left and points per game, and Players with no uses left are visible but disabled.

Not chosen: Week first, Standings first, and the one-page board. The prototype was deleted and not kept on a branch. Points per game was fake data in the prototype.

### 08: Fantasy redesign

**What to build:** Rebuild `/fantasy`, the Manager Link page and the Player picker in the layouts chosen in 07. See "Surfaces" in this PRD.

**Blocked by:** 05 (Pick'em), 07 (chosen layout)

**Status:** done

- [x] `/fantasy` has a shared Week overview with games, the Bye team and results, following the Week picker
- [x] Fantasy and Pick'em tabs each show Weekly and season standings, with the tab and Week in the URL
- [x] The Manager Link page has the Week overview plus Lineup, Predictions and History tabs, each form showing its saved state
- [x] The Player picker is searchable, grouped by Week game then team, and shows uses left and points per game
- [x] Players with no uses left are visible but disabled
- [x] The site shows the day and time rather than the word "Lock"

### 09: Public Manager page

**What to build:** Each Team Name on `/fantasy` links to a public season view of that Manager. See "Surfaces" in this PRD.

**Blocked by:** 05 (Pick'em), 08 (redesign)

**Status:** done

- [x] `/fantasy/manager/[id]` shows season totals and every locked Week's Lineup, Predictions and results for both games
- [x] The URL uses the id, because Team Names can be renamed
- [x] The page never exposes the open Week or a real name, and a route test covers both
