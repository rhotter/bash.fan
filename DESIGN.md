---
name: BASH – Bay Area Street Hockey
colors:
  surface: "#f8f9fc"
  surface-dim: "#eef0f5"
  surface-bright: "#ffffff"
  surface-container-lowest: "#ffffff"
  surface-container-low: "#f4f5fa"
  surface-container: "#eef0f5"
  surface-container-high: "#e8eaf0"
  surface-container-highest: "#dfe1e8"
  on-surface: "#1a1c23"
  on-surface-variant: "#6b7280"
  inverse-surface: "#1a1c23"
  inverse-on-surface: "#f8f9fc"
  outline: "#d1d5db"
  outline-variant: "#e5e7eb"
  surface-tint: "#f97316"
  primary: "#f97316"
  on-primary: "#ffffff"
  primary-container: "#fff7ed"
  on-primary-container: "#9a3412"
  inverse-primary: "#fb923c"
  secondary: "#f4f5fa"
  on-secondary: "#1f2937"
  secondary-container: "#e8eaf0"
  on-secondary-container: "#374151"
  tertiary: "#3b82f6"
  on-tertiary: "#ffffff"
  tertiary-container: "#dbeafe"
  on-tertiary-container: "#1d4ed8"
  error: "#dc2626"
  on-error: "#ffffff"
  error-container: "#fef2f2"
  on-error-container: "#991b1b"
  primary-fixed: "#ffedd5"
  primary-fixed-dim: "#fdba74"
  on-primary-fixed: "#7c2d12"
  on-primary-fixed-variant: "#c2410c"
  secondary-fixed: "#f3f4f6"
  secondary-fixed-dim: "#d1d5db"
  on-secondary-fixed: "#111827"
  on-secondary-fixed-variant: "#4b5563"
  tertiary-fixed: "#dbeafe"
  tertiary-fixed-dim: "#93c5fd"
  on-tertiary-fixed: "#1e3a5f"
  on-tertiary-fixed-variant: "#2563eb"
  background: "#f8f9fc"
  on-background: "#1a1c23"
  surface-variant: "#f3f4f6"
  franchise-red: "#dc2626"
  franchise-blue: "#2563eb"
  franchise-black: "#1f2937"
  franchise-green: "#16a34a"
  franchise-orange: "#ea580c"
  franchise-purple: "#7c3aed"
  franchise-teal: "#0d9488"
  franchise-yellow: "#ca8a04"
  success: "#16a34a"
  on-success: "#ffffff"
  warning: "#eab308"
  on-warning: "#1a1c23"
  live-red: "#ef4444"
typography:
  display:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: "800"
    lineHeight: 56px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: "700"
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: "700"
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: "600"
    lineHeight: 28px
  title-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: "600"
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: "400"
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: "400"
    lineHeight: 18px
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: "600"
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: "600"
    lineHeight: 16px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: "700"
    lineHeight: 14px
    letterSpacing: 0.06em
  stat-number:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: "600"
    lineHeight: 20px
    letterSpacing: -0.01em
  stat-number-lg:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: "700"
    lineHeight: 32px
    letterSpacing: -0.02em
  scoreboard:
    fontFamily: JetBrains Mono
    fontSize: 36px
    fontWeight: "800"
    lineHeight: 40px
    letterSpacing: -0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.375rem
  md: 0.5rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  section: 64px
  gutter: 16px
  container-margin: 16px
  container-max: 1280px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    height: 40px
    padding: 0 16px
  button-primary-hover:
    backgroundColor: "#ea580c"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    height: 40px
    padding: 0 16px
  button-secondary-hover:
    backgroundColor: "{colors.secondary-container}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
  button-ghost-hover:
    backgroundColor: "{colors.surface-container}"
  button-destructive:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-error}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
  card-standard:
    backgroundColor: "{colors.surface-container-lowest}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  card-stat:
    backgroundColor: "{colors.surface-container-lowest}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
  card-score:
    backgroundColor: "{colors.surface-container-lowest}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
  input-field:
    backgroundColor: "{colors.surface-container-lowest}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: 40px
    padding: 0 12px
  table-header:
    backgroundColor: transparent
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-sm}"
  table-row:
    backgroundColor: transparent
    padding: 8px 12px
  table-row-hover:
    backgroundColor: "{colors.surface-container}"
  tab-active:
    backgroundColor: "{colors.surface-container-lowest}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
  tab-inactive:
    backgroundColor: transparent
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-sm}"
  badge-live:
    backgroundColor: "{colors.live-red}"
    textColor: "#ffffff"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 2px 10px
  badge-franchise:
    textColor: "#ffffff"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 2px 10px
  nav-link:
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
  nav-link-active:
    textColor: "{colors.on-surface}"
  week-pill-active:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.surface}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
  week-pill-inactive:
    backgroundColor: transparent
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
---

## Brand & Style

BASH (Bay Area Street Hockey) is a recreational street hockey league based in San Francisco. The design system conveys a **sports-first, data-dense** visual identity — closer to a clean stats dashboard than a flashy marketing site. The aesthetic is utilitarian and premium, prioritizing legibility of scores, standings, and player statistics over decorative elements.

The personality is **casual-professional**: friendly enough for a beer-league community where everyone knows each other by name, but polished enough that the stats pages feel like they belong next to ESPN box scores. Think "best rec league website anyone has ever seen" rather than a corporate product.

The UI is built with **shadcn/ui** primitives (Radix + Tailwind CSS v4), producing a component library of clean, accessible, and consistent elements throughout.

## Colors

The color system is **light-mode only**, using a warm neutral palette with an orange primary accent.

- **Primary (Orange #f97316):** Used for links, active states, focus rings, the league logo accent, and primary CTAs. This warm orange gives the site energy without the aggressiveness of red — it reads as "community sports" rather than "corporate product."
- **Surface:** A subtle cool-gray tint (#f8f9fc) provides the page background. Cards sit on pure white (#ffffff) to create gentle elevation without shadows.
- **Text:** Deep charcoal (#1a1c23) for headings and body, muted gray (#6b7280) for secondary labels, table headers, and metadata.
- **Borders:** Thin 1px borders in light gray (#e5e7eb / oklch 0.91) define card edges and table dividers. Borders are the primary depth mechanism — shadows are used very sparingly.
- **Franchise Colors:** Each franchise has a persistent hex color (red, blue, black, green, orange, purple, teal, yellow) used for team badges, draft board accents, and data visualization. These are never used for UI chrome — only for team-specific context.
- **Semantic Colors:** Green (#16a34a) for wins and success states, red (#dc2626 / #ef4444) for losses, destructive actions, and LIVE badges, amber (#eab308) for overtime and warning states.

## Typography

The type system uses **Inter** as the sole UI font, selected for its exceptional legibility at small sizes and its tabular-lining figures which align stat columns neatly.

- **Headings:** Inter Bold (700) or Extrabold (800) with tight negative letter-spacing (-0.01em to -0.03em) for a compact, authoritative feel.
- **Body:** Inter Regular (400) at 14px for most content. Line heights are generous (1.43x ratio) for comfortable scanning of dense stat tables.
- **Labels & Tabs:** Inter Bold (700) at 11px with wide letter-spacing (0.06em) and uppercase transform for tab labels, column headers, and metadata. This creates a clear separation between navigational elements and content.
- **Statistics:** **JetBrains Mono** (Semibold 600) for all numeric stat displays — goals, assists, points, save percentages. The monospace font ensures columns align naturally and gives numbers a "scoreboard" authority.
- **Scoreboard:** JetBrains Mono Extrabold (800) at 36px for the live scorekeeper view, evoking a physical arena scoreboard.

## Layout & Spacing

The layout is **single-column, container-constrained** on a 1280px max-width, centered with generous side margins.

- **Rhythm:** A 4px base grid governs all spacing. Common increments are 8px, 16px, 24px, and 32px.
- **Page Structure:** Each page follows a consistent hierarchy — page title (headline-lg), optional season selector inline with the title, tab bar or filter controls, then the main data display.
- **Tables:** The dominant UI pattern. Tables use full-width layouts with left-aligned text, right-aligned numbers, and compact 8px vertical padding per row. First columns (player name, team name) are sticky on mobile scroll.
- **Cards:** Used for score cards on the home page and individual stat sections. Cards use white backgrounds, 1px borders, and 0.5rem (8px) border radius.
- **Mobile:** Fully responsive. On small screens, stat tables enable horizontal scroll with sticky first columns. Tab bars compress into horizontal scroll strips. Score cards stack vertically.

## Elevation & Depth

The design system uses a **flat, border-defined** depth model. This is not a glassmorphism or shadow-heavy system.

- **Level 0 (Background):** Cool gray (#f8f9fc) page background.
- **Level 1 (Cards):** White (#ffffff) with a 1px border in light gray. No box-shadow by default.
- **Level 2 (Popovers/Dropdowns):** White with a subtle ring shadow (`ring-1 ring-border/50`) and a small box-shadow for menus and command palettes.
- **Interactions:** Hover states use background tints (surface-container: #eef0f5) rather than shadow lifts. Active/selected states use the primary orange for text color or a light orange tint background.
- **Exceptions:** Decorative badges (captain badge, awards badge) use gradient fills with ring borders and subtle shadows to feel like physical pins — these are the only places gradients appear in the system.

## Shapes

The shape language is **subtly rounded** — just enough softness to feel modern without becoming playful.

- **Cards & Containers:** 0.5rem (8px) border radius — the most common radius in the system.
- **Buttons:** 0.5rem for standard buttons. Pill-shaped (fully rounded) for week-navigation pills and status badges.
- **Inputs:** 0.375rem (6px) radius to maintain a tighter, more utilitarian look than the cards.
- **Tables:** No border radius — tables are flat, full-bleed data grids.
- **Badges:** Fully rounded (pill shape) for all badges — franchise colors, live indicators, stat categories, and week selectors.

### Cards & Score Tiles

Score cards are the hero element on the home page. Each card displays two teams, the final score, and game metadata. Cards use the standard white/border treatment with compact internal spacing. Team names are left-aligned in semibold, and scores are right-aligned in JetBrains Mono for alignment.

### Tables & Stat Grids

Tables are the workhorse of the standings and stats pages. Column headers use `label-sm` (11px uppercase bold tracking) for a clean, scannable header row. Data rows use `body-md` with `stat-number` for numeric columns. Row hover states are a subtle background tint. Clickable rows (linking to player/team detail pages) show a cursor pointer and slightly stronger hover tint.

### Tabs & Filters

Tab bars use a segmented control pattern — uppercase labels in a horizontal strip. The active tab has a filled background and dark text; inactive tabs are transparent with muted text. On the stats page, additional filter toggles (Skaters/Goalies, Regular/Playoff) use the same pattern at a smaller scale.

### Navigation

The top navigation bar is minimal — the BASH logo on the left, navigation links (Scores, Standings, Stats, About) centered, and a utility area on the right. The active page link is indicated by text color change to foreground (from muted). On mobile, navigation collapses behind a hamburger menu.

### Week Navigator

A distinctive horizontal pill strip allows users to jump between weeks on the scores page. The current week uses a filled black pill; other weeks use transparent pills with muted text. A small dot below the current-week pill reinforces the active state. On mobile, this strip is horizontally scrollable with the current week auto-scrolled into view.

### Live Elements

The live scorekeeper interface inverts the color scheme — dark background (foreground color) with light text — to create a high-contrast "arena mode" for in-game use. Score buttons are large circular touch targets. The LIVE badge uses a pulsing red dot (#ef4444) with uppercase label text.

### Admin Interface

The admin dashboard uses a **sidebar + content** layout via shadcn/ui's `Sidebar` component. The sidebar contains a logo header ("BASH Admin") and a vertical menu of top-level sections (Seasons, Registration, Awards) using Lucide icons. The active route is highlighted automatically. The content area fills the remaining width with comfortable padding.

**Authentication.** The admin login screen is a full-screen centered card (`max-w-sm`) with a branded icon badge (Shield icon on a `primary/10` background with a `primary/20` border ring), a PIN input field, and a full-width primary submit button. Error messages appear as `text-xs text-destructive` below the input. The loading state swaps the button text for a spinning `Loader2` icon.

### Admin Tabs (Season Detail)

Inside a season detail page, content is organized into horizontal tabs using a **bottom-border underline** pattern (not the segmented pill style used on public pages). Tabs include Schedule, Teams, Roster, and Settings — with Draft and Registration tabs appearing conditionally when the season status is `"draft"`.

- **Active tab:** `border-primary text-foreground` with a 2px bottom border
- **Inactive tab:** `border-transparent text-muted-foreground`, hover transitions to `text-foreground` with a `border-muted` tint
- Tabs are `text-sm font-medium` and spaced with `gap-1`

### Multi-Step Wizards

Complex admin operations (creating seasons, generating schedules, building playoff brackets) use a **multi-step wizard** pattern hosted inside a Dialog or inline Card.

**Wizard anatomy:**
1. **Progress indicator** — Two variants exist:
   - *Dot stepper* (Season Wizard): Small colored dots (`h-2 w-2 rounded-full`) connected by horizontal lines (`w-8 h-px`). Completed/active steps use `bg-primary`; future steps use `bg-muted`. Step labels appear as `text-xs` beside each dot.
   - *Progress bar* (Scheduling Wizards): A row of horizontal bar segments (`h-1 flex-1 rounded-full`) spanning the full dialog width. Completed segments fill with `bg-primary`; remaining use `bg-muted`. A `Badge variant="outline"` displays "Step N/M" in the dialog title.
2. **Step title** — `font-semibold text-base` heading below the progress indicator, describing the current step's purpose.
3. **Step content** — Form fields arranged inside a `space-y-4` container. Complex steps may use a tinted info panel (`p-4 bg-muted/30 rounded-lg`) at the top to explain the step's purpose in `text-sm text-muted-foreground`.
4. **Navigation footer** — `flex justify-between` with a Back button (`variant="outline"`, left-aligned, `ChevronLeft` icon) and a Next/Submit button (right-aligned, primary, `ChevronRight` icon). The final step replaces Next with a contextual action button (e.g., "Create Season" with `Check` icon, "Generate 60 Games" with count).

**Validation:** The Next button is disabled (`disabled={!canGoNext()}`) when required fields are incomplete. No inline field-level validation is used — the wizard validates at the step transition level.

**Loading state:** The final submit button swaps its icon to a spinning `Loader2` and its label to a gerund ("Generating...", "Creating...") while the async operation runs.

### Season Creation Wizard (3 steps)

A compact inline wizard (not in a Dialog) for creating new seasons:
1. **Basics** — Season name (auto-suggested from current date), season type (Fall/Summer radio group), optional league ID
2. **Teams** — Number of teams (numeric input, 2–32), with a checkbox "Team count hasn't been decided yet"
3. **Confirm** — Summary table with key-value pairs (`flex justify-between py-1.5 border-b`), showing name, type, team count, and a status badge in amber ("Draft")

Uses the dot stepper progress indicator and a card container for step content.

### Round Robin Scheduling Wizard (4 steps, Dialog)

Opened from the Schedule tab, this wizard generates a full regular-season schedule inside a `Dialog` (`sm:max-w-[700px] max-h-[85vh] overflow-y-auto`):

1. **Parameters & Start Date** — Grid layout (`grid-cols-2 gap-4`) for teams, games per week, schedule length mode (cycles vs. games-per-team Select), and a date picker. A summary box (`p-3 border rounded-lg text-sm bg-muted/10`) previews "60 total games across 20 weeks."
2. **Skip Weeks** — A scrollable table (`max-h-[300px] overflow-y-auto`) with sticky header, listing all calendar dates. Each row is clickable (toggling a Checkbox). Holiday conflicts are flagged in `text-orange-600` with a Tooltip explaining the holiday calculation method. Skipped rows dim to `bg-muted/50 text-muted-foreground`.
3. **Times & Locations** — A "defaults" panel (`bg-muted/30 rounded-lg border`) with per-game-slot time inputs and an "Apply to Schedule" button. Below, each week is a bordered card containing a `grid-cols-12` row per game: matchup label (3 cols), date input (3 cols), time input (2 cols), location input (4 cols). All inputs are compact (`h-8 text-xs`).
4. **Review & Save** — Summary stats in a tinted panel, a Save Mode switch (Overwrite vs. Append using `Switch`), and a full game preview table.

**Overwrite guard:** If final games exist, an `AlertDialog` warns the user before allowing destructive overwrite.

### Playoff Bracket Wizard (4 steps, Dialog)

Similar dialog structure to Round Robin, with two workflow modes selected in Step 1:

1. **Action** — RadioGroup with two bordered card options (`border p-4 rounded-lg bg-card`): "Create / Replace Bracket" or "Resolve Existing Seeds." Each option has a bold title and descriptive `text-sm text-muted-foreground` subtitle.
2. **Format & Teams** (Generate mode) — Playoff team count Select, play-in toggle (Switch), series length Selects per round (Single Game / Best of 3), and a "Are playoff teams known?" RadioGroup. Preview box shows total game count.
3. **Assign Seeds** — Either a placeholder message or a reorderable list: each seed is a row (`p-2 border rounded-lg`) with a circular Badge (`#1`, `#2`...), a team Select dropdown, and up/down arrow buttons (`variant="ghost" size="icon" h-7 w-7`). A bracket preview box shows matchups.
4. **Game Details** — Games grouped by round with section headers (`font-medium text-sm` + Badge showing game count). Each game uses the same `grid-cols-12` compact input pattern as Round Robin.

**Resolve mode** (2 steps): Shows a mapping table where each placeholder seed gets a Select dropdown for the actual team, connected by an `ArrowRight` icon. Placeholders are grouped under `text-xs uppercase tracking-wider text-muted-foreground` section labels.

### CRUD Forms (Season Settings)

Settings forms use a **stacked Card** layout with each card representing a logical group:

- **Card structure:** `Card > CardHeader > CardTitle (text-sm font-semibold)` + `CardContent > space-y-4`
- **Field pattern:** `space-y-2` containing a `Label (text-xs text-muted-foreground)` above an `Input` or `Select`
- **Grid layout:** Related fields sit side-by-side in `grid grid-cols-2 gap-4`
- **Helper text:** `text-xs text-muted-foreground` or `text-[10px]` below inputs for contextual hints
- **Tooltips:** Complex fields (e.g., "Standings Method") pair a `HelpCircle (h-3 w-3)` icon with a Tooltip explaining options
- **Checkbox fields:** A `Checkbox` + adjacent content block with a bold label and `text-xs text-muted-foreground` description (e.g., "Stats-only season")
- **Textareas:** Full-width, `rounded-md border bg-background px-3 py-2 text-sm resize-none`

**Save feedback:** A `flex items-center justify-between` footer. The left side shows either an error (`text-xs text-destructive` with `AlertTriangle` icon) or success message (`text-xs text-green-600` with `Check` icon, auto-clears after 3s). The right side has Save Changes (`size="sm" font-semibold`, primary) and optional status transition buttons.

### Status Transitions & Confirmation Dialogs

Season lifecycle transitions (Draft → Active → Completed) use guarded `AlertDialog` confirmations:

- **Activate Season:** `variant="outline"` button styled with `text-green-700 border-green-300 hover:bg-green-50`
- **Complete Season:** Placed in its own Card section with a description and a muted outline button
- **Confirmation dialog:** `AlertDialogTitle` states the action, `AlertDialogDescription` explains consequences, with Cancel and Continue buttons in the footer

### Danger Zone

Destructive operations (season deletion) are isolated in a **red-bordered Card** (`border-destructive/30`):

- Card title uses `text-sm font-semibold text-destructive`
- Content shows a description and a `variant="destructive" size="sm"` button with a `Trash2` icon
- **Type-to-confirm dialog:** A secondary AlertDialog requires the user to type the season name exactly to enable the delete button (`disabled={deleteConfirmText !== season.name}`). The dialog lists all data that will be destroyed in a `text-xs text-muted-foreground` bulleted list.

### Edit Game Modal (Dialog)

Individual game editing uses a single-screen Dialog (`sm:max-w-[600px]`), not a wizard:

- **Top row:** Date, Time, and Status fields in `grid-cols-3`
- **Middle row:** Game Type and Location in `grid-cols-2`
- **Matchup panel:** A tinted area (`bg-muted/30 p-4 rounded-lg`) with `grid-cols-5`: Away team Select + score input, "VS" center label, Home team Select + score input
- **Flags panel:** A bordered area (`bg-muted/10 p-4 rounded-lg border`) with three Switch toggles: Overtime, Shootout, and Forfeit (forfeit label uses `text-destructive`)
- **Notes section:** shadcn/ui Tabs (`TabsList w-full`) with three full-width triggers: League Notes, Away Notes, Home Notes — each containing a Textarea

**Footer:** Cancel (`variant="outline"`) and Save Game (primary) buttons. Submit label changes to "Saving..." during the async operation.

### Toast Notifications

All admin mutations surface success/error feedback via **Sonner toasts** (`toast.success()`, `toast.error()`). Toasts appear at the bottom-right of the viewport and auto-dismiss. Messages are short and action-oriented: "Generated 60 games", "Game updated", "Playoff seeds resolved successfully!"

### Placeholder Cards

Features not yet implemented (Draft, Registration) display a `PlaceholderCard` — a simple card with a title, a phase badge, and a `text-muted-foreground` description explaining what the feature will do.

### Franchise Color Application

Franchise colors are used contextually, never as primary UI elements:
- Team detail pages may show a subtle color accent in the header area
- Draft board columns use franchise colors as tinted header backgrounds
- Data visualizations and charts use franchise colors for series differentiation
- The franchise color should always maintain WCAG AA contrast when used with white text
