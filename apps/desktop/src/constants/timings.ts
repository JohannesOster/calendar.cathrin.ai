/**
 * Behavioral timing constants used across components.
 * Only includes timings that appear in multiple files or are important
 * behavioral constants. One-off CSS transition durations stay inline.
 */

/**
 * Transition duration tokens — mirrors CSS custom properties in App.css.
 * fast:   micro-interactions (event chip hover, color shift)
 * normal: standard transitions (buttons, opacity, fades)
 * slow:   layout changes (sidebar slide, expand/collapse)
 */
export const DURATION_FAST_MS = 75;
export const DURATION_NORMAL_MS = 150;
export const DURATION_SLOW_MS = 200;

/** Toast auto-dismiss delay in ms */
export const AUTO_DISMISS_MS = 5000;

/** Toast exit animation duration in ms (matches --duration-normal) */
export const EXIT_DURATION_MS = DURATION_NORMAL_MS;

/** Flash highlight animation duration in ms */
export const FLASH_DURATION_MS = 2000;
