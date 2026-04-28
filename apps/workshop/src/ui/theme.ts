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

const darkColors: ColorScheme = {
  bg: { canvas: "#0E0E10", surface: "#16161A", elevated: "#1F1F25" },
  text: {
    primary: "#F2F2F5",
    secondary: "#A8A8B3",
    muted: "#6E6E78",
    onAccent: "#0E0E10",
  },
  border: { subtle: "#26262E", default: "#33333D", strong: "#4A4A56" },
};

const lightColors: ColorScheme = {
  bg: { canvas: "#FAFAFB", surface: "#F2F2F5", elevated: "#E6E6EC" },
  text: {
    primary: "#16161A",
    secondary: "#5A5A66",
    muted: "#8E8E98",
    // Accent is amber in both modes; dark text on amber stays readable.
    onAccent: "#0E0E10",
  },
  border: { subtle: "#DCDCE2", default: "#C8C8D0", strong: "#A8A8B3" },
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
    size: { xs: 12, sm: 14, md: 16, lg: 20, xl: 28, xxl: 36 },
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
