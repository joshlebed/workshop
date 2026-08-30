// HighScore text primitive. Same variant/tone API surface as @workshop/ui's
// Text so restyled call sites are drop-in swaps, but headings render in the
// pixel face (Press Start 2P, ALL CAPS, generous line height — the face has
// no lowercase and clips tight line boxes) while body copy stays the system
// face, per DESIGN.md typography rules.

import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { hs } from "./tokens";

type Variant = "title" | "heading" | "body" | "caption" | "label" | "pixel";
type Tone =
  | "primary"
  | "secondary"
  | "muted"
  | "onAccent"
  | "danger"
  | "accent"
  | "neon"
  | "success";

const pixelBase: TextStyle = {
  fontFamily: hs.font.pixel,
  textTransform: "uppercase",
  letterSpacing: 1,
};

const variantStyle: Record<Variant, TextStyle> = {
  // Screen titles — pixel face, ~1.6× line height.
  title: { ...pixelBase, fontSize: 20, lineHeight: 32 },
  // Section headings — pixel face at 14px.
  heading: { ...pixelBase, fontSize: 14, lineHeight: 24 },
  // Small pixel accents (badges, tab labels) — brief minimum 10px.
  pixel: { ...pixelBase, fontSize: 10, lineHeight: 16 },
  body: { fontSize: hs.font.size.md, lineHeight: 22, fontWeight: hs.font.weight.regular },
  caption: { fontSize: hs.font.size.xs, lineHeight: 16, fontWeight: hs.font.weight.regular },
  label: { fontSize: hs.font.size.sm, lineHeight: 18, fontWeight: hs.font.weight.medium },
};

const toneColor: Record<Tone, string> = {
  primary: hs.color.textPrimary,
  secondary: hs.color.textSecondary,
  muted: hs.color.textSecondary,
  onAccent: hs.color.textOnPrimary,
  danger: hs.color.danger,
  accent: hs.color.accent,
  neon: hs.color.primary,
  success: hs.color.success,
};

export interface HSTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
}

export function Text({ variant = "body", tone = "primary", style, ...rest }: HSTextProps) {
  return <RNText {...rest} style={[variantStyle[variant], { color: toneColor[tone] }, style]} />;
}
