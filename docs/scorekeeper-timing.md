# Scorekeeper timestamps

Real-world observations are stored in the private, append-only `game_timing_events` table. The game snapshot retains only `state.timing = { version: 1, firstPlayStartedAt?, hasPlayStarted, entries: [] }`. The scoring UI does not display timing metadata; `fetchLiveGameData` removes the summary from public game-page and API payloads. Historical events without recorded timestamps are not backfilled.

## Schema and deployment

Run `pnpm exec tsx scripts/setup-scorekeeper-timing.ts dev` to create the table and migrate any previously recorded inline history in the explicitly configured `DATABASE_URL_DEV`. Run the same script with `prod` before deploying the application to production; this requires `PROD_URL` or `DATABASE_URL_PROD`. The script never falls back to a generic database URL. Each step is idempotent. Moving inline events and compacting their source snapshot happen in one atomic SQL statement.

Each row is keyed by `(game_id, entry_id)` and contains `kind`, `action`, `captured_at`, `recorded_at`, `received_at`, `source`, `period`, `clock_seconds`, and `details`. The database timestamps are `timestamptz`; client timestamps are UTC Unix milliseconds. An index on `(game_id, captured_at)` supports video time-range queries. Application writes only insert rows, using `ON CONFLICT DO NOTHING`; editing or removing a scoring event appends a new observation without changing its earlier rows. Explicitly deleting the parent game cascades to its timing history.

## Capture semantics

- `firstPlayStartedAt` is the device timestamp when the scorekeeper first starts a full first-period clock. It is not set for a midgame resume and is never replaced by subsequent starts. `hasPlayStarted` retains the fact of earlier play even when no trustworthy opening timestamp is available.
- `capturedAt` is the action/observation time. For new goals and penalties it comes from opening the entry drawer, before the scorekeeper fills in details.
- `recordedAt` is the submission time. `received_at` is assigned by the database and can be much later after offline scoring.
- `source: "device"` means the scorekeeper device's clock. `source: "server"` identifies an administrative correction, not live observation.

Entries cover clock changes, goals, penalties, timeouts, goalie pulls/returns/substitutions, shot-count changes, and shootout changes. `details.eventId` links identified events to their scoring records. `details.event` retains the entered event, while edits also retain the previous event. Clock entries retain before/after period, countdown, running flag, and latest start time. Shot-count entries include side, period, delta, and new total. Shootout entries retain side and before/after attempts.

For video alignment, use the original device `add` entry for an event. Captured period/countdown are retained separately from the event's entered period/clock, so a backdated entry or later correction can be distinguished. Device clock errors and scorekeeper reaction/entry delays are still possible: these are observation timestamps, not verified physical event times. An expired countdown's endpoint can be computed from the preceding clock start and countdown even if the next period is selected later.

## Synchronization and recovery

A normal scorekeeper save sends only entries that the server has not acknowledged. A per-game local acknowledgment ledger survives reloads; the full device draft remains a recovery copy. Only explicit acknowledgments for IDs actually sent advance that ledger. Failed/uncertain responses and unload beacons do not acknowledge anything. Retrying an entry is safe because its stable ID deduplicates in the database. Missing local storage can cause harmless resends. Completing a game clears its device draft and acknowledgment ledger.

The live-state API writes compact state and new timing entries in one SQL statement, without `db.transaction()`. A rejected or failed state write inserts no entries; an event insertion failure rolls back the state write. The server acknowledges the submitted IDs only after that statement succeeds. Older clients omitting timing preserve the stored game-start summary.

Finalization writes pending timing entries in the same statement that claims the validated snapshot. Subsequent statistics rebuild failures retain the committed observations, and retries do not duplicate them. Public editor snapshots omit timing; the server preserves the private summary, timestamps uncaptured administrative corrections, and uses the complete stored snapshot for its database compare-and-swap. Shot-only corrections retain the summary through their existing JSONB patch and keep their separate server-timestamped `shotCorrections` audit.

Live database checks use `RUN_TIMING_DB_TESTS=1 pnpm exec vitest run tests/scorekeeper-timing-db.integration.test.ts`. They require a distinct dev endpoint, create a uniquely named game fixture, and remove that fixture afterward.
