/**
 * Cathrin Color System
 *
 * Maps raw provider colors (Google, Outlook, Apple) to a curated palette
 * designed for our light surface (#fcfcfc) with #212020 accent.
 *
 * Provider colors vary wildly in saturation and brightness. This mapping
 * preserves the user's color *intent* (blue stays blue, green stays green)
 * while normalizing tone for consistent visual weight on a light background.
 *
 * Approach:
 *   1. Known provider hex → hand-tuned Cathrin color (lookup table)
 *   2. Unknown hex → nearest match via OKLab perceptual distance
 *
 * Vivid, contemporary palette. All colors pass ≥4.5:1 contrast against
 * white text on solid bg. Cool-toned graphite complements the near-black accent.
 * Must stay in sync with --event-* variables in App.css.
 */

// =============================================================================
// Cathrin Palette
// =============================================================================

export const CATHRIN_PALETTE = {
  graphite:   "#64748b",  // cool slate gray
  coral:      "#c93c35",  // clear red
  terracotta: "#b85a15",  // burnt orange
  amber:      "#937115",  // deep gold
  sage:       "#258a3e",  // forest green
  teal:       "#00858e",  // ocean teal
  sky:        "#0072c3",  // clear blue
  slate:      "#4c6a9e",  // steel blue
  lavender:   "#6050cc",  // electric indigo
  plum:       "#9848b2",  // rich purple
  rose:       "#c43262",  // hot rose
} as const;

export type CathrinColorKey = keyof typeof CATHRIN_PALETTE;
export type CathrinColor = (typeof CATHRIN_PALETTE)[CathrinColorKey];

// Cathrin palette key → Google Calendar colorId ("1"-"11")
const CATHRIN_TO_GOOGLE_COLOR_ID: Record<string, string> = {
  lavender: "1", sage: "2", plum: "3", coral: "4", amber: "5",
  terracotta: "6", sky: "7", graphite: "8", slate: "9", teal: "10", rose: "11",
};

// Google colorId → Cathrin palette key
const GOOGLE_COLOR_ID_TO_CATHRIN: Record<string, CathrinColorKey> = {
  "1": "lavender", "2": "sage", "3": "plum", "4": "coral", "5": "amber",
  "6": "terracotta", "7": "sky", "8": "graphite", "9": "slate", "10": "teal", "11": "rose",
};

export function cathrinKeyToGoogleColorId(key: string): string | undefined {
  return CATHRIN_TO_GOOGLE_COLOR_ID[key];
}

export function googleColorIdToCathrinKey(colorId: string): CathrinColorKey | undefined {
  return GOOGLE_COLOR_ID_TO_CATHRIN[colorId];
}

// =============================================================================
// Provider → Cathrin Lookup Table
// =============================================================================
// Keys: lowercase hex. Values: Cathrin palette hex.
// Comprehensive coverage avoids fallback to nearest-neighbor for common colors.

const PROVIDER_MAP: Record<string, string> = {
  // ─── Google Calendar: Event Colors (Modern hex from API) ───────────
  "#d50000": CATHRIN_PALETTE.coral,       // Tomato
  "#e67c73": CATHRIN_PALETTE.coral,       // Flamingo
  "#f4511e": CATHRIN_PALETTE.terracotta,  // Tangerine
  "#f6bf26": CATHRIN_PALETTE.amber,       // Banana
  "#33b679": CATHRIN_PALETTE.sage,        // Sage
  "#0b8043": CATHRIN_PALETTE.sage,        // Basil
  "#039be5": CATHRIN_PALETTE.sky,         // Peacock
  "#3f51b5": CATHRIN_PALETTE.slate,       // Blueberry
  "#7986cb": CATHRIN_PALETTE.lavender,    // Lavender
  "#8e24aa": CATHRIN_PALETTE.plum,        // Grape
  "#616161": CATHRIN_PALETTE.graphite,    // Graphite

  // ─── Google Calendar: Event Colors (Classic hex from API) ──────────
  "#a4bdfc": CATHRIN_PALETTE.lavender,    // 1  Lavender
  "#7ae7bf": CATHRIN_PALETTE.teal,        // 2  Sage
  "#dbadff": CATHRIN_PALETTE.plum,        // 3  Grape
  "#ff887c": CATHRIN_PALETTE.coral,       // 4  Flamingo
  "#fbd75b": CATHRIN_PALETTE.amber,       // 5  Banana
  "#ffb878": CATHRIN_PALETTE.terracotta,  // 6  Tangerine
  "#46d6db": CATHRIN_PALETTE.teal,        // 7  Peacock
  "#e1e1e1": CATHRIN_PALETTE.graphite,    // 8  Graphite
  "#5484ed": CATHRIN_PALETTE.sky,         // 9  Blueberry
  "#51b749": CATHRIN_PALETTE.sage,        // 10 Basil
  "#dc2127": CATHRIN_PALETTE.coral,       // 11 Tomato

  // ─── Google Calendar: Calendar Background Colors (Classic hex) ─────
  // These are the `calendar.backgroundColor` values from the API.
  "#ac725e": CATHRIN_PALETTE.terracotta,  // 1  Cocoa
  "#d06b64": CATHRIN_PALETTE.coral,       // 2  Flamingo
  "#f83a22": CATHRIN_PALETTE.coral,       // 3  Tomato
  "#fa573c": CATHRIN_PALETTE.terracotta,  // 4  Tangerine
  "#ff7537": CATHRIN_PALETTE.terracotta,  // 5  Pumpkin
  "#ffad46": CATHRIN_PALETTE.amber,       // 6  Mango
  "#42d692": CATHRIN_PALETTE.teal,        // 7  Eucalyptus
  "#16a765": CATHRIN_PALETTE.sage,        // 8  Basil
  "#7bd148": CATHRIN_PALETTE.sage,        // 9  Pistachio
  "#b3dc6c": CATHRIN_PALETTE.sage,        // 10 Avocado
  "#fbe983": CATHRIN_PALETTE.amber,       // 11 Citron
  "#fad165": CATHRIN_PALETTE.amber,       // 12 Banana
  "#92e1c0": CATHRIN_PALETTE.teal,        // 13 Sage
  "#9fe1e7": CATHRIN_PALETTE.teal,        // 14 Peacock
  "#9fc6e7": CATHRIN_PALETTE.sky,         // 15 Cobalt
  "#4986e7": CATHRIN_PALETTE.sky,         // 16 Blueberry
  "#9a9cff": CATHRIN_PALETTE.lavender,    // 17 Lavender
  "#b99aff": CATHRIN_PALETTE.lavender,    // 18 Wisteria
  "#c2c2c2": CATHRIN_PALETTE.graphite,    // 19 Graphite
  "#cabdbf": CATHRIN_PALETTE.graphite,    // 20 Birch
  "#cca6ac": CATHRIN_PALETTE.rose,        // 21 Radicchio
  "#f691b2": CATHRIN_PALETTE.rose,        // 22 Cherry Blossom
  "#cd74e6": CATHRIN_PALETTE.plum,        // 23 Grape
  "#a47ae2": CATHRIN_PALETTE.lavender,    // 24 Amethyst

  // ─── Google Calendar: Calendar Colors (Modern hex) ─────────────────
  "#795548": CATHRIN_PALETTE.terracotta,  // 1  Cocoa
  // 2  Flamingo (#e67c73) — already mapped above
  // 3  Tomato (#d50000) — already mapped above
  // 4  Tangerine (#f4511e) — already mapped above
  "#ef6c00": CATHRIN_PALETTE.terracotta,  // 5  Pumpkin
  "#f09300": CATHRIN_PALETTE.amber,       // 6  Mango
  "#009688": CATHRIN_PALETTE.teal,        // 7  Eucalyptus
  // 8  Basil (#0b8043) — already mapped above
  "#7cb342": CATHRIN_PALETTE.sage,        // 9  Pistachio
  "#c0ca33": CATHRIN_PALETTE.amber,       // 10 Avocado
  "#e4c441": CATHRIN_PALETTE.amber,       // 11 Citron
  // 12 Banana (#f6bf26) — already mapped above
  // 13 Sage (#33b679) — already mapped above
  // 14 Peacock (#039be5) — already mapped above
  "#4285f4": CATHRIN_PALETTE.sky,         // 15 Cobalt (also default Google blue)
  // 16 Blueberry (#3f51b5) — already mapped above
  // 17 Lavender (#7986cb) — already mapped above
  "#b39ddb": CATHRIN_PALETTE.lavender,    // 18 Wisteria
  // 19 Graphite (#616161) — already mapped above
  "#a79b8e": CATHRIN_PALETTE.graphite,    // 20 Birch
  "#ad1457": CATHRIN_PALETTE.rose,        // 21 Radicchio
  "#d81b60": CATHRIN_PALETTE.rose,        // 22 Cherry Blossom
  // 23 Grape (#8e24aa) — already mapped above
  "#9e69af": CATHRIN_PALETTE.plum,        // 24 Amethyst

  // ─── Microsoft Outlook 365: Category Presets ───────────────────────
  "#dc626d": CATHRIN_PALETTE.coral,       // preset0  Red
  "#e8825d": CATHRIN_PALETTE.terracotta,  // preset1  Orange
  "#ffcd8f": CATHRIN_PALETTE.amber,       // preset2  Peach
  "#fdee65": CATHRIN_PALETTE.amber,       // preset3  Yellow
  "#52ce90": CATHRIN_PALETTE.sage,        // preset4  Light Green
  "#57d2da": CATHRIN_PALETTE.teal,        // preset5  Light Teal
  "#b6d767": CATHRIN_PALETTE.sage,        // preset6  Lime Green
  "#5ca9e5": CATHRIN_PALETTE.sky,         // preset7  Blue
  "#b1aaeb": CATHRIN_PALETTE.lavender,    // preset8  Lavender
  "#ee5fb7": CATHRIN_PALETTE.rose,        // preset9  Magenta
  "#c5ced1": CATHRIN_PALETTE.graphite,    // preset10 Light Gray
  "#4497a9": CATHRIN_PALETTE.teal,        // preset11 Steel
  "#c3c5bb": CATHRIN_PALETTE.graphite,    // preset12 Warm Gray
  "#9fadb1": CATHRIN_PALETTE.graphite,    // preset13 Gray
  "#8f8f8f": CATHRIN_PALETTE.graphite,    // preset14 Dark Gray
  "#ac4e5e": CATHRIN_PALETTE.coral,       // preset15 Dark Red
  "#df8e64": CATHRIN_PALETTE.terracotta,  // preset16 Dark Orange
  "#bc8f6f": CATHRIN_PALETTE.terracotta,  // preset17 Brown
  "#dac257": CATHRIN_PALETTE.amber,       // preset18 Gold
  "#4ca64c": CATHRIN_PALETTE.sage,        // preset19 Dark Green
  "#4bb4b7": CATHRIN_PALETTE.teal,        // preset20 Teal
  "#85b44c": CATHRIN_PALETTE.sage,        // preset21 Green
  "#4179a3": CATHRIN_PALETTE.slate,       // preset22 Navy Blue
  "#a589cb": CATHRIN_PALETTE.lavender,    // preset23 Dark Purple
  "#c34e98": CATHRIN_PALETTE.plum,        // preset24 Dark Pink

  // ─── Microsoft Outlook Classic: Category Presets ───────────────────
  "#f07d88": CATHRIN_PALETTE.coral,       // preset0  Red
  "#ff8c00": CATHRIN_PALETTE.terracotta,  // preset1  Orange
  "#fecb6f": CATHRIN_PALETTE.amber,       // preset2  Peach
  "#fff100": CATHRIN_PALETTE.amber,       // preset3  Yellow
  "#5fbe7d": CATHRIN_PALETTE.sage,        // preset4  Green
  "#33bab1": CATHRIN_PALETTE.teal,        // preset5  Teal
  "#a3b367": CATHRIN_PALETTE.sage,        // preset6  Olive
  "#55abe5": CATHRIN_PALETTE.sky,         // preset7  Blue
  "#a895e2": CATHRIN_PALETTE.lavender,    // preset8  Purple
  "#e48bb5": CATHRIN_PALETTE.rose,        // preset9  Maroon
  "#b9c0cb": CATHRIN_PALETTE.graphite,    // preset10 Steel
  "#4c596e": CATHRIN_PALETTE.slate,       // preset11 Dark Steel
  "#ababab": CATHRIN_PALETTE.graphite,    // preset12 Gray
  "#666666": CATHRIN_PALETTE.graphite,    // preset13 Dark Gray
  "#474747": CATHRIN_PALETTE.graphite,    // preset14 Black
  "#910a19": CATHRIN_PALETTE.coral,       // preset15 Dark Red
  "#ce4b28": CATHRIN_PALETTE.terracotta,  // preset16 Dark Orange
  "#a47332": CATHRIN_PALETTE.terracotta,  // preset17 Dark Peach
  "#b0a923": CATHRIN_PALETTE.amber,       // preset18 Dark Yellow
  "#026802": CATHRIN_PALETTE.sage,        // preset19 Dark Green
  "#1c6367": CATHRIN_PALETTE.teal,        // preset20 Dark Teal
  "#5c6a22": CATHRIN_PALETTE.sage,        // preset21 Dark Olive
  "#254069": CATHRIN_PALETTE.slate,       // preset22 Dark Blue
  "#562685": CATHRIN_PALETTE.plum,        // preset23 Dark Purple
  "#80275d": CATHRIN_PALETTE.plum,        // preset24 Dark Maroon

  // ─── Apple Calendar: Default Presets ───────────────────────────────
  "#fc3d39": CATHRIN_PALETTE.coral,       // Red
  "#fc9500": CATHRIN_PALETTE.terracotta,  // Orange
  "#ffcc02": CATHRIN_PALETTE.amber,       // Yellow
  "#64da38": CATHRIN_PALETTE.sage,        // Green
  "#1badf8": CATHRIN_PALETTE.sky,         // Blue
  "#cc73e1": CATHRIN_PALETTE.plum,        // Purple
  "#a2845e": CATHRIN_PALETTE.terracotta,  // Brown
};

// =============================================================================
// OKLab Perceptual Distance (fallback for unknown colors)
// =============================================================================
// OKLab is perceptually uniform — equal Euclidean distance ≈ equal perceived
// difference. Much better than RGB distance for color matching.
//
// Conversion: hex → sRGB → linear sRGB → OKLab
// Reference: Björn Ottosson, https://bottosson.github.io/posts/oklab/

type Lab = [number, number, number];

function hexToOklab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16);

  // sRGB 0–1
  let r = ((n >> 16) & 0xff) / 255;
  let g = ((n >> 8) & 0xff) / 255;
  let b = (n & 0xff) / 255;

  // Inverse sRGB companding → linear
  r = r <= 0.04045 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4;
  g = g <= 0.04045 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
  b = b <= 0.04045 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4;

  // Linear sRGB → LMS (M1)
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2220049874 * g + 0.6896925507 * b;

  // Cube root
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  // LMS → OKLab (M2)
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

function oklabDistanceSq(a: Lab, b: Lab): number {
  const dL = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dL * dL + da * da + db * db;
}

// Precompute OKLab values for the palette (runs once at module load)
const paletteEntries = Object.values(CATHRIN_PALETTE).map(
  (hex) => [hex, hexToOklab(hex)] as const,
);

const paletteHexSet = new Set<string>(Object.values(CATHRIN_PALETTE));

/**
 * Find the perceptually nearest Cathrin palette color.
 * Used as fallback when the exact hex isn't in PROVIDER_MAP.
 */
function nearestPaletteColor(hex: string): string {
  const lab = hexToOklab(hex);
  let best = paletteEntries[0][0];
  let bestDist = Infinity;

  for (const [paletteHex, paletteLab] of paletteEntries) {
    const dist = oklabDistanceSq(lab, paletteLab);
    if (dist < bestDist) {
      bestDist = dist;
      best = paletteHex;
    }
  }
  return best;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Map a provider color to the Cathrin palette.
 *
 * 1. Exact match in known provider map → use it
 * 2. Already a Cathrin palette color → pass through
 * 3. Unknown hex → nearest perceptual match via OKLab distance
 * 4. Invalid input → fallback to graphite
 */
export function mapProviderColor(color: string): string {
  if (!color || !color.startsWith("#") || color.length < 7) {
    return CATHRIN_PALETTE.graphite;
  }

  // Normalize: lowercase, strip alpha suffix (Apple sends #CC73E1FF)
  const lower = color.toLowerCase().slice(0, 7);

  // Exact provider match
  const exact = PROVIDER_MAP[lower];
  if (exact) return exact;

  // Already a Cathrin palette color (e.g. from a draft or local override)
  if (paletteHexSet.has(lower)) return lower;

  // Nearest perceptual match
  return nearestPaletteColor(lower);
}
