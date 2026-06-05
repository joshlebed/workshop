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
  border: { subtle: string; default: string; strong: string };
};

// Neutrals are tinted warm (OKLCH hue ~66, the amber accent's hue) at very
// low chroma, so every surface belongs to one warm family instead of the
// old navy-canvas / neutral-surface mismatch. Canvas is the darkest layer;
// surface and elevated step up in lightness, not hue. Values derived in
// OKLCH and checked for WCAG AA (muted clears 4.5:1 on canvas + surface).
const darkColors: ColorScheme = {
  bg: { canvas: "#0E0C0B", surface: "#191715", elevated: "#24221F" },
  text: {
    primary: "#F2F0ED",
    secondary: "#A7A29E",
    muted: "#86817C",
    onAccent: "#0E0C0B",
  },
  border: { subtle: "#2D2926", default: "#3C3835", strong: "#55504C" },
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
  border: { subtle: "#E3DFDA", default: "#D4CEC9", strong: "#AFA8A1" },
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
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 6, md: 10, lg: 14, pill: 999 },
  font: {
    size: { xs: 12, sm: 13, md: 16, lg: 18, xl: 22, xxl: 28 },
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
