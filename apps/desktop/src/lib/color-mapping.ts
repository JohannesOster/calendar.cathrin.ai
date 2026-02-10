/**
 * Maps raw provider colors (Google, Outlook) to Cathrin's warm, muted palette.
 *
 * Provider colors are designed for white backgrounds — they're saturated and
 * bright. On our dark warm surface they look garish. This mapping preserves
 * the user's color *intent* (blue stays blue, green stays green) while
 * adjusting the tone to harmonize with our theme.
 */

// Cathrin curated palette — OKLCH-normalized (L=0.73, C=0.11).
// Must stay in sync with App.css :root variables.
const PALETTE = {
  graphite:   "#98958e",  // oklch(0.67 0.01  80) — near-neutral warm
  coral:      "#e58c84",  // oklch(0.73 0.11  25) — red-orange
  terracotta: "#df9367",  // oklch(0.73 0.11  50) — earthy brown
  amber:      "#cca051",  // oklch(0.73 0.11  80) — golden yellow
  sage:       "#7aba7c",  // oklch(0.73 0.11 145) — soft green
  teal:       "#47beaa",  // oklch(0.73 0.11 180) — cyan-green
  sky:        "#4db6dc",  // oklch(0.73 0.11 225) — blue
  slate:      "#8babcd",  // oklch(0.73 0.06 250) — muted blue-gray
  lavender:   "#a79ce8",  // oklch(0.73 0.11 290) — purple-blue
  plum:       "#c691d3",  // oklch(0.73 0.11 320) — purple-pink
  rose:       "#de8aab",  // oklch(0.73 0.11 355) — dusty pink
} as const;

/**
 * Known provider color mappings.
 * Keys are lowercase hex. Values are Cathrin palette hex strings.
 *
 * Google Calendar named colors:
 *   https://developers.google.com/calendar/api/v3/reference/colors
 * Outlook category colors use a similar but smaller set.
 */
const PROVIDER_MAP: Record<string, string> = {
  // Google Calendar event colors
  "#d50000": PALETTE.coral,       // Tomato
  "#e67c73": PALETTE.rose,        // Flamingo
  "#f4511e": PALETTE.terracotta,  // Tangerine
  "#f6bf26": PALETTE.amber,       // Banana
  "#33b679": PALETTE.sage,        // Sage
  "#0b8043": PALETTE.sage,        // Basil
  "#039be5": PALETTE.sky,         // Peacock
  "#3f51b5": PALETTE.slate,       // Blueberry
  "#7986cb": PALETTE.lavender,    // Lavender
  "#8e24aa": PALETTE.plum,        // Grape
  "#616161": PALETTE.graphite,    // Graphite

  // Google Calendar *calendar* background colors (colorId 1-24)
  "#a4bdfc": PALETTE.lavender,    // 1  Lavender
  "#7ae7bf": PALETTE.teal,        // 2  Sage
  "#dbadff": PALETTE.plum,        // 3  Grape
  "#ff887c": PALETTE.coral,       // 4  Flamingo
  "#fbd75b": PALETTE.amber,       // 5  Banana
  "#ffb878": PALETTE.terracotta,  // 6  Tangerine
  "#46d6db": PALETTE.teal,        // 7  Peacock
  "#e1e1e1": PALETTE.graphite,    // 8  Graphite
  "#5484ed": PALETTE.sky,         // 9  Blueberry
  "#51b749": PALETTE.sage,        // 10 Basil
  "#dc2127": PALETTE.coral,       // 11 Tomato
  "#e6c800": PALETTE.amber,       // 12 (alt yellow)

  // Outlook category colors (common ones)
  "#ff0000": PALETTE.coral,       // Red
  "#ffa500": PALETTE.terracotta,  // Orange
  "#ffff00": PALETTE.amber,       // Yellow
  "#008000": PALETTE.sage,        // Green
  "#0000ff": PALETTE.sky,         // Blue
  "#800080": PALETTE.plum,        // Purple
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  // Weighted Euclidean — human eyes are more sensitive to green
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

const paletteEntries = Object.values(PALETTE).map(
  (hex) => [hex, hexToRgb(hex)] as const,
);

/**
 * Find the nearest Cathrin palette color using weighted RGB distance.
 * Used as a fallback when the exact hex isn't in PROVIDER_MAP.
 */
function nearestPaletteColor(hex: string): string {
  const rgb = hexToRgb(hex);
  let best = paletteEntries[0][0];
  let bestDist = Infinity;

  for (const [paletteHex, paletteRgb] of paletteEntries) {
    const dist = colorDistance(rgb, paletteRgb);
    if (dist < bestDist) {
      bestDist = dist;
      best = paletteHex;
    }
  }
  return best;
}

/**
 * Map a provider color to the Cathrin palette.
 *
 * 1. Exact match in the known provider map → use it
 * 2. Nearest perceptual match in the palette → use it
 * 3. Invalid input → fallback to graphite
 */
export function mapProviderColor(color: string): string {
  if (!color || !color.startsWith("#")) return PALETTE.graphite;

  const lower = color.toLowerCase();

  // Exact match
  const exact = PROVIDER_MAP[lower];
  if (exact) return exact;

  // Already a Cathrin palette color (e.g. from a draft or local override)
  const paletteValues = new Set(Object.values(PALETTE));
  if (paletteValues.has(lower as typeof PALETTE[keyof typeof PALETTE])) return lower;

  // Nearest match by perceptual distance
  return nearestPaletteColor(lower);
}
