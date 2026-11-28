# PR stack review: BASH Fantasy

Reviewed 2026-11-27.

| PR | Branch → base | Head | Critical | Important | Suggestions |
|---|---|---|---|---|---|
| [#60](https://github.com/rhotter/bash.fan/pull/60) Local Postgres | `local-postgres-support` → `main` | `584fece` | 0 | 4 | 5 |
| [#61](https://github.com/rhotter/bash.fan/pull/61) Fantasy admin and API | `fantasy-admin-api` → #60 | `bd963c6` | 1 | 8 | 8 |
| [#62](https://github.com/rhotter/bash.fan/pull/62) Fantasy public side | `fantasy-public-section` → #61 | `b241106` | 2 | 9 | 8 |

## Checks

Each branch was in sync with its base. `main` here means `origin/main` after a fetch.

| | #60 | #61 | #62 |
|---|---|---|---|
| `tsc --noEmit` | pass | pass | pass |
| `oxlint` | no findings | no findings | no findings |
| `vitest run` | 1363 passed, 64 skipped | 1733 passed, 64 skipped | 1791 passed, 64 skipped (second run) |

On the first #62 run, one test failed: `tests/playoff-odds-ui.test.tsx` ("does not show previous season metadata bar…"). The file then passed 5 of 5 times alone, and a second full run passed. It looks flaky and unrelated to #62. The likely cause (not reproduced) is the 1s `waitFor` timeout under load, plus an SWR cache shared between tests. `next build` was not run.

## How to read this

- **Proof:** *Reproduced* means a review agent ran a throwaway test or probe. *Code checked* means I also confirmed it in the source. *Read only* means it comes from reading the code and nothing was run.
- Line numbers are at that PR's head.
- Fix each item in the PR named by its section, then rebase the branches above it. Work bottom-up: #60, #61, #62.
- Nothing was posted to GitHub.

---

## PR #60: Local Postgres support

No critical issues. Production runtime is unchanged on read: non-localhost URLs still use `neon-http`.

### Important

- [x] **60-1. A target database error in trade sync is swallowed after the DELETE.** `scripts/export-prod-db.ts:690-694`. *Reproduced, code checked.*
  The `.catch` wraps all of `syncTrades`, including the target `DELETE`, `setval` and inserts. If the target raises `42501` after the delete, trades are lost or only partly refilled. The script then blames the **source** database and prints "Completed Successfully!".
  **Fix:** wrap only the two `prod` reads with `readIfPermitted`, return before the `DELETE` if either is `null`, and remove the outer `.catch`. Add a test for this; the existing one only checks the call string.

- **60-2. Docker port binding: won't fix.** The standard Docker port mapping is intentional.

- [x] **60-3. `db:setup` can report success when the schema push failed.** `scripts/setup-local-db.sh:40`. *Reproduced for a connection failure.*
  `drizzle-kit push` exits 0 on a refused connection, so `set -e` doesn't stop the script. From reading drizzle-kit, failed statements and "No, abort" also exit 0. The script then prints "Local database ready" over a stale or half-applied schema.
  **Fix:** push through a small script using `pushSchema`/`apply` from `drizzle-kit/api`, as `tests/helpers/pglite-db.ts` does, so errors throw. Keep the `push_*` table filter and handle data-loss warnings explicitly.

- [x] **60-4. Re-running `db:setup` isn't safe, although the docs say it is.** *Reproduced on file-backed PGlite, not on Docker Postgres, so confirm there first.*
  With no schema change, a second push still plans to drop and re-add constraints. With data present, it offers to **truncate** tables such as `hall_of_fame`; `player_awards` and `draft_picks` have the same kind of constraint. It also plans to drop `games_gen_seq`, which isn't in `schema.ts`, and `lib/db/game-id.ts` caches that it exists.
  **Fix:** correct the docs (answer No, or use `db:reset`). Recreate the sequence after the push, or declare it with `pgSequence` (untested, and it affects production pushes).

**Resolution of 60-1, 60-3 and 60-4** (uncommitted on `local-postgres-support`):
- **60-1:** only the two source reads can be skipped. Target errors now fail the run, and the summary says `skipped`.
- **60-3:** the proposed `pushSchema` fix doesn't work: it crashes on a populated database with `there is no parameter $1`. `db:setup` instead requires drizzle-kit's success message. Checked on Docker Postgres: fresh, re-run, failed statement, declined prompt, unreachable server, and an accepted prompt in a terminal.
- **60-4:** on real Postgres, the truncate prompt did **not** reproduce (it appears specific to PGlite). The silent drop of `games_gen_seq` did, and declaring it with `pgSequence` fixes it. Three foreign keys with names over 63 characters are still dropped and re-added on each push; this loses no data.

### Suggestions

- [x] **60-5. The sync can target a different database from the app.** `scripts/export-prod-db.ts:43-47`. Without `--to` or `DEV_URL`, it uses `DATABASE_URL` and ignores `DATABASE_URL_DEV` and `DB_TARGET`. The fallback is older than this PR, but the app, setup script and docs now prefer the target-specific variable, so a destructive sync could hit another hosted database. The documented command passes `--to`. *Read only.*
- [x] **60-6. Gaps in the localhost guard.** `lib/db/is-local-db-url.ts:6`, `setup-local-db.sh:22`. `postgresql://…@localhost/db?host=remote` passes the guard, but node-postgres connects to `remote` (*reproduced*). Reject a `host` query parameter. Also, `push` uses the URL's port while `psql` always uses the compose container, so compare against `docker compose port postgres 5432`.
- [x] **60-7. The env-file parser is fragile.** `setup-local-db.sh:7-9`. An inline `# comment` or CRLF ends up in the database name. With duplicate keys it takes the first, while dotenv takes the last (*reproduced*). Read the URL through `dotenv` instead.
- [x] **60-8. Pool robustness.** `lib/db/index.ts:56-57`. There's no `pool.on("error")` listener, so a container restart can raise an uncaught exception. The cached pool is also reused if the URL changes. Key the cache by URL. *Read only.*
- [x] **60-9. Smaller items.**
  - Skipped tables print as `0`, and the run still ends with plain success. Say "skipped".
  - Placeholder franchises are written without a log message.
  - `setupGame({status: "upcoming"})` still gets scores and `hasBoxscore: true`.
  - No tests cover skip-on-`42501`, the setup script's URL refusal, PGlite triggers and functions, or reset between tests.
  - `games_gen_seq` probably doesn't restart on truncate, although the docs say ID sequences do.

**Resolution of 60-5 to 60-9** (uncommitted on `local-postgres-support`):
- **60-5:** the sync needs `--to` or `DEV_URL`; `DATABASE_URL` is no longer a fallback.
- **60-6:** URLs with a `host` or `port` query parameter aren't local (node-postgres lets both override the address). Setup also stops if the URL's port isn't the container's published port.
- **60-7:** `scripts/local-db-config.ts` reads env files with `dotenv` and shares URL resolution and the localhost check with the app.
- **60-8:** `lib/db/local-pool.ts` handles idle connection errors and replaces the pool when the URL changes. Checked against a real database restart.
- **60-9:** all items done, with tests.

### Earlier feedback

Almost all of it is fixed: pool caching, officials and roster delete guards, franchise and draft read guards, `is_rookie`, closing the pool in `finally`, all setup-script items, the opt-in tests, factory ties and slugs, the `indexOf` guard, the jsdom stub, the single `TRUNCATE` and the docs.
- **Partly fixed:** trade permission handling (it introduced 60-1).
- **Mostly met:** the `createTestDb` test doesn't check triggers or functions.
- **Kept on purpose:** `@date-fns/tz`, for later PRs.

### Strengths

`null` versus `[]` cleanly separates "couldn't read" from "empty". Casting the local driver to the `neon-http` type keeps `db.transaction()` unavailable at compile time. The test database is built from the real schema and SQL.

---

## PR #61: Fantasy admin and API

No problems found with admin authorization, token hashing, real-name privacy, DST under the default lock, or drift between `schema.ts` and the SQL.

### Critical

- [ ] **61-1. Changing the lock day removes every saved Lineup from scoring, and the warning says they only move.** `app/api/bash/admin/seasons/[id]/fantasy/route.ts:82`, `lib/fantasy/standings.ts` (exact `weekId` match), `components/admin/fantasy-config-form.tsx:440`, `fantasy-admin.tsx:154`. *Reproduced by three agents, code checked.*
  `week_id` is the lock day's date. After Saturday → Friday, no saved ID matches a Week. In the repro, one Manager went from 20 points to 0, and spent uses were freed, so used-up Players could be picked again. The save reports success. Rows are kept, so changing the day back should restore them. Predictions are keyed by game and survive.
  Also, the confirmation only appears when there are Lineups, so a Predictions-only run gets no warning (`config-form.tsx:204`).
  **Fix:** reject a `lock.dayOfWeek` change once Lineups exist (or re-key `week_id` in one re-runnable statement). Correct the warning and count Predictions. Add a test. The PRD wording is covered in 62-11.

### Important

- [ ] **61-2. One anonymous client can block all registration for an hour.** `app/api/bash/fantasy/register/route.ts:21-37, 55-61`. *Reproduced, code checked.*
  Every attempt increments the global bucket, even when the client is already over its limit of 10, and counting happens before validation. 200 empty POSTs from one IP lock everyone out.
  **Fix:** check the client bucket first and only then count globally, validate before counting, log when the global limit trips, and show the real retry time (the client says "wait a moment"). Test the global limit and header spoofing, neither of which is covered.

- [ ] **61-3. Two overlapping Prediction saves can delete every Prediction while both report "saved".** `lib/fantasy/predictions.ts:84-107`. *Reproduced, code checked.*
  The order can be upsert A, upsert B, delete all but A, delete all but B. Two tabs, or an admin and a Manager, are enough.
  **Fix:** upsert and delete in one data-modifying CTE. The worst case then becomes merged picks instead of none.

- [ ] **61-4. Player auto-merge fails when one Lineup holds duplicates from two merge groups.** `lib/merge-duplicates.ts:356` with `reassignLineupPlayer` (`lib/fantasy/lineups.ts:514`). *Reproduced, code checked.*
  Concurrent workers read the same row, so the second compare-and-swap matches nothing and throws "still hold". The sync route has no separate catch for this, so it returns 500 and skips `last_sync` and playoff-odds revalidation. A re-run should recover.
  **Fix:** retry the read and update, or run reassignment one at a time. Test two merge groups, and the concurrent-edit guard, which is also untested.

- [ ] **61-5. Playoff games added by the daily sync count as regular games.** `app/api/bash/sync/route.ts:238-305` with `lineups.ts:96-97`. *Code checked; no real data checked.*
  The sync sets `isPlayoff` but never `gameType`, which defaults to `'regular'`. Fantasy filters only on `gameType`. For synced games, a regular contest also scores playoffs, and a playoffs contest finds nothing. The player route already guards with `NOT is_playoff AND game_type = 'regular'`.
  This only matters if fantasy seasons get games from the sync. Schedule-admin writes set both fields.
  **Fix:** make the fantasy filter respect `is_playoff`, or set `gameType` on insert and backfill, without overwriting a manual `championship`.

- [ ] **61-6. One invalid stored config breaks every contest, and the app can't repair it.** `lib/fantasy/season.ts:19-25, 44`, fantasy `route.ts:27, 61`. *Reproduced.*
  A hand-edited row, or a stricter future schema, makes the admin GET, registration and listing return 500 for healthy contests too. A PUT with a valid replacement also fails, because it parses the old row first.
  **Fix:** have the PUT read only `launchedAt` without parsing. Isolate and log bad rows in lists, and show admins the validation errors. Give new config keys a `.default()`.

- [ ] **61-7. Admins can't correct a past Week after a trade or roster removal.** `lineups.ts:471-478` with `scoring.ts:354-362`. *Reproduced.*
  Past Lineups are validated against today's roster. `on-bye` and `not-rostered` can't be overridden, so fixing any slot fails unless the affected Player is dropped.
  **Fix:** for closed Weeks, skip those checks for Players already saved in the same kind of slot, or allow an override.

- [ ] **61-8. Switching tabs in the admin picks editor discards unsaved picks.** `components/admin/fantasy-picks-editor.tsx:69-85`. *Read only; the same pattern is reproduced in #62.*
  Radix unmounts the inactive tab. Its Week links also leave without a warning.
  **Fix:** the same as 62-2. Fix it here, then carry it up.

- [ ] **61-9. Important test gaps.**
  - `fetchFantasyManager` and `loadPublicManager` have **no direct tests**, although they're a pre-lock privacy boundary. Assert exact result keys, no picks before the lock, and `null` for unknown or non-current-season Managers.
  - No test covers a skater slot earning goalie stats, including negative goals against.
  - Playoffs Managers' pick routes may not be checked against their own contest config.

### Suggestions

- [ ] **61-10. Configs that save but misbehave.** Fractional weights make float totals that should tie rank differently, and huge weights can overflow (`config.ts:54`). Goalie Backups are allowed with `goalies: 0`, so they can never play. The `endsOn` check with a null `startsOn` lives only in the route, not in `saveFantasyConfig`. Check stored rows before tightening (see 61-6).
- [ ] **61-11. Copy link.** `components/fantasy/copy-link.tsx` isn't keyed, so after a second reissue it still says "Copied" while the clipboard holds the dead link. A rejected `writeText` is also unhandled.
- [ ] **61-12. Merge recovery.** A failed manual-merge reassignment returns a generic 500, although re-running would fix it. Return a message the client will show. Also log when `replaceInLineup` drops a slot.
- [ ] **61-13. Removed Players show as "Unknown"** on Manager history, because names come only from the current roster (`lineups.ts:255`). *Reproduced.* Look them up in `players`.
- [ ] **61-14. Predictions don't record the teams they were made for.** A home/away swap silently reverses the pick, and `tbd` playoff games can be predicted before teams are known.
- [ ] **61-15. Backups can take a Player over the usage cap**, because they hold no use while a Week is unscored. The PRD says this is intended. Just add a test that pins it down.
- [ ] **61-16. Small test and type items.** Run the deploy script's statement splitter in a test, since a `;` in an indented comment would break only the deploy. Test submitting `RegistrationForm`. Key Pick'em rows by `managerId` instead of team name.
- [ ] **61-17. Docs for this PR.** `AGENTS.md` lacks `lib/fantasy/`, `lib/fetch-fantasy.ts`, the fantasy components, API routes, admin URLs and deploy script. Its table count is stale, and `SESSION_SECRET` (32 or more characters, or registration returns 503) isn't listed. The comment at `view-state.ts:8` gets the default contest wrong.

### Earlier feedback

All addressed at this head. Two items were done differently: the contest dropdown picks a type while the name stays free text (there's no beta type), and the closed state comes from `endsOn`, with no archive flag.

### Strengths

Only token hashes are stored, and public identity types have no real names. Responses are `no-store`. Sending `weekId` with each save stops a stale form writing into the next Week. The registration throttle is separate from the admin login limit. DST, lock boundaries and schema parity are tested against real PGlite, and the fantasy tests pass in other time zones.

---

## PR #62: Fantasy public side

No leaks of real names or of other Managers' pre-lock picks were found in public reads. Save routes enforce the lock, and the shared `GameCard` change shows no Scores page regression on read.

### Critical

- [ ] **62-1. The secret Manager Link token is sent to Vercel Analytics.** `app/layout.tsx:61-62` with `/fantasy/m/[token]`. *Code checked in `@vercel/analytics` 1.6.1; no network request captured.*
  The package sends `{ route, path }`. Only `route` is templated; `path` is the raw `usePathname()`, which includes the token. Anyone with dashboard access could take over a team, which defeats storing only a hash. `noindex` and `no-referrer` don't help. What Speed Insights' remote script sends is unverified.
  **Fix:** use a client wrapper with `beforeSend` that drops or rewrites `/fantasy/m/` URLs for both components, or don't mount them on that route. Verify in the network tab. If any real links were already visited on a deployed build, reissue them.

- [ ] **62-2. Switching between Lineup and Predictions throws away unsaved picks without warning.** `components/fantasy/manager-panel.tsx:79-127`. *Reproduced by three agents, code checked.*
  The inactive tab unmounts, and its cleanup reports `dirty=false`. The values and badge disappear, and the new leave guard is turned off. If you save and switch tabs before `router.refresh()` returns, the form reopens with the **old** values. Saving again then overwrites the new ones, and blank Prediction boxes delete them (that last step is read only). There's also no `beforeunload` guard.
  **Fix:** add `forceMount` with `data-[state=inactive]:hidden`, or lift the draft state into the panel. If both forms stay mounted, **track dirty state per form**: the single `unsaved` ref would be overwritten. Test edit → switch → back. The admin editor is 61-8.

### Important

- [ ] **62-3. Edits made while a save is in flight show as "Saved".** `predictions-form.tsx:120-134`, `lineup-form.tsx:161-191`. *Reproduced for Predictions.*
  Inputs stay editable, then success clears `dirty`. The screen can show a different winner from the one stored.
  **Fix:** use `<fieldset disabled={saving}>` including slot cards and Clear, or only clear `dirty` if nothing changed since the request. The logic predates this PR, but the new badge and guard depend on it.

- [ ] **62-4. Form and view state carries over when switching contests.** `app/fantasy/page.tsx:32`, `app/fantasy/register/page.tsx:43`. *Reproduced by re-rendering with new props; Next keeping the instance is from reading its source, so check in a browser.*
  - Standings keep the old contest's view and links, and Pick'em can rewrite the URL to the wrong contest.
  - After registering for Regular and clicking "Join Playoffs", the success screen still shows the **Regular** Manager Link.
  **Fix:** add `key={data.contest}` and `key={season.contest}`. This also finishes the `?contest=` feedback.

- [ ] **62-5. Concurrent saves for different Weeks can beat the usage cap.** `lineups.ts:439-456`. *Read only.*
  Picking ahead lets two Weeks be saved at once. Each reads, validates, then writes, and scoring never rechecks.
  **Fix:** use a single conditional write or a per-Manager version check, or document that the race is accepted.

- [ ] **62-6. The Predictions form crashes if a refresh adds a game.** `predictions-form.tsx:36, 98, 150`. *Reproduced.*
  `boxes` is built only on mount, and the new refresh after save can bring in a new game, so a successful save lands on the error boundary. The admin editor is affected too.
  **Fix:** use `boxes[game.id] ?? { home: "", away: "" }` in render, `readBoxes` and `change`.

- [ ] **62-7. Scores from 20 to 30 can't be typed straight through.** `predictions-form.tsx:55-60`. *Code checked.*
  Focus waits only after "1", so typing "25" splits across two boxes. The maximum is 30.
  **Fix:** also wait on "2" and "3", or drop auto-advance.

- [ ] **62-8. New teams may not appear on `/fantasy` right after joining.** `app/api/bash/fantasy/register/route.ts`. *Code checked that there's no refresh call.*
  **Fix:** call `refreshPublicPages()` after `createManager`.

- [ ] **62-9. A saved future Lineup disappears if its games are rescheduled.** `lineups.ts:353-380`. *Read only.*
  The Week list is built only from games. If a Week empties, its Lineup vanishes and doesn't follow them, while Predictions do. Picking ahead makes this more likely.
  **Fix:** tell the Manager, or flag it to admins.

- [ ] **62-10. Test gaps.**
  - No test for the `/fantasy/m/[token]` page (week parameter, closed or no-games header, bad token 404).
  - Nothing checks `key={form.week.id}` or refresh after save.
  - The `unstable_cache` tag, 30s revalidate and JSON round-trip are mocked away.
  - `/fantasy` week selection and keeping `?week` through the redirect are untested.
  - `fantasy-pickem-routes.test.ts:159` ("won't take Predictions for a later Week") now passes only because that file has no game that Week. Rename or remove it.
  - Add a test that re-saving one future Week's Predictions leaves another's intact.

- [ ] **62-11. The PRD disagrees with the code.** `docs/prd-fantasy.md`
  - The admin-priority note (line 120) says the page doesn't reuse a leaderboard view, but the Overview is still a ranked table. Word it as intent, or change the UI. Rename, remove and reissue are on the Manager detail page.
  - It omits that admins can view and edit unlocked picks and override the usage cap, and line 26 contradicts this.
  - It says only regular games score and playoffs are out of scope, but a playoffs run is built in. It omits `startsOn`, `endsOn` and run statuses. "Join in any Week" is wrong near the end of a run.
  - Line 102 says changing the lock moves Lineups (see 61-1).
  - "Pages open on the next Week with games" is wrong for `/fantasy`, which opens the latest locked Week.
  - It links files that **aren't in the repo**: `GLOSSARY.md`, `fantasy-cap-simulation.md`, `.scratch/` and `docs/agents/`. Commit them or remove the links.

### Suggestions

- [ ] **62-12. Admin "uses held" excludes future picks** (`fetch-fantasy.ts:116-132`), but save-time cap checks include them. Include them, or label it "locked Weeks only".
- [ ] **62-13. Screen readers hear final scores out of order** with no team names (`week-overview.tsx`, `GameCard`).
- [ ] **62-14. `fetchFantasyManager` runs two independent reads in sequence.** Use `Promise.all`, per `AGENTS.md`.
- [ ] **62-15. Stale comments.** `app/fantasy/page.tsx:7` (default contest), `week-row.tsx:18` (shared layout), `close-time.tsx:18` (not only the open Week), `cached-page-data.ts:53` (not only locked Weeks), `lineups.ts:211` (future Weeks hold uses too).
- [ ] **62-16. Smaller PRD points.** Provisional-without-boxscore applies to Fantasy only, not Pick'em. Team names are unique per season and contest. The "Known differences" list is incomplete.
- [ ] **62-17. `AGENTS.md` URL Structure** needs `/fantasy`, `/fantasy/register`, `/fantasy/m/[token]` and `/fantasy/manager/[id]`.
- [ ] **62-18. Countdown and `GameCard` tests.** Advance fake timers across the lock. Render live, final and TBD cards. Add a holiday-week case for the admin "open Week submitted".
- [ ] **62-19. Stabilise the flaky playoff-odds test** by giving it a fresh SWR cache provider and a longer `waitFor` timeout. This may belong in a separate PR off `main`.

### Earlier feedback

| Item | Status |
|---|---|
| Always keep `?contest=` | **Partly**: breaks after switching contests (62-4) |
| `?contest=` and contest indicator on registration | Done (success screen affected by 62-4) |
| Reuse Scores card UX | **Partly**: the week overview shares it; Pick'em uses its own `PickRow` |
| Team logos in Predictions | Done |
| Close time at top with countdown | Done |
| More visible unsaved changes | Done (but see 62-2 and 62-3) |
| One-click clear | Done |
| PRD note on admin priority | Done, but the wording overstates the UI (62-11) |
| Win odds on Pick'em (follow-up) | Not done (optional) |

The reviewer's manual test plan is still pending for sections 5–7.

### Strengths

Public queries select only IDs and team names. Locked-Week filtering happens on the server, so a stale cache can lag but not reveal picks early. Apart from 62-1, tokens are handled carefully. The countdown avoids hydration mismatches. No new `rawSql`. Server-side privacy, default-Week boundaries and cross-Week caps are well tested.

---

## Suggested order

1. **#60:** 60-1, 60-3 and 60-4.
2. **#61:** 61-1 first, which needs a decision: block the lock-day change (simpler, recommended) or re-key. Then 61-2 to 61-9. For 61-5, first check how the fantasy season's games get created.
3. **#62:** 62-1 and 62-2, then 62-3, 62-4 and 62-6, which are in the same forms and pages. Update the PRD last, once behavior is settled.

Decisions for you: 61-1 (block or re-key), 61-15 and 62-5 (fix or accept the cap gaps), and 62-11 (change the PRD wording or the admin UI).

After each PR's fixes, rebase the branches above it and rerun typecheck, lint and tests.
