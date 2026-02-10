/**
 * Calendar layout constants
 * Centralized configuration for event rendering and overlap calculations
 */

// =============================================================================
// TIME & GRID
// =============================================================================

/** Height in pixels for one hour on the calendar grid */
export const HOUR_HEIGHT_PX = 52;

/** Total grid height: 24 hours × HOUR_HEIGHT_PX */
export const TOTAL_GRID_HEIGHT_PX = 24 * HOUR_HEIGHT_PX;

/** Milliseconds in common time units */
export const MS_PER_MINUTE = 60 * 1000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/** Snap increment for drag-to-create (minutes) */
export const SNAP_MINUTES = 15;

/** Height in pixels for one snap increment */
export const SNAP_HEIGHT_PX = HOUR_HEIGHT_PX / (60 / SNAP_MINUTES);

// =============================================================================
// EVENT CHIP DIMENSIONS
// =============================================================================

/** Left margin of event chips (px) */
export const EVENT_MARGIN_LEFT_PX = 1;

/** Right margin of event chips (px) */
export const EVENT_MARGIN_RIGHT_PX = 4;

/** Total horizontal margin (left + right) */
export const EVENT_MARGIN_TOTAL_PX = EVENT_MARGIN_LEFT_PX + EVENT_MARGIN_RIGHT_PX;

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

// =============================================================================
// AUTO-SCROLL (drag-to-create)
// =============================================================================

/** Edge detection zone in px — entering this zone triggers auto-scroll */
export const AUTO_SCROLL_EDGE_PX = 40;

/** Max scroll speed in px/frame (~720 px/s at 60 fps) */
export const AUTO_SCROLL_MAX_SPEED = 12;

// =============================================================================
// CALENDAR GRID LAYOUT
// =============================================================================

/** Number of hours in a day */
export const HOURS_PER_DAY = 24;

/** Height of the month/year label row (px) */
export const MONTH_LABEL_HEIGHT = 36;

/** Height of the day header row (px) - matches --grid-header-height */
export const HEADER_HEIGHT = 34;

/** Fallback width for the time column (px) - matches --grid-time-col-width */
export const TIME_COL_WIDTH_FALLBACK = 64;

/** Total height of the 24-hour time grid (px) */
export const TOTAL_HEIGHT = HOURS_PER_DAY * HOUR_HEIGHT_PX;

/** Collapsed/minimum height of the all-day section (px) */
export const ALL_DAY_BASE_HEIGHT = 28;

/** Large virtual width for infinite horizontal scroll (px) */
export const CONTAINER_WIDTH = 500000;

/** Anchor point in middle of virtual scroll container (px) */
export const CENTER_OFFSET = CONTAINER_WIDTH / 2;

/** Days in each direction from anchor for snap points (~3 months) */
export const SNAP_TRACK_RANGE = 90;

/** Extra days to render off-screen for smooth scrolling */
export const VISIBLE_BUFFER_DAYS = 5;

/** Hours before current time to show on initial load */
export const INITIAL_SCROLL_OFFSET_HOURS = 2;

/** Minimum scroll movement (px) to register direction change */
export const DIRECTION_THRESHOLD_PX = 10;

/** Reset scroll direction to null after this idle period (ms) */
export const DIRECTION_RESET_DELAY_MS = 2000;
