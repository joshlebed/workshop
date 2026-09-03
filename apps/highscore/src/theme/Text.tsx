import type { ComponentProps } from "react";
import { Platform, Text as RNText, type TextProps, type TextStyle } from "react-native";
import Animated from "react-native-reanimated";
import { pixelType, tokens } from "./tokens";

type Variant =
  | "hero"
  | "display"
  | "title"
  | "heading"
  | "eyebrow"
  | "score"
  | "body"
  | "caption"
  | "label"
  | "mono";
type Tone =
  | "primary"
  | "secondary"
  | "muted"
  | "onAccent"
  | "danger"
  | "warning"
  | "link"
  | "success"
  | "spotlight";

// hero/display/title/heading/eyebrow/score render in Press Start 2P (ALL CAPS,
// generous line height — the face clips tight line boxes); body/caption/label
// stay on the system face per DESIGN.md ("pixel type is for headings + scores
// only"). `mono` is the pasted-share grid: system monospace, never the pixel
// face (emoji grids need a real mono metric, not a bitmap one).
const variantStyle: Record<Variant, TextStyle> = {
  hero: { ...pixelType(38), lineHeight: 42, letterSpacing: 0 },
  display: pixelType(20),
  title: pixelType(15),
  heading: pixelType(12),
  eyebrow: { ...pixelType(10), letterSpacing: 2 },
  // Score numerals — effectively monospace, so columns align.
  score: pixelType(13),
  body: { fontSize: tokens.font.size.md, lineHeight: 21, fontWeight: tokens.font.weight.regular },
  caption: {
    fontSize: tokens.font.size.xs,
    lineHeight: 16,
    fontWeight: tokens.font.weight.regular,
  },
  label: { fontSize: tokens.font.size.sm, lineHeight: 18, fontWeight: tokens.font.weight.medium },
  mono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: tokens.font.size.sm,
    lineHeight: tokens.font.size.sm + 5,
  },
};

const toneColor: Record<Tone, string> = {
  primary: tokens.text.primary,
  secondary: tokens.text.secondary,
  muted: tokens.text.muted,
  onAccent: tokens.text.onAccent,
  danger: tokens.status.danger,
  // Amber. Warnings only — spotlight yellow is a separate tone.
  warning: tokens.status.warning,
  // Pink = tappable/interactive text. Tint variant for small sizes is the
  // caller's call (`tokens.neon.pinkTint`).
  link: tokens.neon.pink,
  // Chartreuse is earned: success, streaks, personal bests only.
  success: tokens.neon.chartreuse,
  // Yellow spotlights the leader / today / badges — never CTAs.
  spotlight: tokens.neon.yellow,
};

export interface HSTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
}

export function Text({ variant = "body", tone = "primary", style, ...rest }: HSTextProps) {
  return <RNText {...rest} style={[variantStyle[variant], { color: toneColor[tone] }, style]} />;
}

const AnimatedRNText = Animated.createAnimatedComponent(RNText);

type AnimatedRNTextProps = ComponentProps<typeof AnimatedRNText>;

export interface HSAnimatedTextProps extends AnimatedRNTextProps {
  variant?: Variant;
  tone?: Tone;
}

export function AnimatedText({
  variant = "body",
  tone = "primary",
  style,
  ...rest
}: HSAnimatedTextProps) {
  return (
    <AnimatedRNText {...rest} style={[variantStyle[variant], { color: toneColor[tone] }, style]} />
  );
}
