// HighScore theme tokens — the app-owned implementation of DESIGN.md ("A dark
// arcade"). Dark-only by rule: there is no light palette and no
// `useColorScheme()` branch anywhere in HighScore styling. Nothing here may be
// imported from `@workshop/ui` (HighScore branding has zero Workshop effect).

import { Platform, type TextStyle } from "react-native";

export const colors = {
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
  /** Neon pink — the one interactive color: CTAs, links, active states. */
  primary: "#FF3D9A",
  primaryGlow: "rgba(255,61,154,0.45)",
  /** Small-size pink text tint when full pink reads muddy below ~15px. */
  primaryTint: "#FF6AB5",
  /** Neon chartreuse — earned: success, streaks, positive deltas, wins. */
  success: "#C6FF3D",
  successGlow: "rgba(198,255,61,0.40)",
  /** Neon yellow — the spotlight: #1 rank, "today", badges, brand accent. */
  accent: "#FFE93D",
  accentGlow: "rgba(255,233,61,0.40)",
  /** Amber — sparingly; duller than `accent` on purpose. */
  warning: "#FFC53D",
  danger: "#FF4D5E",
  textPrimary: "#F2EFFA",
  textSecondary: "#A99EC2",
  /** Text on pink or chartreuse fills (dark, not white). */
  textOnNeon: "#121216",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Corner radius is 0 everywhere; 2 only where a hard 0 renders badly on iOS. */
export const radius = { none: 0, soft: 2 } as const;

/** Chunky and honest: the standard bezel width. */
export const bezel = 2;

export const font = {
  /** Press Start 2P — headings + scores ONLY; it has no lowercase, set ALL CAPS. */
  pixel: "PressStart2P_400Regular",
  size: { xs: 12, sm: 13, md: 16, lg: 18, xl: 22, xxl: 28 },
  weight: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
} as const;

/**
 * A ready Press Start 2P text style. Minimum size 10; letterSpacing ≥ 1 and a
 * generous ~1.6× lineHeight because the face clips tight line boxes.
 */
export function pixelType(size: number): TextStyle {
  return {
    fontFamily: font.pixel,
    fontSize: size,
    lineHeight: Math.round(size * 1.6),
    letterSpacing: 1,
    textTransform: "uppercase",
  };
}

/**
 * Neon glow — the only shadow in the app. Reserved for: primary buttons,
 * focused inputs, active tab/selection, celebration moments, the wordmark,
 * and `accent` spotlight moments (#1 rank). Nothing else glows.
 */
export function glow(glowColor: string, blur = 10) {
  return Platform.OS === "web"
    ? { boxShadow: `0 0 ${blur}px ${glowColor}` }
    : {
        shadowColor: glowColor,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: blur,
        elevation: 6,
      };
}

/** Snappy and stepped, never bouncy: 100–150ms, plain ease-out. */
export const motion = { fast: 100, base: 150 } as const;

/** Shared home-screen inset (was `homeLayout.horizontalInset` in @workshop/ui). */
export const layout = { horizontalInset: space.xl } as const;
