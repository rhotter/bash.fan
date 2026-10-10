# BASH Hockey

A stats website for the Bay Area Street Hockey (BASH) league. View live scores, standings, player stats, game boxscores, live scorekeeper, and real-time draft boards.

## Tech Stack

- **Next.js 16** (App Router) with React 19
- **Neon Postgres** via **Drizzle ORM** (`drizzle-orm/neon-http`)
- **Tailwind CSS v4** with shadcn/ui components
- **SWR** for client-side data caching and revalidation
- **Vitest** for testing
- Deployed on **Vercel**

## Getting Started

### Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/)
- A [Neon](https://neon.tech/) Postgres database

### Setup

1. Clone the repo and install dependencies:

   ```bash
   pnpm install
   ```

2. Create a `.env.local` file with your database connection string:

   ```
   DATABASE_URL=postgresql://...
   ```

3. Push the Drizzle schema to your database:

   ```bash
   pnpm db:push
   ```

4. Seed or sync database data:

   - **Option A: Sync from Production DB (Recommended)**
     Pulls recent completed seasons, boxscores, and live draft boards from production:
     ```bash
     PROD_URL='<prod-db-url>' DEV_URL='<dev-db-url>' npx tsx scripts/export-prod-db.ts
     ```
     *(Or pass flags: `npx tsx scripts/export-prod-db.ts --from '<prod-url>' --to '<dev-url>'`)*

   - **Option B: Basic Seed (Sportability API)**
     Seeds historical season data from the external Sportability API:
     ```bash
     pnpm seed
     ```

5. Start the dev server:

   ```bash
   pnpm dev
   ```

## Data Sync

- **Sportability Sync**: External schedule, scores, and boxscores are pulled daily via Vercel cron hitting `/api/bash/sync`.
- **Production Database Sync**: Native BASH seasons (such as Summer 2026 and 2026–2027 draft boards) are replicated using `scripts/export-prod-db.ts` (`PROD_URL='...' DEV_URL='...' npx tsx scripts/export-prod-db.ts`).

## Database Schema

The Drizzle schema (`lib/db/schema.ts`) has 40 tables:

- **seasons** / **teams** / **season_teams** / **franchises** — league structure and franchise identities
- **games** / **game_live** — schedule, scores, overtime/playoff flags, live game state, and bracket management (`game_type`, `bracket_round`, `series_id`, `next_game_id` for playoff auto-advancement)
- **players** / **player_seasons** / **adhoc_game_rosters** / **player_season_stats** — player identities, per-season team membership (with `is_captain`, `is_rookie` flags), ad-hoc rosters, and aggregated stats
- **player_game_stats** — per-game skater stats (G, A, PTS, PPG, SHG, GWG, PIM, etc.)
- **goalie_game_stats** — per-game goalie stats (GA, SA, saves, shutouts, result)
- **game_officials** — referees and linesmen
- **player_awards** / **hall_of_fame** — awards and hall of fame entries
- **draft_instances** / **draft_team_order** / **draft_pool** / **draft_picks** / **draft_trades** / **draft_trade_items** / **draft_log** — complete draft management system
- **users** / **accounts** / **sessions** / **verification_tokens** / **registration_*** — registration periods, custom questions, discounts, legal notices, and player registrations
- **site_banners** — site announcement banners with priority scheduling, dynamic countdowns, route suppression, and draft lifecycle synchronization
- **sync_metadata** — tracks last sync times

## Project Structure

```
app/
  api/bash/          API routes (games, players, sync, banners, admin, scorekeeper, draft, etc.)
  admin/             Admin dashboard (seasons, players, teams, awards, franchises, banners, draft board)
  draft/[season]/    Public draft board (real-time spectator view)
  player/[slug]/     Player detail page
  team/[slug]/       Team detail page
  game/[id]/         Game boxscore page
  standings/         League standings
  stats/             Player stats leaderboards
  scorekeeper/       Live game scorekeeper
components/
  ui/                shadcn/ui primitives
  admin/             Admin components (schedule tab, draft wizard, draft board, franchise manager, banners portal)
  site-banner.tsx    Responsive public announcement banner with protected countdown truncation
  *.tsx              Page-level components (scores-tab, standings-tab, public-draft-board, etc.)
lib/
  db/                Database connection and Drizzle schema
  fetch-*.ts         Server-side data fetching
  hockey-data.ts     SWR hooks for client-side data
  banner-helpers.ts  Pure helper algorithms, countdown suffixes, and banner contract validators
  draft-banner-sync.ts Automated banner sync engine across draft lifecycle state transitions
  schedule-utils.ts  Pure schedule generation (round-robin, playoff brackets)
  draft-helpers.ts   Snake/linear pick slot generation
  draft-trade-resolver.ts  Chain trade resolution engine
  csv-utils.ts       Shared CSV parser for Sportability exports
scripts/             Database seeding, schema migration (deploy-banners-schema.ts), and maintenance utilities
```
