// Phase 0 placeholder palette — see docs/redesign-plan.md §9.
// Components only reference `tokens`; `palette` is raw hex that a designer can
// edit in-place later without touching screens.

const palette = {
  ink: {
    900: "#0E0E10",
    800: "#16161A",
    700: "#1F1F25",
    600: "#26262E",
    500: "#33333D",
    400: "#4A4A56",
  },
  paper: { 50: "#F2F2F5", 200: "#A8A8B3", 400: "#6E6E78" },
  amber: { 500: "#F5A524", 600: "#E89611", muted: "#F5A52422" },
  green: { 500: "#3DD68C" },
  red: { 500: "#F05252" },
  listColors: {
    sunset: "#F5A524",
    ocean: "#4CA7E8",
    forest: "#3DD68C",
    grape: "#A78BFA",
    rose: "#F472B6",
    sand: "#D4B896",
    slate: "#94A3B8",
  },
} as const;

export const tokens = {
  bg: {
    canvas: palette.ink[900],
    surface: palette.ink[800],
    elevated: palette.ink[700],
  },
  text: {
    primary: palette.paper[50],
    secondary: palette.paper[200],
    muted: palette.paper[400],
    onAccent: palette.ink[900],
  },
  border: {
    subtle: palette.ink[600],
    default: palette.ink[500],
    strong: palette.ink[400],
  },
  accent: {
    default: palette.amber[500],
    hover: palette.amber[600],
    muted: palette.amber.muted,
  },
  status: {
    success: palette.green[500],
    warning: palette.amber[500],
    danger: palette.red[500],
  },
  list: palette.listColors,
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

export type Tokens = typeof tokens;
export type ListColorKey = keyof typeof palette.listColors;
