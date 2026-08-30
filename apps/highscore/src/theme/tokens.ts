// HighScore-owned design tokens. `apps/highscore/DESIGN.md` is the binding
// spec — palette hexes, type rules, shape, and motion all come from there.
// No visual token may be imported from `@workshop/ui` (HighScore branding
// has zero Workshop effect). Dark-only: there is no light palette.
import type { TextStyle, ViewStyle } from "react-native";

export const hs = {
  color: {
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
    /** Small-size pink text (below ~15px) where full pink reads muddy. */
    primaryTint: "#FF6AB5",
    primaryGlow: "rgba(255,61,154,0.45)",
    /** Neon chartreuse — success, streaks, positive deltas, wins. Earned. */
    success: "#C6FF3D",
    successGlow: "rgba(198,255,61,0.40)",
    /** Neon yellow — spotlight: leader crowns, "today", badges. Never tappable. */
    accent: "#FFE93D",
    accentGlow: "rgba(255,233,61,0.40)",
    /** Amber — sparingly; duller than accent on purpose. */
    warning: "#FFC53D",
    danger: "#FF4D5E",
    textPrimary: "#F2EFFA",
    textSecondary: "#A99EC2",
    /** Text on pink or chartreuse fills — dark, not white. */
    textOnNeon: "#121216",
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  /** Corner radius: 0 everywhere; 2 max where a hard 0 renders badly on iOS. */
  radius: { none: 0, hard: 2 },
  /** Chunky 2px bezel width for cards/buttons/inputs/sheets. */
  bezel: 2,
  font: {
    /** Press Start 2P — wordmark, screen titles, hero score numerals only
     * (Quiet Arcade: section headings stay system). ALL CAPS, min 10px,
     * letterSpacing ≥ 1, generous lineHeight (~1.6×). */
    pixel: "PressStart2P_400Regular",
    size: { xs: 12, sm: 13, md: 16, lg: 18, xl: 22, xxl: 28 },
    weight: {
      regular: "400",
      medium: "500",
      semibold: "600",
      bold: "700",
    } satisfies Record<string, TextStyle["fontWeight"]>,
  },
  /** Snappy and stepped, never bouncy. Plain ease-out or hard steps. */
  motion: { fast: 100, base: 150 },
} as const;

/**
 * Neon glow shadow (~8–12px blur, no offset). Reserved for: primary buttons,
 * focused inputs, active tab/selection, celebration moments, the wordmark.
 * Nothing else glows. react-native-web maps these shadow props to box-shadow.
 */
export function hsGlow(glowColor: string, radius = 10): ViewStyle {
  return {
    shadowColor: glowColor,
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: radius,
    elevation: 8,
  };
}

/** Standard 2px bezel — the only card/button/input edge treatment. */
export const hsBezel: ViewStyle = {
  borderWidth: hs.bezel,
  borderColor: hs.color.border,
  borderRadius: hs.radius.hard,
};

export type HsTokens = typeof hs;
