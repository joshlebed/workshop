// HighScore design tokens — the app-owned implementation of
// apps/highscore/DESIGN.md. Dark-only by decree: there is no light palette and
// no `useColorScheme()` branching anywhere in HighScore styling. Never import
// visual tokens from `@workshop/ui`.
//
// The spacing scale and motion signature are the UX-4 "Players × Games"
// exploration's own (see UX-EXPLORATION.md): a gapped 4·12·16·24·32 rhythm with
// no 8 step, so elements are either welded (4) or clearly apart (12+), and a
// 120ms/18ms-stagger stepped motion signature.
import { Platform, type TextStyle, type ViewStyle } from "react-native";

/** Press Start 2P — headings, scores, wordmark only. No lowercase; always ALL CAPS. */
export const PIXEL_FONT = "PressStart2P_400Regular";

/** DESIGN.md palette, verbatim. */
export const palette = {
  bg: "#121216",
  surface1: "#1C1528",
  surface2: "#251B36",
  surface3: "#2F2244",
  border: "#3D2E55",
  primary: "#FF3D9A",
  primaryGlow: "rgba(255,61,154,0.45)",
  /** Small-size pink text (<15px) where full primary reads muddy. */
  primaryTint: "#FF6AB5",
  success: "#C6FF3D",
  successGlow: "rgba(198,255,61,0.40)",
  accent: "#FFE93D",
  accentGlow: "rgba(255,233,61,0.40)",
  warning: "#FFC53D",
  danger: "#FF4D5E",
  textPrimary: "#F2EFFA",
  textSecondary: "#A99EC2",
  onNeon: "#121216",
} as const;

export const tokens = {
  bg: {
    canvas: palette.bg,
    surface: palette.surface1,
    elevated: palette.surface2,
    raised: palette.surface3,
  },
  text: {
    primary: palette.textPrimary,
    secondary: palette.textSecondary,
    muted: palette.textSecondary,
    onAccent: palette.onNeon,
  },
  border: {
    subtle: palette.border,
    default: palette.border,
    strong: palette.border,
  },
  // Pink is the one interactive color: CTAs, links, active states, selection.
  accent: {
    default: palette.primary,
    hover: palette.primaryTint,
    muted: "rgba(255,61,154,0.14)",
  },
  neon: {
    pink: palette.primary,
    pinkGlow: palette.primaryGlow,
    pinkTint: palette.primaryTint,
    chartreuse: palette.success,
    chartreuseGlow: palette.successGlow,
    yellow: palette.accent,
    yellowGlow: palette.accentGlow,
  },
  status: {
    success: palette.success,
    warning: palette.warning,
    danger: palette.danger,
  },
  // 4 · 12 · 16 · 24 · 32 · 48. The 8 step is deliberately missing: things are
  // either welded together (4) or plainly separated (12+), never in between.
  space: { xs: 4, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 },
  // Corner radius 0 everywhere (2 max where hard 0 renders badly on iOS).
  radius: { sm: 0, md: 0, lg: 0, pill: 0 },
  /** Standard bezel width — cards, buttons, inputs, sheets. */
  bezel: 2,
  font: {
    pixel: PIXEL_FONT,
    size: { xs: 12, sm: 13, md: 16, lg: 18, xl: 22, xxl: 28 },
    weight: {
      regular: "400" as const,
      medium: "500" as const,
      semibold: "600" as const,
      bold: "700" as const,
    },
  },
  // Snappy and stepped, never bouncy. `stagger` is the per-row delay in the
  // projection flip; `shift` is how far a row travels on entry.
  motion: { fast: 100, base: 120, slow: 150, stagger: 18, staggerMax: 6, shift: 8 },
} as const;

export type Tokens = typeof tokens;

/**
 * Neon glow shadow. Reserved for: primary buttons, focused inputs, the active
 * projection/key, streak & new-high-score celebration, the wordmark, and
 * `accent` spotlight moments (the daily crown). Nothing else glows.
 */
export function glow(color: string, radius = 10): ViewStyle {
  if (Platform.OS === "web") {
    // react-native-web maps shadow* props, but an explicit boxShadow renders
    // the crisper halo we want and avoids RNW's shadow deprecation warnings.
    return { boxShadow: `0 0 ${radius}px ${color}` } as ViewStyle;
  }
  return {
    shadowColor: color,
    shadowOpacity: 1,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: 0 },
  };
}

/**
 * Pixel-face text style helper. Press Start 2P clips tight line boxes, so
 * every use gets ~1.6× lineHeight and ≥1 letterSpacing; it has no lowercase,
 * so ALL CAPS is applied deliberately.
 */
export function pixelType(fontSize: number, lineScale = 1.6): TextStyle {
  return {
    fontFamily: PIXEL_FONT,
    fontSize,
    lineHeight: Math.round(fontSize * lineScale),
    letterSpacing: 1,
    textTransform: "uppercase",
  };
}

/** Monospace body face — raw pasted results, recap previews. */
export const MONO_FONT = Platform.OS === "ios" ? "Menlo" : "monospace";
