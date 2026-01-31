# Code Guidance

> The best code is no code. Every line we write is a line we must maintain.

This document defines how we write code in this project. It exists to eliminate debates, reduce cognitive load, and keep the codebase simple.

## Core Philosophy

**YAGNI** — You Ain't Gonna Need It. Don't build for hypothetical futures. Build for today.

**KISS** — Keep It Simple, Stupid. Complexity is the enemy. Clever is the enemy of clear.

**Delete First** — Before adding, ask: can I delete something instead?

---

## Decision Framework

When writing code, ask in order:

1. **Do I need this at all?** — Can the feature be cut? Can we solve it without code?
2. **Does this already exist?** — Check the codebase first. Check if a library handles it.
3. **What's the simplest solution?** — Not the most elegant. Not the most extensible. The simplest.
4. **Am I adding complexity for a future that may never come?** — Stop. Do less.

---

## What We Don't Do

### No Premature Abstractions
```typescript
// BAD: "I might need this later"
function createEventFetcher<T extends EventConfig>(config: T): EventFetcher<T> {
  return new GenericFetcher(config);
}

// GOOD: Just fetch the events
async function fetchEvents(weekId: string): Promise<CalendarEvent[]> {
  return apiFetch(`/api/events?week=${weekId}`);
}
```

Three similar lines of code is better than one abstraction you'll fight later.

### No Speculative Generality
Don't add parameters, options, or configuration for use cases that don't exist yet.

```typescript
// BAD: "Someone might want to customize this"
function formatDate(date: Date, options?: {
  locale?: string;
  timezone?: string;
  format?: 'short' | 'long' | 'iso';
  includeYear?: boolean;
}) { ... }

// GOOD: Format the date the one way we actually use it
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
```

### No Defensive Over-Engineering
Trust the code you control. Only validate at system boundaries.

```typescript
// BAD: Defensive programming against ourselves
function processEvent(event: CalendarEvent) {
  if (!event) throw new Error('Event is required');
  if (!event.id) throw new Error('Event must have id');
  if (!event.start) throw new Error('Event must have start');
  // ... finally do the work
}

// GOOD: TypeScript already guarantees CalendarEvent shape
function processEvent(event: CalendarEvent) {
  // Do the work. Type system handles the rest.
}
```

**Validate at boundaries:**
- User input (forms, URL params)
- External API responses
- File system reads

**Don't validate:**
- Internal function calls
- Data you just created
- Store values (already validated on entry)

### No Feature Flags for One-Time Changes
If you're changing something, change it. Don't add toggles for backwards compatibility unless there's an actual migration period with real users on the old behavior.

### No Comments That Describe What
Comments should explain **why**, not **what**. The code tells you what it does.

```typescript
// BAD
// Loop through events and filter by date
const filtered = events.filter(e => isInRange(e.start, from, to));

// GOOD
// ISO weeks start Monday, but we display Sunday-Saturday
// Use Thursday to reliably identify the week across boundaries
const thursday = new Date(date);
thursday.setDate(date.getDate() - ((date.getDay() + 6) % 7) + 3);
```

---

## SolidJS Patterns

### Signals Are Simple
Export signals directly. No wrapper hooks. No state management libraries.

```typescript
// stores/auth.ts
export const [sessionToken, setSessionToken] = createSignal<string | null>(null);
export const [isAuthenticated, setIsAuthenticated] = createSignal(false);
```

### Don't Destructure Props
Props are reactive getters in SolidJS. Destructuring breaks reactivity.

```typescript
// BAD
function DayColumn({ date, events }: Props) {
  return <div>{date.toDateString()}</div>; // Not reactive!
}

// GOOD
function DayColumn(props: Props) {
  return <div>{props.date.toDateString()}</div>;
}
```

### Use `<For>` for Lists
Never use `.map()` for rendering lists. `<For>` is optimized for SolidJS reactivity.

```typescript
// BAD
{events().map(event => <EventCard event={event} />)}

// GOOD
<For each={events()}>
  {(event) => <EventCard event={event} />}
</For>
```

### Effects: Be Explicit About Dependencies
Use `on()` to explicitly declare what triggers an effect.

```typescript
// BAD: Magic dependency tracking
createEffect(() => {
  console.log(centerDate());
  fetchEvents(centerDate());
});

// GOOD: Explicit dependencies
createEffect(
  on(centerDate, (date) => {
    fetchEvents(date);
  })
);
```

### `createMemo` for Derived State
If you compute something from signals, memoize it.

```typescript
const dayEvents = createMemo(() =>
  allEvents().filter(e => isSameDay(e.start, props.date))
);
```

---

## TypeScript Patterns

### Types Over Interfaces (for consistency)
We use `type` for everything. Interfaces are fine, but consistency matters more than the marginal differences.

```typescript
type CalendarEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
};
```

### Strict Mode is Non-Negotiable
`strict: true` in tsconfig. No exceptions. No `any`. No `@ts-ignore` without a comment explaining why.

### Let TypeScript Infer When Obvious
```typescript
// Unnecessary
const count: number = 0;
const events: CalendarEvent[] = [];

// Better
const count = 0;
const events: CalendarEvent[] = []; // Keep this one—empty array needs type
```

---

## Backend Patterns (Hono)

### Route Organization
One file per resource. Mount with `app.route()`.

```typescript
// routes/events.ts
export const eventsRoute = new Hono()
  .get('/', async (c) => { ... })
  .post('/', async (c) => { ... });

// index.ts
app.route('/api/events', eventsRoute);
```

### Validate at the Edge
Use Zod validators on route handlers. Don't validate deep in business logic.

```typescript
const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export const eventsRoute = new Hono()
  .get('/', zValidator('query', querySchema), async (c) => {
    const { from, to } = c.req.valid('query'); // Already validated
  });
```

### Errors Are Data
Return structured errors. Don't throw and catch across layers.

```typescript
// Return errors explicitly
if (!account) {
  return c.json({ error: 'Account not found' }, 404);
}

// Reserve exceptions for truly exceptional cases
try {
  await googleApi.fetchCalendars();
} catch (e) {
  // External service failure is exceptional
  return c.json({ error: 'Google API unavailable' }, 502);
}
```

---

## File Organization

### Flat Over Nested
Don't create folders until you have 5+ related files. A flat structure is easier to navigate.

```
// BAD: Premature structure
components/
  calendar/
    grid/
      CalendarGrid.tsx
      index.ts
    header/
      DateHeader.tsx
      index.ts

// GOOD: Flat until necessary
components/
  calendar/
    CalendarGrid.tsx
    DateHeader.tsx
    DayColumn.tsx
    TimeColumn.tsx
```

### Colocate Related Code
Tests next to source. Types next to implementation. Utils next to usage.

```
lib/
  date-utils.ts
  date-utils.test.ts
```

### No Barrel Files (index.ts re-exports)
They hide where things come from and make refactoring harder.

```typescript
// BAD
import { CalendarGrid, DateHeader } from '@/components/calendar';

// GOOD
import { CalendarGrid } from '@/components/calendar/CalendarGrid';
import { DateHeader } from '@/components/calendar/DateHeader';
```

---

## Naming

### Functions: Verb First
```typescript
getWeekId()
fetchEvents()
formatDate()
calculateEventLayout()
```

### Booleans: Is/Has/Should
```typescript
isAuthenticated
hasEvents
shouldRefetch
```

### Signals: Noun (value) + Set Prefix (setter)
```typescript
const [events, setEvents] = createSignal([]);
const [isLoading, setIsLoading] = createSignal(false);
```

### Constants: UPPER_SNAKE_CASE
```typescript
const HOUR_HEIGHT_PX = 48;
const MAX_LRU_WEEKS = 50;
const STALE_THRESHOLD_MS = 3 * 60 * 1000;
```

### Files: kebab-case or PascalCase for Components
```typescript
// Utilities, stores, services
date-utils.ts
events.ts
auth.ts

// Components
CalendarGrid.tsx
DateHeader.tsx
```

---

## CSS & Styling

### Tailwind for Everything
No custom CSS unless Tailwind can't do it. When Tailwind can't, use CSS variables.

### CSS Variables for Shared Values
Values used in both CSS and JS go in CSS variables.

```css
:root {
  --grid-hour-height: 48px;
  --grid-time-col-width: 64px;
}
```

```typescript
const hourHeight = parseInt(getComputedStyle(document.documentElement)
  .getPropertyValue('--grid-hour-height'));
```

### No `!important`
If you need `!important`, something is wrong with specificity. Fix the real problem.

---

## What Good Looks Like

### A Good Component
- Under 200 lines (split if larger)
- Single responsibility
- Props interface at the top
- Hooks/effects before JSX
- No business logic in JSX expressions

### A Good Store
- Exports signals directly
- Has an `init*()` function if setup is needed
- Keeps implementation details private (non-exported)
- Under 150 lines

### A Good Route Handler
- Validation at the top (Zod)
- Early returns for errors
- One happy path
- Under 50 lines (extract to service if longer)

---

## Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|-----------|
| Create abstractions for one use case | Write the specific code |
| Add config options "just in case" | Hard-code the value |
| Create utility files with one function | Keep the function where it's used |
| Write defensive checks for internal code | Trust TypeScript |
| Add comments explaining what code does | Write clearer code |
| Create interfaces for single implementations | Use the implementation directly |
| Over-organize with nested folders | Keep it flat |
| Use `any` to "fix" type errors | Fix the actual type |

---

## When to Break These Rules

These guidelines exist to make decisions easier, not to create dogma. Break them when:

1. **A library requires it** — Some patterns don't fit our style. That's fine.
2. **Performance demands it** — Measure first. Optimize with evidence.
3. **The team agrees** — Discuss, decide, document.

When you break a rule, add a comment explaining why.

```typescript
// Using any here because google-auth-library types are incomplete
// See: https://github.com/googleapis/google-auth-library-nodejs/issues/xxx
const credentials = response.credentials as any;
```

---

## Summary

1. **Write less code** — Every line is a liability
2. **Keep it simple** — Boring is good
3. **Be explicit** — Magic is the enemy of understanding
4. **Delete aggressively** — Unused code is harmful code
5. **Trust the tools** — TypeScript, Zod, and SolidJS handle a lot

The goal is a codebase where any developer can open any file and understand what's happening in under 30 seconds.
