# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a calendar application built as a **pnpm monorepo** with:
- **Tauri v2** - Desktop application framework
- **SolidJS** - Reactive UI framework
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS v4** - Styling framework
- **Vite** - Build tool and dev server
- **Turborepo** - Monorepo build orchestration

The app features a macOS-style calendar with a custom title bar overlay (traffic light positioning) and collapsible sidebars that persist state to localStorage.

## Product & Design Context

### Who We're Designing For

**Primary persona: "The Craft-Conscious Professional"** — people who notice when software is good, have opinions about their tools, and pay for apps because they want to.

- Uses taste apps (Arc, Raycast, Things, Notion) — expects that level of polish
- Has tried multiple calendar apps and isn't satisfied
- Works at startups, agencies, design studios, remote-first companies, or freelances
- Has tool autonomy — can install and pay for apps without IT approval
- Cross-context: uses work tools (Outlook) but chooses personal tools deliberately

**Anti-persona: "The Locked-Down Enterprise Worker"** — IT controls everything, can't install apps, locked into Microsoft ecosystem. Not our customer. Don't design for IT admins.

### Design Philosophy

**"Craft you can feel."** Not "beautiful" (everyone claims that). Not "delightful" (overused). But:
- Animations that feel inevitable
- Spacing that doesn't fight your eyes
- Interactions that work the way you expect before you expect it
- Polish that compounds across every touchpoint

**"iPhone, not cartoon."** Sophisticated, simple, warm undertones. Elegant without being cold.

The moat is relentless craft — competitors won't put in this work because it doesn't show up in a feature comparison table.

### In-App Voice & Copy

Tone: **Minimal, warm, brief.** Deadpan and self-aware — never pushy or hyper.

| Context | Example |
|---------|---------|
| Empty state | "Nothing here. Enjoy the quiet." |
| Error state | "Something's off. Try again?" |
| Feature announcement | "You can now sync multiple calendars. We know, groundbreaking." |

**Words we use:** considered, thoughtful, crafted, simple, clean, calm
**Words we avoid:** revolutionary, disruptive, game-changing, synergy, leverage, optimize, delightful

### The Mascot: Cathrin

A cute flame character (yellow core, orange edges, expressive eyes, rosy cheeks). Warm, dry, observant personality.

**In-product rule:** Cathrin appears only in empty states, errors, and onboarding. Rare enough to be delightful, not annoying. The product is clean and quiet — Cathrin moments are punctuation, not the sentence.

### What This Product Is (and Isn't)

**Is:** A calendar app with Outlook/Google/iCloud sync, obsessive attention to detail, Mac first.
**Is not:** A productivity suite, meeting scheduler (Calendly), AI assistant, or notes app with calendar features.

### Competitive Angles

- **vs Fantastical:** Simpler, warmer, fresher (they're complex and earnest)
- **vs Notion Calendar:** We work with Outlook (they don't)
- **vs Google Calendar:** Worth paying for (they're ugly and generic)
- **vs Outlook:** Actually pleasant to use (they're bloated)

### Success Metrics

- **North star:** Daily active users who open Cathrin as their primary calendar
- **Activation ("aha moment"):** User connects a calendar and views their week — it looks right
- **Business model:** $8/mo or $72/yr. 7-day trial, full features.

### Visual Direction

The product color palette is not yet finalized — a dedicated design session will establish the definitive system. Current working style uses Notion-like neutrals (see Styling System section below). Brand marketing colors (Warm Amber #F59E0B, Soft Orange #FB923C, Cream #FEF3C7) exist as reference but are not committed to the product UI.

**Do:** Subtle warmth, smooth micro-animations, clean spacious layouts, every micro-interaction considered.
**Don't:** Literal flames, aggressive reds/oranges, Cathrin on every screen, over-the-top animations.

## Monorepo Structure

```
calendar.cathrin.ai/
├── apps/
│   ├── desktop/          # Tauri + SolidJS desktop app (@cathrin/desktop)
│   └── sync-server/      # Hono API server (@cathrin/sync-server)
├── packages/
│   └── shared-types/     # Shared TypeScript types (@cathrin/shared-types)
├── pnpm-workspace.yaml   # Workspace configuration
├── turbo.json            # Turborepo build pipeline
└── package.json          # Root workspace scripts
```

## Worktree Setup

When working in a git worktree, run these steps after creation:

```bash
rm -rf apps/desktop/src-tauri/target
```

The `target` directory contains Rust build artifacts with hardcoded absolute paths from the original worktree. Removing it forces a clean Cargo build with correct paths.

## Development Commands

### From Repository Root

```bash
# Install all dependencies
pnpm install

# Start desktop app in dev mode
pnpm tauri:dev

# Build all packages
pnpm build

# Run all tests
pnpm test:run
```

### Desktop App (apps/desktop)

```bash
# Start Vite dev server only (http://localhost:1430)
pnpm --filter @cathrin/desktop dev

# Run Tauri in development mode
pnpm --filter @cathrin/desktop tauri dev

# Build desktop app for production
pnpm --filter @cathrin/desktop tauri build

# Run tests
pnpm --filter @cathrin/desktop test:run
```

Uses Vitest with configuration in `apps/desktop/vite.config.ts`. Tests are in `*.test.ts` files alongside source.

### Sync Server (apps/sync-server)

```bash
# Start dev server with hot reload (http://localhost:3000)
pnpm --filter @cathrin/sync-server dev

# Build for production
pnpm --filter @cathrin/sync-server build

# Start production server
pnpm --filter @cathrin/sync-server start

# Database commands
pnpm --filter @cathrin/sync-server db:generate  # Generate migrations from schema
pnpm --filter @cathrin/sync-server db:migrate   # Apply migrations
pnpm --filter @cathrin/sync-server db:studio    # Open Drizzle Studio
```

## Architecture

### Sync Server

`apps/sync-server` is a Hono-based TypeScript server that will proxy calendar provider APIs.

**Structure:**
```
apps/sync-server/src/
├── index.ts          # Entry point, middleware, route mounting
├── routes/           # API route handlers
│   └── health.ts     # Health check endpoint
├── services/         # Business logic (future)
└── middlewares/      # Custom middleware (future)
```

**Endpoints:**
- `GET /health` - Health check, returns `{ status: "ok", timestamp: "...", db: "connected|disconnected" }`

**Type exports:**
The server exports `AppType` for future RPC client usage with Hono's type-safe client.

**Database:**
- Uses Drizzle ORM with postgres.js driver
- Schema defined in `src/db/schema.ts` (users, accounts, sessions tables)
- Migrations in `drizzle/` directory
- Token encryption with AES-256-GCM (utilities in `src/lib/crypto.ts`)

**Environment variables:**
- `PORT` - Server port (default: 3000)
- `DATABASE_URL` - Postgres connection string
- `ENCRYPTION_KEY` - 64-char hex string for token encryption

### Caching & Sync Architecture

The app uses a multi-tier caching strategy with stale-while-revalidate pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT                                   │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────────┐ │
│  │ HOT ZONE    │    │ LRU CACHE    │    │ SQLite Persistent   │ │
│  │ today ±30d  │    │ up to 50     │    │ (offline backup)    │ │
│  │ never evict │    │ other weeks  │    │                     │ │
│  └─────────────┘    └──────────────┘    └─────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                           │
                           ▼ HTTP
┌──────────────────────────────────────────────────────────────────┐
│                         SERVER                                    │
│  ┌─────────────────┐    ┌──────────────────────────────────────┐ │
│  │ fetched_weeks   │    │ Postgres event cache                 │ │
│  └─────────────────┘    └──────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**Timing Configuration (intentionally asymmetric):**

| Component | Interval | Purpose |
|-----------|----------|---------|
| Server sync | 5 min | Sync with Google (reduces API quota) |
| Client staleness | 3 min | Consider cached data stale |
| Client polling | 3 min | Check for stale visible weeks |

This means changes in Google Calendar propagate to UI in ~3-8 minutes.

**Key files:**
- `apps/desktop/src/stores/events.ts` - Client cache, staleness, polling
- `apps/sync-server/src/services/background-sync.ts` - Server sync with Google
- `apps/sync-server/src/services/reanchor.ts` - Extends fetched window over time

### Shared Types Package

`packages/shared-types` exports TypeScript types for API contracts between apps:
- `Provider` - Calendar provider type (`"google" | "outlook" | "caldav"`)
- `ApiCalendarEvent` - Event with ISO string dates
- `ApiCalendar` - Calendar metadata
- `ApiAccount` - Connected account info

Import with: `import { ApiCalendarEvent } from "@cathrin/shared-types"`

### Desktop App Component Structure

The app uses a three-layer layout system defined in `apps/desktop/src/components/layout/AppShell.tsx`:

1. **AppShell** - Main layout container with:
   - Draggable header region (data-tauri-drag-region)
   - Left sidebar (240px wide when open, collapsible)
   - Right sidebar (240px wide when open, collapsible)
   - Center content area
   - Sidebar state management via exported signals and toggle functions: `leftSidebarOpen`, `rightSidebarOpen`, `toggleLeftSidebar()`, `toggleRightSidebar()`
   - Sidebar state persisted to localStorage

2. **Calendar Components** (`apps/desktop/src/components/calendar/`):
   - `CalendarGrid.tsx` - Main calendar container with week view
   - `DateHeader.tsx` - Day header cells
   - `TimeColumn.tsx` - Left-side time labels
   - `DayColumn.tsx` - Individual day columns for events
   - Grid automatically scrolls to current time on mount

3. **Layout Components** (`apps/desktop/src/components/layout/`):
   - `AppShell.tsx` - Main layout structure
   - `CalendarHeader.tsx` - Top header content
   - `LeftSidebar.tsx` - Left sidebar content

### Styling System

- Uses Tailwind CSS v4 with custom CSS variables in `apps/desktop/src/App.css`:
  - `--grid-header-height`: Header height
  - `--grid-time-col-width`: Time column width
  - `--grid-hour-height`: Height per hour slot
- Color palette matches Notion-like aesthetics (#fbfbfa backgrounds, #e8e8e8 borders, #91918e muted text)

### Tauri Configuration

- Window configuration in `apps/desktop/src-tauri/tauri.conf.json`:
  - Title bar style: "Overlay" with traffic light position at (x: 20, y: 24)
  - Default size: 1200x800
  - Dev server on port 1430
  - Frontend build output: `../dist`

### State Management

- Uses SolidJS signals for reactive state
- Sidebar state is exported from AppShell and can be imported by other components
- No global state management library - relies on SolidJS primitives

## Key Implementation Patterns

### SolidJS Reactivity
- Use `createSignal()` for reactive state
- Use `createEffect()` for side effects
- Use `onMount()` for initialization logic
- Prefer `<For>` component over `.map()` for lists

### Sidebar Animation
The sidebars use width-based transitions (`w-60` to `w-0`) with `overflow-hidden` on the outer container and a fixed-width inner container. This prevents content from being "smashed" during animation - the inner content maintains its width while the outer container clips it.

### Calendar Grid Layout
The calendar grid uses percentage-based flexbox widths (`width: ${(TOTAL_DAYS / VISIBLE_DAYS) * 100}%`) rather than pixel-based calculations. This approach:
- Automatically adapts to container resize without recalculating column widths
- Avoids animation lag when sidebars toggle (no width recalculation needed)
- Uses CSS `flex-1` on day columns for equal distribution

### Scroll Synchronization
The time column uses CSS transform (`translateY`) instead of a separate scrollable container for vertical sync with the main grid. This provides pixel-perfect alignment and avoids scroll event race conditions.

### Drag-and-Drop with solid-dnd

Uses `@thisbeyond/solid-dnd` for sortable lists.

**Architecture** (`apps/desktop/src/components/sidebar/AccountsList/`):
- `AccountsList.tsx` - Main DnD orchestrator with single DragDropProvider
- `SortableAccountItem.tsx` - Draggable account header (sortable)
- `SortableCalendarItem.tsx` - Draggable calendar item (sortable)

**Two-Level Drag System with Type Filtering**:
- Both accounts and calendars use `createSortable()` with a `type` data attribute
- Accounts: `createSortable(id, { type: "account" })`
- Calendars: `createSortable(id, { type: "calendar" })`
- Custom collision detector filters droppables by type — accounts only collide with accounts, calendars only with calendars

**Sibling Structure for Variable Heights**:
Account headers and their calendars are **siblings**, not parent-child:
```tsx
<For each={accounts}>
  {(account) => (
    <>
      <SortableAccountItem />           {/* Sortable header */}
      <Show when={!isDraggingAccounts}>
        <SortableProvider ids={calendarIds}>
          <For each={calendars}>
            <SortableCalendarItem />
          </For>
        </SortableProvider>
      </Show>
    </>
  )}
</For>
```
This allows account headers to have uniform height for DnD while calendars can have variable heights.

**Critical: Layout Remeasurement**:
When dragging accounts, calendars hide via `<Show>`. This changes DOM positions, but solid-dnd has already measured. Solution: `LayoutRemeasurer` component calls `recomputeLayouts()` after calendars hide:
```tsx
function LayoutRemeasurer(props: { isDragging: () => boolean }) {
  const [, { recomputeLayouts }] = useDragDropContext()!;
  createEffect(() => {
    if (props.isDragging()) {
      queueMicrotask(() => recomputeLayouts());
    }
  });
  return null;
}
```

**Key Patterns**:
- Use `use:sortable` directive (not `ref={sortable}`) for proper lifecycle handling
- Always include a `DragOverlay` for the ghost element — it affects collision detection behavior
- Tag sortables with `{ type: "..." }` data to enable type-filtered collision detection
- Call `recomputeLayouts()` via `queueMicrotask` when DOM structure changes during drag

### TypeScript Configuration
- Strict mode enabled
- JSX preserved with `jsxImportSource: "solid-js"`
- No emitted files (Vite handles bundling)

### Progressive Event Loading

Events are fetched progressively as users scroll, using week-based caching:
- `apps/desktop/src/stores/events.ts` - Week-based fetching, cache queries, loading state
- `apps/desktop/src/lib/date-utils.ts` - Week ID calculation (`getWeekId`, `getWeekBounds`, etc.)
- `apps/desktop/src-tauri/src/storage.rs` - Backend cache with `fetched_weeks` tracking

**ISO Week vs Calendar Week Gotcha**:
The calendar displays Sunday-Saturday weeks, but uses ISO 8601 week IDs (YYYY-Wnn) which are Monday-Sunday. This causes edge cases:
- Sunday is the **last** day of an ISO week, not the first
- When navigating weeks, use mid-week dates (Wednesday) or the week's end + 2 days to avoid boundary issues
- See `getNextWeek()` implementation for the correct pattern

## Rust Backend

Minimal Rust backend in `apps/desktop/src-tauri/src/`:
- `main.rs` - Entry point
- `lib.rs` - Core Tauri setup with fullscreen event hooks
- Uses `tauri-plugin-opener` for opening URLs
- macOS-specific dependencies: `objc2` ecosystem (`objc2`, `objc2-foundation`, `objc2-app-kit`) for native integrations

## Coding Standards

### Philosophy: YAGNI & KISS
- Don't build for hypothetical futures. Build for today.
- Three similar lines of code is better than one abstraction you'll fight later.
- Before adding code, ask: can I delete something instead?

### SolidJS Rules (Critical)
```typescript
// DON'T destructure props - breaks reactivity
function Bad({ date }: Props) { return <div>{date}</div>; }

// DO access props directly
function Good(props: Props) { return <div>{props.date}</div>; }

// DON'T use .map() for lists
{events().map(e => <Event event={e} />)}

// DO use <For> component
<For each={events()}>{(e) => <Event event={e} />}</For>

// DO use on() for explicit effect dependencies
createEffect(on(centerDate, (date) => fetchEvents(date)));

// DO use createMemo for derived state
const dayEvents = createMemo(() => events().filter(e => isSameDay(e.start, props.date)));
```

### Validation Boundaries
- **Validate at:** User input, external API responses, file system reads
- **Don't validate:** Internal function calls, data you just created, store values

### File Organization
- **No barrel files** (index.ts re-exports) - import from specific files
- **Flat over nested** - don't create folders until 5+ related files
- **Colocate tests** - `date-utils.ts` next to `date-utils.test.ts`

### Backend (Hono)
- One route file per resource, mount with `app.route()`
- Validate with Zod at route level: `zValidator('query', schema)`
- Return errors explicitly, don't throw across layers

### Size Limits (extract if exceeded)
- Components: ~200 lines
- Stores: ~150 lines (extract logic to `lib/`)
- Route handlers: ~50 lines (extract to `services/`)

### Naming
- Functions: verb first (`getWeekId`, `fetchEvents`)
- Booleans: `is`/`has`/`should` prefix
- Signals: `[value, setValue]`
- Constants: `UPPER_SNAKE_CASE`
