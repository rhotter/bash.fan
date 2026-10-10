# PRD: Admin Banner Management & Dynamic Site Banner

> **Status**: Completed / Shipped  
> **Author**: Chris Torres & Antigravity  
> **Created**: 2026-10-03  
> **Target Release**: Fall 2026  

---

## 1. Executive Summary

Bay Area Street Hockey (BASH) relies on a dismissible site-wide banner (`SiteBanner`) rendered above the sticky navigation header to broadcast critical league milestones — registration deadlines, draft alerts, live broadcasts, and tournament announcements.

Historically, all banner copy, URLs, close dates, and countdown calculations have been hardcoded directly in application source code (`components/site-banner.tsx`), requiring developers to open pull requests, merge, and deploy code for simple operational updates (e.g., PR #16, PR #17, PR #24, PR #25). Furthermore, PR #25 (`bb19fbb`) had to be hotfixed specifically because mobile banners clipped text, misaligned the status dot, and collided with the dismiss button.

This document specifies a complete, database-backed **Admin Banner Management System** located at `/admin/banners`. It enables commissioners to draft, preview, schedule, activate, and manage site banners dynamically without writing code. In addition, it retires automated draft SWR polling and hardcoded dates in favor of a clean, custom-controlled banner engine with:
- **Responsive Mobile/Desktop Architecture**: Optional short-form `mobileLabel` override, flex-based suffix protection (preventing countdown clipping), and 44px touch targets.
- **Dual Interactive Preview**: Commissioner preview in the admin modal with instant Desktop ↔ Mobile viewport switching.
- **Dynamic Countdowns & Auto-Expiration**: Automated day counts transitioning to "· LIVE NOW" at event time.
- **Admin Invalidation & Reset**: Per-banner `localStorage` dismissal with an admin "Reset dismissals" control.

---

## 2. Problem Statement

1. **Deployment Overhead for Routine Copy & Date Changes**: Updating registration dates (e.g. changing the banner from "Summer 2026" to "Fall 2026–27" in PR #24) required touching source code, committing, creating a GitHub branch, and executing a production deployment.
2. **Brittle Hardcoded Logic**: `REG_CLOSE_DATE = new Date("2026-09-25T23:59:59-07:00")` and the Sportability registration URL were hardcoded. Once the date passed, the banner expired with no straightforward way for a non-technical commissioner to post a followup announcement (e.g., "Registration Extended", "Tryouts This Sunday", or "Weather Delay").
3. **Desktop vs. Mobile Viewport Conflicts**:
   - A typical mobile screen (375px–390px) leaves only ~200px of text space once the indicator dot (16px), touch padding, dismiss `X` button (36px), and countdown suffix (` · 3 days left` ~ 80px) are subtracted.
   - Long desktop headlines wrap awkwardly or truncate, completely hiding critical countdown suffixes when nested inside a single `truncate` span.
   - Small touch targets on the `X` button cause accidental clicks on the banner destination link.
4. **No Commissioner Sandbox or Preview**: Commissioners could not draft announcements in advance or preview how copy would render on mobile viewports before publishing live to the league.
5. **Architectural Duplication**: `components/site-banner.tsx` maintained redundant SWR logic querying `/api/bash/draft-status` alongside static banner configurations.

---

## 3. Target Users & Personas

- **League Commissioners & Admins**:
  - Authenticated via PIN session (`admin_session` cookie).
  - Need to create, edit, test, schedule, and retire banners in under 60 seconds from any desktop or mobile browser.
  - Require confidence that active banners look visually polished across both desktop monitors and mobile phones.
- **League Players & Visitors**:
  - Desktop and mobile visitors navigating standings, scores, rosters, and draft boards.
  - Need subtle, high-clarity notices with intuitive dismissal that stays dismissed throughout their session and across repeat visits.

---

## 4. Current State & Technical Debt

### Existing Implementation (`components/site-banner.tsx`)
- **Mount Point**: Mounted in root layout (`app/layout.tsx:50`) above `{children}`, wrapping all pages under `<AdminProvider>`.
- **Configuration Shape**: Hardcoded `banners: BannerConfig[]` array evaluated in order of priority (first match wins):
  1. Priority 1: Automated draft status polled from `/api/bash/draft-status` (displays "BASH Draft is LIVE" or countdown "· Live in X days").
  2. Priority 2: Fall registration banner with hardcoded `REG_CLOSE_DATE` and hardcoded Sportability URL.
- **Dismissal Mechanism**: Client-side `localStorage` keys checked on client hydration.
- **Mobile Styling**: Fixed in PR #25 (`bb19fbb`) to align indicator dot and text to the left on mobile viewports (`pl-4 pr-8 text-left sm:justify-center sm:px-8`).
- **Known Truncation Bug**: Suffix is embedded directly inside `<span className="truncate">`, which causes countdown suffixes to disappear if the headline exceeds available width.

---

## 5. Proposed Solution & Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Admin Portal (/admin/banners)               │
│  - Table of banners (Status, Copy, Schedule, Priority)      │
│  - Create / Edit Modal with Dual Preview (Desktop ↔ Mobile) │
│  - Optional "Mobile Label" short-copy override              │
│  - "Reset Dismissals" toggle                                │
└──────────────────────────────┬──────────────────────────────┘
                               │ POST / PUT / DELETE
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Admin API (/api/bash/admin/banners)           │
│  - Enforces getSession() PIN auth                           │
│  - Sequential Drizzle ORM mutations (Neon HTTP driver)      │
└──────────────────────────────┬──────────────────────────────┘
                               │ Writes to Neon Postgres
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              Database Table: site_banners                   │
│  - label, mobile_label, href, variant, is_active            │
│  - start_date, end_date, countdown_target, countdown_type   │
│  - priority, dismiss_version, hide_on_paths                 │
└──────────────────────────────┬──────────────────────────────┘
                               │ Reads active & eligible
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Public API (/api/bash/banners)                │
│  - Returns top active banner (ordered by priority DESC)     │
│  - Cache-Control: s-maxage=30, stale-while-revalidate=60    │
└──────────────────────────────┬──────────────────────────────┘
                               │ SWR Polling (30s)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Public Component: SiteBanner                    │
│  - CSS-based responsive label (desktop label vs mobileLabel)│
│  - Protected suffix (shrink-0 tabular countdown badge)      │
│  - 44px mobile touch target for dismiss X                   │
│  - Evaluates localStorage dismissal & path suppression      │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Scope

### In Scope
1. **Database Schema (`site_banners`)**: New table in `lib/db/schema.ts` tracking headline `label`, optional `mobile_label`, URL, visual variants, status, date scheduling, countdown configurations, priority, and dismissal versions.
2. **Admin Navigation Integration**: Add "Banners" with `Megaphone` icon to `NAV_ITEMS` in `components/admin/admin-sidebar.tsx`.
3. **Admin Banner Management UI (`/admin/banners`)**:
   - Table view showing all banners (active, scheduled, draft, expired).
   - Create and Edit dialogs using shadcn/ui primitives (`Dialog`, `Input`, `Select`, `Switch`, `Button`).
   - **Dual Interactive Preview**: Toggle between Desktop (full width, centered) and Mobile (375px frame, left-aligned) within the modal.
   - **Mobile Copy Optimization**: Dedicated `mobileLabel` input with real-time character count and overflow warnings.
   - Delete confirmation with shadcn `AlertDialog`.
   - "Reset Dismissals" toggle on edit to re-show an updated banner to players who previously dismissed it.
4. **Admin REST API**:
   - `GET /api/bash/admin/banners` — List all banners.
   - `POST /api/bash/admin/banners` — Create banner.
   - `PUT /api/bash/admin/banners/[id]` — Update banner.
   - `DELETE /api/bash/admin/banners/[id]` — Delete banner.
   - Authenticated via `await getSession()` from `lib/admin-session.ts`.
5. **Public Banner API**:
   - `GET /api/bash/banners` — Returns currently active, date-eligible banners ordered by priority.
   - Cached via HTTP headers (`s-maxage=30, stale-while-revalidate=60`).
6. **Public `SiteBanner` Refactor**:
   - Consumes `/api/bash/banners` via SWR (30s interval).
   - Retires hardcoded draft SWR and hardcoded registration constants.
   - **Responsive Truncation Architecture**: Separates headline and suffix so countdowns never get clipped.
   - **Zero-UA Switching**: Pure Tailwind CSS responsive toggling between desktop and mobile labels, preserving 100% CDN edge cacheability.
   - **44×44px Touch Targets**: Mobile-optimized dismiss button to prevent mis-clicks.

### Out of Scope
- Explicit device-specific banner scheduling (e.g. "desktop-only" banners); banners apply universally with responsive copy overrides.
- Role-based multi-user permissions (relies on existing shared commissioner PIN auth).
- WYSIWYG rich-text HTML styling (banners remain concise text + optional suffix + link).
- User-targeted banners by roster, team, or player ID.
- SMS or web push notifications.

---

## 7. User Stories

### Commissioner Stories
- **US-1 (Draft Announcement)**: *As a commissioner, I want to create a draft banner ahead of time without publishing it immediately, so I can review the copy before going live.*
- **US-2 (Scheduled Launch & Expiry)**: *As a commissioner, I want to set a start date and end date on a registration banner, so it automatically turns on when registration opens and turns off at 11:59 PM PDT on the deadline.*
- **US-3 (Countdown Promotion)**: *As a commissioner, I want to configure a target event date (e.g., Draft Night), so the banner automatically computes and displays "· Live in 3 days" and transitions to "· LIVE NOW" at event time.*
- **US-4 (Critical Copy Update & Reset Dismissal)**: *As a commissioner, when a critical schedule change occurs (e.g. rainout or rink closure), I want to update the banner and check "Reset dismissals", so users who dismissed the previous banner see the new alert.*
- **US-5 (Priority Overrides)**: *As a commissioner, when multiple announcements are relevant, I want to set a numerical priority (1–100) so the most urgent notice always takes precedence.*
- **US-6 (Mobile Headline Customization)**: *As a commissioner writing a detailed desktop announcement, I want to provide an optional shorter mobile headline so mobile players get a clean, punchy banner that does not truncate awkwardly.*
- **US-7 (Dual Viewport Preview)**: *As a commissioner, I want to toggle between desktop and mobile previews inside the banner editor, so I can confirm exactly how the text, dot, and countdown look on phones before saving.*

### Player / Visitor Stories
- **US-8 (Awareness)**: *As a player, I want to see an eye-catching announcement banner at the top of the site with a link directly to registration or the live draft.*
- **US-9 (Accidental Click Prevention)**: *As a mobile player tapping with my thumb, I want a sufficiently large dismiss button area so I can close the banner without inadvertently triggering the navigation link.*
- **US-10 (Persistent Dismissal)**: *As a player, when I dismiss a banner, it remains dismissed across page navigations and future visits until updated.*

---

## 8. Detailed Functional Requirements

### 8.1 Database Schema (`lib/db/schema.ts`)

```typescript
export const siteBanners = pgTable("site_banners", {
  id: text("id").primaryKey(), // Generated via crypto.randomUUID()
  label: text("label").notNull(), // Main text: "Fall 2026–27 Registration is Now Open — Secure Your Spot!"
  mobileLabel: text("mobile_label"), // Optional short override: "Register for Fall 2026–27"
  href: text("href").notNull(), // Target URL: "/register", "/draft/fall-2026", or external URL
  variant: text("variant").notNull().default("default"), // "default" | "live" | "warning"
  isActive: boolean("is_active").notNull().default(true), // Master toggle
  startDate: timestamp("start_date", { withTimezone: true }), // Optional auto-start
  endDate: timestamp("end_date", { withTimezone: true }), // Optional auto-expire
  countdownType: text("countdown_type").notNull().default("none"), // "none" | "deadline" | "event"
  countdownTarget: timestamp("countdown_target", { withTimezone: true }), // Target timestamp for countdown
  priority: integer("priority").notNull().default(10), // Higher number = higher priority
  dismissVersion: integer("dismiss_version").notNull().default(1), // Incremented to invalidate dismissals
  hideOnPaths: text("hide_on_paths").array().notNull().default(["/admin"]), // Paths to suppress
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})
```

### 8.2 Countdown Engine & Suffix Logic

The system provides three countdown modes:
1. **`none`**: Renders standard label without automated date math.
2. **`deadline`** (e.g. Registration closes):
   - Computes days remaining until `countdownTarget`:
     $$\text{daysLeft} = \max(0, \lceil(\text{target} - \text{now}) / 86,400,000\rceil)$$
   - Formats suffix: ` · {daysLeft} day{daysLeft === 1 ? "" : "s"} left`
   - If $\text{daysLeft} \le 0$, the banner automatically treats the deadline as expired.
3. **`event`** (e.g. Draft starts):
   - If $\text{now} < \text{target}$:
     - If same calendar day: ` · Live today @ {formattedTime}`
     - If future day: ` · Live in {daysUntil} day{daysUntil === 1 ? "" : "s"}`
   - If $\text{now} \ge \text{target}$ and within active duration:
     - Automatically switches suffix to: ` · LIVE NOW` (and sets variant indicator to pulsing green dot).

### 8.3 Visual Variants
- **`default`**: Subtle neutral dot (`bg-foreground/40`), standard text styling.
- **`live`**: Animated green pulsing dot (`animate-ping bg-green-400` + `bg-green-500`) with emerald highlight text (`text-green-600 dark:text-green-400`).
- **`warning`**: Amber indicator dot (`bg-amber-500`) with amber highlight text (`text-amber-600 dark:text-amber-400`) for rainouts, rink maintenance, or urgent alerts.

### 8.4 Admin Portal Features (`/admin/banners`)
- **Status Badges**:
  - `Live` (Green): `isActive = true`, current time within `[startDate, endDate]`.
  - `Scheduled` (Blue): `isActive = true`, current time before `startDate`.
  - `Expired` (Gray): `isActive = true`, current time after `endDate`.
  - `Draft` (Muted): `isActive = false`.
- **Dual Interactive Preview**:
  - Embedded preview widget in the modal with a **Desktop ↔ Mobile switch**:
    - **Desktop Preview**: Renders full-width, centered text, 13px font.
    - **Mobile Preview**: Renders in a 375px bordered frame, left-aligned, 12px font, with accurate dismiss button clearance.
  - **Dynamic Mobile Overflow Warning**: If `label` exceeds 35 characters and `mobileLabel` is blank, an amber badge alerts the commissioner: *"Headline may truncate on small phones. Consider adding a Mobile Label."*
- **Quick Actions**:
  - One-click Active/Inactive toggle switch directly in the table row.
  - Edit button opening dialog.
  - Delete button triggering `AlertDialog`.
- **Reset Dismissal Control**: Checkbox inside Edit modal: *"Reset player dismissals (re-show banner to players who previously clicked X)"*. When checked, increments `dismissVersion` by 1.

### 8.5 Responsive Mobile & Desktop UX Specifications

#### 1. Protected Suffix Truncation Architecture
To prevent the existing bug where long headlines push the countdown suffix off-screen or into an ellipsis, the public component must separate the label and suffix into distinct flex items:
```tsx
<div className="flex min-w-0 items-center gap-1.5 truncate">
  {/* Headline truncates gracefully if needed */}
  <span className="truncate font-medium underline underline-offset-4">
    <span className={mobileLabel ? "hidden sm:inline" : ""}>{label}</span>
    {mobileLabel && <span className="inline sm:hidden">{mobileLabel}</span>}
  </span>
  {/* Suffix never truncates and preserves tabular figures */}
  {suffix && (
    <span className="shrink-0 text-muted-foreground/70 tabular-nums">
      {suffix}
    </span>
  )}
</div>
```

#### 2. Pure CSS Responsive Switching (Preserving Edge Caching)
To maintain high performance and CDN cacheability (`s-maxage=30`), the server returns both `label` and `mobileLabel` in the JSON payload. Viewport switching is executed purely in the client browser using CSS utility classes (`hidden sm:inline` and `inline sm:hidden`). **No User-Agent sniffing or server-side viewport branching is permitted.**

#### 3. Touch Target Sizing (WCAG 2.5.5 Compliance)
On mobile devices, the dismiss button must provide an accessible hit area of at least 44×44px:
```tsx
<button
  type="button"
  onClick={dismiss}
  aria-label={`Dismiss ${activeBanner.id} banner`}
  className="absolute right-0 top-0 flex h-full min-h-[44px] min-w-[44px] items-center justify-center p-2 text-muted-foreground/60 hover:text-foreground touch-manipulation sm:right-3 sm:top-1/2 sm:-translate-y-1/2 sm:h-auto sm:min-h-0 sm:min-w-0 sm:p-1"
>
  <X className="h-3.5 w-3.5" />
</button>
```

#### 4. Fixed Height & Header Stability
The banner bar must maintain a stable single-line height (`h-8` or 32px–34px) on both mobile and desktop. Multi-line wrapping is prevented via `truncate` and safe right padding (`pr-10 sm:pr-8`) to prevent layout shifts with the sticky navigation header.

### 8.6 Automated Draft Lifecycle Banner Synchronization (`lib/draft-banner-sync.ts`)

To eliminate manual commissioner operations when scheduling and executing live drafts, the system integrates automated lifecycle triggers between the draft management engine (`/api/bash/admin/seasons/[id]/draft/`) and `site_banners`:

1. **Pre-Draft Countdown on Draft Publication (`publish` / `reschedule`)**:
   - **Trigger**: When a draft is published via `POST /api/bash/admin/seasons/[id]/draft/[draftId]/publish` or rescheduled via `PATCH /api/bash/admin/seasons/[id]/draft/[draftId]`.
   - **Banner Record**: Upserts `draft-[id]-predraft` with `isActive: true`, `priority: 20`, `variant: "default"`.
   - **Copy & Formatting**: Formats copy using `formatDraftEventCopy()` (e.g. headline `"BASH Draft: Wed @ 7pm"`, mobile label `"Draft: Wed @ 7pm"`, destination `/draft/[seasonId]`).
   - **Countdown**: Configures `countdownType: "event"` targeting the draft's scheduled start time, dynamically displaying `"· Live in X days"` or `"· Live today @ 7:00 PM"`.
2. **Draft Unpublication (`unpublish`)**:
   - **Trigger**: When a published draft is unpublished back to draft state via `POST /api/bash/admin/seasons/[id]/draft/[draftId]/publish` (`action: "unpublish"`).
   - **Banner Record**: Deactivates `draft-[id]-predraft` (`isActive: false`).
3. **Live Draft Broadcast on Start (`start`)**:
   - **Trigger**: When the draft transitions to live (`POST /api/bash/admin/seasons/[id]/draft/[draftId]/start`).
   - **Banner Record**: Deactivates `draft-[id]-predraft` and upserts `draft-[id]-live` with `isActive: true`, `priority: 25`, `variant: "live"`.
   - **Copy**: Headline `"BASH Draft is LIVE — Watch the picks unfold"`, mobile label `"Draft is LIVE"`, destination `/draft/[seasonId]`, `countdownType: "none"`.
4. **Draft Results Banner on Completion (`complete`)**:
   - **Trigger**: When the final pick of the draft is submitted (`POST .../pick`) or rosters are pushed (`POST .../push-rosters`).
   - **Banner Record**: Deactivates `draft-[id]-live` and upserts `draft-[id]-results` with `isActive: true`, `priority: 15`, `variant: "default"`.
   - **Copy**: Headline `"View Draft Results — [Season] Draft Board"`, mobile label `"Draft Results"`, destination `/draft/[seasonId]`, `countdownType: "none"`.
   - **Expiration Window**: Sets `endDate` to the upcoming Friday at 11:59:59.999 PM Pacific Time (`computeNextFridayMidnightPacific()`). If completed on a Friday before midnight, expires that same night; if completed after Friday 23:59:59 PT, expires the following Friday.
5. **Revert to Live (`revert_to_live`)**:
   - **Trigger**: When an admin undos the final pick or resumes a completed draft via `POST /api/bash/admin/seasons/[id]/draft/[draftId]/revert-to-live`.
   - **Banner Record**: Restores `draft-[id]-live` (`isActive: true`), and deactivates `draft-[id]-results`.
6. **Archive / Unarchive (`archive`)**:
   - **Trigger**: When an admin archives a completed draft (`POST .../archive`).
   - **Banner Record**: Deactivates `draft-[id]-results`. When unarchived (`DELETE .../archive`), re-syncs the results banner via the `complete` event.
7. **Draft Deletion (`delete`)**:
   - **Trigger**: When a draft instance is permanently deleted (`DELETE /api/bash/admin/seasons/[id]/draft/[draftId]`).
   - **Banner Record**: Deletes all banners starting with `draft-[id]-%` from `site_banners`.
8. **Isolation & Resilience**:
   - All `syncDraftBanner()` calls are executed sequentially outside transactions (honoring Neon HTTP constraints) and wrapped in defensive error handling with error logging, ensuring secondary banner broadcast glitches never block primary draft mutations.

---

## 9. Non-Functional Requirements & Architecture Compliance

### 9.1 Database Driver Constraints (AGENTS.md)
- Neon Postgres uses `drizzle-orm/neon-http`.
- **NO `db.transaction()`**: Transactions are strictly not supported by the HTTP driver and cause fatal runtime crashes.
- All database operations in route handlers must be sequential, standalone `await db.` operations designed to be idempotent.

### 9.2 Route Handlers in Next.js 16
- Dynamic route parameters are promises and must be awaited:
  ```typescript
  export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params
    // ...
  }
  ```

### 9.3 Performance & Caching
- **Public Endpoint (`/api/bash/banners`)**:
  - `Cache-Control: public, s-maxage=30, stale-while-revalidate=60`.
  - Query selects only active eligible banners (`limit(10)`), filtering out expired deadline banners at the database level.
  - Payload size $< 650$ bytes.
- **Client Polling**:
  - `SiteBanner` uses SWR with `dedupingInterval: 30000`, `refreshInterval: 30000` (30 seconds), and `revalidateOnFocus: false`.
  - Zero Cumulative Layout Shift (CLS): Fixed banner height with smooth mount.

### 9.4 Accessibility (a11y)
- Dismiss button includes explicit `aria-label="Dismiss banner"`.
- Container uses semantic `role="region"` and `aria-label="Site announcement"`.
- Touch target hit area satisfies WCAG 2.5.5 on mobile devices (44×44px).
- Color contrast meets WCAG 2.1 AA standards in both light and dark modes.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation Strategy |
|---|---|---|
| **Mobile Truncation of Countdown** | Players see truncated copy and miss deadline days. | Flex architecture with `shrink-0` on suffix guarantees countdown numbers are always fully visible. |
| **Accidental Link Activation on Mobile** | Tapping X inadvertently opens the registration URL. | 44×44px touch target on mobile dismiss button with dedicated click propagation stop (`e.stopPropagation()`). |
| **Stale Dismissal State** | Players keep seeing a dismissed banner or miss a critical update. | Dismissal key embeds `dismissVersion` (e.g. `bash-banner-${id}-v${dismissVersion}`). Updating the version cleanly resets client dismissal. |
| **Timezone Ambiguity** | Countdown days off by 1 due to UTC vs PDT mismatch. | All dates stored as `timestamp with time zone`. Client parses using the user's local day boundary or San Francisco (America/Los_Angeles) league standard. |
| **Public API Failure** | Network blip or database outage breaks site header. | `SiteBanner` returns `null` on fetch error or loading state. The rest of the site renders completely unaffected. |

---

## 11. Implementation Plan & Milestones

1. **Phase 1 — Schema & Database Migration (Completed)**:
   - Add `siteBanners` table with `mobileLabel` to `lib/db/schema.ts`.
   - Run Drizzle migration to create table in Neon Postgres.
   - Implement idempotent zero-downtime deployment script `scripts/deploy-banners-schema.ts`.
2. **Phase 2 — Admin API Routes (Completed)**:
   - Create `app/api/bash/admin/banners/route.ts` (GET, POST).
   - Create `app/api/bash/admin/banners/[id]/route.ts` (PUT, DELETE).
   - Enforce `getSession()` authentication.
3. **Phase 3 — Admin UI (Completed)**:
   - Add "Banners" link to `NAV_ITEMS` in `components/admin/admin-sidebar.tsx`.
   - Implement `app/admin/banners/page.tsx` (Server Component).
   - Implement `components/admin/banners-client.tsx`:
     - Banner table with status indicators and fast inline toggle.
     - Create/Edit dialog with `mobileLabel` input and character count warning.
     - Dual Interactive Preview widget (Desktop ↔ Mobile toggle).
     - Reset dismissals checkbox & delete confirmation.
4. **Phase 4 — Public API & SiteBanner Refactor (Completed)**:
   - Create `app/api/bash/banners/route.ts`.
   - Refactor `components/site-banner.tsx`:
     - Consume dynamic API via SWR.
     - Implement protected suffix layout and CSS-based mobile label switching.
     - Add 44px mobile touch target for dismiss button.
     - Remove legacy draft SWR and hardcoded registration constants.
   - Verify on simulated iPhone and desktop viewports.
5. **Phase 5 — Automated Draft Lifecycle Integration & Hardening (Completed)**:
   - Implement `lib/draft-banner-sync.ts` with draft lifecycle hooks (`publish`, `unpublish`, `start`, `complete`, `revert_to_live`, `archive`, `reschedule`, `delete`).
   - Implement next-Friday midnight PT calculation (`computeNextFridayMidnightPacific`).
   - Connect draft API route endpoints (`publish/`, `start/`, `pick/`, `push-rosters/`, `revert-to-live/`, `archive/`, `[draftId]/route.ts`).
   - Comprehensive automated test suite with 229 tests across 9 test suites in `tests/banners/`.

---

## 12. Sources & Historical References

- **PR #16 / Commit `cf4f509`**: Original dismissible registration banner.
- **PR #17 / Commit `d40a1f1`**: Unified `SiteBanner` priority queue architecture.
- **Commit `c7c98ae9`**: Draft countdown logic adjustment.
- **PR #24 / Commit `529cee2`**: Hardcoded Fall 2026 registration banner update.
- **PR #25 / Commit `bb19fbb`**: Mobile left-alignment fix.
- **`docs/prd-admin-page.md` & `docs/prd-admin-phase1.md`**: Admin navigation, PIN authentication architecture, and layout conventions.
- **`docs/prd-draft.md` & `docs/prd-registration.md`**: Historical specifications for draft and registration broadcast patterns.
