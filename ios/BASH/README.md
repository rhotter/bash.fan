# BASH for iPhone

Native SwiftUI league app, separate from `../BASHCapture`. Uses the existing public BASH APIs and does not require a database connection or account to browse. Requires iOS 17 or later. Native system controls adopt the installed iOS appearance, including the iOS 26 tab bar.

## Run

Open `BASH.xcodeproj`, select the BASH scheme and an iPhone simulator, then Run. Regenerate the project after changing `project.yml` using `xcodegen generate --spec ios/BASH/project.yml` from the repository root. Automatic signing is configured with development team `8GJXSBZAF8` for `fan.bash.league`.

```sh
xcodebuild -project ios/BASH/BASH.xcodeproj -scheme BASH \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -parallel-testing-enabled NO test
```

## Current scope

- Stats supports All time as an option in its existing season menu, without extra selectors. It uses the website API default of fall regular-season totals. This scope stays local to Stats; Scores and Standings keep their selected season. Team filtering is hidden for career totals, while name search, sorting, and player navigation remain available.

- All team-logo circles share the same team-color gradient, border, padding, and shadow across Scores, Standings, Stats, team/player profiles, game logs, and play-by-play. The Yeti artwork retains a white interior within its blue ring.

- Three tabs: Scores, Standings, and Stats, with compact branded headers and outline system icons.
- Scores: a horizontal Monday–Sunday week slider filters the dated schedule to the selected week. It opens on the current or most recent game week and preserves selection during refresh. The shared season dropdown is available on Scores, Standings, and Stats; changing it updates all three tabs.
- Standings: server-calculated ranking, team records and schedules. Points use neutral text; list rows share spacing, logo sizes and full-width dividers with Stats.
- Stats: native player-name search, a separate team filter (reset when changing season), player rows with a compact goals/assists/points breakdown, and descending metric sorting for points, goals, assists, games played, or points per game. The selected sort metric remains on the right; ties sort by name then player ID.
- BASH and team logos are bundled from the website's assets for immediate and offline display. The slug mapping mirrors `lib/team-logos.ts`; update both when adding teams or season-specific branding.
- Apple Sports-inspired matchup cards: opposing team logos, centered rounded score numerals, quiet status labels, and separate compact game cards. Outer margins are 12 points, with denser standings and stats rows. BASH orange remains on navigation and the selected week.
- Native player pages show regular-season and playoff history, expandable GP/G/A/PTS/PIM and points per game, plus goalie history where available. Career totals explicitly follow the API fall-season scope. History is cached in memory for two minutes.
- Schedule week groups are indexed once per snapshot instead of rebuilt during SwiftUI rendering. Grouping reuses date formatters and parses each distinct day once. Game details and player history share a bounded 80-response memory cache with in-flight request deduplication. The selected week preloads at most four games; Stats preloads at most four top-ranked players. Game cache freshness is 10 seconds for live games and 45 seconds otherwise; career history is 120 seconds. Pull-to-refresh bypasses the game cache.
- Search state is isolated to the Stats screen; metric/team ranking is recalculated only when its inputs change, not for each keystroke. Scores and stats requests start concurrently using the canonical API host.
- Native light/dark appearance, navigation, sharing, and pull-to-refresh. Accessible static skeletons cover first loads for scores, standings, stats, player careers, and game details; existing content remains visible during refresh. Debug-only slow-network UI coverage verifies placeholder-to-content transitions.
- Last successful scores and standings remain available offline with a stale-data label. Player stats are not persisted offline.
- Foreground refresh every 30 seconds and on return to the app.
- Native game pages use a pinned score header with Summary, Stats, and Plays tabs. Summary shows period goals and three stars; Stats separates skaters, goalies, and shots; Plays merges goals and penalties chronologically by period, plus shootouts. Game metadata is collapsed by default and the app tab bar is hidden while viewing a game. Tap a skater for their history. Game pages refresh every 15 seconds while live and every 60 seconds otherwise, only while active. Replays still open the website.

Following and notification controls are deferred. Their underlying local preference/reminder code is retained, but the app disables reminders and removes pending requests on launch while those controls are absent. No remote push notifications are sent.

## Next implementation steps

1. Goalie leaderboards, player game logs, draft board, and native replay playback to reach website parity.
2. Remote notifications: register APNs device tokens with an installation identifier, persist team/event preferences, and queue idempotent events from scorekeeper, finalization, schedule edits, and draft mutations. Use an outbox with retry/deduplication so a failed push does not fail a score update. Respect the HTTP database driver's lack of interactive transactions. Add credential-backed delivery, token invalidation, rate limits, and preference deletion before enabling production pushes.
3. Opt-in alerts for game reminders, schedule changes/cancellations, final scores, draft announcements, and optionally goals. Ask for notification permission when enabling alerts, rather than at launch.
4. ActivityKit live scores on the Lock Screen/Dynamic Island, with explicit stale state and end-of-game expiry. Use APNs updates while backgrounded; never depend on foreground polling or show an invented running clock.
5. WidgetKit next-game/recent-result widgets using a shared App Group cache, calendar export, and associated-domain links that open the relevant game/team in the app.
6. Integrate Capture behind an authenticated recording flow. Keep its recording/upload lifecycle independent from league browsing so navigation cannot accidentally end a recording. The existing capture project is unchanged.

Push credentials, production database changes, associated domains, widgets, and Live Activities are not included in this initial version.

## TestFlight

Push-triggered GitHub Actions deployment is configured for iOS changes on `main` and `video`. See [CI setup](ci/README.md) for the required repository secrets and verification steps. The CI path uses API-key authentication and a temporary signing keychain rather than this Mac's Xcode account session.

Pending release: player profiles include the API-backed current-season skater/goalie game logs, switched by regular season/playoffs. Removed the extra points-per-game/penalty summary line, horizontal-swipe hint, and selected history-row fill.

Pending release: player profiles use a compact identity header, selectable season headline stats, visible season comparison tables, and a separate goalie-history table. Regular season/playoffs remain separate and career totals retain their fall-only label.

Pending release: game Summary now includes scoring by period, shots on goal, three stars, and the period-by-period play feed. The separate Plays tab and stats-type selector are removed. Stats shows skaters followed by a separate Goalies block for the selected team. Play rows use compact six-point vertical insets with centered timestamps.

Build 18 moves the team-color gradients from entire Scores cards into the logo circles, with gentle colored edges and shadows; cards return to neutral backgrounds. The removed game counts stay removed. Navigation UI tests passed in both light and dark appearances, and signed archive/upload succeeded.

Build 17 adds logo-inspired away/home color gradients to Scores cards, neutral centers for legibility, subtle borders, and light-mode shadows. Unknown team palettes fall back to neutral; Reduce Transparency disables the gradient. Removed per-day game counts. Navigation UI tests passed in light and dark mode; archive/upload succeeded and 0.1 (17) is verified as Testing in BASH Internal.

Build 19 corrects the home-screen icon to the white bridge and white circular border on orange, with no text, matching the header artwork. The 1024px icon has no alpha and the signed archive succeeded. Upload is blocked: Xcode reports no App Store Connect account for the team, and Apple Accounts settings shows no signed-in account. Sign in again before retrying upload. This build has not reached TestFlight.

Build 16 replaces the square header tile with the white bridge on an orange circle, clipped outside its white border; the home-screen icon is unchanged. Navigation UI test and signed archive passed; upload succeeded and 0.1 (16) is verified as Testing in BASH Internal.

Build 15 adds accessible loading skeletons and prevents premature empty states. All 14 tests passed, including a delayed-network UI test; the delayed-network test passed again after the initial empty-schedule fix. Signed archive/upload succeeded; 0.1 (15) is verified as Testing in BASH Internal.

Build 14 removes repeated week grouping from rendering and adds bounded detail caching, shared in-flight requests, and limited game/player preloading. All 13 tests passed, including cache deduplication, forced refresh, retry, week index invalidation, and navigation. Optimized local benchmark: 40 groupings of 150 games took 0.476 seconds before and 0.146 seconds after; rendering now uses the stored index. This is a grouping benchmark, not a device-wide interaction latency claim. Signed archive/upload succeeded; 0.1 (14) is verified as Testing in BASH Internal.

Build 13 uses the text-free app icon in the top-left header on Scores, Standings, and Stats. Navigation UI test and signed archive passed; upload succeeded and 0.1 (13) is verified as Testing in BASH Internal.

Build 12 redesigns game details into Summary, Stats, and Plays with a pinned score header, separate shots table, merged chronological event feed, and compact spacing. All ten tests passed, and the game UI test passed again after the spacing adjustment. Signed archive and upload succeeded; 0.1 (12) is verified as Testing in BASH Internal.

Build 11 uses the text-free variant of the latest icon: black bridge, orange background, and white inner border. The signed archive and upload succeeded, and 0.1 (11) is verified as Testing in BASH Internal.

Version 0.1 (18) successfully archived and uploaded on October 25, 2026. The separate App Store Connect app is **BASH Hockey** (Apple ID `6826919308`, bundle ID `fan.bash.league`). The home-screen name remains BASH. The BASH Internal group automatically receives Xcode builds; the account holder is its tester. Build 0.1 (7) uses white bridge artwork, lettering, and circle outline on orange throughout, referencing the original league logo orange (#F36527). Build 0.1 (6) constrains the week selector to horizontal scrolling, scopes pull-to-refresh to the game list, and adds white circular backplates to team logos in dark mode. Six tests passed for the UI fixes. Build 8 adds neutral standings, matching row spacing and dividers, native player history, and isolated search rendering with cached ranking. Eight tests passed; build 0.1 (8) is verified as Testing in BASH Internal. Build 9 adds native box scores and game events, finalized goalie stats, and player-history navigation from the box score. Ten tests passed (eight unit and two API-backed UI tests). Build 0.1 (9) is verified as Testing in BASH Internal. Build 10 restores the original black bridge and lettering on orange, retaining the white inner border; the signed archive and upload succeeded and build 0.1 (10) is verified as Testing in BASH Internal.

```sh
xcodebuild -project ios/BASH/BASH.xcodeproj -scheme BASH \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath /tmp/BASH-League-TestFlight-1.xcarchive \
  -allowProvisioningUpdates archive
```

Distribute future archives through Xcode Organizer using App Store Connect and automatic signing. Increment `CURRENT_PROJECT_VERSION` in `project.yml` and regenerate the project before each new upload. Verify the build has finished processing and is available in BASH Internal before reporting it ready to install.
