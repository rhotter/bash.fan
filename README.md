# BASH Hockey

A stats website for the Bay Area Street Hockey (BASH) league. View live scores, standings, player stats, and game boxscores.

## Tech Stack

- **Next.js 16** (App Router) with React 19
- **Neon Postgres** — serverless database with raw SQL queries (no ORM)
- **Tailwind CSS v4** with shadcn/ui components
- **SWR** for client-side data caching and revalidation
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

3. Set up the database schema:

   Run the SQL in `lib/db/schema.sql` against your Neon database.

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

The Postgres schema (`lib/db/schema.sql`) has 9 tables:

- **seasons** / **teams** / **season_teams** — league structure
- **games** — schedule with scores, overtime/playoff flags, and boxscore availability
- **players** / **player_seasons** — player identities and per-season team membership
- **player_game_stats** — per-game skater stats (G, A, PTS, PPG, SHG, GWG, PIM, etc.)
- **goalie_game_stats** — per-game goalie stats (GA, SA, saves, shutouts, result)
- **game_officials** — referees and linesmen
- **sync_metadata** — tracks last sync times

## Project Structure

```
app/
  api/bash/          API routes (games, players, sync, etc.)
  player/[slug]/     Player detail page
  team/[slug]/       Team detail page
  game/[id]/         Game boxscore page
  standings/         League standings
  stats/             Player stats leaderboards
components/
  ui/                shadcn/ui primitives
  *.tsx              Page-level components (scores-tab, standings-tab, etc.)
lib/
  db/                Database connection and schema
  fetch-*.ts         Server-side data fetching (raw SQL)
  hockey-data.ts     SWR hooks for client-side data
  seasons.ts         Season definitions with Sportability league IDs
scripts/             Database seeding and maintenance utilities
```
