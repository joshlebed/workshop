import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { hs } from "./tokens";

// Quiet Arcade type scale. Press Start 2P is confined to the wordmark,
// top-level screen titles, and hero score numerals — everything else is the
// system face. Pixel variants force ALL CAPS (the face has no lowercase).
type Variant =
  | "pixelTitle" // top-level screen titles
  | "pixelHero" // hero score numerals / big celebratory numbers
  | "pixelSmall" // small pixel accents (wordmark-adjacent, min 10px)
  | "title" // system large title (non-top-level)
  | "heading" // section headings — system semibold, per Quiet Arcade
  | "body"
  | "label"
  | "caption";

type Tone =
  | "primary"
  | "secondary"
  | "link" // pink — tappable text
  | "success" // chartreuse — earned
  | "accent" // yellow — spotlight only
  | "danger"
  | "onNeon";

const variantStyle: Record<Variant, TextStyle> = {
  // Press Start 2P clips tight line boxes — keep ~1.6× line height and
  // letterSpacing ≥ 1 per the brief.
  pixelTitle: {
    fontFamily: hs.font.pixel,
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  pixelHero: {
    fontFamily: hs.font.pixel,
    fontSize: 32,
    lineHeight: 52,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  pixelSmall: {
    fontFamily: hs.font.pixel,
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    fontSize: hs.font.size.xl,
    lineHeight: 28,
    fontWeight: hs.font.weight.semibold,
    letterSpacing: -0.2,
  },
  heading: {
    fontSize: hs.font.size.lg,
    lineHeight: 24,
    fontWeight: hs.font.weight.semibold,
  },
  body: { fontSize: hs.font.size.md, lineHeight: 22, fontWeight: hs.font.weight.regular },
  label: { fontSize: hs.font.size.sm, lineHeight: 18, fontWeight: hs.font.weight.medium },
  caption: { fontSize: hs.font.size.xs, lineHeight: 16, fontWeight: hs.font.weight.regular },
};

const toneColor: Record<Tone, string> = {
  primary: hs.color.textPrimary,
  secondary: hs.color.textSecondary,
  link: hs.color.primary,
  success: hs.color.success,
  accent: hs.color.accent,
  danger: hs.color.danger,
  onNeon: hs.color.textOnNeon,
};

export interface HsTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
}

export function HsText({ variant = "body", tone = "primary", style, ...rest }: HsTextProps) {
  return <RNText {...rest} style={[variantStyle[variant], { color: toneColor[tone] }, style]} />;
}
