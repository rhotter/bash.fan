# PRD: Admin Dashboard

> **Status**: Draft
> **Author**: Chris Torres
> **Created**: 2026-04-18

## 1. Problem Statement

BASH currently has no dedicated admin page. Admin functionality is scattered across:
- **Scorekeeper page** (`/scorekeeper`) — allows PIN-authenticated users to manage live game state
- **Admin Game Editor** — a modal-based editor embedded in game detail views for post-game corrections (goals, penalties, shots, attendance, goalie changes, officials, three stars, shootouts, notes)
- **CLI scripts** (`scripts/`) — data imports, duplicate merging, award seeding, sync, and other operational tasks require terminal access

There is no centralized place for commissioners to manage the league — seasons, teams, players, schedules, or review data quality — without direct database or CLI access.

## 2. Goals

- Provide commissioners with a single, PIN-authenticated admin dashboard at `/admin`
- Reduce dependency on CLI scripts and direct database access for routine operations
- Maintain the existing PIN-based auth model (`SCOREKEEPER_PIN` via `x-pin` header)
- Only some of the admin experience needs to be optimized for mobile (typically gameday specific needs)

## 3. Current Admin Infrastructure

| Component | Location | What it does |
|---|---|---|
| PIN Auth | `lib/admin-context.tsx`, `components/admin-editor/pin-dialog.tsx` | Client-side PIN state, dialog for entry |
| PIN Validation API | `app/api/bash/admin/validate-pin/route.ts` | Validates PIN against `SCOREKEEPER_PIN` env var |
| Admin Game Editor | `components/admin-editor/*.tsx` (12 files) | Full game state editing (goals, penalties, shots, attendance, etc.) |
| Scorekeeper | `app/scorekeeper/` | Live game management with clock, period tracking |
| Data Sync | `app/api/bash/sync/route.ts` | Cron-triggered scrape from Sportability |

## 4. Proposed Features

### Phase 1 — Core Admin Dashboard & Season Management (MVP)

#### 4.1 Dashboard Home (`/admin`)
- PIN gate on page load (reuse existing `PinDialog`)
- At-a-glance cards:
  - Current season name + game count
  - Last sync timestamp (from `sync_metadata`)
  - Number of upcoming / final / live games
  - Player count for current season

#### 4.2 Season Management (`/admin/seasons`)
- List all seasons with game counts
- Edit season: name, `is_current` toggle, season type (fall, summer), and a new status field (draft/active/completed)
- Create new season with a season wizard
- Create a season wizard should include:
  - Season name, type, and initializes the status as draft
- Draft seasons:
  - Should not be visible on the public site
  - Provides a player draft wizard and draft board for commissioners to configure and run the draft.
  - Should have a placeholder for a player registration wizard
  - Provides a schedule wizard — the ability for commissioners to define a schedule for the season including playoff dates

#### 4.3 Game Management (`/admin/games`)
- Filterable list of games for the current season (by date, status, team)
- Quick actions: mark as forfeit
- Link to existing Admin Game Editor for full editing
- Trigger a manual sync for a single game or all games

#### 4.4 Manual Sync Controls
- "Sync Now" button to trigger `/api/bash/sync` on demand
- Display last sync time and result
- Option to sync a specific season

---

### Phase 2 — Extended Management

#### 4.5 Awards & Hall of Fame (`/admin/awards`)
- View/edit player awards by season
- Manage Hall of Fame inductees

---

### Phase 3 — Advanced

#### 4.6 Player Management (`/admin/players`)
- Searchable player list
- Merge duplicate players (bring `scripts/merge-duplicates.ts` logic into the UI)
- Edit player details
- View player season assignments

#### 4.7 Team Management (`/admin/teams`)
- List teams, edit names/slugs
- Assign teams to seasons

#### 4.8 Action Items / Alert Panel (`/admin` dashboard)
- Auto-generated alerts surfacing issues needing commissioner attention
- Games needing scores (overdue), games without boxscores, today's games, stale sync, draft seasons
- Each alert links directly to the page or action needed to resolve it
- Green "All clear" state when nothing needs attention

#### 4.9 Data Quality Dashboard
- Flag games missing boxscores
- Flag players with stat anomalies
- Show unlinked `player_awards` (where `player_id` is null)

#### 4.10 Audit Log
- Track admin actions (who changed what, when)
- Requires evolving beyond single shared PIN

#### 4.11 Team Logo Management
- Upload and manage team logos directly in the UI instead of relying on `lib/team-logos.ts` mapping.
- Requires cloud storage implementation (e.g. S3, Vercel Blob).

## 5. Auth Model

### Current
- Single shared PIN (`SCOREKEEPER_PIN` env var)
- Validated server-side via `x-pin` header
- Client stores PIN in React context (memory only, lost on refresh)

### Proposed (Phase 1)
- Keep existing PIN model for simplicity
- Add `httpOnly` session cookie after initial PIN validation so auth persists across page navigations
- Admin routes should validate the session cookie server-side

### Future Consideration
- Role-based access (commissioner vs. captain vs. scorekeeper)
- OAuth integration (Google) for individual identity

## 6. Tech Approach

### Layout Architecture — Option B: Nested layout under `/admin`

The admin dashboard uses a nested layout under `app/admin/` with its own shell (sidebar/nav, PIN gate). This requires **zero changes to existing public pages** — the admin layout simply wraps its children with a different navigation and auth layer, while still inheriting the root `<html>` and global providers.

```
app/
  layout.tsx          ← root layout (unchanged)
  page.tsx            ← home (unchanged)
  admin/
    layout.tsx        ← wraps admin pages with PIN gate + admin sidebar
    page.tsx          ← dashboard home
    seasons/
      page.tsx
    games/
      page.tsx
```

### Stack
- **Routing**: Next.js App Router with `app/admin/layout.tsx` for shared PIN gate + admin nav
- **API**: New routes under `app/api/bash/admin/` for CRUD operations
- **Data**: Drizzle ORM queries, consistent with existing patterns
- **UI**: shadcn/ui components (Tables, Cards, Dialogs, Tabs), consistent with site design. Uses the **same light theme** as the public site with a prominent **orange admin bar** at the top to indicate commissioner mode (no separate dark theme).
- **Mobile**: Gameday-specific views optimized for mobile; management pages desktop-first

### Database Pattern — Playoff Placeholders
Instead of utilizing generic "TBD vs TBD" scheduling, provisional playoff trees should utilize explicit canonical "Seeds".
- Add an `is_placeholder` boolean column to the `teams` table.
- Maintain six explicit placeholder franchise records: `1-seed`, `2-seed`, `3-seed`, `4-seed`, `5-seed`, and `6-seed`.
- Filter out `is_placeholder = true` everywhere public tables, profiles, or admin indexes are generated.
- In Admin Season Tools, build a "Resolve Placeholders" configuration wizard at season's end that searches `games` for `home_team` or `away_team` matching a seed, providing dropdowns to explicitly swap the seed for the real finalized franchise.

## 7. Open Questions

- [x] ~~Should `/admin` be a separate Next.js layout group?~~ **Resolved: Option B** — nested layout under `app/admin/` with its own shell, no changes to existing pages.
- [x] ~~Where should the admin link live?~~ **Resolved**: Keep existing placement — subtle "Admin" link in the site footer (`components/site-footer.tsx`), links directly to `/admin` where the PIN gate handles authentication. "Scorekeeper" link also lives in the footer alongside it.
- [x] ~~Which Phase 1 features are highest priority?~~ **Resolved**: Season management is the highest priority. Phase 1 will get its own detailed PRD (`docs/prd-admin-phase1.md`) to flesh out season wizard, draft states, and registration/schedule placeholders.
- [x] ~~Should we persist the PIN session in a cookie?~~ **Resolved: Yes** — use an `httpOnly` session cookie set after initial PIN validation, so auth persists across page navigations within the admin section. This avoids commissioners re-entering the PIN on every page transition. Cookie should be scoped to `/admin` path and expire after a reasonable session duration (e.g. 4 hours).
- [x] ~~Move beyond single shared PIN before v1?~~ **Resolved: No** — single shared PIN is sufficient for v1. Role-based access and individual identity deferred to future phases.

## 8. Success Metrics

- Commissioners can manage game day operations entirely from the browser
- Zero CLI access needed for routine tasks (score corrections, forfeits, sync triggers)
- Admin page loads in under 2 seconds on mobile
