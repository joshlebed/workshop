// HighScore theme tokens — the app-owned implementation of DESIGN.md.
// Every value here is either a literal from the brief's palette table or a
// direct consequence of its shape/type/motion rules. No visual token may be
// imported from @workshop/ui (repo rule: HighScore branding has zero
// Workshop effect); HighScore surfaces style from this module instead.

/** DESIGN.md palette, dark-only. Exact hexes from the brief. */
export const hs = {
  color: {
    bg: "#121216",
    surface1: "#1C1528",
    surface2: "#251B36",
    surface3: "#2F2244",
    border: "#3D2E55",
    primary: "#FF3D9A",
    primaryGlow: "rgba(255,61,154,0.45)",
    /** Small-size pink tint for text below ~15px where contrast reads muddy. */
    primaryTint: "#FF6AB5",
    success: "#C6FF3D",
    successGlow: "rgba(198,255,61,0.40)",
    accent: "#FFE93D",
    accentGlow: "rgba(255,233,61,0.40)",
    warning: "#FFC53D",
    danger: "#FF4D5E",
    textPrimary: "#F2EFFA",
    textSecondary: "#A99EC2",
    /** Dark-on-neon: text on pink/chartreuse fills reads as a lit sign. */
    textOnPrimary: "#121216",
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  /** Corner radius 0 everywhere; 2 max where a hard 0 renders badly on iOS. */
  radius: 0,
  radiusSoft: 2,
  /** Standard chunky bezel width on cards/buttons/inputs/sheets. */
  bezel: 2,
  font: {
    /** Pixel face — headings, scores, wordmark. ALL CAPS, min 10px. */
    pixel: "PressStart2P_400Regular",
    size: { xs: 12, sm: 13, md: 16, lg: 18, xl: 22, xxl: 28 },
    weight: {
      regular: "400" as const,
      medium: "500" as const,
      semibold: "600" as const,
      bold: "700" as const,
    },
  },
  /** Neon glow shadows (~8–12px blur, no offset). Reserved elements only. */
  glow: {
    primary: "0px 0px 10px rgba(255,61,154,0.45)",
    success: "0px 0px 10px rgba(198,255,61,0.40)",
    accent: "0px 0px 10px rgba(255,233,61,0.40)",
  },
  /** Snappy and stepped, never bouncy. */
  motion: { fast: 100, base: 150 },
} as const;

// Compat layer: same shape as @workshop/ui's `Tokens`, resolved to the
// arcade palette. Lets HighScore files keep `tokens.bg.canvas`-style call
// sites (and pass values into shared presentational components as props)
// while every color comes from DESIGN.md. Radii collapse to sharp corners.
export const tokens = {
  bg: { canvas: hs.color.bg, surface: hs.color.surface1, elevated: hs.color.surface2 },
  text: {
    primary: hs.color.textPrimary,
    secondary: hs.color.textSecondary,
    muted: hs.color.textSecondary,
    onAccent: hs.color.textOnPrimary,
  },
  border: { subtle: hs.color.border, default: hs.color.border, strong: hs.color.border },
  // Pink is the one interactive color — anything a shared call site paints
  // with "accent" (CTAs, active states, selection) must land on primary pink.
  accent: {
    default: hs.color.primary,
    hover: hs.color.primaryTint,
    muted: `${hs.color.primary}22`,
  },
  status: { success: hs.color.success, warning: hs.color.warning, danger: hs.color.danger },
  space: hs.space,
  radius: { sm: hs.radius, md: hs.radius, lg: hs.radiusSoft, pill: hs.radiusSoft },
  font: { size: hs.font.size, weight: hs.font.weight },
} as const;

export type HsTokens = typeof hs;
