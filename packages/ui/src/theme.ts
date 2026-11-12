// Phase 5b: split palette into `dark` and `light` so tokens can flip on
// `useColorScheme()`. Semantic token names (bg.canvas, text.primary, etc.)
// stay stable; only raw hex values differ between modes. Mode-invariant
// pieces (accent, status, list colors, space, radius, font) are shared.
//
// Backward compat: `tokens` is still exported and points at `darkTokens`,
// so existing call sites (`tokens.bg.canvas`) keep working unchanged.
// Components that want to flip with the system color scheme should call
// `useTheme()` from `./useTheme`.

type ColorScheme = {
  bg: { canvas: string; surface: string; elevated: string };
  text: { primary: string; secondary: string; muted: string; onAccent: string };
  /**
   * `subtle` / `default` / `strong` are dividers and quiet card edges
   * (decorative, no contrast floor). `control` is the edge of anything you
   * operate (TextField box, Chip outline, secondary Button, checkbox and
   * radio rings, the off Switch track): ≥3:1 on canvas, surface and elevated
   * (WCAG 1.4.11), UX pass 5.5.
   */
  border: { subtle: string; default: string; strong: string; control: string };
};

// Neutrals are tinted warm (OKLCH hue ~66, the amber accent's hue) at very
// low chroma, so every surface belongs to one warm family instead of the
// old navy-canvas / neutral-surface mismatch. Canvas is the darkest layer;
// surface and elevated step up in lightness, not hue. Values derived in
// OKLCH and checked for WCAG AA (muted clears 4.5:1 on canvas, surface and
// elevated; `border.control` clears 3:1 on all three).
const darkColors: ColorScheme = {
  bg: { canvas: "#0E0C0B", surface: "#191715", elevated: "#24221F" },
  text: {
    primary: "#F2F0ED",
    secondary: "#A7A29E",
    // ≥4.5:1 on canvas, surface and elevated (was #86817C, 4.11:1 on elevated).
    muted: "#908B87",
    onAccent: "#0E0C0B",
  },
  border: { subtle: "#2D2926", default: "#3C3835", strong: "#55504C", control: "#726E6A" },
};

const lightColors: ColorScheme = {
  bg: { canvas: "#FEFCFA", surface: "#F7F4F2", elevated: "#EFECE9" },
  text: {
    primary: "#1F1B17",
    secondary: "#554F49",
    muted: "#726C66",
    // Accent is amber in both modes; dark text on amber stays readable.
    onAccent: "#0E0C0B",
  },
  border: {
    subtle: "#E3DFDA",
    default: "#D4CEC9",
    strong: "#AFA8A1",
    control: "#847F7B",
  },
};

const SHARED = {
  accent: { default: "#F5A524", hover: "#E89611", muted: "#F5A52422" },
  status: { success: "#3DD68C", warning: "#F5A524", danger: "#F05252" },
  list: {
    sunset: "#F5A524",
    ocean: "#4CA7E8",
    forest: "#3DD68C",
    grape: "#A78BFA",
    rose: "#F472B6",
    sand: "#D4B896",
    slate: "#94A3B8",
  },
  // `xxs` (2) and `xsm` (6) exist for optical nudges (badge offsets, icon
  // gaps); layout rhythm stays on 4 · 8 · 12 · 16 · 24 · 32.
  space: { xxs: 2, xs: 4, xsm: 6, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 6, md: 10, lg: 14, pill: 999 },
  // Durations in ms. One exponential ease-out curve (`easeOut`, cubic-bezier
  // control points) for everything that enters or changes state; exits use
  // `fast`. No bounce. Feed the curve to Reanimated with
  // `Easing.bezier(...tokens.motion.easeOut)`.
  motion: {
    fast: 150,
    base: 220,
    slow: 320,
    easeOut: [0.16, 1, 0.3, 1] as const,
  },
  // The 44pt minimum touch target, on every platform (web ignores hitSlop).
  hit: 44,
  font: {
    size: { xs: 12, sm: 13, md: 16, lg: 18, xl: 22, xxl: 28, xxxl: 34 },
    // The line height that goes with each size. `Text` variants use these;
    // a hand-set `fontSize` takes the matching step, never its own number.
    lineHeight: { xs: 16, sm: 18, md: 22, lg: 24, xl: 28, xxl: 34, xxxl: 40 },
    // Letter spacing: large text pulls in, small uppercase labels open up.
    // Body sizes take the font's own spacing (no entry).
    tracking: { display: -0.6, title: -0.4, heading: -0.2, eyebrow: 0.8 },
    weight: {
      regular: "400" as const,
      medium: "500" as const,
      semibold: "600" as const,
      bold: "700" as const,
    },
  },
} as const;

export const darkTokens = { ...darkColors, ...SHARED };
export const lightTokens = { ...lightColors, ...SHARED };

// Default `tokens` export — re-exported via `./index` and pinned to
// `darkTokens` for backward compat. Existing `tokens.bg.canvas` call
// sites still resolve against the dark palette; components that want to
// follow the system color scheme should call `useTheme()` instead.
export { darkTokens as tokens };

export type Tokens = typeof darkTokens;
export type ListColorKey = keyof typeof SHARED.list;

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;
const HEX8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/i;

/**
 * `color` at `level` opacity (0–1), as an 8-digit hex. Replaces the old
 * `${accent}1F` string concatenation: the level reads as a number, and a
 * color that already carries alpha is multiplied instead of corrupted.
 * Non-hex inputs (named colors, rgba()) are returned unchanged.
 */
export function alpha(color: string, level: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
  let rgb: string;
  let base = 1;
  const m8 = HEX8.exec(color);
  const m6 = HEX6.exec(color);
  const m3 = HEX3.exec(color);
  if (m8?.[1] && m8[2]) {
    rgb = m8[1];
    base = Number.parseInt(m8[2], 16) / 255;
  } else if (m6?.[1]) {
    rgb = m6[1];
  } else if (m3?.[1]) {
    rgb = m3[1]
      .split("")
      .map((c) => c + c)
      .join("");
  } else {
    return color;
  }
  const a = Math.round(clamped * base * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `#${rgb.toUpperCase()}${a}`;
}
