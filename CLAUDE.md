# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a calendar application built with:
- **Tauri v2** - Desktop application framework
- **SolidJS** - Reactive UI framework
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS v4** - Styling framework
- **Vite** - Build tool and dev server

The app features a macOS-style calendar with a custom title bar overlay (traffic light positioning) and collapsible sidebars that persist state to localStorage.

## Development Commands

### Frontend Development
```bash
# Start Vite dev server only (http://localhost:1430)
yarn dev

# Build frontend
yarn build

# Preview production build
yarn serve
```

### Tauri Desktop App
```bash
# Run Tauri in development mode (starts Vite dev server automatically)
yarn tauri dev

# Build desktop app for production
yarn tauri build
```

## Architecture

### Component Structure

The app uses a three-layer layout system defined in `src/components/layout/AppShell.tsx`:

1. **AppShell** - Main layout container with:
   - Draggable header region (data-tauri-drag-region)
   - Left sidebar (60px wide when open, collapsible)
   - Right sidebar (60px wide when open, collapsible)
   - Center content area
   - Sidebar state management via exported signals: `leftSidebarOpen`, `setLeftSidebarOpen`, `rightSidebarOpen`, `setRightSidebarOpen`
   - Sidebar state persisted to localStorage

2. **Calendar Components** (`src/components/calendar/`):
   - `CalendarGrid.tsx` - Main calendar container with week view
   - `DateHeader.tsx` - Day header cells
   - `TimeColumn.tsx` - Left-side time labels
   - `DayColumn.tsx` - Individual day columns for events
   - Grid automatically scrolls to current time on mount

3. **Layout Components** (`src/components/layout/`):
   - `AppShell.tsx` - Main layout structure
   - `CalendarHeader.tsx` - Top header content
   - `LeftSidebar.tsx` - Left sidebar content

### Styling System

- Uses Tailwind CSS v4 with custom CSS variables in `src/App.css`:
  - `--grid-header-height`: Header height
  - `--grid-time-col-width`: Time column width
  - `--grid-hour-height`: Height per hour slot
- Color palette matches Notion-like aesthetics (#fbfbfa backgrounds, #e8e8e8 borders, #91918e muted text)

### Tauri Configuration

- Window configuration in `src-tauri/tauri.conf.json`:
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

### Sidebar Toggling
The current implementation uses width-based transitions (`w-60` to `w-0`). Per the README notes, there's a known issue that this causes content to be "smashed" during animation. Consider using `transform: translateX()` or margin-left adjustments instead of width changes.

### TypeScript Configuration
- Strict mode enabled
- JSX preserved with `jsxImportSource: "solid-js"`
- No emitted files (Vite handles bundling)

## Rust Backend

Minimal Rust backend in `src-tauri/src/`:
- `main.rs` - Entry point
- `lib.rs` - Core Tauri setup
- Uses `tauri-plugin-opener` for opening URLs
- macOS-specific dependencies: `cocoa` crate for native integrations
