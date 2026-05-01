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

## Required environment variables

See `.env.example` for the full set. Required for local dev:

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string |
| `SCOREKEEPER_PIN` | yes | Admin PIN gate |
| `AUTH_SECRET` | yes for /signin | `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | yes on Vercel | set to `true` |

Required to actually send emails or charge cards (otherwise the registration
funnel runs in stub mode):

| Var | What it unlocks |
|---|---|
| `AUTH_RESEND_KEY` + `AUTH_EMAIL_FROM` | Magic-link sign-in + confirmation emails (Resend) |
| `RESEND_API_KEY` | Same key as `AUTH_RESEND_KEY` works; kept separate for clarity |
| `STRIPE_SECRET_KEY` | Stripe Checkout sessions |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe client SDK (not used yet but reserve the slot) |
| `NEXT_PUBLIC_SITE_URL` | Stripe redirect URLs (default `http://localhost:3000`) |

### Stripe webhook setup

Once `STRIPE_SECRET_KEY` is in place, in the Stripe dashboard:

1. Developers → Webhooks → Add endpoint
2. URL: `https://bash.fan/api/register/stripe/webhook`
3. Subscribe to event: `checkout.session.completed`
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`

For local testing: `stripe listen --forward-to localhost:3000/api/register/stripe/webhook` and use the temporary signing secret it prints.

## Database Schema

The Drizzle schema (`lib/db/schema.ts`) covers the league core plus the
registration system:

- **seasons** / **teams** / **season_teams** — league structure
- **games** / **game_live** — schedule, scores, overtime/playoff flags, live game state, and bracket management (`game_type`, `bracket_round`, `series_id`, `next_game_id` for playoff auto-advancement)
- **players** / **player_seasons** / **player_season_stats** — player identities, per-season team membership, and aggregated stats
- **player_game_stats** — per-game skater stats (G, A, PTS, PPG, SHG, GWG, PIM, etc.)
- **goalie_game_stats** — per-game goalie stats (GA, SA, saves, shutouts, result)
- **game_officials** — referees and linesmen
- **player_awards** / **hall_of_fame** — awards and hall of fame entries
- **sync_metadata** — tracks last sync times
- **users** / **accounts** / **sessions** / **verification_tokens** — Auth.js / NextAuth player accounts (with optional `players.id` FK so users can claim historical stats)
- **registration_periods** + **registration_questions** — per-season registration config
- **legal_notices** + **registration_period_notices** — versioned waiver library + per-period assignment
- **registrations** + **registration_answers** + **registration_extras** + **notice_acknowledgements** — player-facing registration data
- **discount_codes** + **registration_period_discounts** — flat-dollar codes
- **extras** + **registration_period_extras** — optional add-ons (donations, jerseys)

## Project Structure

```
app/
  api/bash/          API routes (games, players, sync, admin, scorekeeper, etc.)
  admin/             Admin dashboard (seasons, players, teams, awards)
  player/[slug]/     Player detail page
  team/[slug]/       Team detail page
  game/[id]/         Game boxscore page
  standings/         League standings
  stats/             Player stats leaderboards
  scorekeeper/       Live game scorekeeper
components/
  ui/                shadcn/ui primitives
  admin/             Admin components (schedule tab, edit-game modal, round-robin & playoff wizards)
  *.tsx              Page-level components (scores-tab, standings-tab, etc.)
lib/
  db/                Database connection and Drizzle schema
  fetch-*.ts         Server-side data fetching
  hockey-data.ts     SWR hooks for client-side data
  schedule-utils.ts  Pure schedule generation (round-robin, playoff brackets)
scripts/             Database seeding and maintenance utilities
```
