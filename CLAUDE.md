# Calendar App — calendar.cathrin.ai

For brand and product context see @../../.claude/refs/identity.md
For design tokens see @../../.claude/refs/tokens.md
For shared coding standards see @../../.claude/refs/standards.md

## Tech Stack

- **Tauri v2** — Desktop application framework
- **SolidJS** — Reactive UI framework
- **Ark UI** — Headless component primitives (popovers, menus, toggles, toasts)
- **TypeScript** — Type-safe JavaScript
- **Tailwind CSS v4** — Styling
- **Vite** — Build tool and dev server
- **Turborepo** — Monorepo build orchestration

macOS-style calendar with custom title bar overlay (traffic light positioning) and collapsible sidebars persisted to localStorage.

## Monorepo Structure

```
calendar.cathrin.ai/
├── apps/
│   ├── desktop/          # Tauri + SolidJS desktop app (@cathrin/desktop)
│   └── sync-server/      # Hono API server (@cathrin/sync-server)
├── packages/
│   └── shared-types/     # Shared TypeScript types (@cathrin/shared-types)
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## Worktree Setup

After creating a git worktree:
```bash
rm -rf apps/desktop/src-tauri/target
```
The `target` directory has hardcoded paths from the original worktree. Removing forces a clean Cargo build.

## Development Commands

### From Root
```bash
pnpm install              # Install all deps
pnpm tauri:dev            # Start desktop app dev mode
pnpm build                # Build all packages
pnpm test:run             # Run all tests
```

### Desktop App (apps/desktop)
```bash
pnpm --filter @cathrin/desktop dev           # Vite dev server (localhost:1430)
pnpm --filter @cathrin/desktop tauri dev     # Tauri dev mode
pnpm --filter @cathrin/desktop tauri build   # Production build
pnpm --filter @cathrin/desktop test:run      # Tests
```

Uses Vitest. Tests are `*.test.ts` alongside source.

### Sync Server (apps/sync-server)
```bash
pnpm --filter @cathrin/sync-server dev       # Dev server (localhost:3000)
pnpm --filter @cathrin/sync-server build     # Production build
pnpm --filter @cathrin/sync-server start     # Start production
pnpm --filter @cathrin/sync-server db:generate  # Generate migrations
pnpm --filter @cathrin/sync-server db:migrate   # Apply migrations
pnpm --filter @cathrin/sync-server db:studio    # Drizzle Studio
```

## Architecture

### Sync Server

Hono-based TypeScript server proxying calendar provider APIs.

```
apps/sync-server/src/
├── index.ts          # Entry point, middleware, route mounting
├── routes/           # API route handlers
├── services/         # Business logic
└── middlewares/      # Custom middleware
```

- `GET /health` — returns `{ status: "ok", timestamp, db: "connected|disconnected" }`
- Exports `AppType` for RPC client usage
- Drizzle ORM with postgres.js (schema in `src/db/schema.ts`)
- Token encryption: AES-256-GCM (`src/lib/crypto.ts`)
- Env: `PORT`, `DATABASE_URL`, `ENCRYPTION_KEY` (64-char hex), `WEBHOOK_BASE_URL` (optional, see below)

### Caching & Sync Architecture

Multi-tier with stale-while-revalidate:

```
CLIENT: HOT ZONE (today ±30d) → LRU CACHE (50 weeks) → SQLite Persistent
                    ↓ HTTP
SERVER: fetched_weeks tracker → Postgres event cache
```

| Component | Interval | Purpose |
|-----------|----------|---------|
| Server sync | 5 min | Sync with Google (API quota) |
| Client staleness | 3 min | Consider cached data stale |
| Client polling | 3 min | Check stale visible weeks |

Changes propagate in ~3-8 minutes.

**Key files:** `stores/events.ts`, `stores/event-polling.ts`, `stores/event-deletion.ts`, `services/background-sync.ts`, `services/reanchor.ts`

### Real-Time Sync (Push Notifications)

Google Calendar push notifications deliver changes in seconds instead of waiting for the polling interval. **Optional** — without it, the app falls back to polling every 2 minutes.

**How it works:** The sync server registers watch channels with Google for each calendar. Google POSTs to `{WEBHOOK_BASE_URL}/webhooks/google-calendar` when events change. The server debounces notifications (3s window), runs an incremental sync, and pushes affected week IDs to the client via WebSocket.

**Setup for local dev:**

1. Start a tunnel exposing the sync server (port 3000):
   ```bash
   ngrok http 3000        # or: cloudflared tunnel --url localhost:3000
   ```
2. Copy the HTTPS URL (e.g. `https://abc123.ngrok.io`) and set it in `.env`:
   ```
   WEBHOOK_BASE_URL=https://abc123.ngrok.io
   ```
3. Restart the sync server. Watch channels are created automatically after initial sync completes, and bootstrapped for existing accounts on startup.

Without `WEBHOOK_BASE_URL`, the watch system is disabled entirely and sync runs on the 2-minute polling interval.

**Key files:** `services/watch-manager.ts`, `services/webhook-debouncer.ts`, `routes/webhooks.ts`

### Shared Types Package

`packages/shared-types` exports: `Provider`, `ApiCalendarEvent`, `ApiCalendar`, `ApiAccount`

Import: `import { ApiCalendarEvent } from "@cathrin/shared-types"`

### Component Structure

Three-layer layout in `components/layout/AppShell.tsx`:
1. **AppShell** — draggable header, left/right sidebars (240px, collapsible), center content. Exports `leftSidebarOpen`, `rightSidebarOpen`, `toggleLeftSidebar()`, `toggleRightSidebar()`.
2. **Calendar Components** (`components/calendar/`): `CalendarGrid.tsx`, `DateHeader.tsx`, `TimeColumn.tsx`, `DayColumn.tsx`
3. **Layout Components** (`components/layout/`): `AppShell.tsx`, `CalendarHeader.tsx`, `LeftSidebar.tsx`

### Styling

Tailwind CSS v4 with CSS variables in `apps/desktop/src/App.css`:
- `--grid-header-height`, `--grid-time-col-width`, `--grid-hour-height`

### State Management

SolidJS signals. Sidebar state exported from AppShell. No global state library.

### Tauri Configuration

`src-tauri/tauri.conf.json`: Overlay title bar, traffic lights at (20, 24), 1200x800 default, port 1430, `tauri-plugin-opener`.

## Key Implementation Patterns

### SolidJS Rules (Critical)

```typescript
// DON'T destructure props - breaks reactivity
function Bad({ date }: Props) { return <div>{date}</div>; }

// DO access props directly
function Good(props: Props) { return <div>{props.date}</div>; }

// DON'T use .map() — DO use <For>
<For each={events()}>{(e) => <Event event={e} />}</For>

// DO use on() for explicit effect dependencies
createEffect(on(centerDate, (date) => fetchEvents(date)));

// DO use createMemo for derived state
const dayEvents = createMemo(() => events().filter(e => isSameDay(e.start, props.date)));
```

### Sidebar Animation

Width transitions (`w-60` to `w-0`) with `overflow-hidden` outer + fixed-width inner. Prevents content smashing during animation.

### Calendar Grid Layout

Percentage-based flexbox widths. Adapts to container resize without recalculating. CSS `flex-1` on day columns.

### Scroll Synchronization

Time column uses CSS `translateY` (not separate scrollable container) for pixel-perfect sync.

### Drag-and-Drop (solid-dnd)

`@thisbeyond/solid-dnd` for sortable lists in `components/sidebar/AccountsList/`.

Two-level type-filtered system:
- Accounts: `createSortable(id, { type: "account" })`
- Calendars: `createSortable(id, { type: "calendar" })`
- Custom collision detector filters by type

Sibling structure for variable heights. `LayoutRemeasurer` calls `recomputeLayouts()` via `queueMicrotask` when DOM changes during drag.

Key: use `use:sortable` directive (not `ref={sortable}`). Always include `DragOverlay`.

### Ark UI — Headless Primitives

`@ark-ui/solid` for interactive UI. Ark handles behavior + accessibility, we supply Tailwind styling.

**Use for:** Popovers, dropdowns, menus, tooltips, dialogs, toggles, tabs, toasts
**Don't use for:** Calendar grid, event chips, drag-to-create/move/resize, DnD sorting

Import from specific paths: `@ark-ui/solid/popover`

### Date/Time Arithmetic — Always Use UTC

Never subtract two local `Date.getTime()` values and divide by `MS_PER_DAY` — DST transitions add/remove an hour, causing `Math.floor` off-by-one errors. Use `Date.UTC(y, m, d)` for day-count arithmetic instead.

### Progressive Event Loading

Week-based caching. ISO Week vs Calendar Week gotcha: calendar shows Sun-Sat, ISO weeks are Mon-Sun. Use mid-week dates to avoid boundary issues.

## Calendar-Specific Standards

### Backend (Hono)
- One route file per resource, mount with `app.route()`
- Validate with Zod: `zValidator('query', schema)`
- Return errors explicitly, don't throw across layers
- DB operations in 2+ routes → extract to `services/`
- Prefer batch DB operations over loops

### Monorepo Config
- TypeScript target: `ES2020` across all packages
- Tauri CSP: must be enabled (never `null`)
- Shared types: only export types actually imported by consumers

## Rust Backend

Minimal: `main.rs`, `lib.rs` with fullscreen event hooks. macOS deps: `objc2` ecosystem.

## Research

Use `/nia` for library API lookup, implementation patterns, dependency docs. Don't use for local codebase questions or simple factual questions.

Key libraries to index when needed: SolidJS, Tauri v2, Hono, Drizzle, solid-dnd, Ark UI, Tailwind v4.
