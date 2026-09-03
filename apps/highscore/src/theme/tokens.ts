// HighScore design tokens — the app-owned implementation of
// apps/highscore/DESIGN.md, tuned for the "Gesture Dock" exploration. Dark-only
// by decree: there is no light palette and no `useColorScheme()` branching
// anywhere in HighScore styling. Never import visual tokens from `@workshop/ui`.
//
// The spacing rhythm is a 6px base (2 / 6 / 12 / 18 / 24 / 36) rather than the
// usual 4-or-8 grid — see UX-EXPLORATION.md. Everything on a screen lands on a
// multiple of 6, which is what makes the pixel bezels and the 24px icon grid
// line up without half-pixel seams.

import { Platform, type TextStyle, type ViewStyle } from "react-native";
import { Easing, type EasingFunction } from "react-native-reanimated";

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

// Keyed to mirror the shared `@workshop/ui` token shape so call sites port
// over with mechanical `tokens.x.y` edits, plus DESIGN.md-native `neon` names.
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
  // Pink is the one interactive color: CTAs, links, tab-active, focus, selection.
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
  space: { xs: 2, sm: 6, md: 12, lg: 18, xl: 24, xxl: 36 },
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
  // Snappy and stepped, never bouncy. `steps` is the number of discrete frames
  // a transition is quantized into — the arcade "attract mode" feel.
  motion: { fast: 100, base: 140, steps: 4 },
} as const;

export type Tokens = typeof tokens;

/**
 * Neon glow shadow. Reserved for: primary buttons, focused inputs, the active
 * tab/selection, streak & new-high-score celebration, the wordmark, and
 * `accent` spotlight moments. Nothing else glows.
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
export function pixelType(fontSize: number): TextStyle {
  return {
    fontFamily: PIXEL_FONT,
    fontSize,
    lineHeight: Math.round(fontSize * 1.6),
    letterSpacing: 1,
    textTransform: "uppercase",
  };
}

/**
 * The app's one motion curve: `motion.steps` hard frames, no interpolation
 * between them, no overshoot. Pass to `withTiming`'s `easing`.
 */
export const stepped: EasingFunction = Easing.steps(tokens.motion.steps, true);

/** Quantize a continuous drag offset onto the 6px rhythm. */
export function snapToRhythm(value: number, unit = 6): number {
  "worklet";
  return Math.round(value / unit) * unit;
}

/**
 * Text-level neon. `glow()` draws a box halo, which is wrong on a glyph — this
 * lights the letterforms themselves. Same restraint rules apply: wordmark,
 * spotlight ranks, celebration only.
 */
export function textGlow(color: string, radius = 10): TextStyle {
  // react-native-web 0.21 deprecates the split `textShadow*` props in favour of
  // the CSS shorthand; RN still needs the split form.
  if (Platform.OS === "web") return { textShadow: `0 0 ${radius}px ${color}` } as TextStyle;
  return {
    textShadowColor: color,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: radius,
  };
}
