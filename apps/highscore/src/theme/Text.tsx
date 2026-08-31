// HighScore-owned Text. Mirrors the shared component's API (variant/tone) so
// swapping the import restyles a screen, but implements DESIGN.md type rules:
// `title` and `heading` are Press Start 2P ALL CAPS; body/caption/label stay
// on the system face. `score` is the pixel numeral style for standings.

import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { colors, font, pixelType } from "./tokens";

type Variant = "title" | "heading" | "body" | "caption" | "label" | "score";
type Tone =
  | "primary"
  | "secondary"
  | "muted"
  | "onNeon"
  | "onAccent"
  | "danger"
  | "pink"
  | "success"
  | "accent";

const variantStyle: Record<Variant, TextStyle> = {
  title: pixelType(20),
  heading: pixelType(14),
  body: { fontSize: font.size.md, lineHeight: 22, fontWeight: font.weight.regular },
  caption: { fontSize: font.size.xs, lineHeight: 16, fontWeight: font.weight.regular },
  label: { fontSize: font.size.sm, lineHeight: 18, fontWeight: font.weight.medium },
  score: pixelType(11),
};

const toneColor: Record<Tone, string> = {
  primary: colors.textPrimary,
  secondary: colors.textSecondary,
  muted: colors.textSecondary,
  onNeon: colors.textOnNeon,
  // Back-compat alias for call sites written against the shared Text.
  onAccent: colors.textOnNeon,
  danger: colors.danger,
  pink: colors.primary,
  success: colors.success,
  accent: colors.accent,
};

export interface HSTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
}

export function Text({ variant = "body", tone = "primary", style, ...rest }: HSTextProps) {
  return <RNText {...rest} style={[variantStyle[variant], { color: toneColor[tone] }, style]} />;
}
