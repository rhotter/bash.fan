# BASH Hockey

A stats website for the Bay Area Street Hockey (BASH) league. View live scores, standings, player stats, game boxscores, and live scorekeeper.

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

4. Seed data from the Sportability API:

   ```bash
   pnpm seed
   ```

5. Start the dev server:

   ```bash
   pnpm dev
   ```

## Data Sync

Game data is sourced from [Sportability](https://www.sportability.com/). A daily cron job (configured in `vercel.json`) calls `/api/bash/sync` to pull the latest schedule, scores, and boxscores into the database.

## Database Schema

The Drizzle schema (`lib/db/schema.ts`) has 15 tables:

- **seasons** / **teams** / **season_teams** — league structure
- **games** / **game_live** — schedule, scores, overtime/playoff flags, and live game state
- **players** / **player_seasons** / **player_season_stats** — player identities, per-season team membership, and aggregated stats
- **player_game_stats** — per-game skater stats (G, A, PTS, PPG, SHG, GWG, PIM, etc.)
- **goalie_game_stats** — per-game goalie stats (GA, SA, saves, shutouts, result)
- **game_officials** — referees and linesmen
- **player_awards** / **hall_of_fame** — awards and hall of fame entries
- **sync_metadata** — tracks last sync times

## Project Structure

```
app/
  api/bash/          API routes (games, players, sync, admin, scorekeeper, etc.)
  player/[slug]/     Player detail page
  team/[slug]/       Team detail page
  game/[id]/         Game boxscore page
  standings/         League standings
  stats/             Player stats leaderboards
  scorekeeper/       Live game scorekeeper
components/
  ui/                shadcn/ui primitives
  *.tsx              Page-level components (scores-tab, standings-tab, etc.)
lib/
  db/                Database connection and Drizzle schema
  fetch-*.ts         Server-side data fetching
  hockey-data.ts     SWR hooks for client-side data
  seasons.ts         Season definitions with Sportability league IDs
scripts/             Database seeding and maintenance utilities
```
