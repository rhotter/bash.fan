# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Bay Area Street Hockey (BASH) league stats website. Displays scores, standings, player stats, game details, and live draft boards. Data is synced daily from Sportability (external API) into a Neon Postgres database.

## Commands

- `pnpm dev` — Start dev server
- `pnpm build` — Production build (automatically runs `pnpm logos:optimize`)
- `pnpm lint` — Run ESLint
- `pnpm logos:optimize` — Pre-generate 64/128/256px content-hashed WebP logos in `public/optimized-logos/` and update `lib/optimized-logos.json`
- `npx tsx scripts/seed.ts` — Seed database from Sportability API
- `PROD_URL='<prod-db-url>' DEV_URL='<dev-db-url>' npx tsx scripts/export-prod-db.ts` — Sync recent seasons, boxscores, and draft boards from production into dev database (or `pnpm db:export-prod --from '...' --to '...'`)

## Tech Stack

- **Framework:** Next.js 16 (App Router) with React 19
- **Database:** Neon Postgres via Drizzle ORM (`drizzle-orm/neon-http`) + `rawSql()` helper for complex queries
- **Styling:** Tailwind CSS v4 with oklch() color variables
- **UI:** shadcn/ui (Radix UI primitives) in `components/ui/`
- **Client Data:** SWR hooks with server-side fallback data
- **Icons:** lucide-react

## Style Guide

Prefer neutral theme tokens (`text-foreground`, `text-muted-foreground`, `bg-muted`, `border-border`) over brand/accent colors for ambient and informational UI; reserve `text-primary` and other strong colors for true CTAs, and avoid all-caps for titles.

## Architecture

### Data Flow

1. **Sync:** Daily cron (`vercel.json`) hits `POST /api/bash/sync` which scrapes Sportability HTML pages and upserts game/player data into Postgres
2. **Server:** Pages are async Server Components that fetch data via functions in `lib/fetch-*.ts` (which call API routes or query DB directly)
3. **Client:** Interactive components use SWR hooks from `lib/hockey-data.ts` with `fallbackData` from server-side prefetch. Hooks auto-refresh on intervals (60-120s)
4. **Draft:** Admin creates/configures drafts via wizard → transitions to live → picks entered through admin board → public board polls `/api/bash/draft/[season]` via SWR (3s interval)
5. **Banners:** Database-backed alert banner management (`/admin/banners`). Public `SiteBanner` fetches active banner via SWR (`/api/bash/banners`, 30s cache/poll) with responsive desktop/mobile label switching, automated draft lifecycle sync (`lib/draft-banner-sync.ts`), and versioned dismissal tracking.

### Database Constraints

**No transaction support.** The `drizzle-orm/neon-http` driver uses stateless HTTP requests — `db.transaction()` is **not supported** and will fail at runtime. All multi-step writes use sequential `await db.` calls. Design mutations to be idempotent so partial failures are recoverable by re-running the operation. Do not introduce `db.transaction()` or `tx.` patterns without first migrating to `drizzle-orm/neon-serverless` (WebSocket driver).

### Performance & Navigation Conventions

1. **Database Round-Trips (`neon-http`):**
   - Serverless functions are pinned to `pdx1` in `vercel.json` to colocate with Neon Postgres.
   - Because `neon-http` executes each query as an individual HTTP round-trip, **never** write sequential `await` waterfalls for independent reads. Group independent queries into a single `Promise.all(...)`.
   - When computing multiple stat sections for the same entity (e.g., player detail pages), batch them into a single SQL round-trip using `WITH ... AS MATERIALIZED` CTEs and `json_agg` via `lib/fetch-player-query-group.ts`.
   - Filter in SQL (e.g., `playerSlugSql` in `lib/player-slug-sql.ts`) rather than fetching full directory tables into Node to filter in JS.
2. **Server Caching & Client Hydration Deduplication:**
   - Wrap server-side page data fetchers (`lib/fetch-*.ts`) in React's `cache()` so `generateMetadata()` and the page Server Component share a single read per render pass.
   - Use `lib/cached-page-data.ts` (`unstable_cache`, 30s TTL) for shared public snapshots (`/stats`, `/team/[slug]`), while keeping `/player/[slug]` on uncached (`revalidate = 0`) single-round-trip CTE reads.
   - When passing server `fallbackData` to SWR hooks (`lib/hockey-data.ts`), set `revalidateOnMount: fallbackData ? false : undefined` so the client does not immediately re-fetch the same snapshot on mount.
3. **Speculative Prefetching & Persistent Layout:**
   - **Use `IntentLink` (`components/intent-link.tsx`)** instead of raw `next/link` for public detail navigation (`/player/[slug]`, `/team/[slug]`, `/game/[id]`) so pointer hover, focus, and touch-start trigger full RSC prefetching (`PrefetchKind.FULL`). Never use `<div onClick={() => router.push(...)}>` for navigable rows — use `<Link>` overlays so Next.js can prefetch and keyboard accessibility is preserved.
   - **Persistent `SiteHeader`:** `SiteHeader` is mounted once in `app/layout.tsx` to preserve the DOM node and decoded logo image across route transitions. Do **not** render `<SiteHeader />` inside individual pages or `loading.tsx` files. Use shared skeleton primitives from `components/page-loading.tsx` and `components/loading-state.tsx`.
   - **Shallow client view toggles:** When updating URL query params for state already in client memory (e.g., switching Skaters/Goalies in `StatsTab`), use `window.history.replaceState` instead of `router.replace` to avoid triggering an unnecessary Server Component round-trip.
   - **Lazy-load header modals:** Heavy interactive dialogs mounted from the persistent header (such as `PlayerSearchDialog`) must be dynamically imported via `next/dynamic` only when opened.
4. **Static Logo Optimization:**
   - Small logos ($\le 128\text{px}$ display / $256\text{px}$ 2x) are served from pre-built content-hashed WebP assets in `public/optimized-logos/` via `getOptimizedLogoUrl()` (`lib/optimized-logo.ts`) with `unoptimized` set on `<Image>` and 1-year `immutable` CDN cache headers. Run `pnpm logos:optimize` after adding or changing any logo in `public/team-logos/`.
5. **Actionable Errors & Safe Scorekeeper Login:**
   - Use `lib/api-errors.ts` (`readApiError`, `getErrorMessage`) and `components/error-notice.tsx` to surface accurate, actionable server/network errors.
   - Authenticate scorekeeper sessions via `authenticateScorekeeper` (`lib/scorekeeper-login.ts` $\rightarrow$ `/api/bash/admin/validate-pin`) without writing to `/state` on login, preventing stale tabs from overwriting live or finalized game state.

### Page Pattern

Each page follows: async Server Component (data fetch via `React.cache` / `lib/cached-page-data.ts` + `generateMetadata`) → route `loading.tsx` (`PageLoading` skeleton) → Client Component for interactivity. Public list/team pages use 30–60s caching; player pages use `revalidate = 0` backed by single-query CTE reads.

### Key Directories

- `app/api/bash/` — REST API routes with Cache-Control headers
- `app/api/bash/admin/banners/` — Admin banner management API (CRUD)
- `app/api/bash/admin/seasons/[id]/draft/` — Draft management API (22 endpoints)
- `lib/fetch-*.ts` — Server-side data fetching functions wrapped in `React.cache()`
- `lib/fetch-player-query-group.ts` — Single-round-trip `MATERIALIZED` CTE batch runner for player detail stats
- `lib/cached-page-data.ts` — Cross-request `unstable_cache` wrappers for public page snapshots
- `lib/player-slug-sql.ts` — SQL equivalent of `playerSlug()` for in-database slug filtering
- `lib/optimized-logo.ts` & `lib/optimized-logos.json` — Static WebP logo manifest and resolver
- `lib/api-errors.ts` & `lib/scorekeeper-login.ts` — Actionable API error helpers and side-effect-free scorekeeper PIN auth
- `lib/hockey-data.ts` — SWR hooks for client-side data
- `lib/db/schema.ts` — Drizzle ORM schema (40 tables)
- `lib/db/game-id.ts` — Collision-free sequential `g[n]` game ID generator backed by `games_gen_seq`
- `lib/banner-helpers.ts` — Pure helper algorithms, countdown suffixes, and banner contract validators
- `lib/draft-banner-sync.ts` — Automated banner sync engine across draft lifecycle state transitions
- `lib/draft-helpers.ts` — Snake/linear pick slot generation
- `lib/draft-trade-resolver.ts` — Chain trade resolution engine
- `lib/schedule-utils.ts` — Round-robin and playoff bracket generation, Berger tables, and simulated annealing equity optimizer (home/away, intra-day time slots)
- `components/` — Page-level components (scores-tab, standings-tab, stats-tab, etc.)
- `components/intent-link.tsx` — Link wrapper that prefetches full RSC payloads (`PrefetchKind.FULL`) on hover/focus/touch
- `components/loading-state.tsx` & `components/page-loading.tsx` — Standardized skeleton loading states and action spinners
- `components/site-banner.tsx` — Responsive public site banner with protected countdown truncation
- `components/admin/banners-client.tsx` — Admin banner management portal with dual desktop/mobile preview
- `components/admin/draft-*.tsx` — Draft wizard, board, and pool import components
- `components/admin/playoff-wizard.tsx` — Playoff bracket schedule wizard
- `components/public-draft-board.tsx` — Real-time public draft spectator view
- `app/admin/scoresheet/[gameId]/page.tsx` — Print-optimized game scoresheet (US Letter, one page)
- `scripts/` — DB seeding, logo WebP optimization (`optimize-logos.mjs`), schema migration (`deploy-banners-schema.ts`), production DB sync (`export-prod-db.ts`), and data maintenance utilities

### Standings Computation

Standings are computed from the games array (not stored): W=3pts, OTW=2pts, OTL=1pt, L=0pts. Sorted by points → goal diff → goals for. Regular season only (playoff games filtered out).

### URL Structure

- `/` — Home (scores grouped by date/week)
- `/register` — Player registration flow (temporary — will be removed)
- `/standings`, `/stats` — List pages filtered by `?season=YYYY-YYYY`
- `/player/[slug]`, `/team/[slug]`, `/game/[id]` — Detail pages
- `/draft/[season]` — Public draft board (e.g., `/draft/2026-summer`)
- `/scorekeeper/[id]` — Live game scorekeeper
- `/admin/banners` — Site banner management and dynamic countdown broadcasts
- `/admin/seasons/[id]/draft/[draftId]/board` — Admin live draft board
- `/admin/scoresheet/[gameId]` — Printable game scoresheet (rosters, scoring/penalty tables, shot grids, officials, game stars)
- `/admin/scoresheet/season/[id]` — Printable batch scoresheets for all remaining games in a season
- `/admin/registration` — Registration period management
- `/admin/franchises` — Franchise manager
- Player slugs generated by `lib/player-slug.ts` (lowercase, special chars removed)

## Environment

- `DATABASE_URL` — Neon Postgres connection string for your dev database (required), stored in `.env.local`
- `PROD_URL` — Production Neon Postgres connection string (required at runtime for `scripts/export-prod-db.ts`; NEVER save to `.env.local` or commit)
- `DEV_URL` — Destination dev database connection string for `scripts/export-prod-db.ts` (pass via env or `--to`)
- To run scripts that need DB access: `export $(cat .env.local | grep -v '^#' | xargs) && npx tsx scripts/your-script.ts`
- Deployed on Vercel
