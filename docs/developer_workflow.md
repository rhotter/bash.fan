# Developer Workflow Document

## Prerequisites

Before starting development on the BASH Hockey website, assure you have the following installed on your local machine:
- **Node.js** (Version 18 or higher)
- **pnpm** (Package manager, install via `npm install -g pnpm`)
- A **Neon Postgres** database instance (or any compatible PostgreSQL database).

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

### 5. Start the Development Server
```bash
pnpm dev
```
Navigate to `http://localhost:3000` in your browser. The app should now be running locally.

## Common Development Tasks

- **Linting**: To ensure code quality and prevent common errors, run:
  ```bash
  pnpm lint
  ```

- **Type Checking**: To verify full type safety across the project (catches errors not caught by lint):
  ```bash
  npx tsc --noEmit
  ```
  > **Note:** There are a small number of pre-existing type errors in legacy files. When adding new code, ensure your changes introduce zero new errors.

- **Building for Production**: To verify that the build succeeds before pushing to main:
  ```bash
  pnpm build
  ```

- **Full Quality Gate**: Run all three checks before pushing:
  ```bash
  pnpm lint && npx tsc --noEmit && pnpm build
  ```

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
3. Proceed to `http://localhost:3000/scorekeeper` and insert the PIN to manage active games.

## Data Sync Workflow
The production site automatically syncs data via a daily Vercel cron job calling `/api/bash/sync`. If you need to force a sync locally to get the absolute latest scores/games:
1. Ensure your local server is running (`pnpm dev`).
2. Send a POST request to the local sync endpoint (e.g., using `curl` or Postman):
   ```bash
   curl -X POST http://localhost:3000/api/bash/sync
   ```
*(Note: The sync process scrapes Sportability and can take a minute to complete.)*

## Testing the Admin Dashboard

The admin dashboard (`/admin`) provides season management, schedule generation, and player/team administration.

1. Ensure your local server is running (`pnpm dev`).
2. Navigate to `http://localhost:3000/admin`. Authentication uses a session cookie — you'll need valid admin credentials.
3. Key admin features to test:
   - **Schedule Tab** (`/admin/seasons/[id]` → Schedule tab): View, add, edit, and delete games. Launch the **Round-Robin Wizard** or **Playoff Bracket Wizard** to generate schedules.
   - **Round-Robin Wizard**: Generates a full season schedule using the Berger tables algorithm. Supports configurable games-per-week, skip weeks, and per-slot times/locations.
   - **Playoff Bracket Wizard**: Generates a linked bracket for 4–8 teams with standard seeding, configurable series lengths (best-of-1 or best-of-3), and auto play-in for odd team counts.
   - **Roster Import**: Upload a CSV player file (exported from Sportability, saved as `.csv`) via the Sportability Import button on the Roster tab. The two-step preview → confirm flow supports Overwrite and Append modes.
4. Generated schedules call the API routes under `/api/bash/admin/seasons/[id]/schedule/`. The wizards run generation logic entirely client-side (`lib/schedule-utils.ts`) and only POST the final payload to the server.

## Known Gotchas

### No `db.transaction()` Support
The project uses Neon's **HTTP driver** (`drizzle-orm/neon-http`), which is stateless and **does not support transactions**. Any route that wraps writes in `db.transaction()` will throw:

```
No transactions support in neon-http driver
```

**Workaround**: Use sequential `await db.*` calls instead. This is acceptable for admin operations on draft data. If true ACID transactions are ever needed, the project would need to switch to the `neon-serverless` WebSocket driver.

### Roster Import Requires CSV (Not XLSX)
Sportability exports player lists as `.xlsx`. The import route uses a **built-in CSV parser** instead of the `xlsx` npm package, because `xlsx` depends on Node.js native APIs (`Buffer`, `fs`) that break under Next.js webpack bundling. Admins must convert the file to CSV before uploading.

