/**
 * Calendar layout constants
 * Centralized configuration for event rendering and overlap calculations
 */

// =============================================================================
// TIME & GRID
// =============================================================================

/** Height in pixels for one hour on the calendar grid */
export const HOUR_HEIGHT_PX = 48;

/** Total grid height: 24 hours × HOUR_HEIGHT_PX */
export const TOTAL_GRID_HEIGHT_PX = 24 * HOUR_HEIGHT_PX;

/** Milliseconds in common time units */
export const MS_PER_MINUTE = 60 * 1000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;

// =============================================================================
// EVENT CHIP DIMENSIONS
// =============================================================================

/** Horizontal margin on each side of event chips (px) */
export const EVENT_MARGIN_X_PX = 4;

/** Total horizontal margin (left + right) */
export const EVENT_MARGIN_TOTAL_PX = EVENT_MARGIN_X_PX * 2;

/** Gap at bottom of events to prevent touching (px) */
export const EVENT_MARGIN_BOTTOM_PX = 4;

/** Minimum event height to ensure visibility (px) */
export const MIN_EVENT_HEIGHT_PX = 24;

// =============================================================================
// OVERLAP LAYOUT
// =============================================================================

/**
 * Events starting within this threshold are considered "simultaneous"
 * and will be placed in separate columns (side-by-side).
 * Events starting further apart will cascade (stack on top).
 */
export const SAME_START_THRESHOLD_MS = 30 * MS_PER_MINUTE;

/** Indent percentage for each cascade level */
export const CASCADE_INDENT_PERCENT = 5;

// =============================================================================
// EVENT CONTENT LAYOUT
// =============================================================================

/**
 * Height thresholds for different content layouts:
 * - Below SINGLE_LINE: Title only, single line
 * - SINGLE_LINE to SHORT_TIME: Title (multi-line) + start time only
 * - Above SHORT_TIME: Title (multi-line) + full time range
 */
export const SINGLE_LINE_THRESHOLD_PX = 28;
export const SHORT_TIME_THRESHOLD_PX = 32;

/** Approximate line height for title text (text-xs leading-tight) */
export const TITLE_LINE_HEIGHT_PX = 15;

/** Approximate height of the time row */
export const TIME_ROW_HEIGHT_PX = 14;

/** Vertical padding inside event chip (top + bottom) */
export const EVENT_PADDING_Y_PX = 8;

// =============================================================================
// Z-INDEX
// =============================================================================

/** Z-index boost when an event is focused/selected */
export const FOCUSED_Z_INDEX = 100;
