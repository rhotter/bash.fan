# BASH Hockey

A stats website for the Bay Area Street Hockey (BASH) league. View live scores, standings, player stats, game boxscores, live scorekeeper, and real-time draft boards.

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
