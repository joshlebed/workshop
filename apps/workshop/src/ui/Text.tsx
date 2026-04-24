import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { tokens } from "./theme";

type Variant = "title" | "heading" | "body" | "caption" | "label";
type Tone = "primary" | "secondary" | "muted" | "onAccent" | "danger";

const variantStyle: Record<Variant, TextStyle> = {
  title: { fontSize: tokens.font.size.xxl, fontWeight: tokens.font.weight.bold },
  heading: { fontSize: tokens.font.size.xl, fontWeight: tokens.font.weight.semibold },
  body: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.regular },
  caption: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.regular },
  label: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.medium },
};

const toneColor: Record<Tone, string> = {
  primary: tokens.text.primary,
  secondary: tokens.text.secondary,
  muted: tokens.text.muted,
  onAccent: tokens.text.onAccent,
  danger: tokens.status.danger,
};

export interface UITextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
}

export function Text({ variant = "body", tone = "primary", style, ...rest }: UITextProps) {
  return <RNText {...rest} style={[variantStyle[variant], { color: toneColor[tone] }, style]} />;
}
