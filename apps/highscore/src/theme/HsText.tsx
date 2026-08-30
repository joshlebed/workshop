// HighScore's text primitive. Pixel variants set Press Start 2P (headings,
// scores, hero numerals — always ALL CAPS, generous line height, tracking ≥1);
// body variants stay on the system face per DESIGN.md.

import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { hsColor, hsFont } from "./tokens";

type Variant =
  | "pixelTitle" // screen titles — 18px pixel
  | "pixelHeading" // section headings — 14px pixel
  | "pixelLabel" // small pixel labels/badges — 10px pixel
  | "score" // score/number columns — pixel is effectively monospace
  | "hero" // big celebratory numerals — 32px pixel
  | "body"
  | "label"
  | "caption";

type Tone =
  | "primary"
  | "secondary"
  | "pink"
  | "pinkTint"
  | "success"
  | "accent"
  | "danger"
  | "onNeon";

const pixelBase: TextStyle = {
  fontFamily: hsFont.pixel,
  textTransform: "uppercase",
  letterSpacing: 1,
};

const variantStyle: Record<Variant, TextStyle> = {
  pixelTitle: { ...pixelBase, fontSize: 18, lineHeight: 29 },
  pixelHeading: { ...pixelBase, fontSize: 14, lineHeight: 23 },
  pixelLabel: { ...pixelBase, fontSize: 10, lineHeight: 16 },
  score: { ...pixelBase, fontSize: 12, lineHeight: 20 },
  hero: { ...pixelBase, fontSize: 32, lineHeight: 52 },
  body: { fontSize: hsFont.size.md, lineHeight: 22, fontWeight: hsFont.weight.regular },
  label: { fontSize: hsFont.size.sm, lineHeight: 18, fontWeight: hsFont.weight.medium },
  caption: { fontSize: hsFont.size.xs, lineHeight: 16, fontWeight: hsFont.weight.regular },
};

const toneColor: Record<Tone, string> = {
  primary: hsColor.textPrimary,
  secondary: hsColor.textSecondary,
  pink: hsColor.primary,
  pinkTint: hsColor.primaryTint,
  success: hsColor.success,
  accent: hsColor.accent,
  danger: hsColor.danger,
  onNeon: hsColor.textOnNeon,
};

export interface HsTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
}

export function HsText({ variant = "body", tone = "primary", style, ...rest }: HsTextProps) {
  return <RNText {...rest} style={[variantStyle[variant], { color: toneColor[tone] }, style]} />;
}
