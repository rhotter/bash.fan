# Developer Workflow Document

## Prerequisites

Before starting development on the BASH Hockey website, assure you have the following installed on your local machine:
- **Node.js** (Version 22.18+ or 24+, required to load `oxlint.config.ts` natively)
- **pnpm** (Package manager, install via `npm install -g pnpm`)
- A **Neon Postgres** database instance, or **Docker** to run Postgres on your machine (see [Local Docker Postgres](#local-docker-postgres)).

## Local Environment Setup

```mermaid
graph TD
    A[Clone Repo & Checkout Branch] --> C[pnpm install]
    C --> D[Configure .env.local]
    D --> E[Init Neon Postgres DB]
    E --> F[pnpm db:push]
    F --> G[pnpm seed]
    G --> H[pnpm dev]
    H --> I[Open localhost:3000]
    
    I --> J{Need to update data?}
    J -- Yes --> K[POST /api/bash/sync locally]
    J -- No --> L[Develop Features]
    
    L --> M[pnpm lint / pnpm build]
    M --> N[Commit & Push]
```

Follow these steps to get the site running locally:

### 1. Clone the Repository & Install Dependencies
```bash
# Clone the repository
git clone https://github.com/rhotter/bash.git
cd bash

# Switch to your development branch
git checkout your-branch-name

# Install frontend dependencies
pnpm install
```

### 2. Configure Environment Variables
Create a `.env.local` file at the root of the project to store your local secrets. It must contain your Postgres connection string:
```bash
DATABASE_URL=postgresql://<user>:<password>@<host>/<database>?sslmode=require
```

### 3. Setup the Database Schema
You need to initialize your local or cloud database with the correct tables.
Push the Drizzle Schema directly to your database by running:
```bash
pnpm db:push
```

> **Note:** If you pull changes that include new schema columns (e.g., additive schedule management fields), re-run `pnpm db:push` to apply them. Drizzle will only add new columns — it won't drop or modify existing data.

### 4. Seed the Database
To populate the database with real team and game data from the Sportability API:
```bash
pnpm seed
```
*(Note: Ensure your `DATABASE_URL` is set before running this command).*

### 4b. Syncing Live Production Data to Dev (Recommended)
`pnpm seed` imports historical data from Sportability up to the 2025–2026 season. Native BASH seasons (such as Summer 2026 and 2026–2027 pre-season drafts) were managed directly in BASH and exist only in the production database.

To replicate recent seasons, game boxscores, rosters, and live draft boards from production into your development or branch database:

```bash
# Using Environment Variables (requires both PROD_URL and DEV_URL)
PROD_URL='<prod-db-url>' DEV_URL='<dev-db-url>' npx tsx scripts/export-prod-db.ts

# Or using CLI Flags
npx tsx scripts/export-prod-db.ts --from '<prod-db-url>' --to '<dev-db-url>'

# Optional: Sync specific seasons only
npx tsx scripts/export-prod-db.ts --from '<prod-db-url>' --to '<dev-db-url>' --seasons 2026-summer,bash-2026-2027
```

> **Safety & Credential Security:**
> - **Never** save `PROD_URL` into `.env.local` or commit it to Git. Pass it at runtime via command line or environment variables.
> - The script automatically masks passwords in terminal output.
> - Source and target URLs cannot be identical (the script will abort to prevent accidental overwrites).
> - Dynamic name-to-ID alignment ensures that target historical stats are preserved without ID collision.

### Local Docker Postgres
This replaces steps 2–4 if you'd rather not use a hosted database.

1. In `.env.local`, point the app at the container:
   ```bash
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
   ```
2. Start Postgres and build the schema:
   ```bash
   pnpm db:setup
   ```
   This starts `docker-compose.yml`, creates the database named in the URL if it's missing, pushes `lib/db/schema.ts`, and adds the functions, triggers and push tables that Drizzle can't create. It's safe to re-run after a schema change. As in the app, `DATABASE_URL_DEV` wins over `DATABASE_URL` if both are set, and the script refuses any URL that isn't on localhost.
3. Copy data from production:
   ```bash
   PROD_URL='<prod-db-url>' pnpm db:export-prod --to 'postgresql://postgres:postgres@localhost:5432/postgres'
   ```
   If the source role can't read a table, the script says so, skips it, and leaves your local rows for that table alone.

To start over, `pnpm db:reset` **deletes all local database data** and runs the setup again.

The container is published on port 5432. To use another port, add a `docker-compose.override.yml` (gitignored, and merged by Compose automatically) and use the same port in your URLs:

```yaml
services:
  postgres:
    ports: !override
      - "54321:5432"
```

The app uses `node-postgres` for a localhost URL and Neon's HTTP driver for anything else. `db.transaction()` still isn't supported (see [Known Gotchas](#known-gotchas)), even though a local database would allow it.

### 5. Start the Development Server
```bash
pnpm dev
```
Navigate to `http://localhost:3000` in your browser. The app should now be running locally.

## Common Development Tasks

- **Linting**: Runs Oxlint (`oxlint.config.ts`) extending `@cloudflare/oxlint-config` with `tsrs` type-aware rules and `eslint-plugin-drizzle` (`jsPlugins`) to guard against unguarded `db.delete()` / `db.update()` queries. Pre-commit hooks (`husky` + `lint-staged`) also run `oxlint --deny-warnings` on staged files:
  ```bash
  pnpm lint
  ```

- **Type Checking**: To verify full type safety across the project (Oxlint does not replace `tsc`):
  ```bash
  pnpm typecheck
  ```

- **Building for Production**: To verify that the build succeeds before pushing to main:
  ```bash
  pnpm build
  ```

- **Full Quality Gate**: Run all three checks before pushing:
  ```bash
  pnpm lint && pnpm typecheck && pnpm build
  ```

- **Optimizing Team & League Logos**: When adding or updating a PNG logo in `public/team-logos/` (and registering it in `lib/team-logos.ts`), regenerate the static `64px`/`128px`/`256px` WebP variants and manifest:
  ```bash
  pnpm logos:optimize
  ```
  Commit the generated files in `public/optimized-logos/` and `lib/optimized-logos.json`. (`pnpm build` also runs this automatically.)

- **Running Tests**: `pnpm test:run` needs no database server. A test that imports `@/lib/db` gets an in-memory Postgres ([PGlite](https://pglite.dev/)) built from `lib/db/schema.ts` plus the same functions and triggers as the local setup. Every table is emptied and ID sequences restart before each test.
  - Create rows with the factories in `tests/factories/` (`setupSeason`, `setupTeam`, `setupPlayer`, `setupGame`, `setupPlayerGame`, `setupGoalieGame`). Each fills in the fields you don't pass.
  - A test with its own `vi.mock("@/lib/db")` keeps that mock. Browser (`jsdom`) tests get an empty stub.
  - Two tests need a real database with data, so they're skipped unless you ask for them. They connect to the database the app would use:
    ```bash
    DB_INTEGRATION=1 pnpm vitest run tests/drizzle-migration.test.ts      # needs season 2024-2025
    PLAYER_BENCHMARK=before pnpm vitest run tests/player-uncached-benchmark.test.ts
    ```

- **Running Banner Tests**: To verify the full banner test suite (helper math, date/timezone parsing, SWR, admin & public APIs, responsive layout assertions, draft sync lifecycle):
  ```bash
  npx vitest run tests/banners
  ```

- **Running Playoff Odds Tests**: To verify the Monte Carlo simulation engine (Rule 213 tiebreakers, probability conservation, attendance impact & Full-Strength rating, Big Games conditional accounting, clinch/elimination math) and UI/API integration:
  ```bash
  npx vitest run lib/__tests__/playoff-odds.test.ts tests/fetch-playoff-odds-attendance.test.ts tests/playoff-odds-ui.test.tsx
  ```
  *(Note: Playoff Odds computes directly from existing `games`, `seasons`, `teams`, `player_game_stats`, and `goalie_game_stats` tables—no extra DB schema migration is required. Any new route that mutates regular-season scores or schedules should call `revalidatePlayoffOdds()` from `lib/revalidate-playoff-odds.ts` to expire the `playoff-odds` cache tag immediately.)*

- **Running Scripts requiring DB access**: 
  If you write custom one-off scripts in the `scripts/` directory that need to talk to the DB, run them like this:
  ```bash
  export $(cat .env.local | grep -v '^#' | xargs) && npx tsx scripts/your-script.ts
  ```

## Testing Live Scorekeeper

The BASH Scorekeeper feature (`/scorekeeper`) allows scorekeepers to manually update game clocks, scores, and events live.
To access and test the live scorekeeper logic locally:
1. Ensure your local server is running (`pnpm dev`).
2. Obtain or generate the scorekeeper PIN (stored as `SCOREKEEPER_PIN` in your environment variables). If you are testing offline sync features, you can turn off your web connection while recording events and test the synchronization once you come back online.
3. Proceed to `http://localhost:3000/scorekeeper` and insert the PIN to manage active games. Note that PIN sign-in uses `authenticateScorekeeper` (`lib/scorekeeper-login.ts` → `/api/bash/admin/validate-pin`) to validate credentials without writing to `/state`, preventing a newly opened or stale tab from overwriting live or finalized scores on login.

## Data Sync Workflow
There are two distinct data sync mechanisms in BASH:

1. **Daily Sportability Sync (`/api/bash/sync`)**:
   - The production site automatically runs a daily Vercel cron job calling `/api/bash/sync` to scrape scores and schedules from Sportability for traditional fall seasons.
   - To trigger locally:
     ```bash
     curl -X POST http://localhost:3000/api/bash/sync
     ```

2. **Database Replication from Production (`scripts/export-prod-db.ts`)**:
   - In-house seasons (e.g., Summer 2026, 2026–2027 draft instances, live scorekeeper games) are created directly within BASH and do not exist on Sportability.
   - Use `scripts/export-prod-db.ts` to replicate these records from production into your target dev database:
     ```bash
     PROD_URL='<prod-db-url>' DEV_URL='<dev-db-url>' npx tsx scripts/export-prod-db.ts
     ```

## Testing the Admin Dashboard

The admin dashboard (`/admin`) provides season management, schedule generation, and player/team administration.

1. Ensure your local server is running (`pnpm dev`).
2. Navigate to `http://localhost:3000/admin`. Authentication uses a session cookie — you'll need valid admin credentials.
3. Key admin features to test:
   - **Schedule Tab** (`/admin/seasons/[id]` → Schedule tab): View, add, edit, and delete games. Launch the **Round-Robin Wizard** or **Playoff Bracket Wizard** to generate schedules.
   - **Round-Robin Wizard**: Generates a full season schedule using the Berger tables algorithm. Supports configurable games-per-week, skip weeks, and per-slot times/locations.
   - **Playoff Bracket Wizard**: Generates a linked bracket for 4–8 teams with standard seeding, configurable series lengths (best-of-1 or best-of-3), and auto play-in for odd team counts.
   - **Roster Import**: Upload a CSV player file (exported from Sportability, saved as `.csv`) via the Sportability Import button on the Roster tab. The two-step preview → confirm flow supports Overwrite and Append modes.
   - **Roster & Season Trades** (`/admin/seasons/[id]` → Roster tab): Roster edits are allowed for `draft` and `active` seasons (read-only once `completed`). Use **Record Trade** to configure a 2-team or $N$-team player/future-pick trade, then **Review Trade → Execute Trade**. Verify the **Season Trades** log, the **Undo** button on the most recent trade (blocked with a `409` once a traded player has played or is checked into a live game for their new team), and that past box scores on `/game/[id]` keep traded players on their game-day team.
   - **Franchise Manager** (`/admin/franchises`): Create and manage franchise identities (name, color) that persist across seasons. Franchises are linked to season teams for draft board theming.
   - **Draft Tab** (`/admin/seasons/[id]` → Draft tab): Create, configure, and manage draft instances. The 5-step wizard walks through settings, player pool (with Sportability CSV import), teams & captains, draft order & pre-draft trades, and review.
   - **Live Draft Board** (`/admin/seasons/[id]/draft/[draftId]/board`): Enter picks, manage timer, execute trades, and undo picks. This is the commissioner's control center during a live draft.
   - **Public Draft Board** (`/draft/[season]`): The read-only spectator view. Polls the server every 3 seconds for live updates. Test by opening this URL in a separate browser while making picks on the admin board.
   - **Banner Management** (`/admin/banners`): Create, edit, toggle active status, and delete announcement banners. Test the **Dual Interactive Preview** (Desktop full-width vs Mobile 375px), length guidance warnings (>35 chars on mobile), countdown configurations (deadline vs event), route suppression (`hideOnPaths`), and dismissal resets. Also test the automated draft lifecycle banner hooks: publishing a draft creates a pre-draft countdown banner, starting a draft activates a live alert banner, completing a draft creates a results banner expiring at upcoming Friday midnight PT, and archiving deactivates it.
4. Generated schedules call the API routes under `/api/bash/admin/seasons/[id]/schedule/`. The wizards run generation logic entirely client-side (`lib/schedule-utils.ts`) and only POST the final payload to the server.
5. Draft API routes live under `/api/bash/admin/seasons/[id]/draft/`. All 22 endpoints require admin authentication via `getSession()`.

## Known Gotchas

### No `db.transaction()` Support & `neon-http` Round-Trip Latency
The project uses Neon's **HTTP driver** (`drizzle-orm/neon-http`), which is stateless and **does not support transactions**. Any route that wraps writes in `db.transaction()` will throw:

```
No transactions support in neon-http driver
```

**Workarounds & Latency Best Practices**:
- **Mutations**: Use idempotent sequential `await db.*` calls. If true ACID transactions are ever needed, migrate to the `neon-serverless` WebSocket driver.
- **Reads**: Because each `neon-http` query is a separate HTTP request, avoid sequential `await` waterfalls. Run independent queries concurrently via `Promise.all()`, filter in SQL (`playerSlugSql`), or combine multi-section entity reads into a single `WITH ... AS MATERIALIZED` CTE query (`fetchPlayerQueryGroup`).
- **Deduplication**: Always wrap server-side page fetchers (`lib/fetch-*.ts`) in `React.cache()` so `generateMetadata()` and the page component do not execute duplicate DB queries during the same render.

### Navigation, Persistent Header & Bundle Size
- **Do not mount `<SiteHeader />` in pages or `loading.tsx`**: `SiteHeader` is mounted once in `app/layout.tsx` so navigating between pages preserves the header DOM and decoded logo image. Use `PageLoading` (`components/page-loading.tsx`) for route `loading.tsx` files.
- **Use `IntentLink` for detail links**: Import `IntentLink` (`components/intent-link.tsx`) instead of `next/link` when linking to `/player/[slug]`, `/team/[slug]`, or `/game/[id]` so pointer hover, focus, and touch-start prefetch the full RSC payload (`PrefetchKind.FULL`). Avoid `onClick={() => router.push(...)}` on table/list rows; use a real `<Link>` overlay instead.
- **Lazy-load header modals**: Any dialog or heavy interactive component attached to `SiteHeader` (like `PlayerSearchDialog`) must be loaded via `next/dynamic` only when opened so its dependencies don't bloat the initial JS bundle on every page.

### Roster Import Requires CSV (Not XLSX)
Sportability exports player lists as `.xlsx`. The import route uses a **built-in CSV parser** instead of the `xlsx` npm package, because `xlsx` depends on Node.js native APIs (`Buffer`, `fs`) that break under Next.js webpack bundling. Admins must convert the file to CSV before uploading.

