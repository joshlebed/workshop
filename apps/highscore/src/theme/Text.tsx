import type { ComponentProps } from "react";
import { Platform, Text as RNText, type TextProps, type TextStyle } from "react-native";
import Animated from "react-native-reanimated";
import { pixelType, tokens } from "./tokens";

type Variant = "display" | "title" | "heading" | "score" | "data" | "body" | "caption" | "label";
type Tone =
  | "primary"
  | "secondary"
  | "muted"
  | "onAccent"
  | "danger"
  | "link"
  | "success"
  | "spotlight";

// display/title/heading/score render in Press Start 2P (ALL CAPS, generous
// line height — the face clips tight line boxes); body/caption/label stay on
// the system face per DESIGN.md ("pixel type is for headings + scores only").
const variantStyle: Record<Variant, TextStyle> = {
  display: pixelType(24),
  title: pixelType(18),
  heading: pixelType(13),
  // Score numerals — effectively monospace, so columns align. Override
  // fontSize freely via `style`; hero numerals go up to 40+.
  score: pixelType(14),
  // Raw share text, timestamps, URLs — anything the app is quoting rather
  // than composing. Monospace so pasted grids keep their columns.
  data: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    lineHeight: 18,
  },
  body: { fontSize: tokens.font.size.md, lineHeight: 22, fontWeight: tokens.font.weight.regular },
  caption: {
    fontSize: tokens.font.size.xs,
    lineHeight: 16,
    fontWeight: tokens.font.weight.regular,
  },
  label: { fontSize: tokens.font.size.sm, lineHeight: 18, fontWeight: tokens.font.weight.medium },
};

const toneColor: Record<Tone, string> = {
  primary: tokens.text.primary,
  secondary: tokens.text.secondary,
  muted: tokens.text.muted,
  onAccent: tokens.text.onAccent,
  danger: tokens.status.danger,
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
