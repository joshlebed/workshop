// HighScore design tokens — the app-owned implementation of
// apps/highscore/DESIGN.md. Dark-only by decree: there is no light palette
// and no `useColorScheme()` branch anywhere in HighScore styling.
//
// Never import visual tokens from `@workshop/ui` in HighScore code — this
// module (and its sibling primitives) is the only source of color, type,
// shape, and motion values.

export const hsColor = {
  /** App background — near-black grey, slightly cool. */
  bg: "#121216",
  /** Cards, sheets — lowest purple. */
  surface1: "#1C1528",
  /** Raised elements, inputs. */
  surface2: "#251B36",
  /** Highest elevation, pressed/hover fills. */
  surface3: "#2F2244",
  /** Standard 2px bezel on cards/buttons/inputs. */
  border: "#3D2E55",
  /** Neon pink — CTAs, links, active states, selection. */
  primary: "#FF3D9A",
  primaryGlow: "rgba(255,61,154,0.45)",
  /** Small-size pink text tint (below ~15px) when contrast reads muddy. */
  primaryTint: "#FF6AB5",
  /** Neon chartreuse — success, streaks, positive scores, wins. Earned. */
  success: "#C6FF3D",
  successGlow: "rgba(198,255,61,0.40)",
  /** Neon yellow — spotlight/rank moments, brand decoration. */
  accent: "#FFE93D",
  accentGlow: "rgba(255,233,61,0.40)",
  /** Amber — sparingly; duller than `accent` on purpose. */
  warning: "#FFC53D",
  danger: "#FF4D5E",
  textPrimary: "#F2EFFA",
  textSecondary: "#A99EC2",
  /** Text on pink or chartreuse fills — dark, not white. */
  textOnNeon: "#121216",
} as const;

export const hsSpace = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Corner radius is 0 everywhere (2 max where a hard 0 renders badly on iOS). */
export const hsRadius = 0;
/** Chunky honest bezel width on cards/buttons/inputs/sheets. */
export const hsBezel = 2;

export const hsFont = {
  /** Pixel face — headings, scores, wordmark. ALL CAPS, min 10px, 1.6× line. */
  pixel: "PressStart2P_400Regular",
  size: { xs: 12, sm: 13, md: 16, lg: 18, xl: 22, xxl: 28 },
  weight: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
} as const;

// Neon glow shadows (~8–12px blur, no offset). Reserved for: primary
// buttons, focused inputs, active tab/selection, celebration moments, the
// wordmark, and `accent` spotlight moments. Nothing else glows.
export const hsGlow = {
  primary: `0px 0px 10px ${hsColor.primaryGlow}`,
  primaryStrong: `0px 0px 14px ${hsColor.primaryGlow}, 0px 0px 4px ${hsColor.primaryGlow}`,
  success: `0px 0px 10px ${hsColor.successGlow}`,
  accent: `0px 0px 10px ${hsColor.accentGlow}`,
} as const;

/** Snappy and stepped, never bouncy. Durations in ms; no springs. */
export const hsMotion = { fast: 100, base: 150 } as const;

/**
 * `contentStyle` override for the shared `<Sheet>`: purple surface, sharp
 * corners, 2px top bezel — the structural slide animation stays shared, the
 * skin is HighScore's.
 */
export const hsSheet = {
  backgroundColor: hsColor.surface1,
  borderTopLeftRadius: 0,
  borderTopRightRadius: 0,
  borderTopWidth: hsBezel,
  borderColor: hsColor.border,
} as const;
